import { NextResponse } from "next/server";
import { proxyToLucidBackend } from "../_backend_proxy";
import { requireEflAuth } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";

type FactuurCreatePayload = {
  werkbon_id?: string;
};

export async function POST(req: Request) {
  const authResult = await requireEflAuth(req);
  if (authResult instanceof Response) return authResult;
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
      },
    });
    if (proxyRes.handled) {
      return NextResponse.json(proxyRes.data, { status: proxyRes.status ?? 200 });
    }
    return NextResponse.json(
      { code: "PERSISTENCE_UNAVAILABLE", detail: "Duurzame factuuropslag vereist een geconfigureerde backend." },
      { status: 503 },
    );
  } catch {
    return NextResponse.json({ detail: "Ongeldige payload" }, { status: 400 });
  }
}
