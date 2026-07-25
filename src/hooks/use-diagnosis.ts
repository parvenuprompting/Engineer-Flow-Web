/**
 * Hook for managing diagnosis state and API communication
 */

import { useState } from 'react';
import { diagnose, createCase } from '@/lib/api/client';
import type { DiagnoseRequest, DiagnoseResponse } from '@/lib/api/types';

export interface UseDiagnosisResult {
    isLoading: boolean;
    result: DiagnoseResponse | null;
    error: string | null;
    activeCaseId: string | null;
    executeDiagnosis: (request: DiagnoseRequest) => Promise<void>;
    reset: () => void;
    initializeCase: (vehicleId: string) => Promise<string | null>;
}

export function useDiagnosis(): UseDiagnosisResult {
    const [isLoading, setIsLoading] = useState(false);
    const [result, setResult] = useState<DiagnoseResponse | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [activeCaseId, setActiveCaseId] = useState<string | null>(null);

    const initializeCase = async (vehicleId: string): Promise<string | null> => {
        try {
            const response = await createCase(vehicleId);
            if (response.data) {
                setActiveCaseId(response.data.case_id);
                return response.data.case_id;
            }
            return null;
        } catch (err) {
            console.error('Error initializing case:', err);
            return null;
        }
    };

    const executeDiagnosis = async (request: DiagnoseRequest) => {
        setIsLoading(true);
        setError(null);
        setResult(null);

        try {
            // Ensure we have a case ID
            let caseId = activeCaseId;
            if (!caseId) {
                // Default vehicle ID if none provided, ideally pass this through
                caseId = await initializeCase("TRUCK-MVP-01");
            }

            const response = await diagnose({
                ...request,
                case_id: caseId || undefined
            });

            if (response.error) {
                setError(response.error);
            } else if (response.data) {
                setResult(response.data);
            }
        } catch (err) {
            setError(
                err instanceof Error
                    ? err.message
                    : 'Er is een onverwachte fout opgetreden.'
            );
        } finally {
            setIsLoading(false);
        }
    };

    const reset = () => {
        setIsLoading(false);
        setResult(null);
        setError(null);
    };

    return {
        isLoading,
        result,
        error,
        activeCaseId,
        executeDiagnosis,
        reset,
        initializeCase,
    };
}
