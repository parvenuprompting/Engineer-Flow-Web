import ruleData from "./data/rules/SCR_NOX_DEGRADATION.json";
import type { RequiredAction } from "./action_types";
import { validateIntake, hashSchema, idSchema, sourceSchema } from "./boundary_validator";
import type { BoundaryResult, ValidatedIntake } from "./boundary_validator";
import type { MeasurementCondition, WindowValidation } from "./can_evidence_validator";
import { validateEvidenceWindow } from "./can_evidence_validator";
import { array, enumeration, freezeData, number, object, refine, text } from "./runtime_schema";
import type { Schema } from "./runtime_schema";
import type { ObservationSource } from "./history_types";

export const SCR_RULE = freezeData(ruleData);
export interface ScrProfile {
  readonly id: string;
  readonly ruleVersion: string;
  readonly configurationHash: string;
  readonly approvalRef: string;
  readonly oemProcedureRef: string;
  readonly decoderHash: string;
  readonly windowPolicyHash: string;
  readonly supportedObdCodes: readonly string[];
  readonly supportedJ1939: readonly { readonly spn: number; readonly fmi: number; readonly sourceAddress: number }[];
  readonly minimumDurationUs: number;
  readonly maxSkewUs: number;
  readonly signals: readonly {
    readonly signalId: string; readonly unit: string; readonly source: ObservationSource;
    readonly minimumSamples: number; readonly maxSampleGapUs: number; readonly maxAgeUs: number;
    readonly range: { readonly min: number; readonly max: number };
  }[];
}
const uint = number(0, Number.MAX_SAFE_INTEGER, true);
const rangeSchema = refine(object({ min: number(), max: number() }), v => v.min <= v.max, "invalid_range");
const profileSchema: Schema<ScrProfile> = object({ id: idSchema, ruleVersion: enumeration(SCR_RULE.version),
  configurationHash: hashSchema, approvalRef: text(), oemProcedureRef: text(), decoderHash: hashSchema,
  windowPolicyHash: hashSchema, supportedObdCodes: array(text(5), 100),
  supportedJ1939: array(object({ spn: number(0, 524287, true), fmi: number(0, 31, true), sourceAddress: number(0, 253, true) }), 100),
  minimumDurationUs: number(1, Number.MAX_SAFE_INTEGER, true), maxSkewUs: uint,
  signals: array(object({ signalId: idSchema, unit: text(32), source: sourceSchema,
    minimumSamples: number(2, 10000, true), maxSampleGapUs: uint, maxAgeUs: uint, range: rangeSchema }), 100) });

/** Profiles come from an authenticated, approved configuration store, never intake.
 * approvalRef is provenance metadata, NOT proof of signature verification. */
export function parseScrProfile(raw: unknown): ScrProfile {
  const profile = profileSchema.parse(raw, "$.profile");
  if (profile.signals.length !== SCR_RULE.measurement.signals.length
    || new Set(profile.signals.map(s => s.signalId)).size !== profile.signals.length
    || SCR_RULE.measurement.signals.some(expected => !profile.signals.some(s =>
      s.signalId === expected.id && s.unit === expected.unit && s.source.protocol !== "external_sensor")))
    throw new Error("SCR profile must map every required signal to OBD/J1939 CAN with canonical units");
  return freezeData(profile);
}

export interface ScrDecision {
  readonly status: "knowledge_gap" | "clarification_required";
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly missing: readonly string[];
  readonly nextAction: RequiredAction;
  readonly replacement: { readonly allowed: false; readonly reason: string; readonly previousReplacementIds: readonly string[] };
  readonly history: { readonly recurring: boolean; readonly priorVisitIds: readonly string[] };
  readonly can: { readonly state: "not_received" | "not_evaluated" | "unknown" | "pass" | "fail";
    readonly missingSignals: readonly string[]; readonly issueCodes: readonly string[] };
}
export type ScrWorkflowResult = Exclude<BoundaryResult, { ok: true }>
  | { readonly ok: true; readonly intake: ValidatedIntake; readonly decision: ScrDecision };

/** Deterministic procedure gate; no root cause or replacement authorization is inferred. */
export function runScrWorkflow(raw: unknown, trustedProfile: ScrProfile | null = null): ScrWorkflowResult {
  const validated = validateIntake(raw);
  if (!validated.ok) return validated;
  const intake = validated.value;
  const component = intake.components.find(c => c.instanceId === intake.current.componentInstanceId);
  const replacements = intake.interventions.filter(i => i.action === "replace"
    && i.replacementInstanceId === intake.current.componentInstanceId);
  const priorVisitIds = [...new Set(intake.history.filter(e => e.visitId !== intake.current.visitId
    && e.configurationHash === intake.current.configurationHash
    && e.symptomIds.some(id => intake.current.symptomIds.includes(id))
    && intake.components.some(c => c.instanceId === e.componentInstanceId && c.slotId === SCR_RULE.componentSlotId))
    .map(e => e.visitId))].sort();
  const requiredSignals = SCR_RULE.measurement.signals.map(s => s.id);
  const can: ScrDecision["can"] = { state: intake.capture ? "not_evaluated" : "not_received",
    missingSignals: requiredSignals, issueCodes: [] };
  const finish = (nextAction: RequiredAction, status: ScrDecision["status"] = "knowledge_gap", quality = can): ScrWorkflowResult => ({
    ok: true, intake, decision: { status, ruleId: SCR_RULE.id, ruleVersion: SCR_RULE.version,
      missing: nextAction.reasonCodes, nextAction, replacement: { allowed: false,
        reason: replacements.length ? "REPEAT_SENSOR_REPLACEMENT_BLOCKED" : "SENSOR_CAUSE_NOT_PROVEN",
        previousReplacementIds: replacements.map(i => i.id).sort() },
      history: { recurring: priorVisitIds.length > 0, priorVisitIds }, can: quality },
  });
  const clarify = (key: "fmi" | "code" | "profile", reason: string) => finish({
    kind: "clarify", id: SCR_RULE.actions[key].questionId, mandatory: true,
    instruction: SCR_RULE.actions[key].instruction, reasonCodes: [reason],
    questionId: SCR_RULE.actions[key].questionId, allowedAnswerIds: [],
  }, "clarification_required");
  if (!component || component.slotId !== SCR_RULE.componentSlotId || !intake.historyComplete)
    return finish({ kind: "verify_history", id: "SCR_VERIFY_SENSOR_HISTORY", mandatory: true,
      instruction: SCR_RULE.actions.history.instruction, reasonCodes: ["component_history:unverified"],
      componentInstanceId: intake.current.componentInstanceId, missingEvent: component ? "replacement" : "installation" });
  const j1939 = intake.dtcs.filter(d => d.protocol === "j1939" && SCR_RULE.triggers.j1939Spns.includes(d.spn));
  if (j1939.some(d => d.protocol === "j1939" && d.fmi === null)) return clarify("fmi", "dtc:fmi_missing");
  const obd = intake.dtcs.filter(d => d.protocol === "obd" && SCR_RULE.triggers.obdCodes.includes(d.code));
  if (!j1939.length && !obd.length) return clarify("code", "dtc:applicability_unconfirmed");
  let profile: ScrProfile;
  try {
    if (trustedProfile === null) return clarify("profile", "profile:missing");
    profile = parseScrProfile(trustedProfile);
  } catch { return clarify("profile", "profile:invalid"); }
  if (profile.configurationHash !== intake.current.configurationHash
    || obd.some(d => d.protocol === "obd" && !profile.supportedObdCodes.includes(d.code))
    || j1939.some(d => d.protocol === "j1939" && !profile.supportedJ1939.some(p => p.spn === d.spn
      && p.fmi === d.fmi && p.sourceAddress === d.sourceAddress))) return clarify("profile", "profile:not_applicable");

  const measure = (reasonCodes: readonly string[], quality = can) => finish({ kind: "measure",
    id: SCR_RULE.measurement.procedureId, mandatory: true, instruction: SCR_RULE.measurement.instruction,
    reasonCodes, procedureId: SCR_RULE.measurement.procedureId, requiredSignalIds: requiredSignals,
    profileId: profile.id, componentInstanceId: component.instanceId, visitId: intake.current.visitId }, "knowledge_gap", quality);
  if (!intake.capture) return measure(["measurement:required_after_replacement_or_scr_complaint"]);
  const condition: MeasurementCondition = { id: SCR_RULE.measurement.procedureId,
    vehicleId: intake.current.vehicleId, configurationHash: profile.configurationHash,
    decoderHash: profile.decoderHash, windowPolicyHash: profile.windowPolicyHash,
    minimumDurationUs: profile.minimumDurationUs, maxSkewUs: profile.maxSkewUs,
    maxDroppedFrames: SCR_RULE.measurement.quality.maxDroppedFrames,
    // Pressure is the diagnostic quantity; load/temperature define test applicability.
    signals: profile.signals.map(s => SCR_RULE.measurement.signals.some(r => r.id === s.signalId && r.role === "diagnostic")
      ? { signalId: s.signalId, unit: s.unit, source: s.source, minimumSamples: s.minimumSamples,
          maxAgeUs: s.maxAgeUs, maxSampleGapUs: s.maxSampleGapUs } : s) };
  const validation: WindowValidation = validateEvidenceWindow(intake.capture.window, intake.capture.observations, condition);
  const quality: ScrDecision["can"] = { state: validation.check.state, missingSignals: validation.missingSignals,
    issueCodes: [...new Set(validation.issues.map(i => i.code))].sort() };
  if (validation.check.state === "unknown") return measure(validation.check.missing, quality);
  if (validation.check.state === "fail") return measure(["measurement:outside_oem_load_or_temperature_window"], quality);
  const pressure = profile.signals.find(s => s.signalId === "DEF_DOSING_PRESSURE");
  const refs = new Set(intake.capture.window.observationRefs);
  const pressureOutside = pressure && intake.capture.observations.some(o => refs.has(o.id) && o.signalId === pressure.signalId
    && o.value !== null && (o.value < pressure.range.min || o.value > pressure.range.max));
  const next = pressureOutside ? SCR_RULE.actions.delivery : SCR_RULE.actions.nox;
  return finish({ kind: "measure", id: next.procedureId, procedureId: next.procedureId,
    mandatory: true, instruction: next.instruction, requiredSignalIds: next.signalIds,
    reasonCodes: [pressureOutside ? "isolation:def_delivery_required" : "isolation:nox_function_required"],
    profileId: profile.id, componentInstanceId: component.instanceId, visitId: intake.current.visitId }, "knowledge_gap", quality);
}

/** Enforcement belongs in the command handler as well as the disabled UI. */
export function requestSensorReplacement(raw: unknown, trustedProfile: ScrProfile | null = null): {
  readonly allowed: false; readonly reason: string;
} {
  const result = runScrWorkflow(raw, trustedProfile);
  return { allowed: false, reason: result.ok ? result.decision.replacement.reason : "BOUNDARY_REJECTED" };
}
