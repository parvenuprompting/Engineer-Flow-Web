import catalog from "./data/scr_symptoms.v1.json";
import type { ContextMeasurement, EvidenceWindow, Intervention, Observation, ObservationSource, SymptomEpisode } from "./history_types";
import { utcMillis } from "./history_types";
import type { WindowInput } from "./can_evidence_validator";
import { array, boolean, BoundaryError, enumeration, freezeData, nullable, number, object, refine, reject, text, union } from "./runtime_schema";
import type { Schema } from "./runtime_schema";

export const idSchema = refine(text(128), v => /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(v), "invalid_id");
export const hashSchema = refine(text(64), v => /^[a-f0-9]{64}$/.test(v), "invalid_hash");
export const timestampSchema = refine(text(24), v => utcMillis(v) !== null, "invalid_utc_timestamp");
const ids = refine(array(idSchema), v => new Set(v).size === v.length, "duplicate_id");
const uint = number(0, Number.MAX_SAFE_INTEGER, true);
const contextSchema: Schema<ContextMeasurement> = object({ signalId: idSchema, value: number(), unit: text(32), evidenceRefs: ids });
const episodeSchema: Schema<SymptomEpisode> = object({ id: idSchema, vehicleId: idSchema, visitId: idSchema,
  componentInstanceId: nullable(idSchema), symptomIds: ids, observedAt: timestampSchema,
  engineHours: nullable(number(0)), configurationHash: hashSchema,
  operatingContext: object({ modeId: idSchema, measurements: array(contextSchema, 100) }), evidenceRefs: ids });
const interventionBase = { id: idSchema, vehicleId: idSchema, visitId: idSchema, performedAt: timestampSchema,
  componentInstanceId: idSchema, preTestRefs: ids, postTestRefs: ids };
const interventionSchema: Schema<Intervention> = union<Intervention>(
  object({ ...interventionBase, action: enumeration("replace"), replacementInstanceId: idSchema }),
  object({ ...interventionBase, action: enumeration("inspect", "adjust", "repair") }),
);
export const sourceSchema: Schema<ObservationSource> = union<ObservationSource>(
  object({ protocol: enumeration("j1939"), busId: idSchema, ecuName: nullable(idSchema),
    sourceAddress: number(0, 253, true), pgn: number(0, 262143, true), spn: number(0, 524287, true) }),
  object({ protocol: enumeration("obd"), busId: idSchema, ecuId: idSchema, service: number(0, 255, true), pid: number(0, 255, true) }),
  object({ protocol: enumeration("external_sensor"), sensorId: idSchema, calibrationRef: idSchema }),
);
const observationSchema: Schema<Observation> = object({ id: idSchema, vehicleId: idSchema, captureSessionId: idSchema,
  sequence: uint, monotonicUs: uint, receivedAtUtc: timestampSchema, source: sourceSchema,
  signalId: idSchema, value: nullable(number()), unit: text(32),
  quality: enumeration("valid", "not_available", "sensor_error", "decode_error"), decoderHash: hashSchema, rawEvidenceRef: idSchema });
const windowSchema: Schema<EvidenceWindow> = object({ id: idSchema, vehicleId: idSchema, captureSessionId: idSchema,
  closed: boolean, startUs: uint, endUs: uint, observationRefs: refine(array(idSchema, 10000), v => new Set(v).size === v.length, "duplicate_ref"),
  quality: object({ missingSignalIds: ids, staleSignalIds: ids, droppedFrames: nullable(uint), maxObservedSkewUs: nullable(uint) }),
  windowPolicyHash: hashSchema, configurationHash: hashSchema });
const captureSchema: Schema<WindowInput> = object({ window: windowSchema, observations: array(observationSchema, 10000) });

export interface ComponentInstance {
  readonly instanceId: string;
  readonly slotId: string;
  readonly installedAt: string;
  readonly removedAt: string | null;
}
export type DiagnosticCode =
  | { readonly protocol: "obd"; readonly code: string }
  | { readonly protocol: "j1939"; readonly spn: number; readonly fmi: number | null; readonly sourceAddress: number };
export interface ValidatedIntake {
  readonly schemaVersion: 1;
  readonly complaint: string;
  readonly current: SymptomEpisode;
  readonly history: readonly SymptomEpisode[];
  readonly interventions: readonly Intervention[];
  readonly components: readonly ComponentInstance[];
  readonly historyComplete: boolean;
  readonly dtcs: readonly DiagnosticCode[];
  readonly capture: WindowInput | null;
}
const dtcSchema: Schema<DiagnosticCode> = union<DiagnosticCode>(
  object({ protocol: enumeration("obd"), code: refine(text(5), v => /^[PBCU][0-3][A-F0-9]{3}$/.test(v), "invalid_dtc") }),
  object({ protocol: enumeration("j1939"), spn: number(0, 524287, true), fmi: nullable(number(0, 31, true)), sourceAddress: number(0, 253, true) }),
);
const intakeSchema: Schema<ValidatedIntake> = object({ schemaVersion: enumeration(1), complaint: text(10000),
  current: episodeSchema, history: array(episodeSchema), interventions: array(interventionSchema),
  components: array(object({ instanceId: idSchema, slotId: idSchema, installedAt: timestampSchema, removedAt: nullable(timestampSchema) })),
  historyComplete: boolean, dtcs: array(dtcSchema, 100), capture: nullable(captureSchema) });

export type BoundaryResult =
  | { readonly ok: true; readonly value: ValidatedIntake }
  | { readonly ok: false; readonly status: "boundary_rejected"; readonly issues: readonly { readonly path: string; readonly code: string }[] };

/** Detached immutable snapshot; unknown fields cannot smuggle a pass or an override. */
export function validateIntake(raw: unknown, canonicalSymptomIds: readonly string[] = catalog.symptomIds): BoundaryResult {
  try {
    if (typeof raw === "string") {
      if (raw.length > 2_000_000) reject("$", "payload_too_large");
      try { raw = JSON.parse(raw) as unknown; } catch { reject("$", "invalid_json"); }
    }
    const intake = intakeSchema.parse(raw, "$");
    const components = new Map<string, ComponentInstance>();
    const unique = (values: readonly string[], path: string) => {
      if (new Set(values).size !== values.length) reject(path, "duplicate_id");
    };
    unique(intake.components.map(c => c.instanceId), "$.components");
    unique([intake.current.id, ...intake.history.map(e => e.id)], "$.history");
    unique(intake.interventions.map(i => i.id), "$.interventions");
    for (const c of intake.components) {
      if (c.removedAt !== null && c.removedAt <= c.installedAt) reject("$.components", "invalid_lifetime");
      if (c.installedAt > intake.current.observedAt) reject("$.components", "future_installation");
      components.set(c.instanceId, c);
    }
    const ordered = [...intake.components].sort((a, b) => a.installedAt < b.installedAt ? -1 : a.installedAt > b.installedAt ? 1 : 0);
    for (let i = 0; i < ordered.length; i++) {
      const c = ordered[i]; if (!c) continue;
      for (const other of ordered.slice(i + 1)) if (c.slotId === other.slotId && (c.removedAt === null || c.removedAt > other.installedAt))
        reject("$.components", "overlapping_component_instances");
    }
    for (const [index, e] of [intake.current, ...intake.history].entries()) {
      const path = index === 0 ? "$.current" : `$.history[${index - 1}]`;
      if (e.vehicleId !== intake.current.vehicleId) reject(path, "vehicle_mismatch");
      if (index > 0 && e.observedAt >= intake.current.observedAt) reject(path, "history_not_before_current");
      if (!e.symptomIds.length || e.symptomIds.some(id => !canonicalSymptomIds.includes(id))) reject(`${path}.symptomIds`, "unknown_canonical_symptom");
      unique(e.operatingContext.measurements.map(m => m.signalId), `${path}.operatingContext`);
      if (e.componentInstanceId !== null) {
        const c = components.get(e.componentInstanceId);
        if (!c) reject(`${path}.componentInstanceId`, "unknown_component");
        if (e.observedAt < c.installedAt || (c.removedAt !== null && e.observedAt >= c.removedAt)) reject(path, "episode_outside_component_lifetime");
      }
    }
    const replaced = new Set<string>(); const installed = new Set<string>();
    for (const i of intake.interventions) {
      const before = components.get(i.componentInstanceId);
      if (i.vehicleId !== intake.current.vehicleId || !before) reject("$.interventions", "identity_mismatch");
      if (i.performedAt > intake.current.observedAt || i.performedAt < before.installedAt) reject("$.interventions", "invalid_event_time");
      if (i.action === "replace") {
        const after = i.replacementInstanceId ? components.get(i.replacementInstanceId) : undefined;
        if (!after || before.instanceId === after.instanceId || before.slotId !== after.slotId
          || before.removedAt !== i.performedAt || after.installedAt !== i.performedAt) reject("$.interventions", "invalid_replacement_chain");
        if (replaced.has(before.instanceId) || installed.has(after.instanceId)) reject("$.interventions", "duplicate_replacement");
        replaced.add(before.instanceId); installed.add(after.instanceId);
      } else if (before.removedAt !== null && i.performedAt >= before.removedAt) reject("$.interventions", "event_after_removal");
    }
    if (intake.historyComplete) for (const c of intake.components) {
      if (c.removedAt !== null && !replaced.has(c.instanceId)) reject("$.interventions", "missing_replacement_event");
    }
    if (intake.capture) {
      const { window, observations } = intake.capture;
      if (window.vehicleId !== intake.current.vehicleId || window.configurationHash !== intake.current.configurationHash)
        reject("$.capture.window", "identity_mismatch");
      if (window.endUs <= window.startUs) reject("$.capture.window", "invalid_interval");
      if (!intake.current.evidenceRefs.includes(window.id)) reject("$.capture", "unbound_capture");
      unique(observations.map(o => o.id), "$.capture.observations");
      for (const o of observations) {
        if (o.vehicleId !== window.vehicleId || o.captureSessionId !== window.captureSessionId
          || o.monotonicUs < window.startUs || o.monotonicUs > window.endUs
          || o.receivedAtUtc < intake.current.observedAt) reject("$.capture.observations", "capture_scope_mismatch");
      }
    }
    return { ok: true, value: freezeData(intake) };
  } catch (error) {
    if (!(error instanceof BoundaryError)) throw error;
    return { ok: false, status: "boundary_rejected", issues: [{ path: error.path, code: error.code }] };
  }
}
