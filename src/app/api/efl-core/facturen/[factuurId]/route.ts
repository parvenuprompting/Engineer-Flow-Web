import { NextResponse } from "next/server";
import {
  createPolicyEnvelope,
  getFactuurRecord,
  getWerkbonRecord,
  isFactuurBalanced,
} from "../../_store";
import { requireEflAuth } from "@/lib/server/firebase-admin";
import { isLocalStoreEnabled } from "../../_backend_proxy";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ factuurId: string }> }
) {
  const authResult = await requireEflAuth(_req);
  if (authResult instanceof Response) return authResult;
  const auth = authResult;
  if (!isLocalStoreEnabled()) {
    return NextResponse.json(
      { code: "PERSISTENCE_UNAVAILABLE", detail: "Factuuropvraag vereist een geconfigureerde backend." },
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
