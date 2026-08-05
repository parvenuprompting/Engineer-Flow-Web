import { NextResponse } from "next/server";
import { createCaseRecord } from "../_store";
import { requireEflAuth } from "@/lib/server/firebase-admin";
import { getLucidBackendUrl, isLocalStoreEnabled, proxyToLucidBackend } from "../_backend_proxy";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const authResult = await requireEflAuth(req);
  if (authResult instanceof Response) return authResult;
  const auth = authResult;
  try {
    const payload = (await req.json()) as { vehicle_id?: string };
    const vehicleId = payload?.vehicle_id?.trim();
    if (!vehicleId) {
      return NextResponse.json({ detail: "vehicle_id is verplicht" }, { status: 400 });
    }

    const proxyRes = await proxyToLucidBackend({
      path: "/cases",
      method: "POST",
      body: { vehicle_id: vehicleId },
    });
    if (proxyRes.handled) {
      return NextResponse.json(proxyRes.data, { status: proxyRes.status ?? 200 });
    }
    if (getLucidBackendUrl()) {
      return NextResponse.json(
        { code: "PERSISTENCE_UNAVAILABLE", detail: "De duurzame case-opslag is niet bereikbaar." },
        { status: 503 }
      );
    }

    if (!isLocalStoreEnabled()) {
      return NextResponse.json(
        { code: "PERSISTENCE_UNAVAILABLE", detail: "Duurzame case-opslag vereist een geconfigureerde backend." },
        { status: 503 },
      );
    }

    const record = createCaseRecord(vehicleId, auth.uid, auth.garageId);
    return NextResponse.json(
      {
        case_id: record.case_id,
        status: record.status,
        vehicle_id: record.vehicle_id,
      },
      { status: 200 }
    );
  } catch {
    return NextResponse.json({ detail: "Ongeldige payload" }, { status: 400 });
  }
}
