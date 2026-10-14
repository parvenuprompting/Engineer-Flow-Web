import type { Check, EvidenceWindow, Intervention, Observation, ObservationSource, SymptomEpisode } from "../src/efl_core/history_types";
import { assessDegradation, matchHistory } from "../src/efl_core/history_matcher";
import type { HistoryPolicy } from "../src/efl_core/history_matcher";
import { assessMeasuredProgression, validateEvidenceWindow } from "../src/efl_core/can_evidence_validator";
import type { MeasurementCondition, WindowInput } from "../src/efl_core/can_evidence_validator";
import { canonicalJson, createExecutionManifest, hashCanonical } from "../src/efl_core/execution_manifest";
import { evaluateHistoryDegradation } from "../src/efl_core/history_degradation";
import type { DegradationSliceInput } from "../src/efl_core/history_degradation";

// Synthetic fixture values, NOT OEM limits or a released diagnostic rule.
const hash = "a".repeat(64);
const source: ObservationSource = { protocol: "external_sensor", sensorId: "fixture-sensor", calibrationRef: "cal-1" };
const policy: HistoryPolicy = {
  id: "fixture-history-v1", sameComponentInstance: true, distinctVisitsRequired: true,
  minimumEpisodes: 2, requiredSymptomIds: ["FIXTURE_LOW_OUTPUT"], modeId: "PTO_LOADED",
  context: [{ signalId: "pto_load", unit: "%", absoluteTolerance: 0 }],
  replacementExclusionTestIds: ["exclude_power", "exclude_contamination"],
};
const condition: MeasurementCondition = {
  id: "fixture-window-v1", vehicleId: "truck-1", configurationHash: hash,
  decoderHash: hash, windowPolicyHash: hash, minimumDurationUs: 2_000_000,
  maxDroppedFrames: 0, maxSkewUs: 0,
  signals: [
    { signalId: "pto_load", unit: "%", source, minimumSamples: 3, maxSampleGapUs: 1_000_000,
      maxAgeUs: 0, range: { min: 60, max: 60 } },
    { signalId: "case_drain", unit: "mL/min", source, minimumSamples: 3,
      maxSampleGapUs: 1_000_000, maxAgeUs: 0 },
  ],
};

function episode(id: string, visit: string, component: string, date: string, windowId: string): SymptomEpisode {
  return { id, vehicleId: "truck-1", visitId: visit, componentInstanceId: component,
    symptomIds: ["FIXTURE_LOW_OUTPUT"], observedAt: date, engineHours: null,
    configurationHash: hash, operatingContext: { modeId: "PTO_LOADED", measurements: [
      { signalId: "pto_load", unit: "%", value: 60, evidenceRefs: [windowId] },
    ] }, evidenceRefs: [windowId] };
}

function capture(id: string, value: number, date: string): WindowInput {
  const observations: Observation[] = [];
  for (let i = 0; i < 3; i++) {
    for (const signal of condition.signals) {
      observations.push({ id: `${id}:${signal.signalId}:${i}`, vehicleId: "truck-1",
        captureSessionId: id, sequence: i, monotonicUs: i * 1_000_000, receivedAtUtc: date,
        source, signalId: signal.signalId, value: signal.signalId === "pto_load" ? 60 : value,
        unit: signal.unit, quality: "valid", decoderHash: hash, rawEvidenceRef: `raw:${id}:${signal.signalId}:${i}` });
    }
  }
  const window: EvidenceWindow = { id, vehicleId: "truck-1", captureSessionId: id, closed: true,
    startUs: 0, endUs: 2_000_000, observationRefs: observations.map(o => o.id),
    quality: { missingSignalIds: [], staleSignalIds: [], droppedFrames: 0, maxObservedSkewUs: 0 },
    windowPolicyHash: hash, configurationHash: hash };
  return { window, observations };
}

function assert(value: unknown, message = "assertion failed"): asserts value {
  if (!value) throw new Error(message);
}
function equal(actual: unknown, expected: unknown): void {
  assert(canonicalJson(actual) === canonicalJson(expected), `Expected ${canonicalJson(expected)}, received ${canonicalJson(actual)}`);
}
function pass(ref: string): Check { return { state: "pass", evidenceRefs: [ref] }; }
const firstDate = "2026-09-01T09:00:00.000Z";
const secondDate = "2026-10-14T09:00:00.000Z";
const baseline = capture("window-1", 100, firstDate);
const current = capture("window-2", 160, secondDate);
const oldEpisode = episode("episode-1", "visit-1", "pump-1", firstDate, baseline.window.id);
const newEpisode = episode("episode-2", "visit-2", "pump-1", secondDate, current.window.id);
const progressionRule = { signalId: "case_drain", direction: "increase", minimumDelta: 40 } as const;
const recurring = () => matchHistory(newEpisode, [oldEpisode], [], policy);
const measuredProgression = () => assessMeasuredProgression(baseline, current, condition, progressionRule);
const assess = (history = recurring(), progression = measuredProgression(), exclusions: Readonly<Record<string, Check>> = {}) =>
  assessDegradation({ history, progression, isolation: pass("signed-test:isolation"),
    requiredExclusionTestIds: [], exclusions });
const tests: { name: string; run: () => void | Promise<void> }[] = [];
function test(name: string, run: () => void | Promise<void>): void { tests.push({ name, run }); }

test("A: repeated same-instance degradation under identical PTO load produces a replayable manifest", async () => {
  equal(validateEvidenceWindow(current.window, current.observations, condition).check.state, "pass");
  equal(recurring().matchedEpisodeIds, [oldEpisode.id]);
  equal(measuredProgression().state, "pass");
  const result = assess();
  equal(result.status, "rule_satisfied");
  const context = { previousExecutionHash: null, engineBuildHash: hash, knowledgeBundleHash: hash,
    decoderHash: hash, windowPolicyHash: hash, configurationHash: hash, policyVersion: "fixture-v1" };
  const evidence = { episodes: [oldEpisode, newEpisode], interventions: [], captures: [baseline, current],
    policy, condition, progressionRule, isolation: pass("signed-test:isolation") };
  const record = await createExecutionManifest(context, evidence, result);
  equal(record, await createExecutionManifest(context, evidence, result));
  assert(/^[a-f0-9]{64}$/.test(record.executionHash));
  equal(record.manifest.resultHash, await hashCanonical({ domain: "efl.result.v1", result }));
  const next = await createExecutionManifest({ ...context, previousExecutionHash: record.executionHash }, evidence, result);
  assert(next.executionHash !== record.executionHash);
  const tampered = await createExecutionManifest(context, { ...evidence, interventions: ["tampered"] }, result);
  assert(tampered.manifest.evidenceRootHash !== record.manifest.evidenceRootHash);
});

const replacement: Intervention = { id: "replace-1", vehicleId: "truck-1", visitId: "visit-1",
  performedAt: "2026-09-01T10:00:00.000Z", componentInstanceId: "pump-1", action: "replace",
  replacementInstanceId: "pump-2", preTestRefs: ["test-before"], postTestRefs: ["test-after"] };
const replacedEpisode: SymptomEpisode = { ...newEpisode, componentInstanceId: "pump-2" };

test("B: new component does not inherit old wear; targeted external tests are mandatory", () => {
  const history = matchHistory(replacedEpisode, [oldEpisode], [replacement], policy);
  equal(history.matchedEpisodeIds, []);
  equal(history.requiredExclusionTestIds, ["exclude_contamination", "exclude_power"]);
  const result = assess(history);
  assert(result.status === "knowledge_gap");
  equal(result.missing, ["history:comparable_baseline", "test:exclude_contamination", "test:exclude_power"]);
});

test("B: even with a new-instance baseline, missing replacement exclusions block a conclusion", () => {
  const postInstall = { ...oldEpisode, id: "post-install", componentInstanceId: "pump-2",
    observedAt: "2026-09-01T11:00:00.000Z" };
  const history = matchHistory(replacedEpisode, [postInstall], [replacement], policy);
  equal(history.check.state, "pass");
  equal(assess(history).status, "knowledge_gap");
  equal(assess(history, measuredProgression(), {
    exclude_power: pass("power-test"), exclude_contamination: pass("fluid-test"),
  }).status, "rule_satisfied");
});

test("B: unsafe cross-instance policy cannot bypass an installation boundary", () => {
  const history = matchHistory(replacedEpisode, [oldEpisode], [replacement], { ...policy, sameComponentInstance: false });
  equal(history.matchedEpisodeIds, []);
  equal(assess(history).status, "knowledge_gap");
});

test("C: unknown frame quality invalidates all required signals", () => {
  const window = { ...current.window, quality: { ...current.window.quality, droppedFrames: null } };
  const result = validateEvidenceWindow(window, current.observations, condition);
  equal(result.check.state, "unknown");
  equal(result.missingSignals, ["case_drain", "pto_load"]);
  assert(result.issues.some(i => i.code === "dropped_frames_unknown"));
});

test("C: dropped frames block the diagnosis even if all signal names are present", () => {
  const damaged = { ...current, window: { ...current.window,
    quality: { ...current.window.quality, droppedFrames: 1 } } };
  const validated = validateEvidenceWindow(damaged.window, damaged.observations, condition);
  equal(validated.missingSignals, ["case_drain", "pto_load"]);
  const progression = assessMeasuredProgression(baseline, damaged, condition, progressionRule);
  equal(assess(recurring(), progression).status, "knowledge_gap");
});

test("C: missing signal reports precisely the affected signal", () => {
  const observations = current.observations.filter(o => o.signalId !== "case_drain");
  const window = { ...current.window, observationRefs: observations.map(o => o.id) };
  const result = validateEvidenceWindow(window, observations, condition);
  equal(result.check.state, "unknown");
  equal(result.missingSignals, ["case_drain"]);
});

test("stale and sensor-error readings are unknown, never silently discarded", () => {
  for (const quality of ["sensor_error", "not_available", "decode_error"] as const) {
    const observations = current.observations.map(o => o.signalId === "case_drain" ? { ...o, quality } : o);
    const result = validateEvidenceWindow(current.window, observations, condition);
    equal(result.check.state, "unknown");
    equal(result.missingSignals, ["case_drain"]);
  }
  const stale = { ...current.window, quality: { ...current.window.quality, staleSignalIds: ["case_drain"] } };
  equal(validateEvidenceWindow(stale, current.observations, condition).missingSignals, ["case_drain"]);
});

test("sample gap and stale tail are detected without trusting metadata", () => {
  for (const suffix of [":1", ":2"]) {
    const observations = current.observations.filter(o => !(o.signalId === "case_drain" && o.id.endsWith(suffix)));
    const window = { ...current.window, observationRefs: observations.map(o => o.id) };
    const result = validateEvidenceWindow(window, observations, condition);
    equal(result.check.state, "unknown");
    assert(result.issues.some(i => i.code === (suffix === ":1" ? "sample_gap" : "stale_at_close")));
  }
});

test("closed window, duration, quality limits, units, provenance and source are enforced", () => {
  for (const window of [
    { ...current.window, closed: false },
    { ...current.window, endUs: 1_000_000 },
    { ...current.window, quality: { ...current.window.quality, maxObservedSkewUs: null } },
    { ...current.window, quality: { ...current.window.quality, maxObservedSkewUs: 1 } },
    { ...current.window, configurationHash: "wrong" },
    { ...current.window, observationRefs: [...current.window.observationRefs, "missing-ref"] },
  ]) equal(validateEvidenceWindow(window, current.observations, condition).check.state, "unknown");
  for (const change of [
    { unit: "wrong" }, { value: NaN }, { rawEvidenceRef: "" }, { decoderHash: "wrong" },
    { source: { ...source, sensorId: "different-sensor" } }, { vehicleId: "another-truck" },
  ]) {
    const observations = current.observations.map(o => o.signalId === "case_drain" ? { ...o, ...change } : o);
    equal(validateEvidenceWindow(current.window, observations, condition).check.state, "unknown");
  }
});

test("actual skew cannot be hidden by a zero-skew gateway report", () => {
  const observations = current.observations.map(o => o.signalId === "case_drain" && o.monotonicUs === 1_000_000
    ? { ...o, monotonicUs: 1_000_001 } : o);
  assert(validateEvidenceWindow(current.window, observations, condition).issues.some(i => i.code === "measured_skew_exceeded"));
});

test("valid but wrong operating condition fails rather than claiming a sensor gap", () => {
  const observations = current.observations.map(o => o.signalId === "pto_load" ? { ...o, value: 70 } : o);
  equal(validateEvidenceWindow(current.window, observations, condition).check.state, "fail");
  equal(assess(recurring(), assessMeasuredProgression(baseline, { ...current, observations }, condition, progressionRule)).status,
    "rule_not_satisfied");
});

test("unchanged measurement does not satisfy degradation", () => {
  const stable = capture("stable", 100, secondDate);
  equal(assess(recurring(), assessMeasuredProgression(baseline, stable, condition, progressionRule)).status,
    "rule_not_satisfied");
});

test("history cannot match another vehicle, component, configuration, load or same visit", () => {
  for (const change of [
    { vehicleId: "truck-2" }, { componentInstanceId: "pump-other" }, { configurationHash: "other" },
    { visitId: "visit-2" }, { operatingContext: { ...oldEpisode.operatingContext,
      measurements: [{ signalId: "pto_load", unit: "%", value: 70, evidenceRefs: ["load"] }] } },
  ]) equal(matchHistory(newEpisode, [{ ...oldEpisode, ...change }], [], policy).check.state, "unknown");
});

test("duplicate visits cannot meet a three-visit threshold; input order is irrelevant", () => {
  const second = { ...oldEpisode, id: "episode-other", observedAt: "2026-09-02T09:00:00.000Z" };
  const p = { ...policy, minimumEpisodes: 3 };
  const a = matchHistory(newEpisode, [oldEpisode, second], [], p);
  equal(a.check.state, "unknown");
  equal(a, matchHistory(newEpisode, [second, oldEpisode], [], p));
});

test("missing identity, context and invalid dates never produce a match", () => {
  for (const change of [
    { componentInstanceId: null }, { observedAt: "2026-02-30T09:00:00.000Z" },
    { operatingContext: { modeId: "PTO_LOADED", measurements: [] } },
  ]) equal(matchHistory({ ...newEpisode, ...change }, [oldEpisode], [], policy).check.state, "unknown");
});

test("failed exclusion rejects rule; unknown dominates; evidence-free passes are blocked", () => {
  const input = { history: recurring(), progression: measuredProgression(), isolation: pass("isolate"),
    requiredExclusionTestIds: ["power"], exclusions: { power: { state: "fail", evidenceRefs: ["bad-power"] } as Check } };
  equal(assessDegradation(input).status, "rule_not_satisfied");
  equal(assessDegradation({ ...input, progression: { state: "unknown", missing: ["pressure"] } }).status, "knowledge_gap");
  equal(assessDegradation({ ...input, isolation: { state: "pass", evidenceRefs: [] } }).status, "knowledge_gap");
});

test("audit serialization is stable and rejects invalid evidence", async () => {
  equal(await hashCanonical({ b: 2, a: 1 }), await hashCanonical({ a: 1, b: 2 }));
  for (const value of [NaN, undefined, { a: undefined }, new Date(), [Infinity]]) {
    let threw = false;
    try { canonicalJson(value); } catch { threw = true; }
    assert(threw, "invalid audit value should throw");
  }
});

const slice: DegradationSliceInput = {
  current: newEpisode, history: [oldEpisode], interventions: [],
  captures: [{ episodeId: oldEpisode.id, input: baseline }, { episodeId: newEpisode.id, input: current }],
  historyPolicy: policy, measurementCondition: condition, progressionRule,
  isolationTestId: "isolation", requiredExclusionTestIds: [],
  tests: [{ testId: "isolation", vehicleId: "truck-1", componentInstanceId: "pump-1", visitId: "visit-2",
    performedAt: secondDate, knowledgeBundleHash: hash, check: pass("signed-isolation") }],
  manifestContext: { previousExecutionHash: null, engineBuildHash: hash, knowledgeBundleHash: hash,
    decoderHash: hash, windowPolicyHash: hash, configurationHash: hash, policyVersion: "fixture-v1" },
};

test("public entry point binds A to exact episodes, observations, tests and manifest", async () => {
  const result = await evaluateHistoryDegradation(slice);
  equal(result.assessment.status, "rule_satisfied");
  equal(result, await evaluateHistoryDegradation(slice));
  equal(result.execution.manifest.evidenceRootHash, await hashCanonical({ domain: "efl.evidence.v1", evidence: slice }));
});

test("public entry point blocks B and C", async () => {
  const b = await evaluateHistoryDegradation({ ...slice, current: replacedEpisode, interventions: [replacement] });
  assert(b.assessment.status === "knowledge_gap");
  assert(b.assessment.missing.includes("test:exclude_power:current_scoped_result"));
  assert(b.assessment.missing.includes("test:exclude_contamination:current_scoped_result"));
  const damaged = { ...current, window: { ...current.window,
    quality: { ...current.window.quality, droppedFrames: 1 } } };
  const c = await evaluateHistoryDegradation({ ...slice,
    captures: [{ episodeId: oldEpisode.id, input: baseline }, { episodeId: newEpisode.id, input: damaged }] });
  equal(c.assessment.status, "knowledge_gap");
});

test("public entry point rejects detached measurements, mismatched context and old-component tests", async () => {
  for (const change of [
    { captures: [{ episodeId: "unrelated-episode", input: baseline }, { episodeId: newEpisode.id, input: current }] },
    { tests: slice.tests.map(t => ({ ...t, componentInstanceId: "old-component" })) },
    { tests: slice.tests.map(t => ({ ...t, performedAt: firstDate })) },
    { current: { ...newEpisode, operatingContext: { modeId: "PTO_LOADED", measurements: [
      { signalId: "pto_load", unit: "%", value: 61, evidenceRefs: [current.window.id] },
    ] } } },
  ]) equal((await evaluateHistoryDegradation({ ...slice, ...change })).assessment.status, "knowledge_gap");
});

// Deze repo draait zonder "type": "module"; tsx compileert hier naar CJS en
// daarin bestaat geen top-level await. Zelfde gedrag via main().
async function main(): Promise<void> {
  let failures = 0;
  for (const entry of tests) {
    try { await entry.run(); console.log(`PASS ${entry.name}`); }
    catch (error) { failures++; console.error(`FAIL ${entry.name}`, error); }
  }
  if (failures) throw new Error(`${failures}/${tests.length} tests failed`);
  console.log(`${tests.length}/${tests.length} tests passed`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
