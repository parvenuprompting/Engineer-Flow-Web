import type { DiagnoseResponse, DiagnosisStep } from "@/lib/api/types";

export type DiagnosisContext = {
  motor_on: boolean;
  pto_on: boolean;
  rain: boolean;
  frost: boolean;
  heavy_load: boolean;
};

export type DeterministicDiagnoseInput = {
  symptomDescription: string;
  photoDataUri?: string;
  caseId?: string | null;
  vehicleId?: string | null;
  context?: Partial<DiagnosisContext>;
};

export type DataQualityScore = "A" | "B" | "C";

export type DriverSymptom = {
  des_id: string;
  category: string;
  description: string;
  subsystem_id: string;
  subsystem_name: string;
};

export type TechnicianSymptom = {
  ts_id: string;
  category: string;
  description: string;
  subsystem_id: string;
  subsystem_name: string;
};

export type SymptomSubsystem = {
  id: string;
  name: string;
  driver_symptoms: DriverSymptom[];
  technician_symptoms: TechnicianSymptom[];
};

export type DesTsLink = {
  ts_id: string;
  strength: number;
  uniqueness: number;
};

export type DesTsMapping = {
  map_id: string;
  des_id: string;
  subsystem_id: string;
  ts_links: DesTsLink[];
};

export type MatchedDriverSymptom = {
  des_id: string;
  subsystem_id: string;
  score: number;
  category: string;
  description: string;
  match_reason: string;
};

export type SymptomBridgeStatus = "matched" | "clarification_required" | "knowledge_gap";

export type TsScoreContribution = {
  des_id: string;
  map_id: string;
  des_match_score: number;
  mapping_score: number;
  contribution: number;
};

export type TechnicianSymptomScore = {
  ts_id: string;
  subsystem_id: string;
  category: string;
  description: string;
  score: number;
  contributions: TsScoreContribution[];
};

export type SubsystemScore = {
  subsystem_id: string;
  subsystem_name: string;
  score: number;
  matched_des_ids: string[];
  top_ts_ids: string[];
};

export type SymptomBridgeResult = {
  status: SymptomBridgeStatus;
  normalized_text: string;
  accepted_des_ids: string[];
  matched_driver_symptoms: MatchedDriverSymptom[];
  technician_symptom_scores: TechnicianSymptomScore[];
  subsystem_scores: SubsystemScore[];
  clarification_prompt?: string;
  clarification_options?: string[];
  clarification_questions?: string[];
  knowledge_gap_reason?: string;
};

export type DdsCase = {
  metadata: {
    case_id: string;
    timestamp_start: string;
    timestamp_end: string;
    duration_minutes?: number;
    workshop_id?: string;
    technician_id?: string;
    ef_version?: string;
    data_quality_score: DataQualityScore;
  };
  vehicle: {
    vehicle_type?: string;
    oem?: string;
    model?: string;
    year?: number;
    odo_km_band?: string;
    usage_profile?: string;
  };
  environment: {
    ambient_temp?: string;
    weather?: string;
    terrain_load?: string;
    vehicle_load_state?: string;
    operation_context?: string;
    prior_events_last_24h?: string;
  };
  symptoms: {
    symptom_primary: string;
    symptom_secondary?: string;
    symptom_description_freeform?: string;
    warning_lights?: string[];
    vehicle_behavior_change?: string;
  };
  dtc_layer: {
    dtc_list_raw: string[];
    dtc_list_filtered?: string[];
    dtc_noise_score?: number;
    dtc_confidence: number;
    dtc_misleading_flag?: boolean;
    dtc_to_failuremap?: string[];
  };
  can_layer: {
    can_snapshot_before?: Record<string, unknown>;
    can_snapshot_event?: Record<string, unknown>;
    can_snapshot_after?: Record<string, unknown>;
    can_signature_id?: string;
    can_pattern_class?: "A" | "B" | "C";
    can_root_component_likelihood?: Record<string, unknown>;
    can_anomaly_score?: number;
  };
  failure_resolution: {
    failure_mode_final: string;
    failure_chain_path: string[];
    failure_mode_layer?: number;
    root_cause_category: string;
    root_cause_specific?: string;
    failure_likelihood_score?: number;
    confounders_detected?: string[];
    confidence_total: number;
  };
  repair: {
    repair_actions_taken?: string[];
    components_replaced?: string[];
    labor_time_minutes?: number;
    parts_cost_band?: string;
    repair_effectiveness_prelim?: number;
    repair_category?: string;
    recommended_actions?: string[];
    guided_flow?: string[];
  };
  outcome: {
    post_repair_test_result?: string;
    return_after_x_days?: number;
    symptom_resolved?: boolean;
    failure_recurrence_flag?: boolean;
    repair_effectiveness_final?: number;
    selected_subdomain?: string;
    symptom_cluster_id?: string;
    symptom_cluster_name?: string;
  };
  privacy: {
    vehicle_hash?: string;
    workshop_hash?: string;
    privacy_audit_pass?: boolean;
    photo_attached?: boolean;
  };
};

export type AuditLogEntry = {
  rule_name: string;
  duration_ms: number;
  input_events: number;
  output_events: number;
  config_used?: Record<string, unknown>;
};

export type ConstraintTraceEntry = {
  id: string;
  stage:
    | "canonical_constraints"
    | "electrical_constraints"
    | "hydraulic_constraints"
    | "variant_constraints"
    | "logic_rules";
  effect: string;
  reason: string;
  excluded_failure_modes?: string[];
  excluded_components?: string[];
  boosted_failure_modes?: Array<{
    failure_mode_id: string;
    delta: number;
  }>;
  reduced_failure_modes?: Array<{
    failure_mode_id: string;
    delta: number;
  }>;
  focused_components?: string[];
};

export type ConstraintTrace = {
  canonical_constraints: ConstraintTraceEntry[];
  electrical_constraints: ConstraintTraceEntry[];
  hydraulic_constraints: ConstraintTraceEntry[];
  variant_constraints: ConstraintTraceEntry[];
  logic_rules: ConstraintTraceEntry[];
};

export type AuditTrail = {
  engine_version: string;
  config_version: string;
  execution_signature: string;
  episode_fingerprint: string;
  rule_versions: Record<string, string>;
  dataset_versions: Record<string, string>;
  execution_plan: string[];
  config_used: Record<string, unknown>;
  debug_log: AuditLogEntry[];
  input_snapshot: {
    case_id: string;
    symptom_text: string;
    normalized_text: string;
    context: DiagnosisContext;
  };
  derived_signals: {
    measurements: string[];
    conditions: string[];
    observations: string[];
    environments: string[];
    events: string[];
    symptoms: string[];
  };
  des_matches: Array<{
    des_id: string;
    subsystem_id: string;
    score: number;
    description: string;
  }>;
  primary_ts_evidence: Array<{
    ts_id: string;
    subsystem_id: string;
    description: string;
    score: number;
    source_des_ids: string[];
  }>;
  subsystem_scores: Array<{
    subsystem_id: string;
    subsystem_name: string;
    score: number;
    matched_des_ids: string[];
    top_ts_ids: string[];
  }>;
  cluster_scores: Array<{
    cluster_id: string;
    score: number;
    exact_matches: number;
    matched_keywords: string[];
  }>;
  constraint_hits: ConstraintTraceEntry[];
  constraint_trace: ConstraintTrace;
  ts_score_breakdown: Array<{
    ts_id: string;
    subsystem_id: string;
    score: number;
    source: string[];
  }>;
  failure_mode_score_breakdown: Array<{
    failure_mode_id: string;
    component_id: string;
    score: number;
    reasons: string[];
    primary_evidence: string[];
  }>;
};

export type DeterministicDiagnoseResponse = DiagnoseResponse & {
  diagnosis_id: string;
  case_id: string;
  diagnosis_status: "ranked" | "knowledge_gap" | "clarification_required";
  status: "ranked" | "knowledge_gap" | "clarification_required";
  clarification_required: boolean;
  matched_des_ids: string[];
  clarification_questions?: string[];
  knowledge_gap_reason?: string;
  ts_score_breakdown: AuditTrail["ts_score_breakdown"];
  constraint_trace: ConstraintTrace;
  audit_sync_state?: "synced" | "buffered_offline" | "sync_failed";
  audit_record_hash?: string;
  previous_record_hash?: string | null;
  dds_case: DdsCase;
  audit_trail: AuditTrail;
  guided_flow: DiagnosisStep[];
};

export type CanonicalComponent = {
  id: string;
  name: string;
  subsystem: string;
  type: string;
};

export type CanonicalFailureMode = {
  id: string;
  component_id: string;
  severity: number;
  likelihood: number;
  description: string;
};

export type CanonicalSymptomCluster = {
  id: string;
  key: string;
  name: string;
  description: string;
  related_component_ids: string[];
  tags: string[];
};
