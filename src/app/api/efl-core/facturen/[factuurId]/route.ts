import { NextResponse } from "next/server";
import {
  createPolicyEnvelope,
  getFactuurRecord,
  getWerkbonRecord,
  isFactuurBalanced,
} from "../../_store";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ factuurId: string }> }
) {
  const { factuurId } = await context.params;
  const factuur = getFactuurRecord(factuurId);
  if (!factuur) {
    return NextResponse.json({ detail: "Factuur niet gevonden" }, { status: 404 });
  }

  const werkbon = getWerkbonRecord(factuur.werkbon_id);

  return NextResponse.json(
    createPolicyEnvelope({
      factuur_id: factuur.id,
      werkbon_id: factuur.werkbon_id,
      status: factuur.status,
      factuurnummer: factuur.factuurnummer,
      subtotaal: factuur.subtotaal,
      btw: factuur.btw,
      totaal: factuur.totaal,
      aangemaakt_at: factuur.aangemaakt_at,
      gefinaliseerd_at: factuur.gefinaliseerd_at,
      grootboek_balans_ok: isFactuurBalanced(factuur),
      werkbon: werkbon
        ? {
            werkbon_id: werkbon.id,
            status: werkbon.status,
            root_cause: werkbon.root_cause,
            afgerond_at: werkbon.afgerond_at,
          }
        : null,
      regels: werkbon?.regels ?? [],
      grootboek_posten: factuur.grootboek_posten,
    }),
    { status: 200 }
  );
}
