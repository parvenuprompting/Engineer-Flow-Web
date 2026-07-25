import { NextResponse } from "next/server";
import { closeWerkbonRecord, createPolicyEnvelope } from "../../../_store";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  context: { params: Promise<{ werkbonId: string }> }
) {
  const { werkbonId } = await context.params;
  const werkbon = closeWerkbonRecord(werkbonId);

  if (!werkbon) {
    return NextResponse.json({ detail: "Werkbon niet gevonden" }, { status: 404 });
  }

  return NextResponse.json(
    createPolicyEnvelope({
      werkbon_id: werkbon.id,
      status: werkbon.status,
      afgerond_at: werkbon.afgerond_at,
    }),
    { status: 200 }
  );
}
