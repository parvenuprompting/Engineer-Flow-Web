import { NextResponse } from "next/server";
import { closeWerkbonRecord, createPolicyEnvelope } from "../../../_store";
import { getWerkbonRecord } from "../../../_store";
import { requireEflAuth } from "@/lib/server/firebase-admin";
import { isLocalStoreEnabled } from "../../../_backend_proxy";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  context: { params: Promise<{ werkbonId: string }> }
) {
  const authResult = await requireEflAuth(_req);
  if (authResult instanceof Response) return authResult;
  const auth = authResult;
  if (!isLocalStoreEnabled()) {
    return NextResponse.json(
      { code: "PERSISTENCE_UNAVAILABLE", detail: "Werkbonafronding vereist een geconfigureerde backend." },
      { status: 503 },
    );
  }
  const { werkbonId } = await context.params;
  const existing = getWerkbonRecord(werkbonId);
  if (existing?.owner_uid !== auth.uid) {
    return NextResponse.json({ code: existing ? "FORBIDDEN" : "NOT_FOUND", detail: existing ? "Geen toegang tot deze werkbon." : "Werkbon niet gevonden" }, { status: existing ? 403 : 404 });
  }
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
