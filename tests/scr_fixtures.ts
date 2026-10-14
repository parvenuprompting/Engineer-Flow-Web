import type { ValidatedIntake } from "../src/efl_core/boundary_validator";
import { parseScrProfile, SCR_RULE } from "../src/efl_core/scr_workflow";
import type { ScrProfile } from "../src/efl_core/scr_workflow";
import type { Observation } from "../src/efl_core/history_types";

// Entirely synthetic calibration. Never export this as an approved vehicle profile.
export const fixtureHash = "f".repeat(64);
export const scrIntake: ValidatedIntake = {
  schemaVersion: 1, complaint: "Nabehandelingsmelding keert terug na vervanging van de NOx-sensor.",
  current: { id: "episode-2", vehicleId: "DEMO-TRUCK", visitId: "visit-2", componentInstanceId: "nox-new",
    symptomIds: ["EFL_SCR_NOX_EXCEEDANCE"], observedAt: "2026-10-14T09:00:00.000Z", engineHours: 1200,
    configurationHash: fixtureHash, operatingContext: { modeId: "LOADED", measurements: [] }, evidenceRefs: ["complaint-2"] },
  history: [{ id: "episode-1", vehicleId: "DEMO-TRUCK", visitId: "visit-1", componentInstanceId: "nox-old",
    symptomIds: ["EFL_SCR_NOX_EXCEEDANCE"], observedAt: "2026-09-01T09:00:00.000Z", engineHours: 1100,
    configurationHash: fixtureHash, operatingContext: { modeId: "LOADED", measurements: [] }, evidenceRefs: ["complaint-1"] }],
  components: [
    { instanceId: "nox-old", slotId: "SCR_OUTLET_NOX_SENSOR", installedAt: "2025-01-01T09:00:00.000Z", removedAt: "2026-09-01T10:00:00.000Z" },
    { instanceId: "nox-new", slotId: "SCR_OUTLET_NOX_SENSOR", installedAt: "2026-09-01T10:00:00.000Z", removedAt: null },
  ],
  interventions: [{ id: "replace-1", vehicleId: "DEMO-TRUCK", visitId: "visit-1", performedAt: "2026-09-01T10:00:00.000Z",
    componentInstanceId: "nox-old", action: "replace", replacementInstanceId: "nox-new", preTestRefs: [], postTestRefs: [] }],
  historyComplete: true, dtcs: [{ protocol: "obd", code: "P20EE" }, { protocol: "j1939", spn: 3226, fmi: 2, sourceAddress: 0 }],
  capture: null,
};
export const syntheticProfile: ScrProfile = parseScrProfile({ id: "SYNTHETIC_TEST_ONLY", ruleVersion: "1.0.0",
  configurationHash: fixtureHash, approvalRef: "TEST_FIXTURE_NOT_OEM_APPROVED", oemProcedureRef: "TEST_ONLY",
  decoderHash: fixtureHash, windowPolicyHash: fixtureHash, supportedObdCodes: ["P20EE"],
  supportedJ1939: [{ spn: 3226, fmi: 2, sourceAddress: 0 }], minimumDurationUs: 2_000_000, maxSkewUs: 0,
  signals: SCR_RULE.measurement.signals.map((s, index) => ({ signalId: s.id, unit: s.unit,
    source: { protocol: "j1939", busId: "fixture-bus", ecuName: "fixture-ecu", sourceAddress: 0, pgn: 65000, spn: 100 + index },
    minimumSamples: 3, maxSampleGapUs: 1_000_000, maxAgeUs: 0,
    range: s.id === "DEF_DOSING_PRESSURE" ? { min: 400, max: 600 }
      : s.id === "ENGINE_LOAD" ? { min: 50, max: 80 }
      : s.id === "DEF_TEMPERATURE" ? { min: 10, max: 40 } : { min: 250, max: 350 },
  })) });

export function withCapture(): ValidatedIntake {
  const observations: Observation[] = syntheticProfile.signals.flatMap(s => [0, 1, 2].map(index => ({
    id: `${s.signalId}:${index}`, vehicleId: scrIntake.current.vehicleId, captureSessionId: "capture-2",
    sequence: index, monotonicUs: index * 1_000_000, receivedAtUtc: scrIntake.current.observedAt,
    source: s.source, signalId: s.signalId, value: (s.range.min + s.range.max) / 2, unit: s.unit,
    quality: "valid", decoderHash: fixtureHash, rawEvidenceRef: `raw:${s.signalId}:${index}`,
  })));
  return { ...scrIntake, current: { ...scrIntake.current, evidenceRefs: ["window-2"] }, capture: {
    window: { id: "window-2", vehicleId: scrIntake.current.vehicleId, captureSessionId: "capture-2", closed: true,
      startUs: 0, endUs: 2_000_000, observationRefs: observations.map(o => o.id),
      quality: { missingSignalIds: [], staleSignalIds: [], droppedFrames: 0, maxObservedSkewUs: 0 },
      windowPolicyHash: fixtureHash, configurationHash: fixtureHash }, observations,
  } };
}
