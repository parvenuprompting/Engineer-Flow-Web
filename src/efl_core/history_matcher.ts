import type { Check, DegradationAssessment, Intervention, SymptomEpisode } from "./history_types";
import { sortedUnique, utcMillis } from "./history_types";

export interface HistoryPolicy {
  readonly id: string;
  readonly sameComponentInstance: boolean;
  readonly distinctVisitsRequired: boolean;
  readonly minimumEpisodes: number;
  readonly requiredSymptomIds: readonly string[];
  readonly modeId: string;
  readonly context: readonly {
    readonly signalId: string;
    readonly unit: string;
    readonly absoluteTolerance: number;
  }[];
  /** Always required after replacement; no arbitrary "recent" time cutoff. */
  readonly replacementExclusionTestIds: readonly string[];
}

export interface HistoryMatch {
  readonly check: Check;
  readonly matchedEpisodeIds: readonly string[];
  readonly replacementIds: readonly string[];
  readonly requiredExclusionTestIds: readonly string[];
}

function validPolicy(p: HistoryPolicy): boolean {
  return p.id.length > 0 && Number.isSafeInteger(p.minimumEpisodes) && p.minimumEpisodes >= 2
    && p.requiredSymptomIds.length > 0 && p.requiredSymptomIds.every(Boolean)
    && p.modeId.length > 0 && p.context.length > 0
    && new Set(p.context.map(c => c.signalId)).size === p.context.length
    && p.context.every(c => c.signalId && c.unit && Number.isFinite(c.absoluteTolerance)
      && c.absoluteTolerance >= 0)
    && p.replacementExclusionTestIds.length > 0
    && p.replacementExclusionTestIds.every(Boolean);
}

export function matchHistory(
  current: SymptomEpisode,
  history: readonly SymptomEpisode[],
  interventions: readonly Intervention[],
  policy: HistoryPolicy,
): HistoryMatch {
  const missing: string[] = [];
  const replacementIds: string[] = [];
  const required: string[] = [];
  const matched: SymptomEpisode[] = [];
  const now = utcMillis(current.observedAt);
  if (!validPolicy(policy)) missing.push("history_policy:invalid");
  if (now === null) missing.push("current:observedAt");
  if (!current.vehicleId || !current.visitId || !current.id || !current.configurationHash)
    missing.push("current:identity");
  if (!current.componentInstanceId) missing.push("current:componentInstanceId");
  if (!current.evidenceRefs.length) missing.push("current:evidence");

  // Record install boundary before matching. Old-instance observations never cross it.
  let installedAt: number | null = null;
  for (const intervention of interventions) {
    if (intervention.vehicleId !== current.vehicleId || intervention.action !== "replace") continue;
    if (intervention.componentInstanceId !== current.componentInstanceId
      && intervention.replacementInstanceId !== current.componentInstanceId) continue;
    const time = utcMillis(intervention.performedAt);
    if (time === null) { missing.push(`intervention:${intervention.id}:performedAt`); continue; }
    if (now === null || time > now) continue;
    if (!intervention.replacementInstanceId
      || intervention.replacementInstanceId === intervention.componentInstanceId) {
      missing.push(`intervention:${intervention.id}:replacementInstanceId`);
    }
    if (intervention.componentInstanceId === current.componentInstanceId) {
      missing.push("current:component_already_removed");
    }
    if (intervention.replacementInstanceId === current.componentInstanceId) {
      replacementIds.push(intervention.id);
      required.push(...policy.replacementExclusionTestIds);
      if (installedAt !== null) missing.push("current:ambiguous_installation_history");
      installedAt = time;
    }
  }

  const contextCheck = (episode: SymptomEpisode): boolean => {
    let comparable = episode.operatingContext.modeId === policy.modeId;
    for (const requirement of policy.context) {
      const a = current.operatingContext.measurements.filter(m => m.signalId === requirement.signalId);
      const b = episode.operatingContext.measurements.filter(m => m.signalId === requirement.signalId);
      const left = a[0]; const right = b[0];
      if (a.length !== 1 || b.length !== 1 || !left || !right
        || left.unit !== requirement.unit || right.unit !== requirement.unit
        || !Number.isFinite(left.value) || !Number.isFinite(right.value)
        || !left.evidenceRefs.length || !right.evidenceRefs.length) {
        missing.push(`context:${episode.id}:${requirement.signalId}`);
        comparable = false;
      } else if (Math.abs(left.value - right.value) > requirement.absoluteTolerance) {
        comparable = false;
      }
    }
    return comparable;
  };

  const currentComparable = contextCheck(current);
  const hasSymptoms = (e: SymptomEpisode) => policy.requiredSymptomIds.every(id => e.symptomIds.includes(id));
  const seen = new Set<string>([current.id]);
  for (const episode of history) {
    if (episode.vehicleId !== current.vehicleId) continue;
    if (seen.has(episode.id)) { missing.push(`episode:${episode.id}:duplicate`); continue; }
    seen.add(episode.id);
    if (episode.configurationHash !== current.configurationHash || !hasSymptoms(episode)) continue;
    if (policy.sameComponentInstance || installedAt !== null) {
      if (!episode.componentInstanceId) { missing.push(`episode:${episode.id}:componentInstanceId`); continue; }
      if (episode.componentInstanceId !== current.componentInstanceId) continue;
    }
    const time = utcMillis(episode.observedAt);
    if (time === null) { missing.push(`episode:${episode.id}:observedAt`); continue; }
    if (now === null || time >= now || (installedAt !== null && time < installedAt)) continue;
    if (!episode.visitId || !episode.evidenceRefs.length) {
      missing.push(`episode:${episode.id}:identity_or_evidence`); continue;
    }
    if (policy.distinctVisitsRequired && episode.visitId === current.visitId) continue;
    if (contextCheck(episode)) matched.push(episode);
  }
  matched.sort((a, b) => a.observedAt < b.observedAt ? -1 : a.observedAt > b.observedAt ? 1
    : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const count = policy.distinctVisitsRequired
    ? new Set([current.visitId, ...matched.map(e => e.visitId)]).size : matched.length + 1;
  if (count < policy.minimumEpisodes) missing.push("history:comparable_baseline");
  const evidenceRefs = sortedUnique([current, ...matched].flatMap(e => [
    ...e.evidenceRefs, ...e.operatingContext.measurements.flatMap(m => m.evidenceRefs),
  ]));
  const check: Check = missing.length ? { state: "unknown", missing: sortedUnique(missing) }
    : !currentComparable || !hasSymptoms(current) ? { state: "fail", evidenceRefs }
    : { state: "pass", evidenceRefs };
  return { check, matchedEpisodeIds: matched.map(e => e.id),
    replacementIds: sortedUnique(replacementIds), requiredExclusionTestIds: sortedUnique(required) };
}

export interface DegradationInput {
  readonly history: HistoryMatch;
  readonly progression: Check;
  readonly isolation: Check;
  readonly requiredExclusionTestIds: readonly string[];
  /** A pass means the external cause was excluded by the named test. */
  readonly exclusions: Readonly<Record<string, Check>>;
}

export function assessDegradation(input: DegradationInput): DegradationAssessment {
  const required = sortedUnique([
    ...input.requiredExclusionTestIds, ...input.history.requiredExclusionTestIds,
  ]);
  const checks: Check[] = [input.history.check, input.progression, input.isolation];
  for (const id of required) {
    checks.push(Object.hasOwn(input.exclusions, id)
      ? input.exclusions[id] ?? { state: "unknown", missing: [`test:${id}`] }
      : { state: "unknown", missing: [`test:${id}`] });
  }
  const missing = sortedUnique(checks.flatMap((check, index) =>
    check.state === "unknown" ? check.missing.length ? check.missing : [`check:${index}:unknown`]
      : check.evidenceRefs.length ? [] : [`check:${index}:evidence`]));
  if (missing.length) return { status: "knowledge_gap", missing };
  const evidenceRefs = sortedUnique(checks.flatMap(c => c.state === "unknown" ? [] : c.evidenceRefs));
  return { status: checks.some(c => c.state === "fail") ? "rule_not_satisfied" : "rule_satisfied", evidenceRefs };
}
