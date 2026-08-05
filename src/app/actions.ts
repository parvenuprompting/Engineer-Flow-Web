"use server";

import { runDeterministicDiagnosis } from "@/efl_core/engine";
import { generateOfflineCaseTitles, generateOfflineExpertChatResponse } from "@/efl_core/offline_assist";
import type { DiagnoseInput, ExpertChatInput, ExpertChatOutput, CaseTitleInput } from "@/ai/flows/types";
import type { DiagnoseResponse } from "@/lib/api/types";
import { isFeatureEnabled } from "@/lib/features";


export async function getDiagnosis(
  input: DiagnoseInput
): Promise<{ data: DiagnoseResponse | null; error: string | null }> {
  try {
    const result = await runDeterministicDiagnosis({
      symptomDescription: input.symptomDescription,
      photoDataUri: input.photoDataUri,
    });
    return { data: result, error: null };
  } catch (e: unknown) {
    console.error("Diagnosis engine failed:", e);
    const errorMessage = e instanceof Error ? e.message : "An unexpected error occurred during diagnosis.";
    return { data: null, error: `Diagnose-engine is mislukt. Details: ${errorMessage}` };
  }
}

export async function getExpertChatResponse(
  input: ExpertChatInput
): Promise<{ data: ExpertChatOutput | null; error: string | null }> {
  try {
    const { expertChat } = await import("@/ai/flows/expert-chat-flow");
    const result = await expertChat(input);
    return { data: result, error: null };
  } catch (e: unknown) {
    console.error("Expert chat flow failed:", e);
    const fallback = generateOfflineExpertChatResponse(input);
    return { data: fallback, error: null };
  }
}

export async function getCaseTitle(
    input: CaseTitleInput
  ): Promise<{ data: string | null; error: string | null }> {
    try {
      const { generateCaseTitle } = await import("@/ai/flows/case-title-flow");
      const titles = await generateCaseTitle(input);
      // Return the first and presumably best title, or a fallback.
      const bestTitle = titles[0] || generateOfflineCaseTitles(input)[0] || "Ongetitelde Diagnose";
      return { data: bestTitle, error: null };
    } catch (e: unknown) {
      console.error("Case title generation failed:", e);
      const fallback = generateOfflineCaseTitles(input)[0] || "Ongetitelde Diagnose";
      return { data: fallback, error: null };
    }
  }

// This is now a simulated function
export async function runCanAnalysis(
  formData: FormData
): Promise<{ data: any | null; error: string | null }> {
    if (!isFeatureEnabled("canAnalysis")) {
        return { data: null, error: "CAN-analyse is momenteel niet beschikbaar in de productieversie." };
    }

    const logFile = formData.get("logFile") as File;
    const vehicleId = formData.get("vehicleId") as string;

    if (!logFile || !vehicleId) {
        return { data: null, error: "Logbestand of Voertuig ID ontbreekt." };
    }

    // Simulate a delay for processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Return a static, simulated result for the demo
    const simulatedResult = {
        "episode_id": "EPI-DEMO-SIMULATED",
        "vehicle_id": vehicleId,
        "trip_id": null,
        "events": [
        {
            "event_id": "EVT-DUMMY-VOLT",
            "event_type": "voltage_drop",
            "severity": "medium",
            "timestamp_start": 1672578200000,
            "timestamp_end": 1672578250000,
            "source_rule_id": "R-VOLT-01-SIM",
            "metadata": {
            "min_voltage": 10.2,
            "duration_ms": 50000,
            "threshold": 10.5
            },
            "context": {
            "avg_rpm": 800
            }
        }
        ],
        "features": {
        "num_events": 1,
        "num_voltage_drops": 1
        }
    };
    
    return { data: simulatedResult, error: null };
}
