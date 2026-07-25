import type { DiagnosisStep, FailureModeResponse, LocationGuess, RootCauseCandidate } from "@/lib/api/types";
import { eflData } from "./data";
import { assertEflCoreReady } from "./health";
import { normalizeBridgeText, runSymptomBridge } from "./symptom_bridge";
import type {
  AuditLogEntry,
  CanonicalFailureMode,
  ConstraintTrace,
  ConstraintTraceEntry,
  DataQualityScore,
  DeterministicDiagnoseInput,
  DeterministicDiagnoseResponse,
  DiagnosisContext,
  DdsCase,
  SubsystemScore,
  SymptomBridgeResult,
  TechnicianSymptomScore,
} from "./types";
import { CONFIG_VERSION, ENGINE_VERSION, VERSION_MANIFEST, createStableHash } from "./version";

const DEFAULT_CONTEXT: DiagnosisContext = {
  motor_on: true,
  pto_on: false,
  rain: false,
  frost: false,
  heavy_load: false,
};

const GENERIC_COMPONENT_INSPECTIONS: Record<string, string[]> = {
  hydraulic_pump: [
    "Meet hydraulische druk op de pomp-uitgang.",
    "Luister naar cavitatie of zuiggeluid bij de pomp.",
  ],
  hydraulic_motor: [
    "Controleer of de hydromotor koppel verliest onder belasting.",
    "Meet drukval over de hydromotor tijdens rotatie.",
  ],
  hydraulic_relief_valve: [
    "Controleer het overdrukventiel op vastlopen of vervuiling.",
    "Verifieer of het ventiel niet te vroeg opent onder belasting.",
  ],
  connector_block: [
    "Inspecteer het connectorblok op vocht, corrosie en losse pinnen.",
    "Voer een wiggle-test uit op de kabelboom en observeer functiedrops.",
  ],
  main_fuse_mixer: [
    "Meet voeding aan beide zijden van de hoofdzekering.",
    "Inspecteer de zekeringhouder op warmte- of brandschade.",
  ],
  ground_main: [
    "Meet spanningsval over het hoofdmassapunt onder belasting.",
    "Reinig het massapunt en controleer de bevestiging.",
  ],
  drum_main_bearing: [
    "Controleer het hoofdlager op speling, hitte en onregelmatig geluid.",
    "Observeer vibratiepatronen tijdens langzame rotatie.",
  ],
  drum_support_rollers: [
    "Inspecteer draagrollen op vlakke plekken, vastlopen of uitlijning.",
    "Controleer of een rol lokaal warm wordt tijdens bedrijf.",
  ],
};

const SUBSYSTEM_COMPONENTS: Record<string, string[]> = {
  ss_hydromotor: ["hydraulic_motor", "drum_shell", "drum_speed_sensor", "hydraulic_pressure_line"],
  ss_hydraulic_pump: [
    "hydraulic_pump",
    "hydraulic_reservoir",
    "hydraulic_suction_line",
    "hydraulic_pressure_line",
    "hydraulic_return_filter",
    "hydraulic_relief_valve",
    "hydraulic_flow_control_valve",
  ],
  ss_valve_control: [
    "solenoid_valve_fwd",
    "solenoid_valve_rev",
    "hydraulic_flow_control_valve",
    "hydraulic_relief_valve",
    "connector_block",
    "harness_valves",
  ],
  ss_drum_mechanics: [
    "drum_shell",
    "drum_gear_ring",
    "drum_support_rollers",
    "drum_thrust_roller",
    "drum_main_bearing",
    "subframe_mixer",
    "mounting_brackets",
    "crossmembers",
  ],
  ss_filters_restrictions: [
    "hydraulic_return_filter",
    "hydraulic_suction_line",
    "hydraulic_pressure_line",
    "hydraulic_return_line",
    "hydraulic_reservoir",
  ],
  ss_thermal_chain: [
    "hydraulic_cooler",
    "hydraulic_cooler_fan",
    "hydraulic_temp_sensor",
    "hydraulic_reservoir",
    "engine_radiator",
    "engine_cooling_fan",
    "engine_coolant_temp_sensor",
  ],
  ss_mix_blade_mass: ["drum_internal_blades", "drum_shell", "hydraulic_motor"],
  ss_electrical_control: [
    "e_box_main",
    "main_fuse_mixer",
    "relay_block",
    "connector_block",
    "harness_main",
    "harness_valves",
    "ground_main",
    "handunit_main",
    "remote_receiver",
    "remote_transmitter",
    "pto_relay",
  ],
};

type ClusterScore = {
  cluster_id: string;
  cluster_key: string;
  score: number;
  exact_matches: number;
  matched_keywords: string[];
};

type DerivedSignals = {
  measurements: Set<string>;
  conditions: Set<string>;
  observations: Set<string>;
  environments: Set<string>;
  events: Set<string>;
  symptoms: Set<string>;
};

type ScoredFailureMode = {
  failureMode: CanonicalFailureMode;
  score: number;
  reasons: string[];
};

function clamp(value: number, min = 0, max = 1): number {
  return Math.min(max, Math.max(min, value));
}

function buildEmptyConstraintTrace(): ConstraintTrace {
  return {
    canonical_constraints: [],
    electrical_constraints: [],
    hydraulic_constraints: [],
    variant_constraints: [],
    logic_rules: [],
  };
}

function normalizeText(value: string): string {
  return normalizeBridgeText(value);
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function overlapRatio(sourceTokens: string[], targetTokens: string[]): number {
  if (sourceTokens.length === 0 || targetTokens.length === 0) {
    return 0;
  }

  const sourceSet = new Set(sourceTokens);
  let matches = 0;

  for (const token of targetTokens) {
    if (sourceSet.has(token)) {
      matches += 1;
    }
  }

  return matches / targetTokens.length;
}

function scorePhrases(normalizedText: string, textTokens: string[], phrases: string[]): { raw: number; exact: number; matches: string[] } {
  let raw = 0;
  let exact = 0;
  const matches: string[] = [];

  for (const phrase of phrases) {
    const normalizedPhrase = normalizeText(phrase);
    if (!normalizedPhrase) {
      continue;
    }

    const phraseTokens = tokenize(normalizedPhrase);
    if (normalizedText.includes(normalizedPhrase)) {
      exact += 1;
      matches.push(phrase);
      raw += normalizedPhrase.includes(" ") ? 1.1 : 0.7;
      continue;
    }

    const overlap = overlapRatio(textTokens, phraseTokens);
    if (overlap > 0.5) {
      matches.push(phrase);
    }
    raw += overlap * (normalizedPhrase.includes(" ") ? 0.6 : 0.35);
  }

  return { raw, exact, matches };
}

function inferSubdomain(tags: string[]): string {
  if (tags.some((tag) => tag.includes("electrical") || tag.includes("controls"))) return "electrical";
  if (tags.some((tag) => tag.includes("rotation"))) return "rotation";
  if (tags.some((tag) => tag.includes("engine"))) return "engine";
  if (tags.some((tag) => tag.includes("safety"))) return "safety";
  if (tags.some((tag) => tag.includes("water"))) return "water";
  if (tags.some((tag) => tag.includes("structure"))) return "structure";
  return "hydraulics";
}

function inferSubdomainFromSubsystem(subsystemId: string | undefined): string | undefined {
  switch (subsystemId) {
    case "ss_electrical_control":
      return "electrical";
    case "ss_drum_mechanics":
    case "ss_mix_blade_mass":
      return "rotation";
    case "ss_thermal_chain":
    case "ss_filters_restrictions":
    case "ss_hydraulic_pump":
    case "ss_hydromotor":
    case "ss_valve_control":
      return "hydraulics";
    default:
      return undefined;
  }
}

function inferSubsystemFromComponentId(componentId: string | undefined): string | undefined {
  if (!componentId) {
    return undefined;
  }

  for (const [subsystemId, componentIds] of Object.entries(SUBSYSTEM_COMPONENTS)) {
    if (componentIds.includes(componentId)) {
      return subsystemId;
    }
  }

  return undefined;
}

function componentSubsystemSupport(componentId: string, subsystemScores: SubsystemScore[]): number {
  let bestScore = 0;

  for (const subsystemScore of subsystemScores) {
    const supportedComponents = SUBSYSTEM_COMPONENTS[subsystemScore.subsystem_id] ?? [];
    if (supportedComponents.includes(componentId)) {
      bestScore = Math.max(bestScore, subsystemScore.score);
    }
  }

  return bestScore;
}

function clusterSubsystemSupport(clusterId: string, subsystemScores: SubsystemScore[]): number {
  const cluster = eflData.clustersById.get(clusterId);
  if (!cluster) {
    return 0;
  }

  let bestScore = 0;

  for (const subsystemScore of subsystemScores) {
    const supportedComponents = SUBSYSTEM_COMPONENTS[subsystemScore.subsystem_id] ?? [];
    const relatedComponentOverlap =
      cluster.related_component_ids.filter((componentId) => supportedComponents.includes(componentId)).length /
      Math.max(cluster.related_component_ids.length, 1);

    let tagBoost = 0;

    if (subsystemScore.subsystem_id === "ss_electrical_control" && cluster.tags.some((tag) => tag.includes("electrical") || tag.includes("controls"))) {
      tagBoost = 0.45;
    } else if (subsystemScore.subsystem_id === "ss_thermal_chain" && cluster.tags.some((tag) => tag.includes("cooling"))) {
      tagBoost = 0.45;
    } else if (subsystemScore.subsystem_id === "ss_filters_restrictions" && cluster.tags.some((tag) => tag.includes("filtration") || tag.includes("hydraulics"))) {
      tagBoost = 0.25;
    } else if (
      ["ss_hydromotor", "ss_hydraulic_pump", "ss_valve_control", "ss_drum_mechanics", "ss_mix_blade_mass"].includes(subsystemScore.subsystem_id) &&
      cluster.tags.some((tag) => tag.includes("rotation") || tag.includes("hydraulics"))
    ) {
      tagBoost = 0.18;
    }

    const subsystemSupport = clamp((relatedComponentOverlap * 0.75 + tagBoost) * subsystemScore.score);
    bestScore = Math.max(bestScore, subsystemSupport);
  }

  return bestScore;
}

function componentTypeContains(componentId: string, ...keywords: string[]): boolean {
  const component = eflData.componentsById.get(componentId);
  if (!component) {
    return false;
  }

  const haystack = `${component.type} ${component.subsystem}`.toLowerCase();
  return keywords.some((keyword) => haystack.includes(keyword));
}

function componentCategoryAffinity(componentId: string, category: string): number {
  switch (category) {
    case "electrical":
    case "connection":
    case "signal":
    case "voltage":
      if (componentTypeContains(componentId, "relay", "fuse", "connector", "wiring", "ground", "control", "sensor", "switch", "receiver", "transmitter")) {
        return 1;
      }
      if (componentTypeContains(componentId, "solenoid", "valve")) {
        return 0.7;
      }
      return 0.2;
    case "pressure":
    case "flow":
      if (componentTypeContains(componentId, "pump", "valve", "hose", "filter", "pressure", "motor")) {
        return 1;
      }
      if (componentTypeContains(componentId, "sensor", "cooler")) {
        return 0.55;
      }
      return 0.2;
    case "temperature":
      if (componentTypeContains(componentId, "cooler", "fan", "temperature", "pump", "motor", "bearing", "filter")) {
        return 1;
      }
      if (componentTypeContains(componentId, "hose", "tank", "valve")) {
        return 0.65;
      }
      return 0.2;
    case "vibration":
      if (componentTypeContains(componentId, "bearing", "roller", "drum", "gear", "fan", "pump", "motor", "bracket", "frame", "crossmember")) {
        return 1;
      }
      return 0.25;
    case "sound":
      if (componentTypeContains(componentId, "pump", "motor", "bearing", "roller", "gear", "fan", "valve")) {
        return 0.95;
      }
      return 0.2;
    case "visual":
      if (componentTypeContains(componentId, "hose", "filter", "connector", "cooler", "bearing", "pump", "motor", "valve")) {
        return 0.8;
      }
      return 0.15;
    case "load":
      if (componentTypeContains(componentId, "pump", "motor", "bearing", "roller", "drum", "gear", "valve", "blade")) {
        return 1;
      }
      return 0.25;
    case "progression":
    case "intermittent":
      if (componentTypeContains(componentId, "connector", "wiring", "relay", "ground", "sensor", "control", "pump", "filter", "cooler")) {
        return 0.85;
      }
      return 0.25;
    case "interaction":
    case "behavior":
      if (componentTypeContains(componentId, "pump", "motor", "valve", "roller", "bearing", "drum", "sensor", "control")) {
        return 0.75;
      }
      return 0.25;
    default:
      return 0.2;
  }
}

function componentTechnicianSupport(componentId: string, technicianSymptomScores: TechnicianSymptomScore[]): number {
  const relevantScores = technicianSymptomScores.filter((score) => {
    const subsystemComponents = SUBSYSTEM_COMPONENTS[score.subsystem_id] ?? [];
    return subsystemComponents.includes(componentId);
  });

  if (relevantScores.length === 0) {
    return 0;
  }

  const support = relevantScores.reduce((acc, score) => {
    return acc + score.score * componentCategoryAffinity(componentId, score.category);
  }, 0);

  return clamp(support / Math.max(relevantScores.length, 1));
}

function technicianDescriptionSupport(failureMode: CanonicalFailureMode, technicianSymptomScores: TechnicianSymptomScore[]): number {
  const failureModeTokens = tokenize(failureMode.description);
  let best = 0;

  for (const technicianSymptomScore of technicianSymptomScores) {
    const similarity = overlapRatio(failureModeTokens, tokenize(technicianSymptomScore.description));
    best = Math.max(best, similarity * technicianSymptomScore.score);
  }

  return clamp(best);
}

function componentRelationSupport(componentId: string, referenceComponents: Set<string>): number {
  let best = 0;

  for (const relation of eflData.componentRelations) {
    if (relation.from !== componentId && relation.to !== componentId) {
      continue;
    }

    const peerComponent = relation.from === componentId ? relation.to : relation.from;
    if (!referenceComponents.has(peerComponent)) {
      continue;
    }

    if (relation.type === "electrical_feed" || relation.type === "hydraulic_flow") {
      best = Math.max(best, 0.85);
    } else if (relation.type === "signal_path" || relation.type === "ground_path") {
      best = Math.max(best, 0.75);
    } else {
      best = Math.max(best, 0.6);
    }
  }

  return best;
}

function technicianEvidenceAtLeast(
  technicianSymptomScores: TechnicianSymptomScore[],
  tsIds: string[],
  minimumScore: number
): boolean {
  return technicianSymptomScores.some(
    (score) => tsIds.includes(score.ts_id) && score.score >= minimumScore
  );
}

function buildDerivedSignals(
  normalizedText: string,
  context: DiagnosisContext,
  technicianSymptomScores: TechnicianSymptomScore[],
  subsystemScores: SubsystemScore[]
): DerivedSignals {
  const has = (...phrases: string[]) => phrases.some((phrase) => normalizedText.includes(normalizeText(phrase)));

  const measurements = new Set<string>();
  const conditions = new Set<string>();
  const observations = new Set<string>();
  const environments = new Set<string>();
  const events = new Set<string>();
  const symptoms = new Set<string>();

  const topSubsystemId = subsystemScores[0]?.subsystem_id;
  const strongElectricalEvidence =
    topSubsystemId === "ss_electrical_control" &&
    technicianSymptomScores.some((score) => score.score >= 0.55);
  const strongHydraulicWeaknessEvidence =
    technicianEvidenceAtLeast(
      technicianSymptomScores,
      ["ts_hm_006", "ts_hm_020", "ts_hp_006", "ts_hp_007", "ts_hp_008", "ts_fr_015", "ts_fr_020", "ts_fr_021"],
      0.45
    );
  const strongOneDirectionEvidence = technicianEvidenceAtLeast(
    technicianSymptomScores,
    ["ts_vc_037", "ts_vc_043", "ts_ec_039"],
    0.5
  );
  const strongLoadCollapseEvidence = technicianEvidenceAtLeast(
    technicianSymptomScores,
    ["ts_hm_020", "ts_hp_007", "ts_fr_020", "ts_dm_036", "ts_mb_036", "ts_vc_039"],
    0.45
  );

  if (!context.pto_on) conditions.add("pto_status_off");
  if (context.rain || has("regen", "nat", "water", "vochtig")) environments.add("rain");
  if (context.frost || has("vorst", "bevroren", "koud")) environments.add("freezing");
  if (has("geen voeding", "geen leds", "volledig dood", "niets werkt elektrisch", "heeft geen voeding")) {
    measurements.add("no_24v_at_main_fuse");
  }
  if (
    strongElectricalEvidence &&
    technicianEvidenceAtLeast(technicianSymptomScores, ["ts_ec_002", "ts_ec_015", "ts_ec_037", "ts_ec_040"], 0.55)
  ) {
    measurements.add("no_24v_at_main_fuse");
  }
  if (has("geen druk", "0 bar", "nul druk", "geen hydraulische druk")) {
    measurements.add("hydraulic_pressure_zero");
  }
  if (has("heet", "oververhit", "warme olie", "verbrand", "brandt")) {
    measurements.add("hydraulic_oil_temp_high");
  }
  if (has("jank", "gierend", "zuigend", "lucht pakt", "knikkerbak", "cavitatie", "gorgelend")) {
    observations.add("cavitation_noise_at_pump");
  }
  if (
    technicianEvidenceAtLeast(
      technicianSymptomScores,
      ["ts_hp_001", "ts_hp_002", "ts_fr_001", "ts_fr_003", "ts_fr_004"],
      0.45
    )
  ) {
    observations.add("cavitation_noise_at_pump");
  }
  if (has("schurend", "metaal", "bonk", "tik", "kloppend")) {
    observations.add("metallic_noise_inside_drum");
  }
  if (has("vonk", "vonken", "sparking", "kortsluiting")) {
    observations.add("sparking");
  }
  if (has("noodstop", "veiligheidsblokkering", "interlock", "goot", "trechter")) {
    conditions.add("safety_circuit_open");
  }
  if ((context.heavy_load || has("onder belasting", "volle trommel", "zware last")) && has("draait niet", "komt niet op gang", "bijna stil")) {
    conditions.add("drum_cannot_move_with_high_pressure");
  }
  if (has("klapband")) events.add("recent_tire_blowout");
  if (has("hobbels", "intermitterend", "soms valt", "trilt")) {
    measurements.add("ground_voltage_drop_high");
  }
  if (
    strongElectricalEvidence &&
    technicianEvidenceAtLeast(technicianSymptomScores, ["ts_ec_018", "ts_ec_022", "ts_ec_027", "ts_ec_028"], 0.45)
  ) {
    measurements.add("ground_voltage_drop_high");
    measurements.add("bad_ground_g45");
  }

  if (has("een richting", "alleen vooruit", "alleen achteruit")) {
    symptoms.add("DRUM_ONLY_ONE_DIRECTION");
  }
  if (strongOneDirectionEvidence && has("richting", "vooruit", "achteruit")) {
    symptoms.add("DRUM_ONLY_ONE_DIRECTION");
  }

  if ((context.heavy_load || has("onder belasting", "volle trommel", "zware load", "zware last")) && (has("stopt", "valt stil", "zakt in") || strongLoadCollapseEvidence)) {
    symptoms.add("DRUM_STOPS_UNDER_LOAD");
  }

  if (has("zwak", "traag", "langzaam", "komt moeilijk op gang", "krachtverlies") || strongHydraulicWeaknessEvidence) {
    symptoms.add("DRUM_SLOW_OR_WEAK");
  }

  return { measurements, conditions, observations, environments, events, symptoms };
}

function scoreClusters(symptomText: string, subsystemScores: SubsystemScore[]): ClusterScore[] {
  const normalizedText = normalizeText(symptomText);
  const textTokens = tokenize(symptomText);

  const clusterScores = eflData.symptomClusters.map<ClusterScore>((cluster) => {
    const keywordPhrases = eflData.clusterKeywords.get(cluster.key) ?? [];
    const keywordScore = scorePhrases(normalizedText, textTokens, keywordPhrases);
    const nameScore = scorePhrases(normalizedText, textTokens, [cluster.name]);
    const descriptionScore = scorePhrases(normalizedText, textTokens, [cluster.description]);
    const bridgeSupport = clusterSubsystemSupport(cluster.id, subsystemScores);
    const lexicalScore = clamp((keywordScore.raw + nameScore.raw * 0.8 + descriptionScore.raw * 0.4) / 4.5);
    const score = clamp(lexicalScore * 0.55 + bridgeSupport * 0.45);
    const matchedKeywords = Array.from(new Set([...keywordScore.matches, ...nameScore.matches, ...descriptionScore.matches]));

    return {
      cluster_id: cluster.id,
      cluster_key: cluster.key,
      score,
      exact_matches: keywordScore.exact + nameScore.exact + descriptionScore.exact,
      matched_keywords: matchedKeywords,
    };
  });

  return clusterScores.sort((left, right) => right.score - left.score);
}

function deriveSelectedClusters(clusterScores: ClusterScore[]): ClusterScore[] {
  if (clusterScores.length === 0) return [];
  const topScore = clusterScores[0].score;
  const threshold = topScore >= 0.2 ? topScore * 0.65 : 0.08;
  return clusterScores.filter((cluster) => cluster.score >= threshold).slice(0, 3);
}

function buildFailureModeCandidates(
  symptomText: string,
  selectedClusters: ClusterScore[],
  derivedSignals: DerivedSignals,
  context: DiagnosisContext,
  subsystemScores: SubsystemScore[],
  technicianSymptomScores: TechnicianSymptomScore[]
): {
  ranked: ScoredFailureMode[];
  appliedConstraints: string[];
  constraintHits: ConstraintTraceEntry[];
  constraintTrace: ConstraintTrace;
} {
  const normalizedText = normalizeText(symptomText);
  const textTokens = tokenize(symptomText);
  const relatedComponents = new Set<string>();

  for (const selectedCluster of selectedClusters) {
    const cluster = eflData.clustersById.get(selectedCluster.cluster_id);
    if (!cluster) continue;
    for (const componentId of cluster.related_component_ids) {
      relatedComponents.add(componentId);
    }
  }

  const subsystemComponents = new Set<string>();
  for (const subsystemScore of subsystemScores.slice(0, 3)) {
    for (const componentId of SUBSYSTEM_COMPONENTS[subsystemScore.subsystem_id] ?? []) {
      subsystemComponents.add(componentId);
    }
  }

  const referenceComponents = new Set<string>([...relatedComponents, ...subsystemComponents]);

  const candidatePool = relatedComponents.size > 0
    ? eflData.failureModes.filter(
        (failureMode) => relatedComponents.has(failureMode.component_id) || subsystemComponents.has(failureMode.component_id)
      )
    : subsystemComponents.size > 0
      ? eflData.failureModes.filter((failureMode) => subsystemComponents.has(failureMode.component_id))
      : eflData.failureModes;

  const clusterSupportByComponent = new Map<string, number>();
  for (const selectedCluster of selectedClusters) {
    const cluster = eflData.clustersById.get(selectedCluster.cluster_id);
    if (!cluster) continue;
    for (const componentId of cluster.related_component_ids) {
      const current = clusterSupportByComponent.get(componentId) ?? 0;
      clusterSupportByComponent.set(componentId, Math.max(current, selectedCluster.score));
    }
  }

  const scored = new Map<string, ScoredFailureMode>();
  for (const failureMode of candidatePool) {
    const descriptionSimilarity = overlapRatio(textTokens, tokenize(failureMode.description));
    const componentSupport = clusterSupportByComponent.get(failureMode.component_id) ?? 0.12;
    const subsystemSupport = componentSubsystemSupport(failureMode.component_id, subsystemScores);
    const technicianSupport = componentTechnicianSupport(failureMode.component_id, technicianSymptomScores);
    const technicianDescriptionScore = technicianDescriptionSupport(failureMode, technicianSymptomScores);
    const relationSupport = componentRelationSupport(failureMode.component_id, referenceComponents);
    const componentDiagnosticValue = eflData.componentDiagnosticValues.get(failureMode.component_id) ?? 0.45;
    const clusterRankBonus = selectedClusters.reduce((acc, selectedCluster) => {
      const componentRanking = eflData.clusterToComponentMap.get(selectedCluster.cluster_key)?.components_ranked ?? [];
      const rankingIndex = componentRanking.indexOf(failureMode.component_id);
      if (rankingIndex === -1) return acc;
      return acc + clamp(((componentRanking.length - rankingIndex) / Math.max(componentRanking.length, 1)) * 0.08);
    }, 0);

    let score =
      technicianSupport * 0.3 +
      technicianDescriptionScore * 0.18 +
      subsystemSupport * 0.17 +
      componentSupport * 0.12 +
      relationSupport * 0.08 +
      descriptionSimilarity * 0.08 +
      componentDiagnosticValue * 0.04 +
      (failureMode.likelihood / 5) * 0.02 +
      (failureMode.severity / 5) * 0.01 +
      clusterRankBonus;

    const reasons = [
      `technician_support=${technicianSupport.toFixed(2)}`,
      `technician_description=${technicianDescriptionScore.toFixed(2)}`,
      `cluster_support=${componentSupport.toFixed(2)}`,
      `subsystem_support=${subsystemSupport.toFixed(2)}`,
      `relation_support=${relationSupport.toFixed(2)}`,
      `description_similarity=${descriptionSimilarity.toFixed(2)}`,
      `component_value=${componentDiagnosticValue.toFixed(2)}`,
      `likelihood=${(failureMode.likelihood / 5).toFixed(2)}`,
      `severity=${(failureMode.severity / 5).toFixed(2)}`,
    ];

    if (context.heavy_load && ["hydraulic_pump", "hydraulic_motor", "drum_main_bearing", "drum_support_rollers", "hydraulic_relief_valve"].includes(failureMode.component_id)) {
      score += 0.06;
      reasons.push("heavy_load_context");
    }

    if ((normalizedText.includes("warm") || normalizedText.includes("heet")) && ["fm_hydraulic_oil_overheated", "fm_hydraulic_cooler_blocked", "fm_hydraulic_cooler_fan_not_working", "fm_hydraulic_pump_worn"].includes(failureMode.id)) {
      score += 0.08;
      reasons.push("thermal_signal");
    }

    if ((normalizedText.includes("soms") || normalizedText.includes("intermitterend") || normalizedText.includes("hobbels")) && ["fm_connector_block_corroded", "fm_harness_main_broken_wire", "fm_ground_main_corroded", "fm_relay_block_contact_worn"].includes(failureMode.id)) {
      score += 0.08;
      reasons.push("intermittent_signal");
    }

    if ((normalizedText.includes("trill") || normalizedText.includes("vibr")) && ["fm_drum_main_bearing_worn", "fm_drum_support_roller_seized", "fm_mounting_bolts_loose", "fm_subframe_cracked"].includes(failureMode.id)) {
      score += 0.07;
      reasons.push("vibration_signal");
    }

    scored.set(failureMode.id, {
      failureMode,
      score: clamp(score),
      reasons,
    });
  }

  const appliedConstraints: string[] = [];
  const constraintHits: ConstraintTraceEntry[] = [];
  const constraintTrace = buildEmptyConstraintTrace();
  const excludedFailureModes = new Set<string>();
  const excludedComponents = new Set<string>(eflData.alwaysAbsentComponents);

  const variantExcludedComponents = Array.from(
    new Set(
      candidatePool
        .map((failureMode) => failureMode.component_id)
        .filter((componentId) => excludedComponents.has(componentId))
    )
  );

  if (variantExcludedComponents.length > 0) {
    const variantHit: ConstraintTraceEntry = {
      id: "variant_constraints_static_absent_components",
      stage: "variant_constraints",
      effect: "static_component_exclusion",
      reason: "Componenten die in variant_constraints als afwezig zijn gemarkeerd worden hard uitgesloten.",
      excluded_components: variantExcludedComponents,
    };
    constraintHits.push(variantHit);
    constraintTrace.variant_constraints.push(variantHit);
  }

  for (const constraint of eflData.canonicalConstraints) {
    const shouldApply = Object.entries(constraint.if).every(([key, value]) => {
      if (key === "measurement") return derivedSignals.measurements.has(value);
      if (key === "condition") return derivedSignals.conditions.has(value);
      if (key === "observation") return derivedSignals.observations.has(value);
      if (key === "environment") return derivedSignals.environments.has(value);
      if (key === "event") return derivedSignals.events.has(value);
      return false;
    });

    if (!shouldApply) continue;

    appliedConstraints.push(constraint.id);

    for (const failureModeId of constraint.effect.exclude_failure_modes) {
      excludedFailureModes.add(failureModeId);
    }

    for (const increase of constraint.effect.increase_probability) {
      const candidate = scored.get(increase.failure_mode_id);
      if (!candidate) continue;
      candidate.score = clamp(candidate.score + increase.delta);
      candidate.reasons.push(`constraint:${constraint.id}+${increase.delta.toFixed(2)}`);
      scored.set(increase.failure_mode_id, candidate);
    }

    const constraintHit: ConstraintTraceEntry = {
      id: constraint.id,
      stage: "canonical_constraints",
      effect: `${constraint.effect.exclude_failure_modes.length} excludes / ${constraint.effect.increase_probability.length} boosts`,
      reason: constraint.description,
      excluded_failure_modes: constraint.effect.exclude_failure_modes,
      boosted_failure_modes: constraint.effect.increase_probability.map((entry) => ({
        failure_mode_id: entry.failure_mode_id,
        delta: entry.delta,
      })),
    };
    constraintHits.push(constraintHit);
    constraintTrace.canonical_constraints.push(constraintHit);
  }

  for (const supplementalConstraint of eflData.electricalConstraints) {
    const shouldApply = Object.entries(supplementalConstraint.if).every(([key, value]) => {
      if (key === "measurement") return derivedSignals.measurements.has(value);
      if (key === "condition") return derivedSignals.conditions.has(value);
      if (key === "observation") return derivedSignals.observations.has(value);
      if (key === "symptom") {
        return (
          derivedSignals.symptoms.has(value) ||
          selectedClusters.some((cluster) => cluster.cluster_key === value || eflData.flowClusterKey(cluster.cluster_id) === value)
        );
      }
      if (key === "pressure") return value === "0_bar" && derivedSignals.measurements.has("hydraulic_pressure_zero");
      if (key === "pto_state") return value === "engaged" && context.pto_on;
      return false;
    });

    if (!shouldApply) continue;

    appliedConstraints.push(supplementalConstraint.id);

    for (const componentId of supplementalConstraint.then_exclude_components ?? []) {
      excludedComponents.add(componentId);
    }

    for (const [failureModeId, delta] of Object.entries(supplementalConstraint.then_increase_failure_modes ?? {})) {
      const candidate = scored.get(failureModeId);
      if (!candidate) continue;
      candidate.score = clamp(candidate.score + delta);
      candidate.reasons.push(`supplemental:${supplementalConstraint.id}+${delta.toFixed(2)}`);
      scored.set(failureModeId, candidate);
    }

    for (const [failureModeId, delta] of Object.entries(supplementalConstraint.then_reduce_failure_modes ?? {})) {
      const candidate = scored.get(failureModeId);
      if (!candidate) continue;
      candidate.score = clamp(candidate.score - delta);
      candidate.reasons.push(`supplemental:${supplementalConstraint.id}-${delta.toFixed(2)}`);
      scored.set(failureModeId, candidate);
    }

    for (const componentId of supplementalConstraint.then_focus_components ?? []) {
      for (const candidate of scored.values()) {
        if (candidate.failureMode.component_id === componentId) {
          candidate.score = clamp(candidate.score + 0.08);
          candidate.reasons.push(`focus_component:${supplementalConstraint.id}`);
        }
      }
    }

    const constraintHit: ConstraintTraceEntry = {
      id: supplementalConstraint.id,
      stage: "electrical_constraints",
      effect: "supplemental_adjustment",
      reason: supplementalConstraint.reason,
      excluded_components: supplementalConstraint.then_exclude_components,
      boosted_failure_modes: Object.entries(supplementalConstraint.then_increase_failure_modes ?? {}).map(
        ([failure_mode_id, delta]) => ({ failure_mode_id, delta })
      ),
      reduced_failure_modes: Object.entries(supplementalConstraint.then_reduce_failure_modes ?? {}).map(
        ([failure_mode_id, delta]) => ({ failure_mode_id, delta })
      ),
      focused_components: supplementalConstraint.then_focus_components,
    };
    constraintHits.push(constraintHit);
    constraintTrace.electrical_constraints.push(constraintHit);
  }

  for (const supplementalConstraint of eflData.hydraulicConstraints) {
    const shouldApply = Object.entries(supplementalConstraint.if).every(([key, value]) => {
      if (key === "measurement") return derivedSignals.measurements.has(value);
      if (key === "condition") return derivedSignals.conditions.has(value);
      if (key === "observation") return derivedSignals.observations.has(value);
      if (key === "symptom") {
        return (
          derivedSignals.symptoms.has(value) ||
          selectedClusters.some((cluster) => cluster.cluster_key === value || eflData.flowClusterKey(cluster.cluster_id) === value)
        );
      }
      if (key === "pressure") return value === "0_bar" && derivedSignals.measurements.has("hydraulic_pressure_zero");
      if (key === "pto_state") return value === "engaged" && context.pto_on;
      return false;
    });

    if (!shouldApply) continue;

    appliedConstraints.push(supplementalConstraint.id);

    for (const componentId of supplementalConstraint.then_exclude_components ?? []) {
      excludedComponents.add(componentId);
    }

    for (const [failureModeId, delta] of Object.entries(supplementalConstraint.then_increase_failure_modes ?? {})) {
      const candidate = scored.get(failureModeId);
      if (!candidate) continue;
      candidate.score = clamp(candidate.score + delta);
      candidate.reasons.push(`supplemental:${supplementalConstraint.id}+${delta.toFixed(2)}`);
      scored.set(failureModeId, candidate);
    }

    for (const [failureModeId, delta] of Object.entries(supplementalConstraint.then_reduce_failure_modes ?? {})) {
      const candidate = scored.get(failureModeId);
      if (!candidate) continue;
      candidate.score = clamp(candidate.score - delta);
      candidate.reasons.push(`supplemental:${supplementalConstraint.id}-${delta.toFixed(2)}`);
      scored.set(failureModeId, candidate);
    }

    for (const componentId of supplementalConstraint.then_focus_components ?? []) {
      for (const candidate of scored.values()) {
        if (candidate.failureMode.component_id === componentId) {
          candidate.score = clamp(candidate.score + 0.08);
          candidate.reasons.push(`focus_component:${supplementalConstraint.id}`);
        }
      }
    }

    const constraintHit: ConstraintTraceEntry = {
      id: supplementalConstraint.id,
      stage: "hydraulic_constraints",
      effect: "supplemental_adjustment",
      reason: supplementalConstraint.reason,
      excluded_components: supplementalConstraint.then_exclude_components,
      boosted_failure_modes: Object.entries(supplementalConstraint.then_increase_failure_modes ?? {}).map(
        ([failure_mode_id, delta]) => ({ failure_mode_id, delta })
      ),
      reduced_failure_modes: Object.entries(supplementalConstraint.then_reduce_failure_modes ?? {}).map(
        ([failure_mode_id, delta]) => ({ failure_mode_id, delta })
      ),
      focused_components: supplementalConstraint.then_focus_components,
    };
    constraintHits.push(constraintHit);
    constraintTrace.hydraulic_constraints.push(constraintHit);
  }

  for (const rule of eflData.logicRules) {
    const textMatch = rule.if_text_contains.some((phrase) => normalizedText.includes(normalizeText(phrase)));
    const clusterMatch = rule.if_cluster ? selectedClusters.some((cluster) => cluster.cluster_key === rule.if_cluster) : false;
    if (!textMatch && !clusterMatch) continue;

    const ruleId = rule.if_cluster ? `logic_cluster_${rule.if_cluster}` : `logic_text_${rule.if_text_contains.join("_")}`;
    appliedConstraints.push(ruleId);

    for (const [failureModeId, delta] of Object.entries(rule.then_increase_failure_modes) as Array<[string, number]>) {
      const candidate = scored.get(failureModeId);
      if (!candidate) continue;
      candidate.score = clamp(candidate.score + delta);
      candidate.reasons.push(`logic_rule:+${delta.toFixed(2)}`);
    }

    for (const [failureModeId, delta] of Object.entries(rule.then_reduce_failure_modes) as Array<[string, number]>) {
      const candidate = scored.get(failureModeId);
      if (!candidate) continue;
      candidate.score = clamp(candidate.score - delta);
      candidate.reasons.push(`logic_rule:-${delta.toFixed(2)}`);
    }

    const constraintHit: ConstraintTraceEntry = {
      id: ruleId,
      stage: "logic_rules",
      effect: "logic_rule",
      reason: rule.reason,
      boosted_failure_modes: Object.entries(rule.then_increase_failure_modes).map(([failure_mode_id, delta]) => ({
        failure_mode_id,
        delta,
      })),
      reduced_failure_modes: Object.entries(rule.then_reduce_failure_modes).map(([failure_mode_id, delta]) => ({
        failure_mode_id,
        delta,
      })),
    };
    constraintHits.push(constraintHit);
    constraintTrace.logic_rules.push(constraintHit);
  }

  const ranked = Array.from(scored.values())
    .filter((candidate) => !excludedFailureModes.has(candidate.failureMode.id))
    .filter((candidate) => !excludedComponents.has(candidate.failureMode.component_id))
    .sort((left, right) => right.score - left.score)
    .slice(0, 5);

  return {
    ranked,
    appliedConstraints: Array.from(new Set(appliedConstraints)),
    constraintHits,
    constraintTrace,
  };
}

function toGuidedFlow(topFailureModeId: string | undefined, clusterId: string | undefined, alternatives: string[]): DiagnosisStep[] {
  if (topFailureModeId) {
    const eflFlow = eflData.eflFlows.get(topFailureModeId);
    if (eflFlow) {
      return eflFlow.steps.map((step, index) => ({
        step_id: `${topFailureModeId}_step_${step.step_id}`,
        action: step.action,
        reason: step.reason,
        eliminates: alternatives,
        expected_observation: step.tool ? `Gebruik: ${step.tool}` : "Verzamel een objectieve observatie die de hypothese bevestigt of uitsluit.",
        next: index < eflFlow.steps.length - 1 ? `${topFailureModeId}_step_${eflFlow.steps[index + 1].step_id}` : "complete",
      }));
    }
  }

  if (clusterId) {
    const baseFlow = eflData.baseFlows.get(eflData.flowClusterKey(clusterId));
    if (baseFlow) {
      return baseFlow.flow.map((stepId, index) => {
        const step = eflData.diagnosticSteps.get(stepId);
        const requirement = eflData.stepRequirements.get(stepId);
        const effect = eflData.stepEffects.get(stepId);
        return {
          step_id: stepId,
          action: step?.action ?? stepId,
          reason: step?.description ?? "Deterministische flowstap uit de basisflow.",
          eliminates: [...(effect?.if_pass?.exclude_failure_modes ?? []), ...(effect?.if_fail?.exclude_components ?? [])],
          expected_observation: requirement?.tools.length ? `Tooling: ${requirement.tools.join(", ")}` : "Observeer of de component consistent reageert op deze test.",
          next: index < baseFlow.flow.length - 1 ? baseFlow.flow[index + 1] : "complete",
        };
      });
    }
  }

  return [];
}

function buildFallbackFlow(componentId: string | undefined): DiagnosisStep[] {
  const genericActions = componentId ? GENERIC_COMPONENT_INSPECTIONS[componentId] ?? [] : [];
  return genericActions.map((action, index) => ({
    step_id: `fallback_${index + 1}`,
    action,
    reason: "Fallback flow op basis van canonieke componentklasse.",
    eliminates: [],
    expected_observation: "Controleer of de observatie overeenkomt met de vermoedelijke failure mode.",
    next: index < genericActions.length - 1 ? `fallback_${index + 2}` : "complete",
  }));
}

function buildLocationGuess(componentId: string | undefined): LocationGuess | undefined {
  if (!componentId) return undefined;

  const metadata = eflData.componentMetadataById.get(componentId);
  const component = eflData.componentsById.get(componentId);
  if (!metadata && !component) return undefined;

  const relationTargets = eflData.componentRelations
    .filter((relation) => relation.from === componentId || relation.to === componentId)
    .slice(0, 2)
    .map((relation) => `${relation.type}: ${relation.from === componentId ? relation.to : relation.from}`);

  return {
    component_id: componentId,
    location_hint: metadata?.location || component?.name || componentId,
    access_hint: relationTargets.length > 0
      ? `Gerelateerde paden: ${relationTargets.join(", ")}`
      : "Benader via de logische componentgroep en controleer voeding, massa en flowpaden.",
  };
}

function inferDataQuality(clusterScore: number, candidateScore: number): DataQualityScore {
  if (clusterScore >= 0.6 && candidateScore >= 0.6) return "A";
  if (clusterScore >= 0.3 && candidateScore >= 0.35) return "B";
  return "C";
}

function buildKnowledgeBaseFallbackActions(): string[] {
  return [
    "Leg het symptoom specifieker vast in chauffeurstaal, inclusief geluid, belasting en temperatuur.",
    "Voeg meetwaarden toe zoals druk, flow, temperatuur of voeding om de klacht te begrenzen.",
    "Controleer of de klacht binnen de huidige Engineer Flow knowledge base valt voordat je verder diagnosticeert.",
  ];
}

function buildClarificationActions(bridgeResult: SymptomBridgeResult): string[] {
  const topMatches = bridgeResult.matched_driver_symptoms.slice(0, 3).map((match) => match.description);
  const actions = [
    "Kies de klachtomschrijving die het beste past uit de voorgestelde symptomopties.",
    "Geef aan of het probleem vooral onder belasting, bij warmte, in één richting of intermitterend optreedt.",
    "Voeg een objectieve observatie toe zoals druk, flow, temperatuur of een duidelijk geluidssymptoom.",
  ];

  for (const matchDescription of topMatches) {
    actions.push(`Bevestig of deze klacht beter past: "${matchDescription}".`);
  }

  return Array.from(new Set(actions)).slice(0, 5);
}

function serializeDerivedSignals(derivedSignals: DerivedSignals) {
  return {
    measurements: Array.from(derivedSignals.measurements).sort(),
    conditions: Array.from(derivedSignals.conditions).sort(),
    observations: Array.from(derivedSignals.observations).sort(),
    environments: Array.from(derivedSignals.environments).sort(),
    events: Array.from(derivedSignals.events).sort(),
    symptoms: Array.from(derivedSignals.symptoms).sort(),
  };
}

function deriveConfounders(derivedSignals: DerivedSignals): string[] {
  const confounders = new Set<string>();

  for (const environment of derivedSignals.environments) {
    confounders.add(`environment:${environment}`);
  }
  for (const condition of derivedSignals.conditions) {
    confounders.add(`condition:${condition}`);
  }
  for (const event of derivedSignals.events) {
    confounders.add(`event:${event}`);
  }

  return Array.from(confounders).sort();
}

function buildPrimaryTsEvidence(technicianSymptomScores: TechnicianSymptomScore[]) {
  return technicianSymptomScores.slice(0, 8).map((technicianSymptomScore) => ({
    ts_id: technicianSymptomScore.ts_id,
    subsystem_id: technicianSymptomScore.subsystem_id,
    description: technicianSymptomScore.description,
    score: Number(technicianSymptomScore.score.toFixed(4)),
    source_des_ids: Array.from(
      new Set(technicianSymptomScore.contributions.map((contribution) => contribution.des_id))
    ),
  }));
}

function buildFailureChainPath(
  matchedDesIds: string[],
  technicianSymptomScores: TechnicianSymptomScore[],
  componentId: string | undefined,
  failureModeId: string | undefined
): string[] {
  const chain: string[] = [];

  for (const desId of matchedDesIds.slice(0, 2)) {
    chain.push(desId);
  }
  for (const tsId of technicianSymptomScores.slice(0, 2).map((score) => score.ts_id)) {
    chain.push(tsId);
  }
  if (componentId) {
    chain.push(componentId);
  }
  if (failureModeId) {
    chain.push(failureModeId);
  }

  return Array.from(new Set(chain));
}

function buildDdsCase(
  input: DeterministicDiagnoseInput,
  caseId: string,
  timestampStart: string,
  timestampEnd: string,
  selectedClusterId: string,
  selectedClusterName: string,
  subdomain: string,
  topFailureModeId: string,
  rootCauseCategory: string,
  confidenceTotal: number,
  failureChainPath: string[],
  confoundersDetected: string[],
  actions: string[],
  guidedFlow: DiagnosisStep[],
  dataQualityScore: DataQualityScore
): DdsCase {
  const startDate = new Date(timestampStart);
  const endDate = new Date(timestampEnd);
  const durationMinutes = Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 60000));

  return {
    metadata: {
      case_id: caseId,
      timestamp_start: timestampStart,
      timestamp_end: timestampEnd,
      duration_minutes: durationMinutes,
      ef_version: ENGINE_VERSION,
      data_quality_score: dataQualityScore,
    },
    vehicle: {
      vehicle_type: "truck_mixer",
      oem: "Volvo / Liebherr",
      model: input.vehicleId || "FM/FH Mixer",
    },
    environment: {
      weather: input.context?.rain ? "rain" : input.context?.frost ? "freezing" : "unknown",
      ambient_temp: input.context?.frost ? "freezing" : "unknown",
      vehicle_load_state: input.context?.heavy_load ? "heavy" : "normal",
    },
    symptoms: {
      symptom_primary: selectedClusterName,
      symptom_secondary: subdomain,
      symptom_description_freeform: input.symptomDescription,
    },
    dtc_layer: {
      dtc_list_raw: [],
      dtc_confidence: 0,
    },
    can_layer: {
      can_signature_id: "",
      can_anomaly_score: 0,
    },
    failure_resolution: {
      failure_mode_final: topFailureModeId,
      failure_chain_path: failureChainPath,
      root_cause_category: rootCauseCategory,
      root_cause_specific: topFailureModeId,
      failure_likelihood_score: confidenceTotal,
      confounders_detected: confoundersDetected,
      confidence_total: confidenceTotal,
    },
    repair: {
      repair_actions_taken: [],
      components_replaced: [],
      recommended_actions: actions,
      guided_flow: guidedFlow.map((step) => step.step_id),
    },
    outcome: {
      selected_subdomain: subdomain,
      symptom_cluster_id: selectedClusterId,
      symptom_cluster_name: selectedClusterName,
    },
    privacy: {
      privacy_audit_pass: true,
      photo_attached: Boolean(input.photoDataUri),
    },
  };
}

export async function runDeterministicDiagnosis(input: DeterministicDiagnoseInput): Promise<DeterministicDiagnoseResponse> {
  assertEflCoreReady();
  const timestampStart = new Date().toISOString();
  const symptomDescription = input.symptomDescription.trim();
  const context: DiagnosisContext = {
    ...DEFAULT_CONTEXT,
    ...(input.context ?? {}),
  };
  const caseId = input.caseId?.trim() || `CASE-DET-${Date.now()}`;
  const diagnosisId = `DIAG-${Date.now()}`;
  const debugLog: AuditLogEntry[] = [];

  const bridgeStart = performance.now();
  const bridgeResult = runSymptomBridge(symptomDescription);
  debugLog.push({
    rule_name: "DesTsBridgeV1",
    duration_ms: Number((performance.now() - bridgeStart).toFixed(3)),
    input_events: 1,
    output_events: bridgeResult.technician_symptom_scores.length,
    config_used: {
      des_match_threshold: 0.42,
      strict_des_match_threshold: 0.58,
      strict_subsystem_threshold: 0.52,
      bridge_status: bridgeResult.status,
      ts_score_formula: "((strength*0.7)+(uniqueness*0.3))/5",
      ts_score_cap: 1,
    },
  });

  const clusterStart = performance.now();
  const clusterScores = scoreClusters(symptomDescription, bridgeResult.subsystem_scores);
  const selectedClusters = deriveSelectedClusters(clusterScores);
  debugLog.push({
    rule_name: "ClusterSelectorV2",
    duration_ms: Number((performance.now() - clusterStart).toFixed(3)),
    input_events: 1,
    output_events: selectedClusters.length,
    config_used: { candidate_limit: 3 },
  });

  const bestClusterScore = selectedClusters[0] ?? clusterScores[0];
  const bestCluster = bestClusterScore ? eflData.clustersById.get(bestClusterScore.cluster_id) : undefined;
  const derivedSignals = buildDerivedSignals(
    normalizeText(symptomDescription),
    context,
    bridgeResult.technician_symptom_scores,
    bridgeResult.subsystem_scores
  );
  const serializedDerivedSignals = serializeDerivedSignals(derivedSignals);

  if (bridgeResult.status === "knowledge_gap") {
    const timestampEnd = new Date().toISOString();
    const fallbackActions = buildKnowledgeBaseFallbackActions();
    const guidedFlow = fallbackActions.map((action, index) => ({
      step_id: `knowledge_gap_${index + 1}`,
      action,
      reason: "Deterministische fallback omdat geen DES-match boven drempel is gevonden.",
      eliminates: [],
      expected_observation: "Verzamel extra symptoomcontext of objectieve meetdata.",
      next: index < fallbackActions.length - 1 ? `knowledge_gap_${index + 2}` : "complete",
    }));

    const ddsCase = buildDdsCase(
      input,
      caseId,
      timestampStart,
      timestampEnd,
      "NOT_COVERED",
      "Niet afgedekt door knowledge base",
      "unknown",
      "not_covered_by_knowledge_base",
      "knowledge_gap",
      0,
      ["knowledge_gap"],
      deriveConfounders(derivedSignals),
      fallbackActions,
      guidedFlow,
      "C"
    );

    const executionPlan = ["DesTsBridgeV1", "KnowledgeBaseFallbackV1", "DdsBuilderV2"];
    const episodeFingerprint = createStableHash({
      case_id: caseId,
      symptom_text: symptomDescription,
      normalized_text: bridgeResult.normalized_text,
      context,
      matched_driver_symptoms: [],
    });

    const clarificationConstraintHit: ConstraintTraceEntry = {
      id: "clarification_required",
      stage: "logic_rules",
      effect: "no_ranking",
      reason: "ambiguous_des_match",
    };

    const auditTrail = {
      engine_version: ENGINE_VERSION,
      config_version: CONFIG_VERSION,
      execution_signature: createStableHash({
        engine_version: ENGINE_VERSION,
        config_version: CONFIG_VERSION,
        case_id: caseId,
        symptom_text: symptomDescription,
        context,
        execution_plan: executionPlan,
      }),
      episode_fingerprint: episodeFingerprint,
      rule_versions: {
        DesTsBridgeV1: "1.0.0",
        KnowledgeBaseFallbackV1: "1.0.0",
        DdsBuilderV2: "1.0.0",
      },
      dataset_versions: VERSION_MANIFEST.datasets,
      execution_plan: executionPlan,
      config_used: {
        des_match_threshold: 0.42,
        ts_score_cap: 1,
        no_match_policy: "not_covered_by_knowledge_base",
      },
      debug_log: debugLog,
      input_snapshot: {
        case_id: caseId,
        symptom_text: symptomDescription,
        normalized_text: bridgeResult.normalized_text,
        context,
      },
      derived_signals: serializedDerivedSignals,
      des_matches: [],
      primary_ts_evidence: [],
      subsystem_scores: [],
      cluster_scores: clusterScores.slice(0, 8).map((cluster) => ({
        cluster_id: cluster.cluster_id,
        score: Number(cluster.score.toFixed(4)),
        exact_matches: cluster.exact_matches,
        matched_keywords: cluster.matched_keywords,
      })),
      constraint_hits: [],
      constraint_trace: buildEmptyConstraintTrace(),
      ts_score_breakdown: [],
      failure_mode_score_breakdown: [],
    };

    return {
      diagnosis_id: diagnosisId,
      case_id: caseId,
      status: "knowledge_gap",
      diagnosis_status: "knowledge_gap",
      clarification_required: false,
      matched_des_ids: [],
      knowledge_gap_reason: bridgeResult.knowledge_gap_reason,
      subdomain: "unknown",
      symptom_cluster: "NOT_COVERED",
      symptom_cluster_name: "Niet afgedekt door knowledge base",
      symptom_cluster_description: "Er is geen DES-match gevonden die voldoende sterk binnen de huidige symptom library valt.",
      steps: guidedFlow,
      guided_flow: guidedFlow,
      root_cause_ranking: [],
      candidates: [],
      recommended_actions: fallbackActions,
      confidence_score: 0,
      ts_score_breakdown: [],
      constraint_trace: buildEmptyConstraintTrace(),
      failure_modes: eflData.failureModes as FailureModeResponse[],
      location_guess: undefined,
      applied_constraints: [],
      dds_case: ddsCase,
      audit_trail: auditTrail,
    };
  }

  if (bridgeResult.status === "clarification_required") {
    const timestampEnd = new Date().toISOString();
    const clarificationActions = buildClarificationActions(bridgeResult);
    const guidedFlow = clarificationActions.map((action, index) => ({
      step_id: `clarify_${index + 1}`,
      action,
      reason: "Deterministische clarificatiefase omdat de DES-match nog ambigu is.",
      eliminates: [],
      expected_observation: "Bevestig welke klachtomschrijving of context het beste past.",
      next: index < clarificationActions.length - 1 ? `clarify_${index + 2}` : "complete",
    }));
    const ddsCase = buildDdsCase(
      input,
      caseId,
      timestampStart,
      timestampEnd,
      "CLARIFICATION_REQUIRED",
      "Meer symptoomafbakening nodig",
      "unknown",
      "clarification_required",
      "clarification_required",
      0,
      ["clarification_required"],
      deriveConfounders(derivedSignals),
      clarificationActions,
      guidedFlow,
      "C"
    );

    const executionPlan = ["DesTsBridgeV1", "ClarificationGateV1", "DdsBuilderV2"];
    const clarificationConstraintHit: ConstraintTraceEntry = {
      id: "clarification_required",
      stage: "logic_rules",
      effect: "no_ranking",
      reason: "ambiguous_des_match",
    };
    const auditTrail = {
      engine_version: ENGINE_VERSION,
      config_version: CONFIG_VERSION,
      execution_signature: createStableHash({
        engine_version: ENGINE_VERSION,
        config_version: CONFIG_VERSION,
        case_id: caseId,
        symptom_text: symptomDescription,
        context,
        execution_plan: executionPlan,
        clarification_reason: "ambiguous_des_match",
      }),
      episode_fingerprint: createStableHash({
        case_id: caseId,
        symptom_text: symptomDescription,
        normalized_text: bridgeResult.normalized_text,
        context,
        matched_driver_symptoms: bridgeResult.matched_driver_symptoms,
      }),
      rule_versions: {
        DesTsBridgeV1: "1.0.0",
        ClarificationGateV1: "1.0.0",
        DdsBuilderV2: "1.0.0",
      },
      dataset_versions: VERSION_MANIFEST.datasets,
      execution_plan: executionPlan,
      config_used: {
        des_match_threshold: 0.42,
        clarification_top_des_min: 0.58,
        clarification_top_subsystem_min: 0.52,
      },
      debug_log: debugLog,
      input_snapshot: {
        case_id: caseId,
        symptom_text: symptomDescription,
        normalized_text: bridgeResult.normalized_text,
        context,
      },
      derived_signals: serializedDerivedSignals,
      des_matches: bridgeResult.matched_driver_symptoms.map((match) => ({
        des_id: match.des_id,
        subsystem_id: match.subsystem_id,
        score: Number(match.score.toFixed(4)),
        description: match.description,
      })),
      primary_ts_evidence: buildPrimaryTsEvidence(bridgeResult.technician_symptom_scores),
      subsystem_scores: bridgeResult.subsystem_scores.map((subsystemScore) => ({
        subsystem_id: subsystemScore.subsystem_id,
        subsystem_name: subsystemScore.subsystem_name,
        score: Number(subsystemScore.score.toFixed(4)),
        matched_des_ids: subsystemScore.matched_des_ids,
        top_ts_ids: subsystemScore.top_ts_ids,
      })),
      cluster_scores: clusterScores.slice(0, 8).map((cluster) => ({
        cluster_id: cluster.cluster_id,
        score: Number(cluster.score.toFixed(4)),
        exact_matches: cluster.exact_matches,
        matched_keywords: cluster.matched_keywords,
      })),
      constraint_hits: [clarificationConstraintHit],
      constraint_trace: {
        ...buildEmptyConstraintTrace(),
        logic_rules: [clarificationConstraintHit],
      },
      ts_score_breakdown: bridgeResult.technician_symptom_scores.slice(0, 20).map((technicianSymptomScore) => ({
        ts_id: technicianSymptomScore.ts_id,
        subsystem_id: technicianSymptomScore.subsystem_id,
        score: Number(technicianSymptomScore.score.toFixed(4)),
        source: technicianSymptomScore.contributions.map((contribution) => contribution.des_id),
      })),
      failure_mode_score_breakdown: [],
    };

    return {
      diagnosis_id: diagnosisId,
      case_id: caseId,
      status: "clarification_required",
      diagnosis_status: "clarification_required",
      clarification_required: true,
      matched_des_ids: [],
      clarification_prompt: bridgeResult.clarification_prompt,
      clarification_options: bridgeResult.clarification_options,
      clarification_questions: bridgeResult.clarification_questions,
      subdomain: "unknown",
      symptom_cluster: "CLARIFICATION_REQUIRED",
      symptom_cluster_name: "Meer symptoomafbakening nodig",
      symptom_cluster_description:
        "De huidige invoer matcht meerdere DES-profielen of past nog te zwak op de symptom library.",
      steps: guidedFlow,
      guided_flow: guidedFlow,
      root_cause_ranking: [],
      candidates: [],
      recommended_actions: clarificationActions,
      confidence_score: 0,
      ts_score_breakdown: auditTrail.ts_score_breakdown,
      constraint_trace: auditTrail.constraint_trace,
      failure_modes: eflData.failureModes as FailureModeResponse[],
      location_guess: undefined,
      applied_constraints: [],
      dds_case: ddsCase,
      audit_trail: auditTrail,
    };
  }

  const scoringStart = performance.now();
  const { ranked, appliedConstraints, constraintHits, constraintTrace } = buildFailureModeCandidates(
    symptomDescription,
    selectedClusters,
    derivedSignals,
    context,
    bridgeResult.subsystem_scores,
    bridgeResult.technician_symptom_scores
  );
  debugLog.push({
    rule_name: "FailureModeScorerV2",
    duration_ms: Number((performance.now() - scoringStart).toFixed(3)),
    input_events: selectedClusters.length,
    output_events: ranked.length,
    config_used: {
      scoring_model: "deterministic_des_ts_component_relation",
      primary_signals: ["technician_support", "technician_description", "subsystem_support", "constraint_adjustments"],
    },
  });

  const topCandidate = ranked[0];
  const rootCauseRanking: RootCauseCandidate[] = ranked.map((candidate) => ({
    fo_id: candidate.failureMode.id,
    confidence: clamp(candidate.score),
    why: candidate.reasons.join("; "),
  }));

  const guidedFlowFromDatasets = toGuidedFlow(
    topCandidate?.failureMode.id,
    bestCluster?.id,
    ranked.slice(1).map((candidate) => candidate.failureMode.id)
  );
  const guidedFlow = guidedFlowFromDatasets.length > 0 ? guidedFlowFromDatasets : buildFallbackFlow(topCandidate?.failureMode.component_id);
  const recommendedActions = guidedFlow.map((step) => step.action);
  const locationGuess = buildLocationGuess(topCandidate?.failureMode.component_id);
  const confidenceScore = Math.round((topCandidate?.score ?? 0) * 100);
  const subdomain =
    inferSubdomainFromSubsystem(bridgeResult.subsystem_scores[0]?.subsystem_id) ?? inferSubdomain(bestCluster?.tags ?? []);
  const dataQualityScore = inferDataQuality(bestClusterScore?.score ?? 0, topCandidate?.score ?? 0);
  const timestampEnd = new Date().toISOString();
  const failureChainPath = buildFailureChainPath(
    bridgeResult.matched_driver_symptoms.map((match) => match.des_id),
    bridgeResult.technician_symptom_scores,
    topCandidate?.failureMode.component_id,
    topCandidate?.failureMode.id
  );
  const ddsCase = buildDdsCase(
    input,
    caseId,
    timestampStart,
    timestampEnd,
    bestCluster?.id ?? "SC_UNKNOWN",
    bestCluster?.name ?? "Onbekend cluster",
    subdomain,
    topCandidate?.failureMode.id ?? "not_covered_by_knowledge_base",
    topCandidate ? "deterministic_root_cause" : "knowledge_gap",
    Number((topCandidate?.score ?? 0).toFixed(3)),
    failureChainPath,
    deriveConfounders(derivedSignals),
    recommendedActions,
    guidedFlow,
    dataQualityScore
  );

  const executionPlan = [
    "DesTsBridgeV1",
    "ClusterSelectorV2",
    "ConstraintEnforcerV1",
    "FailureModeScorerV2",
    "FlowBuilderV1",
    "DdsBuilderV2",
  ];
  const episodeFingerprint = createStableHash({
    case_id: caseId,
    symptom_text: symptomDescription,
    normalized_text: bridgeResult.normalized_text,
    context,
    matched_driver_symptoms: bridgeResult.matched_driver_symptoms,
    selected_clusters: selectedClusters,
  });

  const auditTrail = {
    engine_version: ENGINE_VERSION,
    config_version: CONFIG_VERSION,
    execution_signature: createStableHash({
      engine_version: ENGINE_VERSION,
      config_version: CONFIG_VERSION,
      case_id: caseId,
      symptom_text: symptomDescription,
      context,
      matched_driver_symptoms: bridgeResult.matched_driver_symptoms,
      selected_clusters: selectedClusters,
      applied_constraints: appliedConstraints,
      top_failure_modes: ranked.map((candidate) => ({
        id: candidate.failureMode.id,
        score: Number(candidate.score.toFixed(4)),
      })),
    }),
    episode_fingerprint: episodeFingerprint,
    rule_versions: {
      DesTsBridgeV1: "1.0.0",
      ClusterSelectorV2: "1.0.0",
      FailureModeScorerV2: "1.0.0",
      ConstraintEnforcerV1: "1.0.0",
      FlowBuilderV1: "1.0.0",
      DdsBuilderV2: "1.0.0",
    },
    dataset_versions: VERSION_MANIFEST.datasets,
    execution_plan: executionPlan,
    config_used: {
      des_match_threshold: 0.42,
      ts_score_cap: 1,
      cluster_candidate_limit: 3,
    },
    debug_log: debugLog,
    input_snapshot: {
      case_id: caseId,
      symptom_text: symptomDescription,
      normalized_text: bridgeResult.normalized_text,
      context,
    },
    derived_signals: serializedDerivedSignals,
    des_matches: bridgeResult.matched_driver_symptoms.map((match) => ({
      des_id: match.des_id,
      subsystem_id: match.subsystem_id,
      score: Number(match.score.toFixed(4)),
      description: match.description,
    })),
    primary_ts_evidence: buildPrimaryTsEvidence(bridgeResult.technician_symptom_scores),
    subsystem_scores: bridgeResult.subsystem_scores.map((subsystemScore) => ({
      subsystem_id: subsystemScore.subsystem_id,
      subsystem_name: subsystemScore.subsystem_name,
      score: Number(subsystemScore.score.toFixed(4)),
      matched_des_ids: subsystemScore.matched_des_ids,
      top_ts_ids: subsystemScore.top_ts_ids,
    })),
    cluster_scores: clusterScores.slice(0, 8).map((cluster) => ({
      cluster_id: cluster.cluster_id,
      score: Number(cluster.score.toFixed(4)),
      exact_matches: cluster.exact_matches,
      matched_keywords: cluster.matched_keywords,
    })),
      constraint_hits: constraintHits,
      constraint_trace: constraintTrace,
      ts_score_breakdown: bridgeResult.technician_symptom_scores.slice(0, 20).map((technicianSymptomScore) => ({
        ts_id: technicianSymptomScore.ts_id,
        subsystem_id: technicianSymptomScore.subsystem_id,
        score: Number(technicianSymptomScore.score.toFixed(4)),
      source: technicianSymptomScore.contributions.map((contribution) => contribution.des_id),
    })),
    failure_mode_score_breakdown: ranked.map((candidate) => ({
      failure_mode_id: candidate.failureMode.id,
      component_id: candidate.failureMode.component_id,
      score: Number(candidate.score.toFixed(4)),
      reasons: candidate.reasons,
      primary_evidence: buildPrimaryTsEvidence(bridgeResult.technician_symptom_scores)
        .filter((evidence) => evidence.subsystem_id === inferSubsystemFromComponentId(candidate.failureMode.component_id))
        .map((evidence) => evidence.ts_id),
    })),
  };

  return {
    diagnosis_id: diagnosisId,
    case_id: caseId,
    status: "ranked",
    diagnosis_status: "ranked",
    clarification_required: false,
    matched_des_ids: bridgeResult.accepted_des_ids,
    subdomain,
    symptom_cluster: bestCluster?.id ?? "SC_UNKNOWN",
    symptom_cluster_name: bestCluster?.name ?? "Onbekend cluster",
    symptom_cluster_description: bestCluster?.description ?? "Geen clusterbeschrijving beschikbaar.",
    steps: guidedFlow,
    guided_flow: guidedFlow,
    root_cause_ranking: rootCauseRanking,
    candidates: rootCauseRanking,
    recommended_actions: recommendedActions,
    confidence_score: confidenceScore,
    ts_score_breakdown: auditTrail.ts_score_breakdown,
    constraint_trace: auditTrail.constraint_trace,
    failure_modes: eflData.failureModes as FailureModeResponse[],
    location_guess: locationGuess,
    applied_constraints: appliedConstraints,
    dds_case: ddsCase,
    audit_trail: auditTrail,
  };
}
