import { NextResponse } from "next/server";
import { createPolicyEnvelope, createWerkbonRecord } from "../_store";
import { proxyToLucidBackend } from "../_backend_proxy";

export const runtime = "nodejs";

type WerkbonCreatePayload = {
  voertuig_id?: string;
  root_cause?: string;
};

export async function POST(req: Request) {
  try {
    const payload = (await req.json()) as WerkbonCreatePayload;
    const voertuigId = payload?.voertuig_id?.trim();
    const rootCause = payload?.root_cause?.trim();

    if (!voertuigId) {
      return NextResponse.json({ detail: "voertuig_id is verplicht" }, { status: 400 });
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
        garage_party_id: "garage-001",
      },
    });
    if (proxyRes.handled) {
      return NextResponse.json(proxyRes.data, { status: proxyRes.status ?? 200 });
    }

    const werkbon = createWerkbonRecord({
      voertuig_id: voertuigId,
      root_cause: rootCause,
      garage_party_id: "garage-001",
    });

    return NextResponse.json(
      createPolicyEnvelope({
        werkbon_id: werkbon.id,
        voertuig_id: werkbon.voertuig_id,
        root_cause: werkbon.root_cause,
        status: werkbon.status,
        aangemaakt_at: werkbon.aangemaakt_at,
        afgerond_at: werkbon.afgerond_at,
      }),
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ detail: "Ongeldige payload" }, { status: 400 });
  }
}
