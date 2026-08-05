"use client";

import type { AuditSyncResponse, ClientAuditEvent } from "@/lib/api/types";
import { getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";

const DB_NAME = "engine-flow-audit";
const DB_VERSION = 1;
const EVENTS_STORE = "pending_audit_events";
const META_STORE = "sync_metadata";
const LAST_EVENT_HASH_KEY = "last_event_hash";

type SyncState = "synced" | "buffered_offline" | "sync_failed";

function stableSerialize(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableSerialize(entry)).join(",")}]`;
  }

  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(String(value));
}

async function sha256(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const buffer = encoder.encode(value);

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
  }

  let hash = 0;
  for (const byte of buffer) {
    hash = (hash * 31 + byte) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(EVENTS_STORE)) {
        db.createObjectStore(EVENTS_STORE, { keyPath: "event_id" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
  });
}

function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  executor: (store: IDBObjectStore) => Promise<T> | T
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);

        Promise.resolve(executor(store))
          .then((result) => {
            tx.oncomplete = () => {
              db.close();
              resolve(result);
            };
            tx.onerror = () => {
              db.close();
              reject(tx.error ?? new Error("IndexedDB transaction failed"));
            };
          })
          .catch((error) => {
            db.close();
            reject(error);
          });
      })
  );
}

async function getMetadata(key: string): Promise<string | null> {
  return withStore(META_STORE, "readonly", (store) => {
    return new Promise<string | null>((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve((request.result as string | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB get metadata failed"));
    });
  });
}

async function setMetadata(key: string, value: string): Promise<void> {
  await withStore(META_STORE, "readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("IndexedDB put metadata failed"));
    });
  });
}

async function putEvent(event: ClientAuditEvent): Promise<void> {
  await withStore(EVENTS_STORE, "readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      const request = store.put(event);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("IndexedDB put event failed"));
    });
  });
}

async function deleteEvents(eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) {
    return;
  }

  await withStore(EVENTS_STORE, "readwrite", (store) => {
    return new Promise<void>((resolve, reject) => {
      for (const eventId of eventIds) {
        store.delete(eventId);
      }
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => reject(store.transaction.error ?? new Error("IndexedDB delete events failed"));
    });
  });
}

export async function getPendingAuditEvents(): Promise<ClientAuditEvent[]> {
  if (!isBrowser()) {
    return [];
  }

  return withStore(EVENTS_STORE, "readonly", (store) => {
    return new Promise<ClientAuditEvent[]>((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const events = (request.result as ClientAuditEvent[]).sort((left, right) =>
          left.created_at.localeCompare(right.created_at)
        );
        resolve(events);
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB read pending events failed"));
    });
  });
}

export async function createClientAuditEvent(input: {
  event_type: ClientAuditEvent["event_type"];
  execution_signature: string;
  case_id?: string | null;
  diagnosis_id?: string | null;
  payload: Record<string, unknown>;
}): Promise<ClientAuditEvent> {
  const createdAt = new Date().toISOString();
  const previousEventHash = isBrowser() ? await getMetadata(LAST_EVENT_HASH_KEY) : null;
  const payloadHash = await sha256(stableSerialize(input.payload));
  const baseEvent = {
    event_id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `audit-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    event_type: input.event_type,
    created_at: createdAt,
    execution_signature: input.execution_signature,
    payload_hash: payloadHash,
    previous_event_hash: previousEventHash,
    case_id: input.case_id ?? null,
    diagnosis_id: input.diagnosis_id ?? null,
    payload: input.payload,
  } satisfies ClientAuditEvent;

  return baseEvent;
}

export async function queueClientAuditEvent(event: ClientAuditEvent): Promise<void> {
  if (!isBrowser()) {
    return;
  }

  await putEvent(event);
  const eventHash = await sha256(stableSerialize(event));
  await setMetadata(LAST_EVENT_HASH_KEY, eventHash);
}

export async function syncPendingAuditEvents(fetchImpl: typeof fetch = fetch): Promise<{
  state: SyncState;
  response?: AuditSyncResponse;
}> {
  if (!isBrowser()) {
    return { state: "synced" };
  }

  const pendingEvents = await getPendingAuditEvents();
  const validEvents: ClientAuditEvent[] = [];
  const invalidEventIds: string[] = [];
  for (const event of pendingEvents) {
    const isValid = Boolean(
      event.event_id &&
      event.event_type &&
      event.created_at &&
      event.execution_signature &&
      event.payload &&
      event.payload_hash === (await sha256(stableSerialize(event.payload)))
    );
    if (isValid) validEvents.push(event);
    else invalidEventIds.push(event.event_id);
  }
  if (invalidEventIds.length > 0) await deleteEvents(invalidEventIds);
  if (validEvents.length === 0) {
    return { state: "synced" };
  }

  try {
    const headers = new Headers({ "Content-Type": "application/json" });
    if (getApps().length === 0) {
      return { state: "buffered_offline" };
    }
    const user = getAuth(getApp()).currentUser;
    if (!user) {
      return { state: "buffered_offline" };
    }
    headers.set("Authorization", `Bearer ${await user.getIdToken()}`);

    const response = await fetchImpl("/api/efl-core/audit/sync", {
      method: "POST",
      headers,
      body: JSON.stringify({ events: validEvents }),
    });

    if (!response.ok) {
      return { state: response.status >= 500 ? "sync_failed" : "buffered_offline" };
    }

    const syncResponse = (await response.json()) as AuditSyncResponse;
    await deleteEvents(syncResponse.synced_event_ids);
    const durableSinkFailed = syncResponse.durable_sink_state === "forward_failed";
    return {
      state: syncResponse.failed > 0 || durableSinkFailed ? "sync_failed" : "synced",
      response: syncResponse,
    };
  } catch {
    return { state: "buffered_offline" };
  }
}

/**
 * Register automatic sync listener when network connection recovers ('online' event).
 */
export function registerAutoSyncListener(): () => void {
  if (!isBrowser()) {
    return () => {};
  }
  const handleOnline = () => {
    void syncPendingAuditEvents();
  };
  window.addEventListener("online", handleOnline);
  // Also attempt sync on initial registration
  void syncPendingAuditEvents();
  return () => {
    window.removeEventListener("online", handleOnline);
  };
}
