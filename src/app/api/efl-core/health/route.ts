import { NextResponse } from "next/server";
import { getEflHealthSnapshot } from "@/efl_core/health";
import { getAuditStoreHealth } from "../_store";

export const runtime = "nodejs";

export async function GET() {
  const auditStoreHealth = getAuditStoreHealth();
  const snapshot = getEflHealthSnapshot(auditStoreHealth.audit_store_ok);

  return NextResponse.json(
    {
      status: snapshot.integrity_ok ? "ok" : "degraded",
      mode: "next-api-adapter",
      timestamp: new Date().toISOString(),
      ...snapshot,
      audit_store: auditStoreHealth,
    },
    { status: snapshot.integrity_ok ? 200 : 503 }
  );
}
