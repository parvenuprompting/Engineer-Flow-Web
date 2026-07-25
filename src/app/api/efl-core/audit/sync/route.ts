import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import type { AuditSyncPayload, ClientAuditEvent } from "@/lib/api/types";
import { getEflHealthSnapshot } from "@/efl_core/health";
import {
  getAuditStoreHealth,
  listPendingLucidAuditMirrorEvents,
  storeClientAuditSyncRecords,
  storeLucidAuditForwardStatuses,
} from "../../_store";
import { forwardAuditEventsToLucidBackend } from "../_durable_sink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

function hashPayload(payload: unknown): string {
  return createHash("sha256").update(stableSerialize(payload)).digest("hex");
}

function isClientAuditEvent(value: unknown): value is ClientAuditEvent {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  return (
    typeof record.event_id === "string" &&
      typeof record.event_type === "string" &&
      typeof record.created_at === "string" &&
      typeof record.execution_signature === "string" &&
      typeof record.payload_hash === "string" &&
      (typeof record.previous_event_hash === "string" || record.previous_event_hash === null) &&
      typeof record.payload === "object" &&
      record.payload !== null
  );
}

export async function POST(req: Request) {
  try {
    const auditStoreHealth = getAuditStoreHealth();
    const healthSnapshot = getEflHealthSnapshot(auditStoreHealth.audit_store_ok);
    if (!healthSnapshot.integrity_ok) {
      return NextResponse.json(
        {
          code: "EFL_CORE_UNHEALTHY",
          detail: "Canonieke datasets of version manifest zijn niet valide. Audit sync is geblokkeerd.",
          health: healthSnapshot,
        },
        { status: 503 }
      );
    }

    const payload = (await req.json()) as AuditSyncPayload;
    const rawEvents = Array.isArray(payload?.events) ? payload.events.filter((event) => isClientAuditEvent(event)) : [];

    const events = rawEvents.filter((event) => event.payload_hash === hashPayload(event.payload));

    if (events.length === 0) {
      return NextResponse.json(
        { code: "INVALID_AUDIT_SYNC_PAYLOAD", detail: "events array is verplicht en payload_hash moet overeenkomen met de payload." },
        { status: 400 }
      );
    }

    const syncResult = storeClientAuditSyncRecords(events);
    const syncedEvents = events.filter((event) => syncResult.synced_event_ids.includes(event.event_id));
    const durableSinkResult = await forwardAuditEventsToLucidBackend(syncedEvents);
    let backlogFlushAttempted = 0;
    let backlogFlushForwarded = 0;

    if (syncedEvents.length > 0 && durableSinkResult.durable_sink_state !== "not_configured") {
      storeLucidAuditForwardStatuses(
        syncedEvents.map((event) => ({
          status_id: crypto.randomUUID(),
          source_event_id: event.event_id,
          created_at: new Date().toISOString(),
          status: durableSinkResult.durable_sink_state === "forwarded" ? "forwarded" : "forward_failed",
          target_url: process.env.LUCID_AUDIT_SYNC_URL?.trim() ?? "unconfigured",
          response_status: durableSinkResult.durable_sink_http_status,
          accepted_count: durableSinkResult.durable_sink_accepted,
          error: durableSinkResult.durable_sink_error,
        }))
      );
    }

    if (durableSinkResult.durable_sink_state === "forwarded") {
      const backlogEvents = listPendingLucidAuditMirrorEvents(100);
      if (backlogEvents.length > 0) {
        backlogFlushAttempted = backlogEvents.length;
        const backlogForwardResult = await forwardAuditEventsToLucidBackend(backlogEvents);

        if (backlogForwardResult.durable_sink_state !== "not_configured") {
          storeLucidAuditForwardStatuses(
            backlogEvents.map((event) => ({
              status_id: crypto.randomUUID(),
              source_event_id: event.event_id,
              created_at: new Date().toISOString(),
              status: backlogForwardResult.durable_sink_state === "forwarded" ? "forwarded" : "forward_failed",
              target_url: process.env.LUCID_AUDIT_SYNC_URL?.trim() ?? "unconfigured",
              response_status: backlogForwardResult.durable_sink_http_status,
              accepted_count: backlogForwardResult.durable_sink_accepted,
              error: backlogForwardResult.durable_sink_error,
            }))
          );
        }

        if (backlogForwardResult.durable_sink_state === "forwarded") {
          backlogFlushForwarded = backlogEvents.length;
        }
      }
    }

    const auditStoreAfter = getAuditStoreHealth();

    return NextResponse.json(
      {
        ...syncResult,
        ...durableSinkResult,
        backlog_flush_attempted: backlogFlushAttempted,
        backlog_flush_forwarded: backlogFlushForwarded,
        backlog_pending_after: auditStoreAfter.lucid_audit_pending_count,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audit sync route fout";
    return NextResponse.json({ code: "AUDIT_SYNC_ERROR", detail: message }, { status: 500 });
  }
}
