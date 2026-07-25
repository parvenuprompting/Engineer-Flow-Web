import { NextResponse } from "next/server";
import { addCaseConfirmation, getCaseRecord } from "../../../_store";

export const runtime = "nodejs";

export async function POST(
  req: Request,
  context: { params: Promise<{ caseId: string }> }
) {
  try {
    const { caseId } = await context.params;
    const payload = (await req.json()) as { failure_mode_id?: string };
    const failureModeId = payload?.failure_mode_id?.trim();

    if (!failureModeId) {
      return NextResponse.json({ detail: "failure_mode_id is verplicht" }, { status: 400 });
    }

    const existing = getCaseRecord(caseId);
    if (!existing) {
      return NextResponse.json({ detail: "Case niet gevonden" }, { status: 404 });
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
