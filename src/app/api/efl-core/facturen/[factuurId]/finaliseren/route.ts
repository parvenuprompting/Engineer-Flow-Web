import { NextResponse } from "next/server";
import {
  createPolicyEnvelope,
  finalizeFactuurRecord,
  getFactuurRecord,
  isFactuurBalanced,
} from "../../../_store";

export const runtime = "nodejs";

export async function POST(
  _req: Request,
  context: { params: Promise<{ factuurId: string }> }
) {
  const { factuurId } = await context.params;
  const factuur = getFactuurRecord(factuurId);
  if (!factuur) {
    return NextResponse.json({ detail: "Factuur niet gevonden" }, { status: 404 });
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
