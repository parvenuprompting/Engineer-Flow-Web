import { eflData } from "./data";
import type {
  DriverSymptom,
  MatchedDriverSymptom,
  SubsystemScore,
  SymptomBridgeResult,
  TechnicianSymptomScore,
  TsScoreContribution,
} from "./types";

const DES_MATCH_THRESHOLD = 0.42;
const STRICT_DES_MATCH_THRESHOLD = 0.58;
const STRICT_SUBSYSTEM_THRESHOLD = 0.52;

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeBridgeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeBridgeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function scoreDriverSymptomMatch(normalizedInput: string, inputTokens: string[], symptom: DriverSymptom): MatchedDriverSymptom | null {
  const normalizedDescription = normalizeBridgeText(symptom.description);
  const descriptionTokens = tokenize(normalizedDescription);

  if (!normalizedDescription || descriptionTokens.length === 0) {
    return null;
  }

  const inputSet = new Set(inputTokens);
  const matchedTokens = descriptionTokens.filter((token) => inputSet.has(token));
  const coverage = matchedTokens.length / descriptionTokens.length;
  const exactPhrase = normalizedInput.includes(normalizedDescription);
  const startsWithCorePhrase =
    descriptionTokens.length >= 3 && normalizedInput.includes(descriptionTokens.slice(0, 3).join(" "));
  const score = exactPhrase ? 1 : clamp(coverage * 0.92 + (startsWithCorePhrase ? 0.1 : 0));

  if (score < DES_MATCH_THRESHOLD) {
    return null;
  }

  return {
    des_id: symptom.des_id,
    subsystem_id: symptom.subsystem_id,
    score: Number(score.toFixed(4)),
    category: symptom.category,
    description: symptom.description,
    match_reason: exactPhrase
      ? "exact_phrase"
      : `token_overlap:${matchedTokens.join(",") || "partial"}`,
  };
}

function mappingLinkScore(strength: number, uniqueness: number): number {
  return ((strength * 0.7) + (uniqueness * 0.3)) / 5;
}

function buildClarificationQuestions(matches: MatchedDriverSymptom[]): string[] {
  const questions = [
    "Treedt het probleem vooral op onder belasting, bij warmte of intermitterend?",
    "Is het primaire symptoom een geluid, vertraging, krachtverlies of vibratie?",
  ];

  for (const match of matches.slice(0, 4)) {
    questions.push(`Past deze klacht beter: "${match.description}"?`);
  }

  return Array.from(new Set(questions)).slice(0, 5);
}

function buildBridgeStatus(
  matchedDriverSymptoms: MatchedDriverSymptom[],
  subsystemScores: SubsystemScore[]
): Pick<
  SymptomBridgeResult,
  "status" | "accepted_des_ids" | "clarification_prompt" | "clarification_options" | "clarification_questions" | "knowledge_gap_reason"
> {
  if (matchedDriverSymptoms.length === 0) {
    return {
      status: "knowledge_gap",
      accepted_des_ids: [],
      knowledge_gap_reason: "no_des_match_above_threshold",
    };
  }

  const topDes = matchedDriverSymptoms[0];
  const secondDes = matchedDriverSymptoms[1];
  const topSubsystem = subsystemScores[0];
  const secondSubsystem = subsystemScores[1];
  const weakTopDriverMatch = topDes.score < STRICT_DES_MATCH_THRESHOLD;
  const weakTopSubsystemMatch = (topSubsystem?.score ?? 0) < STRICT_SUBSYSTEM_THRESHOLD;
  const ambiguousDriverTie = Boolean(secondDes) && Math.abs(topDes.score - secondDes.score) <= 0.08;
  const ambiguousSubsystemTie =
    Boolean(topSubsystem && secondSubsystem) &&
    topSubsystem.score >= 0.32 &&
    secondSubsystem.score >= 0.32 &&
    Math.abs(topSubsystem.score - secondSubsystem.score) <= 0.1;
  const clarificationRequired =
    (weakTopDriverMatch && weakTopSubsystemMatch) ||
    (weakTopDriverMatch && ambiguousSubsystemTie) ||
    ambiguousDriverTie ||
    ambiguousSubsystemTie;

  if (clarificationRequired) {
    const clarificationOptions = matchedDriverSymptoms
      .slice(0, 4)
      .map((match) => match.description)
      .filter((value, index, array) => array.indexOf(value) === index);

    return {
      status: "clarification_required",
      accepted_des_ids: [],
      clarification_prompt:
        "De invoer past nog niet eenduidig op een canoniek DES-profiel. Kies de best passende klacht of voeg meer context toe.",
      clarification_options: clarificationOptions,
      clarification_questions: buildClarificationQuestions(matchedDriverSymptoms),
    };
  }

  return {
    status: "matched",
    accepted_des_ids: matchedDriverSymptoms.map((match) => match.des_id),
  };
}

export function runSymptomBridge(input: string): SymptomBridgeResult {
  const normalizedText = normalizeBridgeText(input);
  const inputTokens = tokenize(input);

  const matchedDriverSymptoms = eflData.driverSymptoms
    .map((symptom) => scoreDriverSymptomMatch(normalizedText, inputTokens, symptom))
    .filter((symptom): symptom is MatchedDriverSymptom => symptom !== null)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8);

  const technicianScores = new Map<string, TechnicianSymptomScore>();

  for (const matchedDriverSymptom of matchedDriverSymptoms) {
    const mapping = eflData.desTsMappingsByDesId.get(matchedDriverSymptom.des_id);
    if (!mapping) {
      continue;
    }

    for (const link of mapping.ts_links) {
      const technicianSymptom = eflData.technicianSymptomsById.get(link.ts_id);
      if (!technicianSymptom) {
        continue;
      }

      const mappingScore = mappingLinkScore(link.strength, link.uniqueness);
      const contribution = Number((mappingScore * matchedDriverSymptom.score).toFixed(4));
      const entry = technicianScores.get(link.ts_id) ?? {
        ts_id: technicianSymptom.ts_id,
        subsystem_id: technicianSymptom.subsystem_id,
        category: technicianSymptom.category,
        description: technicianSymptom.description,
        score: 0,
        contributions: [],
      };

      entry.score = Number(clamp(entry.score + contribution).toFixed(4));
      entry.contributions.push({
        des_id: matchedDriverSymptom.des_id,
        map_id: mapping.map_id,
        des_match_score: matchedDriverSymptom.score,
        mapping_score: Number(mappingScore.toFixed(4)),
        contribution,
      } satisfies TsScoreContribution);

      technicianScores.set(link.ts_id, entry);
    }
  }

  const technicianSymptomScores = Array.from(technicianScores.values()).sort((left, right) => right.score - left.score);

  const subsystemAccumulator = new Map<
    string,
    {
      subsystem_name: string;
      total: number;
      matched_des_ids: Set<string>;
      top_ts_ids: string[];
    }
  >();

  for (const matchedDriverSymptom of matchedDriverSymptoms) {
    const subsystem = eflData.symptomSubsystemsById.get(matchedDriverSymptom.subsystem_id);
    const current = subsystemAccumulator.get(matchedDriverSymptom.subsystem_id) ?? {
      subsystem_name: subsystem?.name ?? matchedDriverSymptom.subsystem_id,
      total: 0,
      matched_des_ids: new Set<string>(),
      top_ts_ids: [],
    };

    current.total += matchedDriverSymptom.score * 0.45;
    current.matched_des_ids.add(matchedDriverSymptom.des_id);
    subsystemAccumulator.set(matchedDriverSymptom.subsystem_id, current);
  }

  for (const technicianSymptomScore of technicianSymptomScores) {
    const current = subsystemAccumulator.get(technicianSymptomScore.subsystem_id) ?? {
      subsystem_name: eflData.symptomSubsystemsById.get(technicianSymptomScore.subsystem_id)?.name ?? technicianSymptomScore.subsystem_id,
      total: 0,
      matched_des_ids: new Set<string>(),
      top_ts_ids: [],
    };

    current.total += technicianSymptomScore.score * 0.55;
    if (current.top_ts_ids.length < 5) {
      current.top_ts_ids.push(technicianSymptomScore.ts_id);
    }
    subsystemAccumulator.set(technicianSymptomScore.subsystem_id, current);
  }

  const subsystemScores = Array.from(subsystemAccumulator.entries())
    .map(([subsystemId, value]) => ({
      subsystem_id: subsystemId,
      subsystem_name: value.subsystem_name,
      score: Number(clamp(value.total).toFixed(4)),
      matched_des_ids: Array.from(value.matched_des_ids),
      top_ts_ids: value.top_ts_ids,
    } satisfies SubsystemScore))
    .sort((left, right) => right.score - left.score);

  return {
    normalized_text: normalizedText,
    matched_driver_symptoms: matchedDriverSymptoms,
    technician_symptom_scores: technicianSymptomScores,
    subsystem_scores: subsystemScores,
    ...buildBridgeStatus(matchedDriverSymptoms, subsystemScores),
  };
}
