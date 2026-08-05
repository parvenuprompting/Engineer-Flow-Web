import { NextResponse } from "next/server";
import {
  createPolicyEnvelope,
  finalizeFactuurRecord,
  getFactuurRecord,
  isFactuurBalanced,
} from "../../../_store";
import { requireEflAuth } from "@/lib/server/firebase-admin";
import { isLocalStoreEnabled } from "../../../_backend_proxy";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  context: { params: Promise<{ factuurId: string }> }
) {
  const authResult = await requireEflAuth(_req);
  if (authResult instanceof Response) return authResult;
  const auth = authResult;
  if (!isLocalStoreEnabled()) {
    return NextResponse.json(
      { code: "PERSISTENCE_UNAVAILABLE", detail: "Factuurfinalisatie vereist een geconfigureerde backend." },
      { status: 503 },
    );
  }
  const { factuurId } = await context.params;
  const factuur = getFactuurRecord(factuurId);
  if (!factuur) {
    return NextResponse.json({ detail: "Factuur niet gevonden" }, { status: 404 });
  }
  if (factuur.owner_uid !== auth.uid) {
    return NextResponse.json({ code: "FORBIDDEN", detail: "Geen toegang tot deze factuur." }, { status: 403 });
  }
  if (factuur.status === "gefinaliseerd") {
    return NextResponse.json({ detail: "Factuur is al gefinaliseerd." }, { status: 409 });
  }

  const finalized = finalizeFactuurRecord(factuurId);
  if (!finalized) {
    return NextResponse.json({ detail: "Factuur niet gevonden" }, { status: 404 });
  }

  return NextResponse.json(
    createPolicyEnvelope({
      factuur_id: finalized.id,
      status: finalized.status,
      factuurnummer: finalized.factuurnummer,
      subtotaal: finalized.subtotaal,
      btw: finalized.btw,
      totaal: finalized.totaal,
      gefinaliseerd_at: finalized.gefinaliseerd_at,
      grootboek_balans_ok: isFactuurBalanced(finalized),
      grootboek_posten: finalized.grootboek_posten,
    }),
    { status: 200 }
  );
}
