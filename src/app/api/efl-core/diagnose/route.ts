import { NextResponse } from "next/server";
import { runDeterministicDiagnosis } from "@/efl_core/engine";
import { getEflHealthSnapshot } from "@/efl_core/health";
import { createCaseRecord, getAuditStoreHealth, getCaseRecord, storeDiagnosisAuditRecord } from "../_store";
import { requireEflAuth } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DiagnoseRequest = {
  symptom_text?: string;
  symptomDescription?: string;
  text?: string;
  description?: string;
  query?: string;
  photo_data_uri?: string;
  photoDataUri?: string;
  vehicle_id?: string;
  vehicleId?: string;
  case_id?: string;
  caseId?: string;
  context?: {
    motor_on?: boolean;
    pto_on?: boolean;
    rain?: boolean;
    frost?: boolean;
    heavy_load?: boolean;
  };
};

export async function POST(req: Request) {
  const authResult = await requireEflAuth(req);
  if (authResult instanceof Response) return authResult;
  const auth = authResult;
  try {
    const auditStoreHealth = getAuditStoreHealth();
    const healthSnapshot = getEflHealthSnapshot(auditStoreHealth.audit_store_ok);
    if (!healthSnapshot.integrity_ok) {
      return NextResponse.json(
        {
          code: "EFL_CORE_UNHEALTHY",
          detail: "Canonieke datasets of version manifest zijn niet valide. Diagnose is fail-closed geblokkeerd.",
          health: healthSnapshot,
        },
        { status: 503 }
      );
    }

    const payload = (await req.json()) as DiagnoseRequest;
    const symptomText =
      payload?.symptom_text ||
      payload?.symptomDescription ||
      payload?.text ||
      payload?.description ||
      payload?.query ||
      "";

    if (!symptomText || symptomText.trim().length < 3) {
      return NextResponse.json(
        { detail: "symptom_text is verplicht (minimaal 3 tekens)" },
        { status: 400 }
      );
    }

    const requestedCaseId = payload?.case_id || payload?.caseId;
    const vehicleId = payload?.vehicle_id || payload?.vehicleId || "vehicle-unknown";
    const existingCase = requestedCaseId ? getCaseRecord(requestedCaseId) : null;
    if (existingCase && existingCase.owner_uid !== auth.uid) {
      return NextResponse.json({ code: "FORBIDDEN", detail: "Geen toegang tot deze case." }, { status: 403 });
    }
    const resolvedCaseId = existingCase?.case_id ?? createCaseRecord(vehicleId, auth.uid, auth.garageId).case_id;

    const result = await runDeterministicDiagnosis({
      symptomDescription: symptomText.trim(),
      photoDataUri: payload?.photo_data_uri || payload?.photoDataUri,
      caseId: resolvedCaseId,
      context: payload?.context,
    });

    const storedAuditRecord = storeDiagnosisAuditRecord({
      diagnosis_id: result.diagnosis_id,
      case_id: result.case_id,
      symptom_text: symptomText.trim(),
      created_at: new Date().toISOString(),
      response_summary: {
        symptom_cluster: result.symptom_cluster || "SC_UNKNOWN",
        top_failure_mode: result.root_cause_ranking?.[0]?.fo_id || null,
        confidence_score: result.confidence_score || 0,
      },
      dds_case: result.dds_case,
      audit_trail: result.audit_trail,
    });

    return NextResponse.json(
      {
        ...result,
        audit_sync_state: "synced",
        audit_record_hash: storedAuditRecord.record_hash,
        previous_record_hash: storedAuditRecord.previous_record_hash ?? null,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Diagnose endpoint fout";
    const status = message.startsWith("EFL_CORE_UNHEALTHY") || message.startsWith("EFL_DATA_INTEGRITY_FAILED") || message.startsWith("EFL_VERSION_MANIFEST_INVALID")
      ? 503
      : 500;
    const code =
      status === 503
        ? "EFL_CORE_UNHEALTHY"
        : "DIAGNOSE_ENDPOINT_ERROR";
    return NextResponse.json({ code, detail: message }, { status });
  }
}
