/** Public slice entry point. Inputs must come from the authenticated evidence store,
 * never directly from AI-generated Check objects or unvalidated network JSON. */
import type { Check, DegradationAssessment, Intervention, SymptomEpisode } from "./history_types";
import { sortedUnique, utcMillis } from "./history_types";
import { assessDegradation, matchHistory } from "./history_matcher";
import type { HistoryPolicy } from "./history_matcher";
import { assessMeasuredProgression } from "./can_evidence_validator";
import type { MeasurementCondition, WindowInput } from "./can_evidence_validator";
import { createExecutionManifest } from "./execution_manifest";
import type { ExecutionRecord, ManifestContext } from "./execution_manifest";

export interface ScopedTestResult {
  readonly testId: string;
  readonly vehicleId: string;
  readonly componentInstanceId: string;
  readonly visitId: string;
  readonly performedAt: string;
  readonly knowledgeBundleHash: string;
  readonly check: Check;
}

export interface DegradationSliceInput {
  readonly current: SymptomEpisode;
  readonly history: readonly SymptomEpisode[];
  readonly interventions: readonly Intervention[];
  readonly captures: readonly { readonly episodeId: string; readonly input: WindowInput }[];
  readonly historyPolicy: HistoryPolicy;
  readonly measurementCondition: MeasurementCondition;
  readonly progressionRule: {
    readonly signalId: string;
    readonly direction: "increase" | "decrease";
    readonly minimumDelta: number;
  };
  readonly isolationTestId: string;
  readonly requiredExclusionTestIds: readonly string[];
  readonly tests: readonly ScopedTestResult[];
  readonly manifestContext: ManifestContext;
}

export interface DegradationSliceResult {
  readonly assessment: DegradationAssessment;
  readonly execution: ExecutionRecord;
}

export async function evaluateHistoryDegradation(input: DegradationSliceInput): Promise<DegradationSliceResult> {
  const history = matchHistory(input.current, input.history, input.interventions, input.historyPolicy);
  const missing: string[] = [];
  if (!input.historyPolicy.sameComponentInstance) missing.push("degradation:requires_same_component_instance");
  if (input.manifestContext.configurationHash !== input.measurementCondition.configurationHash
    || input.manifestContext.decoderHash !== input.measurementCondition.decoderHash
    || input.manifestContext.windowPolicyHash !== input.measurementCondition.windowPolicyHash)
    missing.push("manifest:measurement_version_mismatch");
  if (input.current.configurationHash !== input.measurementCondition.configurationHash
    || input.current.vehicleId !== input.measurementCondition.vehicleId)
    missing.push("current:measurement_identity_mismatch");

  const captureFor = (episode: SymptomEpisode): WindowInput | undefined => {
    const captures = input.captures.filter(c => c.episodeId === episode.id);
    const capture = captures[0]?.input;
    if (captures.length !== 1 || !capture || !episode.evidenceRefs.includes(capture.window.id)) {
      missing.push(`episode:${episode.id}:bound_capture`); return undefined;
    }
    // This slice uses a constant, measured context; it does not accept a hand-entered
    // PTO load when the attached stream says otherwise.
    for (const requirement of input.historyPolicy.context) {
      const declared = episode.operatingContext.measurements.find(m => m.signalId === requirement.signalId);
      const refs = new Set(capture.window.observationRefs);
      const observations = capture.observations.filter(o => refs.has(o.id) && o.signalId === requirement.signalId);
      if (!input.measurementCondition.signals.some(s => s.signalId === requirement.signalId)
        || !declared || !declared.evidenceRefs.includes(capture.window.id) || !observations.length
        || observations.some(o => o.value !== declared.value || o.unit !== declared.unit))
        missing.push(`episode:${episode.id}:context_evidence:${requirement.signalId}`);
    }
    return capture;
  };
  // Stable policy: compare the most recent matching baseline, never cherry-pick
  // whichever historic measurement happens to support degradation.
  const baselineId = history.matchedEpisodeIds[history.matchedEpisodeIds.length - 1];
  const baselineEpisode = input.history.find(e => e.id === baselineId);
  const baseline = baselineEpisode ? captureFor(baselineEpisode) : undefined;
  const current = captureFor(input.current);
  if (!baseline) missing.push("progression:bound_baseline");
  if (baseline && current && baseline.window.id === current.window.id) missing.push("progression:reused_window");
  const scopedTest = (id: string): Check => {
    const tests = input.tests.filter(t => t.testId === id && t.vehicleId === input.current.vehicleId
      && t.componentInstanceId === input.current.componentInstanceId && t.visitId === input.current.visitId
      && t.knowledgeBundleHash === input.manifestContext.knowledgeBundleHash);
    const test = tests[0];
    const observedAt = utcMillis(input.current.observedAt);
    const performedAt = test ? utcMillis(test.performedAt) : null;
    if (!id || tests.length !== 1 || !test || observedAt === null || performedAt === null || performedAt < observedAt)
      return { state: "unknown", missing: [`test:${id}:current_scoped_result`] };
    return test.check;
  };
  const required = sortedUnique([...input.requiredExclusionTestIds, ...history.requiredExclusionTestIds]);
  const exclusions: Record<string, Check> = Object.create(null) as Record<string, Check>;
  for (const id of required) exclusions[id] = scopedTest(id);
  const progression: Check = missing.length || !baseline || !current
    ? { state: "unknown", missing: sortedUnique(missing) }
    : assessMeasuredProgression(baseline, current, input.measurementCondition, input.progressionRule);
  const assessment = assessDegradation({ history, progression, isolation: scopedTest(input.isolationTestId),
    requiredExclusionTestIds: required, exclusions });
  const execution = await createExecutionManifest(input.manifestContext, input, assessment);
  return { assessment, execution };
}
