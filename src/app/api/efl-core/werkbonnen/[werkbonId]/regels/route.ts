import { NextResponse } from "next/server";
import { requireEflAuth } from "@/lib/server/firebase-admin";
import { proxyToLucidBackend } from "../../../_backend_proxy";

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
  const authResult = await requireEflAuth(req);
  if (authResult instanceof Response) return authResult;
  void authResult;
  try {
    const { werkbonId } = await context.params;
    const payload = (await req.json()) as WerkbonRegelPayload;
    const proxyRes = await proxyToLucidBackend({ path: `/werkbonnen/${werkbonId}/regels`, method: "POST", body: payload });
    if (proxyRes.handled) return NextResponse.json(proxyRes.data, { status: proxyRes.status ?? 200 });
    return NextResponse.json(
      { code: "PERSISTENCE_UNAVAILABLE", detail: "Werkbonregels vereisen een geconfigureerde backend." },
      { status: 503 },
    );
  } catch {
    return NextResponse.json({ detail: "Ongeldige payload" }, { status: 400 });
  }
}
