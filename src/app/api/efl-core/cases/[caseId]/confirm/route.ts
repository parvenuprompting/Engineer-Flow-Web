import { NextResponse } from "next/server";
import { addCaseConfirmation, getCaseRecord } from "../../../_store";
import { requireEflAuth } from "@/lib/server/firebase-admin";
import { isLocalStoreEnabled } from "../../../_backend_proxy";
import { proxyToLucidBackend } from "../../../_backend_proxy";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  context: { params: Promise<{ caseId: string }> }
) {
  const authResult = await requireEflAuth(req);
  if (authResult instanceof Response) return authResult;
  const auth = authResult;
  if (!isLocalStoreEnabled()) {
    return NextResponse.json(
      { code: "PERSISTENCE_UNAVAILABLE", detail: "Casebevestiging vereist een geconfigureerde backend." },
      { status: 503 },
    );
  }
  try {
    const { caseId } = await context.params;
    const payload = (await req.json()) as { failure_mode_id?: string };
    const failureModeId = payload?.failure_mode_id?.trim();

    if (!failureModeId) {
      return NextResponse.json({ detail: "failure_mode_id is verplicht" }, { status: 400 });
    }

    const proxyRes = await proxyToLucidBackend({
      path: `/cases/${caseId}/confirm`,
      method: "POST",
      body: { failure_mode_id: failureModeId },
    });
    if (proxyRes.handled) {
      return NextResponse.json(proxyRes.data, { status: proxyRes.status ?? 200 });
    }

    const existing = getCaseRecord(caseId);
    if (!existing) {
      return NextResponse.json({ detail: "Case niet gevonden" }, { status: 404 });
    }
    if (existing.owner_uid !== auth.uid) {
      return NextResponse.json({ code: "FORBIDDEN", detail: "Geen toegang tot deze case." }, { status: 403 });
    }

    const updated = addCaseConfirmation(caseId, failureModeId);
    if (!updated) {
      return NextResponse.json({ detail: "Case niet gevonden" }, { status: 404 });
    }

    return NextResponse.json(
      {
        success: true,
        case_id: updated.case_id,
        failure_mode_id: failureModeId,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ detail: "Ongeldige payload" }, { status: 400 });
  }
}
