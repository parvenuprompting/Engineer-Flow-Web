import { NextResponse } from "next/server";
import {
  createFactuurRecord,
  createPolicyEnvelope,
  getFactuurByWerkbon,
  getWerkbonRecord,
} from "../_store";
import { proxyToLucidBackend } from "../_backend_proxy";

export const runtime = "nodejs";

type FactuurCreatePayload = {
  werkbon_id?: string;
};

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as FactuurCreatePayload;
    const werkbonId = payload?.werkbon_id?.trim();
    if (!werkbonId) {
      return NextResponse.json({ detail: "werkbon_id is verplicht" }, { status: 400 });
    }

    const proxyRes = await proxyToLucidBackend({
      path: "/facturen",
      method: "POST",
      body: {
        werkbon_id: werkbonId,
        garage_party_id: "garage-001",
      },
    });
    if (proxyRes.handled) {
      return NextResponse.json(proxyRes.data, { status: proxyRes.status ?? 200 });
    }

    const werkbon = getWerkbonRecord(werkbonId);
    if (!werkbon) {
      return NextResponse.json({ detail: "Werkbon niet gevonden" }, { status: 404 });
    }
    if (werkbon.status !== "afgerond") {
      return NextResponse.json(
        { detail: "Factuur kan alleen op een afgeronde werkbon worden gemaakt." },
        { status: 409 }
      );
    }

    const existing = getFactuurByWerkbon(werkbonId);
    if (existing) {
      return NextResponse.json(
        { detail: "Er bestaat al een factuur voor deze werkbon." },
        { status: 409 }
      );
    }

    const factuur = createFactuurRecord({ werkbon_id: werkbonId, garage_party_id: "garage-001" });
    if (!factuur) {
      return NextResponse.json({ detail: "Werkbon niet gevonden" }, { status: 404 });
    }

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
      }),
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ detail: "Ongeldige payload" }, { status: 400 });
  }
}
