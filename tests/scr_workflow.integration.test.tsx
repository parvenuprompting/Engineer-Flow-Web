import { test } from "node:test";
import assert from "node:assert/strict";
import { validateIntake } from "../src/efl_core/boundary_validator";
import { requestSensorReplacement, runScrWorkflow, SCR_RULE } from "../src/efl_core/scr_workflow";
import { scrIntake, syntheticProfile, withCapture } from "./scr_fixtures";

test("raw intake → canonical boundary → recurrence/replacement → mandatory pressure/temperature CAN action", () => {
  const result = runScrWorkflow(JSON.stringify(scrIntake), syntheticProfile);
  assert.equal(result.ok, true); if (!result.ok) return;
  assert.equal(result.decision.status, "knowledge_gap");
  assert.equal(result.decision.history.recurring, true);
  assert.deepEqual(result.decision.history.priorVisitIds, ["visit-1"]);
  assert.equal(result.decision.replacement.allowed, false);
  assert.equal(result.decision.replacement.reason, "REPEAT_SENSOR_REPLACEMENT_BLOCKED");
  assert.deepEqual(result.decision.replacement.previousReplacementIds, ["replace-1"]);
  assert.equal(result.decision.nextAction.kind, "measure");
  if (result.decision.nextAction.kind !== "measure") return;
  assert.equal(result.decision.nextAction.procedureId, "SCR_DEF_PRESSURE_THERMAL_WINDOW");
  assert.deepEqual(result.decision.nextAction.requiredSignalIds, SCR_RULE.measurement.signals.map(s => s.id));
  assert.equal(result.decision.nextAction.componentInstanceId, "nox-new");
  assert.deepEqual(requestSensorReplacement(scrIntake, syntheticProfile), { allowed: false, reason: "REPEAT_SENSOR_REPLACEMENT_BLOCKED" });
  assert.deepEqual(result, runScrWorkflow(JSON.stringify(scrIntake), syntheticProfile));
});

test("unknown symptoms, missing keys, extra override fields and malformed JSON are rejected", () => {
  for (const raw of ["{", null, [], { ...scrIntake, current: { ...scrIntake.current, symptomIds: ["AI_GUESS"] } },
    { ...scrIntake, current: { ...scrIntake.current, configurationHash: "bad" } },
    { ...scrIntake, replacementAllowed: true }, { ...scrIntake, diagnosis: { state: "pass" } },
    { ...scrIntake, historyComplete: "true" }, { ...scrIntake, complaint: undefined },
    { ...scrIntake, current: { ...scrIntake.current, engineHours: NaN } },
    { ...scrIntake, dtcs: [{ protocol: "j1939", spn: 3226, fmi: 99, sourceAddress: 0 }] },
  ]) {
    const result = runScrWorkflow(raw, syntheticProfile);
    assert.equal(result.ok, false); if (result.ok) continue;
    assert.equal(result.status, "boundary_rejected"); assert.ok(result.issues.length > 0);
    assert.equal("decision" in result, false);
  }
});

test("component corruption, reused IDs, cross-vehicle history and contradictory times are rejected", () => {
  const previous = scrIntake.history[0]; assert.ok(previous);
  for (const raw of [
    { ...scrIntake, current: { ...scrIntake.current, componentInstanceId: "nox-old" } },
    { ...scrIntake, current: { ...scrIntake.current, componentInstanceId: "invented" } },
    { ...scrIntake, history: [{ ...previous, vehicleId: "other" }] },
    { ...scrIntake, history: [previous, previous] },
    { ...scrIntake, interventions: [] },
    { ...scrIntake, interventions: [...scrIntake.interventions, ...scrIntake.interventions] },
    { ...scrIntake, components: scrIntake.components.map(c => ({ ...c, removedAt: null })) },
    { ...scrIntake, current: { ...scrIntake.current, observedAt: "2026-02-30T00:00:00.000Z" } },
  ]) assert.equal(validateIntake(raw).ok, false);
});

test("an incomplete history gets verification before a measurement; it cannot bypass the lock", () => {
  const result = runScrWorkflow({ ...scrIntake, historyComplete: false }, syntheticProfile);
  assert.ok(result.ok); assert.equal(result.decision.nextAction.kind, "verify_history");
  assert.equal(result.decision.replacement.allowed, false);
});

test("SPN alone never inherits P20EE semantics; FMI and applicable OEM profile are mandatory", () => {
  const noFmi = { ...scrIntake, dtcs: [{ protocol: "j1939", spn: 3226, fmi: null, sourceAddress: 0 }] };
  const a = runScrWorkflow(noFmi, syntheticProfile); assert.ok(a.ok);
  assert.equal(a.decision.status, "clarification_required"); assert.equal(a.decision.nextAction.id, "SCR_CONFIRM_FMI");
  const b = runScrWorkflow(scrIntake); assert.ok(b.ok); assert.equal(b.decision.nextAction.id, "SCR_SELECT_OEM_PROFILE");
  const c = runScrWorkflow({ ...scrIntake, dtcs: [{ protocol: "j1939", spn: 3226, fmi: 13, sourceAddress: 0 }] }, syntheticProfile);
  assert.ok(c.ok); assert.deepEqual(c.decision.missing, ["profile:not_applicable"]);
  const d = runScrWorkflow({ ...scrIntake, dtcs: [] }, syntheticProfile);
  assert.ok(d.ok); assert.equal(d.decision.nextAction.id, "SCR_CONFIRM_DTC");
});

test("profile cannot omit signals, units or applicable configuration", () => {
  for (const profile of [
    { ...syntheticProfile, signals: [] }, { ...syntheticProfile, configurationHash: "a".repeat(64) },
    { ...syntheticProfile, signals: syntheticProfile.signals.map(s => ({ ...s, unit: "wrong" })) },
  ]) { const result = runScrWorkflow(scrIntake, profile); assert.ok(result.ok); assert.equal(result.decision.nextAction.id, "SCR_SELECT_OEM_PROFILE"); }
});

test("sensor errors and dropped frames cannot be converted to a passed test", () => {
  const input = withCapture(); assert.ok(input.capture);
  for (const capture of [
    { ...input.capture, window: { ...input.capture.window, quality: { ...input.capture.window.quality, droppedFrames: 1 } } },
    { ...input.capture, observations: input.capture.observations.map(o => o.signalId === "DEF_DOSING_PRESSURE" ? { ...o, quality: "sensor_error" as const } : o) },
    { ...input.capture, window: { ...input.capture.window, quality: { ...input.capture.window.quality, maxObservedSkewUs: null } } },
  ]) {
    const result = runScrWorkflow({ ...input, capture }, syntheticProfile); assert.ok(result.ok);
    assert.equal(result.decision.can.state, "unknown");
    assert.ok(result.decision.can.missingSignals.includes("DEF_DOSING_PRESSURE"));
    assert.equal(result.decision.nextAction.id, "SCR_DEF_PRESSURE_THERMAL_WINDOW");
    assert.equal(result.decision.replacement.allowed, false);
  }
});

test("a missing signal reports its exact canonical ID", () => {
  const input = withCapture(); assert.ok(input.capture);
  const observations = input.capture.observations.filter(o => o.signalId !== "DEF_DOSING_PRESSURE");
  const result = runScrWorkflow({ ...input, capture: { ...input.capture,
    window: { ...input.capture.window, observationRefs: observations.map(o => o.id) }, observations } }, syntheticProfile);
  assert.ok(result.ok); assert.deepEqual(result.decision.can.missingSignals, ["DEF_DOSING_PRESSURE"]);
});

test("valid CAN moves to isolation, never to replacement; low pressure follows a different branch", () => {
  const input = withCapture(); assert.ok(input.capture);
  const valid = runScrWorkflow(input, syntheticProfile); assert.ok(valid.ok);
  assert.equal(valid.decision.can.state, "pass");
  assert.equal(valid.decision.nextAction.id, "SCR_NOX_FUNCTION_ISOLATION");
  assert.equal(valid.decision.replacement.allowed, false);
  const pressure = runScrWorkflow({ ...input, capture: { ...input.capture,
    observations: input.capture.observations.map(o => o.signalId === "DEF_DOSING_PRESSURE" ? { ...o, value: 0 } : o) } }, syntheticProfile);
  assert.ok(pressure.ok); assert.equal(pressure.decision.nextAction.id, "SCR_DEF_DELIVERY_ISOLATION");
  const cold = runScrWorkflow({ ...input, capture: { ...input.capture,
    observations: input.capture.observations.map(o => o.signalId === "SCR_INLET_TEMPERATURE" ? { ...o, value: 0 } : o) } }, syntheticProfile);
  assert.ok(cold.ok); assert.equal(cold.decision.can.state, "fail");
  assert.equal(cold.decision.nextAction.id, "SCR_DEF_PRESSURE_THERMAL_WINDOW");
});

test("snapshot is detached and frozen; accessors and prototype pollution are rejected", () => {
  const raw = structuredClone(scrIntake); const result = validateIntake(raw); assert.ok(result.ok);
  assert.notEqual(raw, result.value); assert.ok(Object.isFrozen(result.value.current));
  let called = false;
  const getter = { ...scrIntake }; Object.defineProperty(getter, "complaint", { get() { called = true; return "x"; } });
  assert.equal(validateIntake(getter).ok, false); assert.equal(called, false);
  const polluted = JSON.stringify(scrIntake).replace('"schemaVersion":1', '"schemaVersion":1,"__proto__":{}');
  assert.equal(validateIntake(polluted).ok, false);
});

// De Vite-demo-UI (MonteurWerkplek) is bewust niet meegekopieerd naar deze repo;
// de twee bijbehorende render-tests zijn daarom hier weggelaten.
