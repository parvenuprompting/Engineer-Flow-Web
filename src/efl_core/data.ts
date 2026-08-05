import baseFlowsJson from "@/ai/data/base_flows.json";
import clusterToComponentMapJson from "@/ai/data/cluster_to_component_map.json";
import componentDiagnosticValueJson from "@/ai/data/component_diagnostic_value.json";
import componentMetadataJson from "@/ai/data/component_metadata.json";
import componentRelationsJson from "@/ai/data/component_relations.json";
import componentTreeJson from "@/ai/data/component_tree.json";
import componentsJson from "@/ai/data/components.json";
import constraintsJson from "@/ai/data/constraints.json";
import diagnosticStepsJson from "@/ai/data/diagnostic_steps.json";
import eflJson from "@/ai/data/efl.json";
import electricalConstraintsJson from "@/ai/data/electrical_constraints.json";
import failureModesJson from "@/ai/data/failure_modes.json";
import hydraulicConstraintsJson from "@/ai/data/hydraulic_constraints.json";
import logicRulesJson from "@/ai/data/logic_rules.json";
import schemaJson from "@/ai/data/schema.json";
import stepEffectsJson from "@/ai/data/step_effects.json";
import stepRequirementsJson from "@/ai/data/step_requirements.json";
import symptomClustersJson from "@/ai/data/symptom_clusters.json";
import variantConstraintsJson from "@/ai/data/variant_constraints.json";
import clusterKeywordsJson from "../../data/cluster_keywords_mapping.json";
import desTsMapJson from "./data/des_ts_map.v1.0.json";
import efDiagnosticSchemaJson from "./data/ef_diagnostic_schema.json";
import masterSymptomSetJson from "./data/master_symptom_set.v1.0.json";
import type {
  CanonicalComponent,
  CanonicalFailureMode,
  CanonicalSymptomCluster,
  DesTsMapping,
  DriverSymptom,
  SymptomSubsystem,
  TechnicianSymptom,
} from "./types";
import { VERSION_MANIFEST } from "./version";

type GenericConstraint = {
  id: string;
  if: Record<string, string>;
  effect: {
    exclude_failure_modes: string[];
    increase_probability: Array<{ failure_mode_id: string; delta: number }>;
  };
  description: string;
};

type SupplementalConstraint = {
  id: string;
  if: Record<string, string>;
  then_exclude_components?: string[];
  then_focus_components?: string[];
  then_reduce_failure_modes?: Record<string, number>;
  then_increase_failure_modes?: Record<string, number>;
  reason: string;
};

type ComponentMetadata = {
  id: string;
  type: string;
  location: string;
  feeds: string[];
  downstream: string[];
  vibration_risk: number;
  moisture_risk: number;
};

type ComponentRelation = {
  type: string;
  from: string;
  to: string;
};

type DiagnosticStepRecord = {
  id: string;
  action: string;
  description: string;
  type: string;
  target_component: string;
};

type StepRequirementRecord = {
  step_id: string;
  tools: string[];
  safety: string[];
  vehicle_state: string;
  estimated_time_min: number;
  difficulty: number;
};

type StepEffectRecord = {
  step_id: string;
  if_pass?: {
    exclude_failure_modes: string[];
    reduce_failure_modes: Record<string, number>;
  };
  if_fail?: {
    increase_failure_modes: Record<string, number>;
    exclude_components: string[];
    exclude_components_downstream: string[];
  };
};

type BaseFlowRecord = {
  cluster: string;
  flow: string[];
};

type EflFlowStep = {
  step_id: number;
  action: string;
  reason: string;
  tool?: string;
};

type EflFlowRecord = {
  id: string;
  failure_object_id: string;
  steps: EflFlowStep[];
};

const COMPONENT_ID_ALIASES: Record<string, string> = {
  opbouw_feed_fuse_f65: "main_fuse_mixer",
  chassis_ground_g45: "ground_main",
  handunit: "handunit_main",
  ebox_controller_pcb: "e_box_main",
  ebox_power_in: "e_box_main",
  e_box: "e_box_main",
  e_box_controller_pcb: "e_box_main",
  valve_fwd: "solenoid_valve_fwd",
  valve_rev: "solenoid_valve_rev",
  hydraulic_pump: "hydraulic_pump",
  drum_drive_motor: "hydraulic_motor",
  pto_solenoid: "pto_control_valve",
  drum_speed_sensor: "drum_speed_sensor",
  pressure_relief_valve: "hydraulic_relief_valve",
  hydraulic_tank_return: "hydraulic_return_line",
  drum_bearing: "drum_main_bearing",
  drum: "drum_shell"
};

const FAILURE_MODE_ALIASES: Record<string, string> = {
  fm_fuse_blown: "fm_main_fuse_blown",
  fm_ground_corrosion: "fm_ground_main_corroded",
  fm_ground_fail: "fm_ground_main_corroded",
  fm_pump_no_pressure: "fm_hydraulic_pump_low_pressure",
  fm_pto_no_engage: "fm_pto_not_engaging",
  fm_valve_fwd_stuck: "fm_solenoid_fwd_spool_stuck",
  fm_valve_rev_stuck: "fm_solenoid_rev_spool_stuck",
  fm_connector_corrosion: "fm_connector_block_corroded",
};

const CLUSTER_FLOW_ALIASES: Record<string, string> = {
  DRUM_NOT_ROTATING: "DRUM_NOT_ROTATING_PTO_ON",
  ELECTRICAL_TOTAL_LOSS: "EBOX_NO_POWER",
  ELECTRICAL_INTERMITTENT: "EBOX_INTERMITTENT",
  PTO_NOT_ENGAGING: "PTO_FAULT"
};

function toSnakeCase(value: string): string {
  return value
    .replace(/\([^)]*\)/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function normalizeClusterKey(value: string): string {
  return value.replace(/^SC_/, "").replace(/^sc_/, "").replace(/[^A-Za-z0-9]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
}

const components = (componentsJson.components as Array<Record<string, unknown>>).map<CanonicalComponent>((component) => ({
  id: String(component.id),
  name: String(component.name),
  subsystem: String(component.subsystem),
  type: String(component.type)
}));

const componentIdSet = new Set(components.map((component) => component.id));

function normalizeComponentId(value: string): string {
  const normalized = toSnakeCase(value);
  if (componentIdSet.has(normalized)) {
    return normalized;
  }
  const aliasTarget = COMPONENT_ID_ALIASES[normalized];
  if (aliasTarget && componentIdSet.has(aliasTarget)) {
    return aliasTarget;
  }
  return normalized;
}

const failureModes = (failureModesJson.failure_modes as Array<Record<string, unknown>>).map<CanonicalFailureMode>((failureMode) => ({
  id: String(failureMode.id),
  component_id: String(failureMode.component_id),
  severity: Number(failureMode.severity),
  likelihood: Number(failureMode.likelihood),
  description: String(failureMode.description)
}));

const failureModeIdSet = new Set(failureModes.map((failureMode) => failureMode.id));

function normalizeFailureModeId(value: string): string {
  const normalized = toSnakeCase(value);
  if (failureModeIdSet.has(normalized)) {
    return normalized;
  }
  const aliasTarget = FAILURE_MODE_ALIASES[normalized];
  if (aliasTarget && failureModeIdSet.has(aliasTarget)) {
    return aliasTarget;
  }
  return normalized;
}

const symptomClusters = (symptomClustersJson.symptom_clusters as Array<Record<string, unknown>>).map<CanonicalSymptomCluster>((cluster) => ({
  id: String(cluster.id),
  key: normalizeClusterKey(String(cluster.id)),
  name: String(cluster.name),
  description: String(cluster.description),
  related_component_ids: Array.isArray(cluster.related_component_ids)
    ? (cluster.related_component_ids as string[])
        .map((componentId) => normalizeComponentId(componentId))
        .filter((componentId) => componentIdSet.has(componentId))
    : [],
  tags: Array.isArray(cluster.tags) ? (cluster.tags as string[]).map((tag) => String(tag)) : []
}));

const componentsById = new Map(components.map((component) => [component.id, component]));
const failureModesById = new Map(failureModes.map((failureMode) => [failureMode.id, failureMode]));
const clustersById = new Map(symptomClusters.map((cluster) => [cluster.id, cluster]));
const clustersByKey = new Map(symptomClusters.map((cluster) => [cluster.key, cluster]));

const clusterKeywords = new Map(
  Object.entries(clusterKeywordsJson as Record<string, string[]>).map(([clusterKey, values]) => [
    normalizeClusterKey(clusterKey),
    values.map((value) => String(value))
  ])
);

const symptomSubsystems = (masterSymptomSetJson.subsystems as Array<Record<string, unknown>>).map<SymptomSubsystem>((subsystem) => {
  const subsystemId = String(subsystem.id);
  const subsystemName = String(subsystem.name);

  const technicianSymptoms = Array.isArray(subsystem.technician_symptoms)
    ? (subsystem.technician_symptoms as Array<Record<string, unknown>>).map<TechnicianSymptom>((symptom) => ({
        ts_id: String(symptom.ts_id),
        category: String(symptom.category),
        description: String(symptom.description),
        subsystem_id: subsystemId,
        subsystem_name: subsystemName,
      }))
    : [];

  const driverSymptoms = Array.isArray(subsystem.driver_symptoms)
    ? (subsystem.driver_symptoms as Array<Record<string, unknown>>).map<DriverSymptom>((symptom) => ({
        des_id: String(symptom.des_id),
        category: String(symptom.category),
        description: String(symptom.description),
        subsystem_id: subsystemId,
        subsystem_name: subsystemName,
      }))
    : [];

  return {
    id: subsystemId,
    name: subsystemName,
    technician_symptoms: technicianSymptoms,
    driver_symptoms: driverSymptoms,
  };
});

const driverSymptoms = symptomSubsystems.flatMap((subsystem) => subsystem.driver_symptoms);
const technicianSymptoms = symptomSubsystems.flatMap((subsystem) => subsystem.technician_symptoms);
const driverSymptomsById = new Map(driverSymptoms.map((symptom) => [symptom.des_id, symptom]));
const technicianSymptomsById = new Map(technicianSymptoms.map((symptom) => [symptom.ts_id, symptom]));
const symptomSubsystemsById = new Map(symptomSubsystems.map((subsystem) => [subsystem.id, subsystem]));

const desTsMappings = (desTsMapJson.mappings as Array<Record<string, unknown>>).map<DesTsMapping>((mapping) => ({
  map_id: String(mapping.map_id),
  des_id: String(mapping.des_id),
  subsystem_id: String(mapping.subsystem_id),
  ts_links: Array.isArray(mapping.ts_links)
    ? (mapping.ts_links as Array<Record<string, unknown>>).map((link) => ({
        ts_id: String(link.ts_id),
        strength: Number(link.strength),
        uniqueness: Number(link.uniqueness),
      }))
    : [],
}));

const desTsMappingsByDesId = new Map(
  desTsMappings.map((mapping) => [mapping.des_id, mapping])
);

const canonicalConstraints = (constraintsJson.constraints as Array<Record<string, unknown>>).map<GenericConstraint>((constraint) => ({
  id: String(constraint.id),
  if: (constraint.if ?? {}) as Record<string, string>,
  effect: {
    exclude_failure_modes: Array.isArray((constraint.effect as Record<string, unknown> | undefined)?.exclude_failure_modes)
      ? ((constraint.effect as Record<string, unknown>).exclude_failure_modes as string[])
          .map((failureModeId) => normalizeFailureModeId(failureModeId))
          .filter((failureModeId) => failureModeIdSet.has(failureModeId))
      : [],
    increase_probability: Array.isArray((constraint.effect as Record<string, unknown> | undefined)?.increase_probability)
      ? ((constraint.effect as Record<string, unknown>).increase_probability as Array<{ failure_mode_id: string; delta: number }>)
          .map((entry) => ({
            failure_mode_id: normalizeFailureModeId(entry.failure_mode_id),
            delta: Number(entry.delta)
          }))
          .filter((entry) => failureModeIdSet.has(entry.failure_mode_id))
      : []
  },
  description: String(constraint.description)
}));

function normalizeSupplementalConstraints(source: Array<Record<string, unknown>>): SupplementalConstraint[] {
  return source.map((constraint) => ({
    id: String(constraint.id),
    if: (constraint.if ?? {}) as Record<string, string>,
    then_exclude_components: Array.isArray(constraint.then_exclude_components)
      ? (constraint.then_exclude_components as string[])
          .map((componentId) => normalizeComponentId(componentId))
          .filter((componentId) => componentIdSet.has(componentId))
      : undefined,
    then_focus_components: Array.isArray(constraint.then_focus_components)
      ? (constraint.then_focus_components as string[])
          .map((componentId) => normalizeComponentId(componentId))
          .filter((componentId) => componentIdSet.has(componentId))
      : undefined,
    then_reduce_failure_modes: constraint.then_reduce_failure_modes
      ? Object.fromEntries(
          Object.entries(constraint.then_reduce_failure_modes as Record<string, number>)
            .map(([failureModeId, value]) => [normalizeFailureModeId(failureModeId), Number(value)])
            .filter((entry): entry is [string, number] => failureModeIdSet.has(String(entry[0])))
        )
      : undefined,
    then_increase_failure_modes: constraint.then_increase_failure_modes
      ? Object.fromEntries(
          Object.entries(constraint.then_increase_failure_modes as Record<string, number>)
            .map(([failureModeId, value]) => [normalizeFailureModeId(failureModeId), Number(value)])
            .filter((entry): entry is [string, number] => failureModeIdSet.has(String(entry[0])))
        )
      : undefined,
    reason: String(constraint.reason)
  }));
}

const electricalConstraints = normalizeSupplementalConstraints(
  electricalConstraintsJson.electrical_constraints as Array<Record<string, unknown>>
);

const hydraulicConstraints = normalizeSupplementalConstraints(
  hydraulicConstraintsJson.hydraulic_constraints as Array<Record<string, unknown>>
);

const logicRules = (logicRulesJson.logic_rules as Array<Record<string, unknown>>).map((rule) => ({
  if_text_contains: Array.isArray(rule.if_text_contains) ? (rule.if_text_contains as string[]).map((value) => String(value)) : [],
  if_cluster: typeof rule.if_cluster === "string" ? normalizeClusterKey(String(rule.if_cluster)) : undefined,
  then_increase_failure_modes: rule.then_increase_failure_modes
    ? Object.fromEntries(
        Object.entries(rule.then_increase_failure_modes as Record<string, number>)
          .map(([failureModeId, value]) => [normalizeFailureModeId(failureModeId), Number(value)])
          .filter((entry): entry is [string, number] => failureModeIdSet.has(String(entry[0])))
      )
    : {},
  then_reduce_failure_modes: rule.then_reduce_failure_modes
    ? Object.fromEntries(
        Object.entries(rule.then_reduce_failure_modes as Record<string, number>)
          .map(([failureModeId, value]) => [normalizeFailureModeId(failureModeId), Number(value)])
          .filter((entry): entry is [string, number] => failureModeIdSet.has(String(entry[0])))
      )
    : {},
  reason: String(rule.reason)
}));

const variantConstraints = (variantConstraintsJson.variant_constraints as Array<Record<string, unknown>>).map((constraint) => ({
  component: normalizeComponentId(String(constraint.component)),
  exists_in: Array.isArray(constraint.exists_in) ? (constraint.exists_in as string[]).map((value) => String(value)) : [],
  reason: String(constraint.reason)
})).filter((constraint) => componentIdSet.has(constraint.component));

const componentDiagnosticValues = new Map(
  (componentDiagnosticValueJson.diagnostic_value as Array<Record<string, unknown>>)
    .map((entry) => [normalizeComponentId(String(entry.component)), Number(entry.value)] as const)
    .filter(([componentId]) => componentIdSet.has(componentId))
);

const clusterToComponentMap = new Map(
  (clusterToComponentMapJson.cluster_map as Array<Record<string, unknown>>).map((entry) => [
    normalizeClusterKey(String(entry.cluster)),
    {
      components_ranked: Array.isArray(entry.components_ranked)
        ? (entry.components_ranked as string[])
            .map((componentId) => normalizeComponentId(componentId))
            .filter((componentId) => componentIdSet.has(componentId))
        : [],
      reason: String(entry.reason ?? "")
    }
  ])
);

const componentMetadataById = new Map(
  (componentMetadataJson.components as Array<Record<string, unknown>>).map((component) => {
    const id = normalizeComponentId(String(component.id));
    return [
      id,
      {
        id,
        type: String(component.type),
        location: String(component.location ?? ""),
        feeds: Array.isArray(component.feeds) ? (component.feeds as string[]).map((feed) => normalizeComponentId(feed)) : [],
        downstream: Array.isArray(component.downstream)
          ? (component.downstream as string[]).map((downstream) => normalizeComponentId(downstream))
          : [],
        vibration_risk: Number(component.vibration_risk ?? 0),
        moisture_risk: Number(component.moisture_risk ?? 0)
      } satisfies ComponentMetadata
    ] as const;
  }).filter((entry): entry is readonly [string, ComponentMetadata] => componentIdSet.has(entry[0]))
);

const componentRelations = (componentRelationsJson.relations as Array<Record<string, unknown>>)
  .map<ComponentRelation>((relation) => ({
    type: String(relation.type),
    from: normalizeComponentId(String(relation.from)),
    to: normalizeComponentId(String(relation.to))
  }))
  .filter((relation) => componentIdSet.has(relation.from) && componentIdSet.has(relation.to));

const diagnosticSteps = new Map(
  (diagnosticStepsJson.diagnostic_steps as Array<Record<string, unknown>>).map((step) => [
    String(step.id),
    {
      id: String(step.id),
      action: String(step.action),
      description: String(step.description ?? ""),
      type: String(step.type ?? "inspect"),
      target_component: normalizeComponentId(String(step.target_component ?? ""))
    } satisfies DiagnosticStepRecord
  ])
);

const stepRequirements = new Map(
  (stepRequirementsJson.step_requirements as Array<Record<string, unknown>>)
    .map((requirement) => {
      const stepId = String(requirement.step_id ?? requirement.id ?? "");
      if (!stepId) {
        return null;
      }
      return [
        stepId,
        {
          step_id: stepId,
          tools: Array.isArray(requirement.tools) ? (requirement.tools as string[]).map((tool) => String(tool)) : [],
          safety: Array.isArray(requirement.safety) ? (requirement.safety as string[]).map((item) => String(item)) : [],
          vehicle_state: String(requirement.vehicle_state ?? "unknown"),
          estimated_time_min: Number(requirement.estimated_time_min ?? 0),
          difficulty: Number(requirement.difficulty ?? 0)
        } satisfies StepRequirementRecord
      ] as const;
    })
    .filter((entry): entry is readonly [string, StepRequirementRecord] => entry !== null)
);

const stepEffects = new Map(
  (stepEffectsJson.step_effects as Array<Record<string, unknown>>).map((effect) => [
    String(effect.step_id),
    {
      step_id: String(effect.step_id),
      if_pass: effect.if_pass
        ? {
            exclude_failure_modes: Array.isArray((effect.if_pass as Record<string, unknown>).exclude_failure_modes)
              ? ((effect.if_pass as Record<string, unknown>).exclude_failure_modes as string[])
                  .map((failureModeId) => normalizeFailureModeId(failureModeId))
                  .filter((failureModeId) => failureModeIdSet.has(failureModeId))
              : [],
            reduce_failure_modes: (effect.if_pass as Record<string, unknown>).reduce_failure_modes
              ? Object.fromEntries(
                  Object.entries((effect.if_pass as Record<string, unknown>).reduce_failure_modes as Record<string, number>)
                    .map(([failureModeId, value]) => [normalizeFailureModeId(failureModeId), Number(value)])
                    .filter((entry): entry is [string, number] => failureModeIdSet.has(String(entry[0])))
                )
              : {}
          }
        : undefined,
      if_fail: effect.if_fail
        ? {
            increase_failure_modes: (effect.if_fail as Record<string, unknown>).increase_failure_modes
              ? Object.fromEntries(
                  Object.entries((effect.if_fail as Record<string, unknown>).increase_failure_modes as Record<string, number>)
                    .map(([failureModeId, value]) => [normalizeFailureModeId(failureModeId), Number(value)])
                    .filter((entry): entry is [string, number] => failureModeIdSet.has(String(entry[0])))
                )
              : {},
            exclude_components: Array.isArray((effect.if_fail as Record<string, unknown>).exclude_components)
              ? ((effect.if_fail as Record<string, unknown>).exclude_components as string[])
                  .map((componentId) => normalizeComponentId(componentId))
                  .filter((componentId) => componentIdSet.has(componentId))
              : [],
            exclude_components_downstream: Array.isArray((effect.if_fail as Record<string, unknown>).exclude_components_downstream)
              ? ((effect.if_fail as Record<string, unknown>).exclude_components_downstream as string[])
                  .map((componentId) => normalizeComponentId(componentId))
                  .filter((componentId) => componentIdSet.has(componentId))
              : []
          }
        : undefined
    } satisfies StepEffectRecord
  ])
);

const baseFlows = new Map(
  (baseFlowsJson.base_flows as Array<Record<string, unknown>>).map((flow) => [
    CLUSTER_FLOW_ALIASES[normalizeClusterKey(String(flow.cluster))] ?? normalizeClusterKey(String(flow.cluster)),
    {
      cluster: CLUSTER_FLOW_ALIASES[normalizeClusterKey(String(flow.cluster))] ?? normalizeClusterKey(String(flow.cluster)),
      flow: Array.isArray(flow.flow) ? (flow.flow as string[]).map((stepId) => String(stepId)) : []
    } satisfies BaseFlowRecord
  ])
);

const eflFlows = new Map(
  (eflJson as Array<Record<string, unknown>>).map((flow) => [
    normalizeFailureModeId(String(flow.failure_object_id)),
    {
      id: String(flow.id),
      failure_object_id: normalizeFailureModeId(String(flow.failure_object_id)),
      steps: Array.isArray(flow.steps)
        ? (flow.steps as Array<Record<string, unknown>>).map((step) => ({
            step_id: Number(step.step_id),
            action: String(step.action),
            reason: String(step.reason ?? ""),
            tool: typeof step.tool === "string" ? step.tool : undefined
          }))
        : []
    } satisfies EflFlowRecord
  ])
);

const alwaysAbsentComponents = new Set(
  variantConstraints.filter((constraint) => constraint.exists_in.length === 0).map((constraint) => constraint.component)
);

function findDuplicateValues(values: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }
    seen.add(value);
  }

  return Array.from(duplicates).sort();
}

const dataIntegrityErrors: string[] = [];
const dataIntegrityWarnings: string[] = [];

const duplicateDriverSymptoms = findDuplicateValues(driverSymptoms.map((symptom) => symptom.des_id));
const duplicateTechnicianSymptoms = findDuplicateValues(technicianSymptoms.map((symptom) => symptom.ts_id));
const duplicateMappings = findDuplicateValues(desTsMappings.map((mapping) => mapping.map_id));
const duplicateMappingDesIds = findDuplicateValues(desTsMappings.map((mapping) => mapping.des_id));

for (const desId of duplicateDriverSymptoms) {
  dataIntegrityErrors.push(`Duplicate driver symptom id: ${desId}`);
}
for (const tsId of duplicateTechnicianSymptoms) {
  dataIntegrityErrors.push(`Duplicate technician symptom id: ${tsId}`);
}
for (const mapId of duplicateMappings) {
  dataIntegrityErrors.push(`Duplicate DES->TS map id: ${mapId}`);
}
for (const desId of duplicateMappingDesIds) {
  dataIntegrityErrors.push(`Multiple DES->TS mappings found for DES id: ${desId}`);
}

for (const mapping of desTsMappings) {
  const subsystem = symptomSubsystemsById.get(mapping.subsystem_id);
  const driverSymptom = driverSymptomsById.get(mapping.des_id);

  if (!subsystem) {
    dataIntegrityErrors.push(`Unknown subsystem in DES->TS mapping: ${mapping.map_id} -> ${mapping.subsystem_id}`);
  }

  if (!driverSymptom) {
    dataIntegrityErrors.push(`Unknown DES id in DES->TS mapping: ${mapping.map_id} -> ${mapping.des_id}`);
  } else if (driverSymptom.subsystem_id !== mapping.subsystem_id) {
    dataIntegrityErrors.push(
      `DES subsystem mismatch in ${mapping.map_id}: ${mapping.des_id} belongs to ${driverSymptom.subsystem_id}, mapping uses ${mapping.subsystem_id}`
    );
  }

  for (const link of mapping.ts_links) {
    const technicianSymptom = technicianSymptomsById.get(link.ts_id);
    if (!technicianSymptom) {
      dataIntegrityErrors.push(`Unknown TS id in DES->TS mapping: ${mapping.map_id} -> ${link.ts_id}`);
      continue;
    }

    if (technicianSymptom.subsystem_id !== mapping.subsystem_id) {
      dataIntegrityErrors.push(
        `TS subsystem mismatch in ${mapping.map_id}: ${link.ts_id} belongs to ${technicianSymptom.subsystem_id}, mapping uses ${mapping.subsystem_id}`
      );
    }

    if (link.strength < 0 || link.strength > 5 || link.uniqueness < 0 || link.uniqueness > 5) {
      dataIntegrityErrors.push(`Out-of-range DES->TS weights in ${mapping.map_id} for ${link.ts_id}`);
    }
  }
}

for (const cluster of symptomClusters) {
  if (cluster.related_component_ids.length === 0) {
    dataIntegrityWarnings.push(`Cluster without canonical component refs after normalization: ${cluster.id}`);
  }
}

const dataIntegrityReport = {
  errors: dataIntegrityErrors,
  warnings: dataIntegrityWarnings,
};

export const eflDataIntegrityOk = dataIntegrityErrors.length === 0;

export function assertEflDataIntegrity(): void {
  if (eflDataIntegrityOk) {
    return;
  }

  throw new Error(`EFL_DATA_INTEGRITY_FAILED\n${dataIntegrityErrors.join("\n")}`);
}

export const eflData = {
  manifest: VERSION_MANIFEST,
  dataIntegrityOk: eflDataIntegrityOk,
  dataIntegrityReport,
  schema: schemaJson,
  efDiagnosticSchema: efDiagnosticSchemaJson,
  componentTree: componentTreeJson,
  components,
  componentsById,
  failureModes,
  failureModesById,
  symptomSubsystems,
  symptomSubsystemsById,
  driverSymptoms,
  driverSymptomsById,
  technicianSymptoms,
  technicianSymptomsById,
  desTsMappings,
  desTsMappingsByDesId,
  symptomClusters,
  clustersById,
  clustersByKey,
  clusterKeywords,
  canonicalConstraints,
  electricalConstraints,
  hydraulicConstraints,
  logicRules,
  variantConstraints,
  alwaysAbsentComponents,
  componentDiagnosticValues,
  clusterToComponentMap,
  componentMetadataById,
  componentRelations,
  diagnosticSteps,
  stepRequirements,
  stepEffects,
  baseFlows,
  eflFlows,
  flowClusterKey(clusterId: string): string {
    const normalized = normalizeClusterKey(clusterId);
    return CLUSTER_FLOW_ALIASES[normalized] ?? normalized;
  }
};
