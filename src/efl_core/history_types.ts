/** All IDs must be resolved against the pinned canonical knowledge bundle at intake. */
export type EvidenceRef = string;
export type CanonicalSymptomId = string;

export interface ContextMeasurement {
  readonly signalId: string;
  readonly value: number;
  readonly unit: string;
  readonly evidenceRefs: readonly EvidenceRef[];
}

export interface SymptomEpisode {
  readonly id: string;
  readonly vehicleId: string;
  readonly visitId: string;
  readonly componentInstanceId: string | null;
  readonly symptomIds: readonly CanonicalSymptomId[];
  readonly observedAt: string;
  readonly engineHours: number | null;
  readonly configurationHash: string;
  readonly operatingContext: {
    readonly modeId: string;
    readonly measurements: readonly ContextMeasurement[];
  };
  readonly evidenceRefs: readonly EvidenceRef[];
}

export interface Intervention {
  readonly id: string;
  readonly vehicleId: string;
  readonly visitId: string;
  readonly performedAt: string;
  readonly componentInstanceId: string;
  readonly action: "inspect" | "adjust" | "repair" | "replace";
  readonly replacementInstanceId?: string;
  readonly preTestRefs: readonly EvidenceRef[];
  readonly postTestRefs: readonly EvidenceRef[];
}

export type Check =
  | { readonly state: "pass"; readonly evidenceRefs: readonly EvidenceRef[] }
  | { readonly state: "fail"; readonly evidenceRefs: readonly EvidenceRef[] }
  | { readonly state: "unknown"; readonly missing: readonly string[] };

export type ObservationSource =
  | { readonly protocol: "j1939"; readonly busId: string;
      readonly ecuName: string | null; readonly sourceAddress: number;
      readonly pgn: number; readonly spn: number }
  | { readonly protocol: "obd"; readonly busId: string; readonly ecuId: string;
      readonly service: number; readonly pid: number }
  | { readonly protocol: "external_sensor"; readonly sensorId: string;
      readonly calibrationRef: string };

export interface Observation {
  readonly id: string;
  readonly vehicleId: string;
  readonly captureSessionId: string;
  readonly sequence: number;
  readonly monotonicUs: number;
  readonly receivedAtUtc: string;
  readonly source: ObservationSource;
  readonly signalId: string;
  readonly value: number | null;
  readonly unit: string;
  readonly quality: "valid" | "not_available" | "sensor_error" | "decode_error";
  readonly decoderHash: string;
  readonly rawEvidenceRef: EvidenceRef;
}

export interface EvidenceWindow {
  readonly id: string;
  readonly vehicleId: string;
  readonly captureSessionId: string;
  readonly closed: boolean;
  readonly startUs: number;
  readonly endUs: number;
  readonly observationRefs: readonly EvidenceRef[];
  readonly quality: {
    readonly missingSignalIds: readonly string[];
    readonly staleSignalIds: readonly string[];
    /** null means unknown, never zero. */
    readonly droppedFrames: number | null;
    readonly maxObservedSkewUs: number | null;
  };
  readonly windowPolicyHash: string;
  readonly configurationHash: string;
}

export interface ExecutionManifest {
  readonly previousExecutionHash: string | null;
  readonly engineBuildHash: string;
  readonly knowledgeBundleHash: string;
  readonly decoderHash: string;
  readonly windowPolicyHash: string;
  readonly configurationHash: string;
  readonly evidenceRootHash: string;
  readonly resultHash: string;
  readonly policyVersion: string;
}

export type DegradationAssessment =
  | { readonly status: "knowledge_gap"; readonly missing: readonly string[] }
  | { readonly status: "rule_not_satisfied"; readonly evidenceRefs: readonly EvidenceRef[] }
  | { readonly status: "rule_satisfied"; readonly evidenceRefs: readonly EvidenceRef[] };

export function sortedUnique(values: readonly string[]): string[] {
  // Default UTF-16 ordering: independent of machine locale.
  return [...new Set(values)].sort();
}

/** Require explicit UTC timestamps; Date.parse alone accepts invalid calendar dates. */
export function utcMillis(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) && new Date(ms).toISOString() === value ? ms : null;
}
