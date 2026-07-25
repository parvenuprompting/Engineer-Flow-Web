/**
 * API Client for EFL-Core Backend
 * By default uses local Next API adapter at /api/efl-core.
 * You can override target using NEXT_PUBLIC_EFL_CORE_URL.
 */

import type {
    ApiResponse,
    AuditSyncState,
    CaseResponse,
    DiagnoseRequest,
    DiagnoseResponse,
    FactuurDetailResponseData,
    FactuurFinalizeResponseData,
    FactuurResponseData,
    PolicyEnvelope,
    WerkbonAfrondenResponseData,
    WerkbonRegelResponseData,
    WerkbonResponseData,
} from './types';
import { createClientAuditEvent, queueClientAuditEvent, syncPendingAuditEvents } from '@/lib/audit/offline-audit-queue';

const API_BASE_URL = process.env.NEXT_PUBLIC_EFL_CORE_URL?.trim() || '/api/efl-core';

function buildUrl(path: string): string {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    if (API_BASE_URL.startsWith('http://') || API_BASE_URL.startsWith('https://')) {
        return `${API_BASE_URL}${normalizedPath}`;
    }
    const base = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
    return `${base}${normalizedPath}`;
}

async function parseErrorMessage(response: Response): Promise<string> {
    let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
    try {
        const errorData = await response.json();
        if (errorData?.detail) {
            errorMessage = String(errorData.detail);
        } else if (errorData?.message) {
            errorMessage = String(errorData.message);
        }
    } catch {
        // Fallback to default HTTP message.
    }
    return errorMessage;
}

async function requestJson<T>(
    path: string,
    options: RequestInit & { bodyObj?: unknown } = {}
): Promise<ApiResponse<T>> {
    try {
        const { bodyObj, headers, ...rest } = options;
        const response = await fetch(buildUrl(path), {
            ...rest,
            headers: {
                'Content-Type': 'application/json',
                ...(headers ?? {}),
            },
            body: bodyObj !== undefined ? JSON.stringify(bodyObj) : options.body,
        });

        if (!response.ok) {
            const errorMessage = await parseErrorMessage(response);
            return { data: null, error: errorMessage, statusCode: response.status };
        }

        const data = (await response.json()) as T;
        return { data, error: null, statusCode: response.status };
    } catch (error) {
        return {
            data: null,
            error:
                error instanceof Error
                    ? `Verbinding met EFL-CORE verbroken: ${error.message}`
                    : 'Verbinding met EFL-CORE verbroken. Controleer of de backend server aan staat.',
            statusCode: 500,
        };
    }
}

/**
 * Robust diagnose method that communicates with the /diagnose endpoint
 */
export async function diagnose(
    request: DiagnoseRequest
): Promise<ApiResponse<DiagnoseResponse>> {
    console.log('Sending Diagnosis Request:', request);
    const requestPayload = {
        ...request,
        case_id: request.case_id,
        symptom: request.symptom_text,
        text: request.symptom_text,
        description: request.symptom_text,
        query: request.symptom_text,
    };

    let fallbackExecutionSignature = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    if (typeof window !== 'undefined') {
        const startEvent = await createClientAuditEvent({
            event_type: 'diagnosis_started',
            execution_signature: fallbackExecutionSignature,
            case_id: request.case_id ?? null,
            payload: {
                request: requestPayload,
            },
        });
        await queueClientAuditEvent(startEvent);
    }

    const response = await requestJson<DiagnoseResponse>('/diagnose', {
        method: 'POST',
        bodyObj: requestPayload,
    });

    if (typeof window !== 'undefined') {
        const eventType = response.data ? 'diagnosis_completed' : 'diagnosis_failed';
        const executionSignature = response.data?.audit_trail?.execution_signature || fallbackExecutionSignature;
        const followUpEvent = await createClientAuditEvent({
            event_type: eventType,
            execution_signature: executionSignature,
            case_id: response.data?.case_id ?? request.case_id ?? null,
            diagnosis_id: response.data?.diagnosis_id ?? null,
            payload: response.data
                ? {
                    request: requestPayload,
                    response: {
                        diagnosis_id: response.data.diagnosis_id ?? null,
                        case_id: response.data.case_id ?? null,
                        diagnosis_status: response.data.diagnosis_status ?? null,
                        execution_signature: response.data.audit_trail?.execution_signature ?? null,
                    },
                }
                : {
                    request: requestPayload,
                    error: response.error,
                },
        });
        await queueClientAuditEvent(followUpEvent);
        const syncResult = await syncPendingAuditEvents();
        const auditSyncState: AuditSyncState = syncResult.state;

        if (response.data) {
            response.data = {
                ...response.data,
                audit_sync_state: auditSyncState,
            };
        }
    }

    if (response.data) {
        console.log('Received Diagnosis Response:', response.data);
    }
    return response;
}

/**
 * Health check endpoint to verify backend connectivity
 */
export async function healthCheck(): Promise<boolean> {
    try {
        const response = await fetch(buildUrl('/health'), {
            method: 'GET',
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Creates a new diagnostic case for a vehicle
 */
export async function createCase(vehicleId: string): Promise<ApiResponse<CaseResponse>> {
    console.log('Creating Case for Vehicle:', vehicleId);
    return requestJson<CaseResponse>('/cases', {
        method: 'POST',
        bodyObj: { vehicle_id: vehicleId },
    });
}

/**
 * Confirms the actual fix for a diagnostic case
 */
export async function confirmFix(caseId: string, failureModeId: string): Promise<ApiResponse<{ success: boolean }>> {
    console.log(`Confirming Fix: Case ${caseId}, FailureMode ${failureModeId}`);
    return requestJson<{ success: boolean }>(`/cases/${caseId}/confirm`, {
        method: 'POST',
        bodyObj: { failure_mode_id: failureModeId },
    });
}

export async function createWerkbon(
    voertuigId: string,
    rootCause: string
): Promise<ApiResponse<PolicyEnvelope<WerkbonResponseData>>> {
    return requestJson<PolicyEnvelope<WerkbonResponseData>>('/werkbonnen', {
        method: 'POST',
        bodyObj: {
            voertuig_id: voertuigId,
            root_cause: rootCause,
        },
    });
}

export async function addWerkbonRegel(
    werkbonId: string,
    regel: {
        omschrijving: string;
        uren: number;
        uurtarief: number;
        onderdeel_code?: string | null;
        onderdeel_prijs?: number;
    }
): Promise<ApiResponse<PolicyEnvelope<WerkbonRegelResponseData>>> {
    return requestJson<PolicyEnvelope<WerkbonRegelResponseData>>(`/werkbonnen/${werkbonId}/regels`, {
        method: 'POST',
        bodyObj: {
            omschrijving: regel.omschrijving,
            uren: regel.uren,
            uurtarief: regel.uurtarief,
            onderdeel_code: regel.onderdeel_code ?? null,
            onderdeel_prijs: regel.onderdeel_prijs ?? 0,
        },
    });
}

export async function afrondenWerkbon(
    werkbonId: string
): Promise<ApiResponse<PolicyEnvelope<WerkbonAfrondenResponseData>>> {
    return requestJson<PolicyEnvelope<WerkbonAfrondenResponseData>>(`/werkbonnen/${werkbonId}/afronden`, {
        method: 'POST',
        bodyObj: {},
    });
}

export async function createFactuur(
    werkbonId: string
): Promise<ApiResponse<PolicyEnvelope<FactuurResponseData>>> {
    return requestJson<PolicyEnvelope<FactuurResponseData>>('/facturen', {
        method: 'POST',
        bodyObj: {
            werkbon_id: werkbonId,
        },
    });
}

export async function finaliseerFactuur(
    factuurId: string
): Promise<ApiResponse<PolicyEnvelope<FactuurFinalizeResponseData>>> {
    return requestJson<PolicyEnvelope<FactuurFinalizeResponseData>>(`/facturen/${factuurId}/finaliseren`, {
        method: 'POST',
        bodyObj: {},
    });
}

export async function getFactuur(
    factuurId: string
): Promise<ApiResponse<PolicyEnvelope<FactuurDetailResponseData>>> {
    return requestJson<PolicyEnvelope<FactuurDetailResponseData>>(`/facturen/${factuurId}`, {
        method: 'GET',
    });
}
