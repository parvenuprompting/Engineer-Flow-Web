import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type CaseRecord = {
  case_id: string;
  vehicle_id: string;
  owner_uid: string;
  garage_id: string;
  status: "open" | "closed";
  created_at: string;
  confirmations: Array<{
    failure_mode_id: string;
    confirmed_at: string;
  }>;
};

export type WerkbonStatus = "open" | "afgerond";
export type FactuurStatus = "concept" | "gefinaliseerd";
export type GrootboekType = "debet" | "credit";

export type WerkbonRegelRecord = {
  id: string;
  werkbon_id: string;
  omschrijving: string;
  uren: number;
  uurtarief: number;
  onderdeel_code: string | null;
  onderdeel_prijs: number;
  regel_totaal: number;
};

export type WerkbonRecord = {
  id: string;
  voertuig_id: string;
  owner_uid: string;
  garage_party_id: string;
  root_cause: string;
  status: WerkbonStatus;
  aangemaakt_at: string;
  afgerond_at: string | null;
  regels: WerkbonRegelRecord[];
};

export type GrootboekPostRecord = {
  id: string;
  factuur_id: string;
  type: GrootboekType;
  rekening: string;
  bedrag: number;
  geboekt_at: string;
};

export type FactuurRecord = {
  id: string;
  werkbon_id: string;
  owner_uid: string;
  garage_party_id: string;
  status: FactuurStatus;
  factuurnummer: string;
  subtotaal: number;
  btw: number;
  totaal: number;
  aangemaakt_at: string;
  gefinaliseerd_at: string | null;
  grootboek_posten: GrootboekPostRecord[];
};

export type DiagnosisAuditRecord = {
  diagnosis_id: string;
  case_id: string | null;
  symptom_text: string;
  created_at: string;
  stored_at?: string;
  previous_record_hash?: string | null;
  record_hash?: string;
  response_summary: {
    symptom_cluster: string;
    top_failure_mode: string | null;
    confidence_score: number;
  };
  dds_case: unknown;
  audit_trail: unknown;
};

export type ClientAuditEventRecord = {
  event_id: string;
  event_type: "diagnosis_started" | "diagnosis_completed" | "diagnosis_failed";
  created_at: string;
  stored_at?: string;
  execution_signature: string;
  payload_hash: string;
  previous_event_hash: string | null;
  record_hash?: string;
  case_id?: string | null;
  diagnosis_id?: string | null;
  payload: Record<string, unknown>;
};

export type LucidAuditMirrorRecord = {
  manifest_id: string;
  decision_id: string;
  endpoint: string;
  request_hash: string;
  response_hash: string;
  created_at: string;
  source_event_id: string;
  payload: Record<string, unknown>;
};

export type LucidAuditForwardStatus = "forwarded" | "forward_failed";

export type LucidAuditForwardStatusRecord = {
  status_id: string;
  source_event_id: string;
  created_at: string;
  stored_at?: string;
  status: LucidAuditForwardStatus;
  target_url: string;
  response_status: number | null;
  accepted_count: number;
  error: string | null;
  previous_record_hash?: string | null;
  record_hash?: string;
};

declare global {
  // eslint-disable-next-line no-var
  var __eflCaseStore: Map<string, CaseRecord> | undefined;
  // eslint-disable-next-line no-var
  var __eflWerkbonStore: Map<string, WerkbonRecord> | undefined;
  // eslint-disable-next-line no-var
  var __eflFactuurStore: Map<string, FactuurRecord> | undefined;
  // eslint-disable-next-line no-var
  var __eflFactuurSeqByYear: Map<number, number> | undefined;
  // eslint-disable-next-line no-var
  var __eflDiagnosisAuditStore: Map<string, DiagnosisAuditRecord> | undefined;
  // eslint-disable-next-line no-var
  var __eflDiagnosisAuditLoaded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __eflClientAuditStore: Map<string, ClientAuditEventRecord> | undefined;
  // eslint-disable-next-line no-var
  var __eflClientAuditLoaded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __eflLucidAuditMirrorSourceIds: Set<string> | undefined;
  // eslint-disable-next-line no-var
  var __eflLucidAuditMirrorLoaded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __eflLucidAuditForwardStatusByEvent: Map<string, LucidAuditForwardStatusRecord> | undefined;
  // eslint-disable-next-line no-var
  var __eflLucidAuditForwardStatusLoaded: boolean | undefined;
  // eslint-disable-next-line no-var
  var __eflLucidAuditForwardLastHash: string | null | undefined;
}

const caseStore: Map<string, CaseRecord> = globalThis.__eflCaseStore ?? new Map<string, CaseRecord>();
const werkbonStore: Map<string, WerkbonRecord> = globalThis.__eflWerkbonStore ?? new Map<string, WerkbonRecord>();
const factuurStore: Map<string, FactuurRecord> = globalThis.__eflFactuurStore ?? new Map<string, FactuurRecord>();
const factuurSeqByYear: Map<number, number> = globalThis.__eflFactuurSeqByYear ?? new Map<number, number>();
const diagnosisAuditStore: Map<string, DiagnosisAuditRecord> =
  globalThis.__eflDiagnosisAuditStore ?? new Map<string, DiagnosisAuditRecord>();
const clientAuditStore: Map<string, ClientAuditEventRecord> =
  globalThis.__eflClientAuditStore ?? new Map<string, ClientAuditEventRecord>();
const lucidAuditMirrorSourceIds: Set<string> =
  globalThis.__eflLucidAuditMirrorSourceIds ?? new Set<string>();
const lucidAuditForwardStatusByEvent: Map<string, LucidAuditForwardStatusRecord> =
  globalThis.__eflLucidAuditForwardStatusByEvent ?? new Map<string, LucidAuditForwardStatusRecord>();
let lucidAuditForwardLastHash: string | null = globalThis.__eflLucidAuditForwardLastHash ?? null;

if (!globalThis.__eflCaseStore) globalThis.__eflCaseStore = caseStore;
if (!globalThis.__eflWerkbonStore) globalThis.__eflWerkbonStore = werkbonStore;
if (!globalThis.__eflFactuurStore) globalThis.__eflFactuurStore = factuurStore;
if (!globalThis.__eflFactuurSeqByYear) globalThis.__eflFactuurSeqByYear = factuurSeqByYear;
if (!globalThis.__eflDiagnosisAuditStore) globalThis.__eflDiagnosisAuditStore = diagnosisAuditStore;
if (globalThis.__eflDiagnosisAuditLoaded === undefined) globalThis.__eflDiagnosisAuditLoaded = false;
if (!globalThis.__eflClientAuditStore) globalThis.__eflClientAuditStore = clientAuditStore;
if (globalThis.__eflClientAuditLoaded === undefined) globalThis.__eflClientAuditLoaded = false;
if (!globalThis.__eflLucidAuditMirrorSourceIds) globalThis.__eflLucidAuditMirrorSourceIds = lucidAuditMirrorSourceIds;
if (globalThis.__eflLucidAuditMirrorLoaded === undefined) globalThis.__eflLucidAuditMirrorLoaded = false;
if (!globalThis.__eflLucidAuditForwardStatusByEvent) {
  globalThis.__eflLucidAuditForwardStatusByEvent = lucidAuditForwardStatusByEvent;
}
if (globalThis.__eflLucidAuditForwardStatusLoaded === undefined) {
  globalThis.__eflLucidAuditForwardStatusLoaded = false;
}
if (globalThis.__eflLucidAuditForwardLastHash === undefined) {
  globalThis.__eflLucidAuditForwardLastHash = lucidAuditForwardLastHash;
}

const AUDIT_STORE_DIR = join(process.cwd(), ".efl_store");
const DIAGNOSIS_AUDIT_JSONL = join(AUDIT_STORE_DIR, "diagnosis_audit.jsonl");
const CLIENT_AUDIT_JSONL = join(AUDIT_STORE_DIR, "client_audit_events.jsonl");
const LUCID_AUDIT_MIRROR_JSONL = join(AUDIT_STORE_DIR, "lucid_audit_mirror.jsonl");
const LUCID_AUDIT_FORWARD_STATUS_JSONL = join(AUDIT_STORE_DIR, "lucid_audit_forward_status.jsonl");

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

function computeAuditRecordHash(record: DiagnosisAuditRecord): string {
  const hashInput = {
    diagnosis_id: record.diagnosis_id,
    case_id: record.case_id,
    symptom_text: record.symptom_text,
    created_at: record.created_at,
    stored_at: record.stored_at ?? null,
    previous_record_hash: record.previous_record_hash ?? null,
    response_summary: record.response_summary,
    dds_case: record.dds_case,
    audit_trail: record.audit_trail,
  };

  return createHash("sha256").update(stableSerialize(hashInput)).digest("hex");
}

function computeClientAuditRecordHash(record: ClientAuditEventRecord): string {
  const hashInput = {
    event_id: record.event_id,
    event_type: record.event_type,
    created_at: record.created_at,
    stored_at: record.stored_at ?? null,
    execution_signature: record.execution_signature,
    payload_hash: record.payload_hash,
    previous_event_hash: record.previous_event_hash,
    case_id: record.case_id ?? null,
    diagnosis_id: record.diagnosis_id ?? null,
    payload: record.payload,
  };

  return createHash("sha256").update(stableSerialize(hashInput)).digest("hex");
}

function computeLucidForwardStatusRecordHash(record: LucidAuditForwardStatusRecord): string {
  const hashInput = {
    status_id: record.status_id,
    source_event_id: record.source_event_id,
    created_at: record.created_at,
    stored_at: record.stored_at ?? null,
    status: record.status,
    target_url: record.target_url,
    response_status: record.response_status,
    accepted_count: record.accepted_count,
    error: record.error,
    previous_record_hash: record.previous_record_hash ?? null,
  };

  return createHash("sha256").update(stableSerialize(hashInput)).digest("hex");
}

function normalizeAuditRecord(record: DiagnosisAuditRecord, previousRecordHash: string | null): DiagnosisAuditRecord {
  const normalized: DiagnosisAuditRecord = {
    ...record,
    stored_at: record.stored_at ?? record.created_at,
    previous_record_hash: record.previous_record_hash ?? previousRecordHash,
  };

  return {
    ...normalized,
    record_hash: record.record_hash ?? computeAuditRecordHash(normalized),
  };
}

function normalizeClientAuditRecord(record: ClientAuditEventRecord, previousRecordHash: string | null): ClientAuditEventRecord {
  const normalized: ClientAuditEventRecord = {
    ...record,
    stored_at: record.stored_at ?? record.created_at,
    previous_event_hash: record.previous_event_hash ?? previousRecordHash,
  };

  return {
    ...normalized,
    record_hash: record.record_hash ?? computeClientAuditRecordHash(normalized),
  };
}

function normalizeLucidForwardStatusRecord(
  record: LucidAuditForwardStatusRecord,
  previousRecordHash: string | null
): LucidAuditForwardStatusRecord {
  const normalized: LucidAuditForwardStatusRecord = {
    ...record,
    stored_at: record.stored_at ?? record.created_at,
    previous_record_hash: record.previous_record_hash ?? previousRecordHash,
  };

  return {
    ...normalized,
    record_hash: record.record_hash ?? computeLucidForwardStatusRecordHash(normalized),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function nextFactuurnummer(): string {
  const year = new Date().getUTCFullYear();
  const current = factuurSeqByYear.get(year) ?? 0;
  const next = current + 1;
  factuurSeqByYear.set(year, next);
  return `${year}-${String(next).padStart(4, "0")}`;
}

function ensureDiagnosisAuditLoaded(): void {
  if (globalThis.__eflDiagnosisAuditLoaded) {
    return;
  }

  mkdirSync(AUDIT_STORE_DIR, { recursive: true });

  if (!existsSync(DIAGNOSIS_AUDIT_JSONL)) {
    globalThis.__eflDiagnosisAuditLoaded = true;
    return;
  }

  const fileContents = readFileSync(DIAGNOSIS_AUDIT_JSONL, "utf8");
  const lines = fileContents.split("\n").map((line) => line.trim()).filter(Boolean);

  let previousRecordHash: string | null = null;

  for (const line of lines) {
    try {
      const rawRecord = JSON.parse(line) as DiagnosisAuditRecord;
      const record = normalizeAuditRecord(rawRecord, previousRecordHash);
      if (!diagnosisAuditStore.has(record.diagnosis_id)) {
        diagnosisAuditStore.set(record.diagnosis_id, record);
      }
      previousRecordHash = record.record_hash ?? previousRecordHash;
    } catch {
      continue;
    }
  }

  globalThis.__eflDiagnosisAuditLoaded = true;
}

function ensureClientAuditLoaded(): void {
  if (globalThis.__eflClientAuditLoaded) {
    return;
  }

  mkdirSync(AUDIT_STORE_DIR, { recursive: true });

  if (!existsSync(CLIENT_AUDIT_JSONL)) {
    globalThis.__eflClientAuditLoaded = true;
    return;
  }

  const fileContents = readFileSync(CLIENT_AUDIT_JSONL, "utf8");
  const lines = fileContents.split("\n").map((line) => line.trim()).filter(Boolean);

  let previousRecordHash: string | null = null;

  for (const line of lines) {
    try {
      const rawRecord = JSON.parse(line) as ClientAuditEventRecord;
      const record = normalizeClientAuditRecord(rawRecord, previousRecordHash);
      if (!clientAuditStore.has(record.event_id)) {
        clientAuditStore.set(record.event_id, record);
      }
      previousRecordHash = record.record_hash ?? previousRecordHash;
    } catch {
      continue;
    }
  }

  globalThis.__eflClientAuditLoaded = true;
}

function ensureLucidAuditMirrorLoaded(): void {
  if (globalThis.__eflLucidAuditMirrorLoaded) {
    return;
  }

  mkdirSync(AUDIT_STORE_DIR, { recursive: true });

  if (!existsSync(LUCID_AUDIT_MIRROR_JSONL)) {
    globalThis.__eflLucidAuditMirrorLoaded = true;
    return;
  }

  const fileContents = readFileSync(LUCID_AUDIT_MIRROR_JSONL, "utf8");
  const lines = fileContents.split("\n").map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    try {
      const rawRecord = JSON.parse(line) as LucidAuditMirrorRecord;
      if (typeof rawRecord.source_event_id === "string" && rawRecord.source_event_id.length > 0) {
        lucidAuditMirrorSourceIds.add(rawRecord.source_event_id);
      }
    } catch {
      continue;
    }
  }

  globalThis.__eflLucidAuditMirrorLoaded = true;
}

function ensureLucidAuditForwardStatusLoaded(): void {
  if (globalThis.__eflLucidAuditForwardStatusLoaded) {
    return;
  }

  mkdirSync(AUDIT_STORE_DIR, { recursive: true });

  if (!existsSync(LUCID_AUDIT_FORWARD_STATUS_JSONL)) {
    globalThis.__eflLucidAuditForwardStatusLoaded = true;
    return;
  }

  const fileContents = readFileSync(LUCID_AUDIT_FORWARD_STATUS_JSONL, "utf8");
  const lines = fileContents.split("\n").map((line) => line.trim()).filter(Boolean);

  let previousRecordHash: string | null = null;

  for (const line of lines) {
    try {
      const rawRecord = JSON.parse(line) as LucidAuditForwardStatusRecord;
      const record = normalizeLucidForwardStatusRecord(rawRecord, previousRecordHash);
      lucidAuditForwardStatusByEvent.set(record.source_event_id, record);
      previousRecordHash = record.record_hash ?? previousRecordHash;
      lucidAuditForwardLastHash = previousRecordHash;
      globalThis.__eflLucidAuditForwardLastHash = lucidAuditForwardLastHash;
    } catch {
      continue;
    }
  }

  globalThis.__eflLucidAuditForwardStatusLoaded = true;
}

export function createCaseRecord(vehicleId: string, ownerUid: string, garageId: string): CaseRecord {
  const record: CaseRecord = {
    case_id: generateId("CASE"),
    vehicle_id: vehicleId,
    owner_uid: ownerUid,
    garage_id: garageId,
    status: "open",
    created_at: nowIso(),
    confirmations: [],
  };
  caseStore.set(record.case_id, record);
  return record;
}

export function getCaseRecord(caseId: string): CaseRecord | null {
  return caseStore.get(caseId) ?? null;
}

export function addCaseConfirmation(caseId: string, failureModeId: string): CaseRecord | null {
  const record = caseStore.get(caseId);
  if (!record) return null;
  record.confirmations.push({
    failure_mode_id: failureModeId,
    confirmed_at: nowIso(),
  });
  caseStore.set(caseId, record);
  return record;
}

export function storeDiagnosisAuditRecord(record: DiagnosisAuditRecord): DiagnosisAuditRecord {
  ensureDiagnosisAuditLoaded();
  const existing = diagnosisAuditStore.get(record.diagnosis_id);
  if (existing) {
    return existing;
  }

  const previousRecordHash =
    Array.from(diagnosisAuditStore.values()).at(-1)?.record_hash ?? null;
  const storedRecord = normalizeAuditRecord(
    {
      ...record,
      stored_at: nowIso(),
      previous_record_hash: previousRecordHash,
    },
    previousRecordHash
  );

  diagnosisAuditStore.set(storedRecord.diagnosis_id, storedRecord);
  mkdirSync(AUDIT_STORE_DIR, { recursive: true });
  appendFileSync(DIAGNOSIS_AUDIT_JSONL, `${JSON.stringify(storedRecord)}\n`, "utf8");
  return storedRecord;
}

export function getDiagnosisAuditRecord(diagnosisId: string): DiagnosisAuditRecord | null {
  ensureDiagnosisAuditLoaded();
  return diagnosisAuditStore.get(diagnosisId) ?? null;
}

function buildLucidAuditMirrorRecord(record: ClientAuditEventRecord): LucidAuditMirrorRecord {
  const responsePayload =
    record.event_type === "diagnosis_completed"
      ? {
          diagnosis_id: record.diagnosis_id ?? null,
          case_id: record.case_id ?? null,
          execution_signature: record.execution_signature,
          payload_hash: record.payload_hash,
        }
      : {
          status: record.event_type,
          execution_signature: record.execution_signature,
        };

  return {
    manifest_id: crypto.randomUUID(),
    decision_id: crypto.randomUUID(),
    endpoint: "/api/efl-core/audit/sync",
    request_hash: createHash("sha256").update(stableSerialize(record.payload)).digest("hex"),
    response_hash: createHash("sha256").update(stableSerialize(responsePayload)).digest("hex"),
    created_at: nowIso(),
    source_event_id: record.event_id,
    payload: {
      event_type: record.event_type,
      case_id: record.case_id ?? null,
      diagnosis_id: record.diagnosis_id ?? null,
      execution_signature: record.execution_signature,
    },
  };
}

export function storeClientAuditSyncRecords(records: ClientAuditEventRecord[]): {
  accepted: number;
  duplicate: number;
  failed: number;
  synced_event_ids: string[];
} {
  ensureClientAuditLoaded();
  mkdirSync(AUDIT_STORE_DIR, { recursive: true });

  let accepted = 0;
  let duplicate = 0;
  let failed = 0;
  const syncedEventIds: string[] = [];

  for (const rawRecord of records) {
    try {
      if (clientAuditStore.has(rawRecord.event_id)) {
        duplicate += 1;
        continue;
      }

      const previousRecordHash = Array.from(clientAuditStore.values()).at(-1)?.record_hash ?? null;
      const record = normalizeClientAuditRecord(
        {
          ...rawRecord,
          stored_at: nowIso(),
          previous_event_hash: rawRecord.previous_event_hash ?? previousRecordHash,
        },
        previousRecordHash
      );

      clientAuditStore.set(record.event_id, record);
      appendFileSync(CLIENT_AUDIT_JSONL, `${JSON.stringify(record)}\n`, "utf8");

      const lucidMirror = buildLucidAuditMirrorRecord(record);
      appendFileSync(LUCID_AUDIT_MIRROR_JSONL, `${JSON.stringify(lucidMirror)}\n`, "utf8");
      lucidAuditMirrorSourceIds.add(record.event_id);

      accepted += 1;
      syncedEventIds.push(record.event_id);
    } catch {
      failed += 1;
    }
  }

  return {
    accepted,
    duplicate,
    failed,
    synced_event_ids: syncedEventIds,
  };
}

export function storeLucidAuditForwardStatuses(
  records: Array<
    Omit<LucidAuditForwardStatusRecord, "stored_at" | "previous_record_hash" | "record_hash">
  >
): {
  stored: number;
} {
  ensureLucidAuditForwardStatusLoaded();
  mkdirSync(AUDIT_STORE_DIR, { recursive: true });

  let stored = 0;

  for (const rawRecord of records) {
    const previousRecordHash = lucidAuditForwardLastHash;
    const record = normalizeLucidForwardStatusRecord(
      {
        ...rawRecord,
        stored_at: nowIso(),
        previous_record_hash: previousRecordHash,
      },
      previousRecordHash
    );

    lucidAuditForwardStatusByEvent.set(record.source_event_id, record);
    appendFileSync(LUCID_AUDIT_FORWARD_STATUS_JSONL, `${JSON.stringify(record)}\n`, "utf8");
    lucidAuditForwardLastHash = record.record_hash ?? lucidAuditForwardLastHash;
    globalThis.__eflLucidAuditForwardLastHash = lucidAuditForwardLastHash;
    stored += 1;
  }

  return { stored };
}

export function listPendingLucidAuditMirrorEvents(limit = 100): ClientAuditEventRecord[] {
  ensureClientAuditLoaded();
  ensureLucidAuditMirrorLoaded();
  ensureLucidAuditForwardStatusLoaded();

  const pendingEvents: ClientAuditEventRecord[] = [];

  for (const eventId of lucidAuditMirrorSourceIds) {
    const forwardStatus = lucidAuditForwardStatusByEvent.get(eventId);
    if (forwardStatus?.status === "forwarded") {
      continue;
    }

    const eventRecord = clientAuditStore.get(eventId);
    if (!eventRecord) {
      continue;
    }

    pendingEvents.push(eventRecord);
    if (pendingEvents.length >= limit) {
      break;
    }
  }

  return pendingEvents;
}

export function getAuditStoreHealth(): {
  audit_store_ok: boolean;
  diagnosis_audit_count: number;
  client_audit_count: number;
  lucid_audit_mirror_count: number;
  lucid_audit_forwarded_count: number;
  lucid_audit_pending_count: number;
  diagnosis_audit_file: string;
  client_audit_file: string;
  lucid_audit_mirror_file: string;
  lucid_audit_forward_status_file: string;
} {
  ensureDiagnosisAuditLoaded();
  ensureClientAuditLoaded();
  ensureLucidAuditMirrorLoaded();
  ensureLucidAuditForwardStatusLoaded();
  mkdirSync(AUDIT_STORE_DIR, { recursive: true });

  let lucidForwardedCount = 0;
  for (const status of lucidAuditForwardStatusByEvent.values()) {
    if (status.status === "forwarded") {
      lucidForwardedCount += 1;
    }
  }

  const lucidPendingCount = Array.from(lucidAuditMirrorSourceIds).reduce((count, eventId) => {
    return lucidAuditForwardStatusByEvent.get(eventId)?.status === "forwarded" ? count : count + 1;
  }, 0);

  return {
    audit_store_ok: existsSync(AUDIT_STORE_DIR),
    diagnosis_audit_count: diagnosisAuditStore.size,
    client_audit_count: clientAuditStore.size,
    lucid_audit_mirror_count: lucidAuditMirrorSourceIds.size,
    lucid_audit_forwarded_count: lucidForwardedCount,
    lucid_audit_pending_count: lucidPendingCount,
    diagnosis_audit_file: DIAGNOSIS_AUDIT_JSONL,
    client_audit_file: CLIENT_AUDIT_JSONL,
    lucid_audit_mirror_file: LUCID_AUDIT_MIRROR_JSONL,
    lucid_audit_forward_status_file: LUCID_AUDIT_FORWARD_STATUS_JSONL,
  };
}

export function createWerkbonRecord(input: {
  voertuig_id: string;
  owner_uid: string;
  garage_party_id: string;
  root_cause: string;
}): WerkbonRecord {
  const record: WerkbonRecord = {
    id: generateId("WB"),
    voertuig_id: input.voertuig_id,
    owner_uid: input.owner_uid,
    garage_party_id: input.garage_party_id,
    root_cause: input.root_cause,
    status: "open",
    aangemaakt_at: nowIso(),
    afgerond_at: null,
    regels: [],
  };
  werkbonStore.set(record.id, record);
  return record;
}

export function getWerkbonRecord(werkbonId: string): WerkbonRecord | null {
  return werkbonStore.get(werkbonId) ?? null;
}

export function addWerkbonRegelRecord(
  werkbonId: string,
  input: {
    omschrijving: string;
    uren: number;
    uurtarief: number;
    onderdeel_code?: string | null;
    onderdeel_prijs?: number;
  }
): { werkbon: WerkbonRecord; regel: WerkbonRegelRecord; werkbon_subtotaal: number } | null {
  const werkbon = werkbonStore.get(werkbonId);
  if (!werkbon) return null;

  const regel: WerkbonRegelRecord = {
    id: generateId("WBR"),
    werkbon_id: werkbon.id,
    omschrijving: input.omschrijving,
    uren: input.uren,
    uurtarief: input.uurtarief,
    onderdeel_code: input.onderdeel_code ?? null,
    onderdeel_prijs: input.onderdeel_prijs ?? 0,
    regel_totaal: round2(input.uren * input.uurtarief + (input.onderdeel_prijs ?? 0)),
  };
  werkbon.regels.push(regel);
  werkbonStore.set(werkbon.id, werkbon);

  return {
    werkbon,
    regel,
    werkbon_subtotaal: werkbonSubtotaal(werkbon.id),
  };
}

export function closeWerkbonRecord(werkbonId: string): WerkbonRecord | null {
  const werkbon = werkbonStore.get(werkbonId);
  if (!werkbon) return null;
  if (werkbon.status === "open") {
    werkbon.status = "afgerond";
    werkbon.afgerond_at = nowIso();
    werkbonStore.set(werkbon.id, werkbon);
  }
  return werkbon;
}

export function werkbonSubtotaal(werkbonId: string): number {
  const werkbon = werkbonStore.get(werkbonId);
  if (!werkbon) return 0;
  return round2(werkbon.regels.reduce((acc, regel) => acc + regel.regel_totaal, 0));
}

export function getFactuurRecord(factuurId: string): FactuurRecord | null {
  return factuurStore.get(factuurId) ?? null;
}

export function getFactuurByWerkbon(werkbonId: string): FactuurRecord | null {
  for (const factuur of factuurStore.values()) {
    if (factuur.werkbon_id === werkbonId) return factuur;
  }
  return null;
}

export function createFactuurRecord(input: {
  werkbon_id: string;
  owner_uid: string;
  garage_party_id: string;
}): FactuurRecord | null {
  const werkbon = getWerkbonRecord(input.werkbon_id);
  if (!werkbon) return null;

  const subtotaal = werkbonSubtotaal(werkbon.id);
  const btw = round2(subtotaal * 0.21);
  const totaal = round2(subtotaal + btw);

  const record: FactuurRecord = {
    id: generateId("FCT"),
    werkbon_id: werkbon.id,
    owner_uid: input.owner_uid,
    garage_party_id: input.garage_party_id ?? werkbon.garage_party_id,
    status: "concept",
    factuurnummer: nextFactuurnummer(),
    subtotaal,
    btw,
    totaal,
    aangemaakt_at: nowIso(),
    gefinaliseerd_at: null,
    grootboek_posten: [],
  };

  factuurStore.set(record.id, record);
  return record;
}

export function finalizeFactuurRecord(factuurId: string): FactuurRecord | null {
  const factuur = factuurStore.get(factuurId);
  if (!factuur) return null;

  if (factuur.status === "gefinaliseerd") {
    return factuur;
  }

  const geboekt_at = nowIso();
  factuur.grootboek_posten = [
    {
      id: generateId("GL"),
      factuur_id: factuur.id,
      type: "debet",
      rekening: "Debiteuren",
      bedrag: factuur.totaal,
      geboekt_at,
    },
    {
      id: generateId("GL"),
      factuur_id: factuur.id,
      type: "credit",
      rekening: "Omzet Werkplaats",
      bedrag: factuur.subtotaal,
      geboekt_at,
    },
    {
      id: generateId("GL"),
      factuur_id: factuur.id,
      type: "credit",
      rekening: "Te Betalen BTW",
      bedrag: factuur.btw,
      geboekt_at,
    },
  ];
  factuur.status = "gefinaliseerd";
  factuur.gefinaliseerd_at = geboekt_at;
  factuurStore.set(factuur.id, factuur);
  return factuur;
}

export function isFactuurBalanced(factuur: FactuurRecord): boolean {
  const debet = factuur.grootboek_posten
    .filter((post) => post.type === "debet")
    .reduce((acc, post) => acc + post.bedrag, 0);
  const credit = factuur.grootboek_posten
    .filter((post) => post.type === "credit")
    .reduce((acc, post) => acc + post.bedrag, 0);
  return round2(debet) === round2(credit);
}

export function createPolicyEnvelope<T>(data: T) {
  return {
    manifest_id: crypto.randomUUID(),
    decision_id: crypto.randomUUID(),
    policy_version: "LUCID-v0.2-local",
    data,
  };
}
