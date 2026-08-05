import { NextResponse } from "next/server";
import { createCaseRecord } from "../_store";
import { requireEflAuth } from "@/lib/server/firebase-admin";

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
