import { NextResponse } from "next/server";
import { proxyToLucidBackend } from "../_backend_proxy";
import { requireEflAuth } from "@/lib/server/firebase-admin";

export const runtime = "nodejs";

type WerkbonCreatePayload = {
  case_id?: string;
  voertuig_id?: string;
  root_cause?: string;
};

export async function POST(req: Request) {
  const authResult = await requireEflAuth(req);
  if (authResult instanceof Response) return authResult;
  try {
    const payload = (await req.json()) as WerkbonCreatePayload;
    const voertuigId = payload?.voertuig_id?.trim();
    const caseId = payload?.case_id?.trim();
    const rootCause = payload?.root_cause?.trim();

    if (!voertuigId) {
      return NextResponse.json({ detail: "voertuig_id is verplicht" }, { status: 400 });
    }
    if (!caseId) {
      return NextResponse.json({ detail: "case_id is verplicht" }, { status: 400 });
    }
    if (!rootCause) {
      return NextResponse.json({ detail: "root_cause is verplicht" }, { status: 400 });
    }

    const proxyRes = await proxyToLucidBackend({
      path: "/werkbonnen",
      method: "POST",
      body: {
        voertuig_id: voertuigId,
        root_cause: rootCause,
        case_id: caseId,
      },
    });
    if (proxyRes.handled) {
      return NextResponse.json(proxyRes.data, { status: proxyRes.status ?? 200 });
    }
    return NextResponse.json(
      { code: "PERSISTENCE_UNAVAILABLE", detail: "Duurzame werkbonopslag vereist een geconfigureerde backend." },
      { status: 503 },
    );
  } catch {
    return NextResponse.json({ detail: "Ongeldige payload" }, { status: 400 });
  }
}
