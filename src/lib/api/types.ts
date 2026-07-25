/**
 * API Types for EFL-Core Backend
 * Based on OpenAPI schema models: DiagnoseRequest, DiagnoseResponse, FailureModeResponse, DiagnosisExplanation
 */

// Request Types
export interface DiagnoseRequest {
    symptom_text: string;
    photo_data_uri?: string;
    case_id?: string;
    context?: {
        motor_on: boolean;
        pto_on: boolean;
        rain: boolean;
        frost: boolean;
        heavy_load: boolean;
    };
}

export interface CaseResponse {
    case_id: string;
    status: string;
    vehicle_id: string;
}

export interface PolicyEnvelope<T> {
    manifest_id: string;
    decision_id: string;
    policy_version: string;
    data: T;
}

// Response Types
export interface FailureModeResponse {
    id: string;
    component_id: string;
    severity: number;
    likelihood: number;
    description: string;
}

export interface LocationGuess {
    component_id: string;
    location_hint: string;
    access_hint: string;
}

export interface DiagnosisStep {
    step_id: string;
    action: string;
    reason: string;
    eliminates: string[];
    expected_observation: string;
    next: string;
}

export interface RootCauseCandidate {
    fo_id: string;
    id?: string; // Alternative for fo_id
    confidence: number;
    likelihood?: number; // Alternative for confidence
    why: string;
}

export interface DiagnoseResponse {
    diagnosis_id?: string;
    case_id?: string;
    status?: 'ranked' | 'knowledge_gap' | 'clarification_required';
    diagnosis_status?: 'ranked' | 'knowledge_gap' | 'clarification_required';
    clarification_required?: boolean;
    subdomain?: string;
    symptom_cluster?: string;
    symptom_cluster_name?: string;
    symptom_cluster_description?: string;
    clarification_prompt?: string;
    clarification_options?: string[];
    clarification_questions?: string[];
    knowledge_gap_reason?: string;
    matched_des_ids?: string[];
    steps?: DiagnosisStep[];
    guided_flow?: DiagnosisStep[]; // New key from backend
    root_cause_ranking?: RootCauseCandidate[];
    candidates?: RootCauseCandidate[]; // Alternative for root_cause_ranking
    recommended_actions?: string[];
    confidence_score?: number;
    ts_score_breakdown?: Array<{
        ts_id: string;
        subsystem_id: string;
        score: number;
        source: string[];
    }>;
    constraint_trace?: {
        canonical_constraints: Array<ConstraintTraceEntry>;
        electrical_constraints: Array<ConstraintTraceEntry>;
        hydraulic_constraints: Array<ConstraintTraceEntry>;
        variant_constraints: Array<ConstraintTraceEntry>;
        logic_rules: Array<ConstraintTraceEntry>;
    };
    audit_sync_state?: 'synced' | 'buffered_offline' | 'sync_failed';
    audit_record_hash?: string;
    previous_record_hash?: string | null;
    failure_modes?: FailureModeResponse[];
    location_guess?: LocationGuess;
    applied_constraints?: string[];
    dds_case?: {
        metadata: {
            case_id: string;
            timestamp_start: string;
            timestamp_end: string;
            duration_minutes?: number;
            ef_version?: string;
            data_quality_score: 'A' | 'B' | 'C';
        };
        vehicle: {
            vehicle_type?: string;
            oem?: string;
            model?: string;
        };
        environment: {
            weather?: string;
            ambient_temp?: string;
            vehicle_load_state?: string;
        };
        symptoms: {
            symptom_primary: string;
            symptom_secondary?: string;
            symptom_description_freeform?: string;
        };
        dtc_layer: {
            dtc_list_raw: string[];
            dtc_confidence: number;
        };
        can_layer: {
            can_signature_id?: string;
            can_anomaly_score?: number;
        };
        failure_resolution: {
            failure_mode_final: string;
            failure_chain_path: string[];
            root_cause_category: string;
            root_cause_specific?: string;
            failure_likelihood_score?: number;
            confidence_total: number;
        };
        repair: {
            repair_actions_taken?: string[];
            components_replaced?: string[];
            recommended_actions?: string[];
            guided_flow?: string[];
        };
        outcome: {
            selected_subdomain?: string;
            symptom_cluster_id?: string;
            symptom_cluster_name?: string;
        };
        privacy: {
            privacy_audit_pass?: boolean;
            photo_attached?: boolean;
        };
    };
    audit_trail?: {
        engine_version: string;
        config_version: string;
        execution_signature: string;
        episode_fingerprint: string;
        rule_versions: Record<string, string>;
        dataset_versions: Record<string, string>;
        execution_plan: string[];
        config_used: Record<string, unknown>;
        debug_log: Array<{
            rule_name: string;
            duration_ms: number;
            input_events: number;
            output_events: number;
            config_used?: Record<string, unknown>;
        }>;
        input_snapshot: {
            case_id: string;
            symptom_text: string;
            normalized_text: string;
            context: {
                motor_on: boolean;
                pto_on: boolean;
                rain: boolean;
                frost: boolean;
                heavy_load: boolean;
            };
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
        constraint_hits: Array<ConstraintTraceEntry>;
        constraint_trace: {
            canonical_constraints: Array<ConstraintTraceEntry>;
            electrical_constraints: Array<ConstraintTraceEntry>;
            hydraulic_constraints: Array<ConstraintTraceEntry>;
            variant_constraints: Array<ConstraintTraceEntry>;
            logic_rules: Array<ConstraintTraceEntry>;
        };
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
}

export interface ConstraintTraceEntry {
    id: string;
    stage:
        | 'canonical_constraints'
        | 'electrical_constraints'
        | 'hydraulic_constraints'
        | 'variant_constraints'
        | 'logic_rules';
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
}

export interface AuditSyncPayload {
    events: ClientAuditEvent[];
}

export interface ClientAuditEvent {
    event_id: string;
    event_type: 'diagnosis_started' | 'diagnosis_completed' | 'diagnosis_failed';
    created_at: string;
    execution_signature: string;
    payload_hash: string;
    previous_event_hash: string | null;
    case_id?: string | null;
    diagnosis_id?: string | null;
    payload: Record<string, unknown>;
}

export interface AuditSyncResponse {
    accepted: number;
    duplicate: number;
    failed: number;
    synced_event_ids: string[];
    durable_sink_state?: 'not_configured' | 'forwarded' | 'forward_failed';
    durable_sink_accepted?: number;
}

export type AuditSyncState = 'synced' | 'buffered_offline' | 'sync_failed';

// Message type for chat functionality
export interface Message {
    role: 'user' | 'model' | 'system' | 'tool';
    content: string;
}

export type WerkbonStatus = 'open' | 'afgerond';
export type FactuurStatus = 'concept' | 'gefinaliseerd';
export type GrootboekType = 'debet' | 'credit';

export interface WerkbonRegel {
    id?: string;
    omschrijving: string;
    uren: number;
    uurtarief: number;
    onderdeel_code?: string | null;
    onderdeel_prijs: number;
    regel_totaal?: number;
}

export interface WerkbonResponseData {
    werkbon_id: string;
    voertuig_id: string;
    root_cause: string;
    status: WerkbonStatus;
    aangemaakt_at: string;
    afgerond_at: string | null;
}

export interface WerkbonRegelResponseData {
    werkbon_id: string;
    werkbon_regel_id: string;
    status: WerkbonStatus;
    regel: WerkbonRegel;
    werkbon_subtotaal: number;
}

export interface WerkbonAfrondenResponseData {
    werkbon_id: string;
    status: WerkbonStatus;
    afgerond_at: string | null;
}

export interface GrootboekPost {
    id: string;
    factuur_id?: string;
    type: GrootboekType;
    rekening: string;
    bedrag: number;
    geboekt_at: string;
}

export interface FactuurResponseData {
    factuur_id: string;
    werkbon_id: string;
    status: FactuurStatus;
    factuurnummer: string;
    subtotaal: number;
    btw: number;
    totaal: number;
    aangemaakt_at: string;
    gefinaliseerd_at: string | null;
}

export interface FactuurFinalizeResponseData extends FactuurResponseData {
    grootboek_balans_ok: boolean;
    grootboek_posten: GrootboekPost[];
}

export interface FactuurDetailResponseData extends FactuurResponseData {
    grootboek_balans_ok: boolean;
    werkbon: {
        werkbon_id: string;
        status: WerkbonStatus;
        root_cause: string;
        afgerond_at: string | null;
    } | null;
    regels: WerkbonRegel[];
    grootboek_posten: GrootboekPost[];
}

// API Error Response
export interface ApiError {
    detail?: string;
    message?: string;
}

// Generic API Response wrapper
export interface ApiResponse<T> {
    data: T | null;
    error: string | null;
    statusCode?: number;
}
