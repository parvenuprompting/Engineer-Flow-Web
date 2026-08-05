import { NextResponse } from "next/server";
import { requireEflAuth } from "@/lib/server/firebase-admin";
import { getLucidBackendUrl, proxyToLucidBackend } from "../_backend_proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const authResult = await requireEflAuth(req);
  if (authResult instanceof Response) return authResult;

  const proxyRes = await proxyToLucidBackend({ path: "/diagnoses", method: "GET" });
  if (proxyRes.handled) {
    return NextResponse.json(proxyRes.data, { status: proxyRes.status ?? 200 });
  }

  return NextResponse.json(
    {
      code: "PERSISTENCE_UNAVAILABLE",
      detail: getLucidBackendUrl()
        ? "Het diagnosearchief is niet bereikbaar."
        : "Het diagnosearchief vereist een geconfigureerde backend.",
    },
    { status: 503 }
  );
}
