import type { Check, EvidenceWindow, Observation, ObservationSource } from "./history_types";
import { sortedUnique, utcMillis } from "./history_types";

export interface SignalRequirement {
  readonly signalId: string;
  readonly unit: string;
  readonly source: ObservationSource;
  readonly minimumSamples: number;
  readonly maxSampleGapUs: number;
  readonly maxAgeUs: number;
  /** Optional operating condition, in the declared canonical unit, inclusive. */
  readonly range?: { readonly min: number; readonly max: number };
}

export interface MeasurementCondition {
  readonly id: string;
  readonly vehicleId: string;
  readonly configurationHash: string;
  readonly decoderHash: string;
  readonly windowPolicyHash: string;
  readonly minimumDurationUs: number;
  readonly maxDroppedFrames: number;
  readonly maxSkewUs: number;
  readonly signals: readonly SignalRequirement[];
}

export interface EvidenceIssue {
  readonly code: string;
  readonly signalId: string | null;
  readonly observationId: string | null;
}

export interface WindowValidation {
  readonly check: Check;
  /** Required signals absent or unusable; global transport faults invalidate all. */
  readonly missingSignals: readonly string[];
  readonly issues: readonly EvidenceIssue[];
}

function nonNegativeInteger(value: number | null): value is number {
  return value !== null && Number.isSafeInteger(value) && value >= 0;
}

export function sameSource(a: ObservationSource, b: ObservationSource): boolean {
  switch (a.protocol) {
    case "j1939": return b.protocol === "j1939" && a.busId === b.busId
      && a.ecuName === b.ecuName && a.sourceAddress === b.sourceAddress
      && a.pgn === b.pgn && a.spn === b.spn;
    case "obd": return b.protocol === "obd" && a.busId === b.busId && a.ecuId === b.ecuId
      && a.service === b.service && a.pid === b.pid;
    case "external_sensor": return b.protocol === "external_sensor"
      && a.sensorId === b.sensorId && a.calibrationRef === b.calibrationRef;
  }
}

/** Pure validation: no wall clock, latest-value carry-forward, or interpolation. */
export function validateEvidenceWindow(
  window: EvidenceWindow,
  observations: readonly Observation[],
  condition: MeasurementCondition,
): WindowValidation {
  const issues: EvidenceIssue[] = [];
  const invalidSignals = new Set<string>();
  const requiredIds = sortedUnique(condition.signals.map(s => s.signalId));
  const add = (code: string, signalId: string | null = null, observationId: string | null = null) => {
    issues.push({ code, signalId, observationId });
    for (const id of signalId === null ? requiredIds : [signalId]) invalidSignals.add(id);
  };
  if (!condition.id || !condition.vehicleId || !condition.configurationHash
    || !condition.decoderHash || !condition.windowPolicyHash
    || !nonNegativeInteger(condition.minimumDurationUs) || condition.minimumDurationUs === 0
    || !nonNegativeInteger(condition.maxDroppedFrames) || !nonNegativeInteger(condition.maxSkewUs)
    || !condition.signals.length || requiredIds.length !== condition.signals.length
    || condition.signals.some(s => !s.signalId || !s.unit || !Number.isSafeInteger(s.minimumSamples)
      || s.minimumSamples < 2 || !nonNegativeInteger(s.maxSampleGapUs)
      || !nonNegativeInteger(s.maxAgeUs)
      || (s.range !== undefined && (!Number.isFinite(s.range.min)
        || !Number.isFinite(s.range.max) || s.range.min > s.range.max)))) add("invalid_condition");
  if (!window.closed) add("window_not_closed");
  if (!window.id || !window.captureSessionId) add("window_identity_missing");
  if (!nonNegativeInteger(window.startUs) || !nonNegativeInteger(window.endUs)
    || window.endUs <= window.startUs) add("invalid_window_time");
  if (window.endUs - window.startUs < condition.minimumDurationUs) add("insufficient_duration");
  if (window.vehicleId !== condition.vehicleId) add("vehicle_mismatch");
  if (window.configurationHash !== condition.configurationHash) add("configuration_mismatch");
  if (window.windowPolicyHash !== condition.windowPolicyHash) add("window_policy_mismatch");
  if (!nonNegativeInteger(window.quality.droppedFrames)) add("dropped_frames_unknown");
  else if (window.quality.droppedFrames > condition.maxDroppedFrames) add("dropped_frames_exceeded");
  if (!nonNegativeInteger(window.quality.maxObservedSkewUs)) add("skew_unknown");
  else if (window.quality.maxObservedSkewUs > condition.maxSkewUs) add("skew_exceeded");
  for (const id of requiredIds) {
    if (window.quality.missingSignalIds.includes(id)) add("reported_missing", id);
    if (window.quality.staleSignalIds.includes(id)) add("reported_stale", id);
  }

  const byId = new Map<string, Observation>();
  const refs = new Set(window.observationRefs);
  if (refs.size !== window.observationRefs.length) add("duplicate_observation_ref");
  for (const observation of observations) {
    // Extra caller data is not evidence unless explicitly referenced by this window.
    if (!refs.has(observation.id)) continue;
    if (byId.has(observation.id)) add("duplicate_observation_id", null, observation.id);
    byId.set(observation.id, observation);
  }
  for (const ref of refs) if (!byId.has(ref)) add("unresolved_observation_ref", null, ref);
  const selected = [...byId.values()];
  for (const observation of selected) {
    if (observation.vehicleId !== window.vehicleId || observation.captureSessionId !== window.captureSessionId)
      add("observation_identity_mismatch", null, observation.id);
    if (!nonNegativeInteger(observation.monotonicUs) || observation.monotonicUs < window.startUs
      || observation.monotonicUs > window.endUs) add("observation_outside_window", null, observation.id);
  }

  let conditionFailed = false;
  const validBySignal = new Map<string, Observation[]>();
  for (const requirement of condition.signals) {
    const samples = selected.filter(o => o.signalId === requirement.signalId)
      .sort((a, b) => a.monotonicUs - b.monotonicUs || a.sequence - b.sequence);
    validBySignal.set(requirement.signalId, samples);
    if (!samples.length) add("signal_missing", requirement.signalId);
    if (samples.length < requirement.minimumSamples) add("insufficient_samples", requirement.signalId);
    let previous: Observation | undefined;
    for (const sample of samples) {
      if (sample.quality !== "valid") add(sample.quality, requirement.signalId, sample.id);
      if (sample.value === null || !Number.isFinite(sample.value)) add("invalid_value", requirement.signalId, sample.id);
      if (sample.unit !== requirement.unit) add("unit_mismatch", requirement.signalId, sample.id);
      if (!sameSource(sample.source, requirement.source)) add("source_mismatch", requirement.signalId, sample.id);
      if (sample.decoderHash !== condition.decoderHash) add("decoder_mismatch", requirement.signalId, sample.id);
      if (!sample.rawEvidenceRef || utcMillis(sample.receivedAtUtc) === null)
        add("provenance_missing", requirement.signalId, sample.id);
      if (!nonNegativeInteger(sample.sequence)) add("invalid_sequence", requirement.signalId, sample.id);
      if (previous) {
        if (sample.monotonicUs === previous.monotonicUs || sample.sequence <= previous.sequence)
          add("duplicate_or_reversed_sample", requirement.signalId, sample.id);
        if (sample.monotonicUs - previous.monotonicUs > requirement.maxSampleGapUs)
          add("sample_gap", requirement.signalId, sample.id);
      }
      if (requirement.range && sample.value !== null
        && (sample.value < requirement.range.min || sample.value > requirement.range.max)) conditionFailed = true;
      previous = sample;
    }
    const first = samples[0]; const last = samples[samples.length - 1];
    if (first && first.monotonicUs - window.startUs > requirement.maxAgeUs)
      add("start_coverage_missing", requirement.signalId, first.id);
    if (last && window.endUs - last.monotonicUs > requirement.maxAgeUs)
      add("stale_at_close", requirement.signalId, last.id);
  }

  // Check actual temporal alignment too, rather than trusting gateway metadata alone.
  for (const [signalId, samples] of validBySignal) {
    for (const sample of samples) {
      for (const [otherId, others] of validBySignal) {
        if (signalId === otherId || !others.length) continue;
        // Binary search nearest timestamp (no synthetic sample is created).
        let lo = 0; let hi = others.length;
        while (lo < hi) {
          const mid = Math.floor((lo + hi) / 2);
          const item = others[mid];
          if (item && item.monotonicUs < sample.monotonicUs) lo = mid + 1; else hi = mid;
        }
        const before = others[lo - 1]; const after = others[lo];
        const nearest = Math.min(before ? Math.abs(before.monotonicUs - sample.monotonicUs) : Infinity,
          after ? Math.abs(after.monotonicUs - sample.monotonicUs) : Infinity);
        if (nearest > condition.maxSkewUs) add("measured_skew_exceeded", signalId, sample.id);
      }
    }
  }
  const uniqueIssues = [...new Map(issues.map(issue => [JSON.stringify(issue), issue])).values()]
    .sort((a, b) => {
      const x = JSON.stringify(a); const y = JSON.stringify(b);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  const evidenceRefs = sortedUnique([window.id, ...selected.flatMap(o => [o.id, o.rawEvidenceRef])]);
  const check: Check = uniqueIssues.length ? { state: "unknown", missing: uniqueIssues.map(i =>
    JSON.stringify([i.code, i.signalId, i.observationId])) }
    : { state: conditionFailed ? "fail" : "pass", evidenceRefs };
  return { check, missingSignals: sortedUnique([...invalidSignals]), issues: uniqueIssues };
}

export interface WindowInput {
  readonly window: EvidenceWindow;
  readonly observations: readonly Observation[];
}

/** Conservative progression: every current sample exceeds every baseline sample
 * by the configured delta. No slope fitting or invented OEM thresholds. */
export function assessMeasuredProgression(
  baseline: WindowInput,
  current: WindowInput,
  condition: MeasurementCondition,
  rule: { readonly signalId: string; readonly direction: "increase" | "decrease"; readonly minimumDelta: number },
): Check {
  const checks = [validateEvidenceWindow(baseline.window, baseline.observations, condition).check,
    validateEvidenceWindow(current.window, current.observations, condition).check];
  if (!Number.isFinite(rule.minimumDelta) || rule.minimumDelta <= 0
    || !condition.signals.some(s => s.signalId === rule.signalId))
    return { state: "unknown", missing: ["progression:invalid_rule"] };
  const missing = checks.flatMap(c => c.state === "unknown" ? c.missing : []);
  if (missing.length) return { state: "unknown", missing: sortedUnique(missing) };
  const evidenceRefs = sortedUnique(checks.flatMap(c => c.state === "unknown" ? [] : c.evidenceRefs));
  if (checks.some(c => c.state === "fail")) return { state: "fail", evidenceRefs };
  const values = (input: WindowInput): number[] => {
    const refs = new Set(input.window.observationRefs);
    return input.observations.filter(o => refs.has(o.id) && o.signalId === rule.signalId)
      .map(o => o.value).filter((v): v is number => v !== null);
  };
  const a = values(baseline); const b = values(current);
  // Reduce instead of spreading potentially large acquisition windows onto the stack.
  const min = (xs: number[]) => xs.reduce((x, y) => Math.min(x, y), Infinity);
  const max = (xs: number[]) => xs.reduce((x, y) => Math.max(x, y), -Infinity);
  const delta = rule.direction === "increase" ? min(b) - max(a) : min(a) - max(b);
  return { state: delta >= rule.minimumDelta ? "pass" : "fail", evidenceRefs };
}
