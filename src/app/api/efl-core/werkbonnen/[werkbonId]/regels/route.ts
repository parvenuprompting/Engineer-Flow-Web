import { NextResponse } from "next/server";
import {
  addWerkbonRegelRecord,
  createPolicyEnvelope,
  getWerkbonRecord,
} from "../../../_store";

export const runtime = "nodejs";

type WerkbonRegelPayload = {
  omschrijving?: string;
  uren?: number;
  uurtarief?: number;
  onderdeel_code?: string | null;
  onderdeel_prijs?: number;
};

export async function POST(
  req: Request,
  context: { params: Promise<{ werkbonId: string }> }
) {
  try {
    const { werkbonId } = await context.params;
    const payload = (await req.json()) as WerkbonRegelPayload;

    const werkbon = getWerkbonRecord(werkbonId);
    if (!werkbon) {
      return NextResponse.json({ detail: "Werkbon niet gevonden" }, { status: 404 });
    }
    if (werkbon.status !== "open") {
      return NextResponse.json(
        { detail: "Regels toevoegen kan alleen op open werkbonnen" },
        { status: 409 }
      );
    }

    const omschrijving = payload?.omschrijving?.trim();
    const uren = Number(payload?.uren ?? 0);
    const uurtarief = Number(payload?.uurtarief ?? 0);
    const onderdeelPrijs = Number(payload?.onderdeel_prijs ?? 0);

    if (!omschrijving) {
      return NextResponse.json({ detail: "omschrijving is verplicht" }, { status: 400 });
    }
    if (!Number.isFinite(uren) || uren < 0) {
      return NextResponse.json({ detail: "uren moet >= 0 zijn" }, { status: 400 });
    }
    if (!Number.isFinite(uurtarief) || uurtarief < 0) {
      return NextResponse.json({ detail: "uurtarief moet >= 0 zijn" }, { status: 400 });
    }
    if (!Number.isFinite(onderdeelPrijs) || onderdeelPrijs < 0) {
      return NextResponse.json({ detail: "onderdeel_prijs moet >= 0 zijn" }, { status: 400 });
    }

    const updated = addWerkbonRegelRecord(werkbonId, {
      omschrijving,
      uren,
      uurtarief,
      onderdeel_code: payload?.onderdeel_code ?? null,
      onderdeel_prijs: onderdeelPrijs,
    });

    if (!updated) {
      return NextResponse.json({ detail: "Werkbon niet gevonden" }, { status: 404 });
    }

    return NextResponse.json(
      createPolicyEnvelope({
        werkbon_id: updated.werkbon.id,
        werkbon_regel_id: updated.regel.id,
        status: updated.werkbon.status,
        regel: {
          omschrijving: updated.regel.omschrijving,
          uren: updated.regel.uren,
          uurtarief: updated.regel.uurtarief,
          onderdeel_code: updated.regel.onderdeel_code,
          onderdeel_prijs: updated.regel.onderdeel_prijs,
          regel_totaal: updated.regel.regel_totaal,
        },
        werkbon_subtotaal: updated.werkbon_subtotaal,
      }),
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ detail: "Ongeldige payload" }, { status: 400 });
  }
}
