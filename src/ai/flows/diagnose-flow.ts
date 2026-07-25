'use server';

/**
 * Legacy adapter kept only for compatibility with older imports.
 *
 * Diagnostic prioritization is no longer allowed in the AI layer.
 * This adapter delegates to the deterministic EFL core and returns
 * the legacy DiagnoseOutput shape without DDS/audit payloads.
 *
 * Do not import this module from active production entrypoints.
 * The authoritative diagnosis path is:
 * - src/app/api/efl-core/diagnose/route.ts
 * - src/efl_core/engine.ts
 */

import { runDeterministicDiagnosis } from "@/efl_core/engine";
import type { DiagnoseInput, DiagnoseOutput } from "./types";

export async function diagnose(input: DiagnoseInput): Promise<DiagnoseOutput> {
  const result = await runDeterministicDiagnosis({
    symptomDescription: input.symptomDescription,
    photoDataUri: input.photoDataUri,
  });

  if (result.diagnosis_status === "knowledge_gap" || result.diagnosis_status === "clarification_required") {
    return {
      subdomain: result.subdomain ?? "unknown",
      symptom_cluster: result.symptom_cluster ?? "SC_UNKNOWN",
      steps: result.steps ?? [],
      root_cause_ranking: [],
      recommended_actions: result.recommended_actions ?? [],
      confidence_score: 0,
      failure_modes: result.failure_modes ?? [],
      location_guess: undefined,
    };
  }

  return {
    subdomain: result.subdomain ?? "unknown",
    symptom_cluster: result.symptom_cluster ?? "SC_UNKNOWN",
    steps: result.steps ?? [],
    root_cause_ranking: result.root_cause_ranking ?? [],
    recommended_actions: result.recommended_actions ?? [],
    confidence_score: result.confidence_score ?? 0,
    failure_modes: result.failure_modes ?? [],
    location_guess: result.location_guess,
  };
}
