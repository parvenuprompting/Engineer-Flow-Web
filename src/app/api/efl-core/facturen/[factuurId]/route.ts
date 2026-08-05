import { NextResponse } from "next/server";
import { requireEflAuth } from "@/lib/server/firebase-admin";
import { proxyToLucidBackend } from "../../_backend_proxy";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  context: { params: Promise<{ factuurId: string }> }
) {
  const authResult = await requireEflAuth(_req);
  if (authResult instanceof Response) return authResult;
  const { factuurId } = await context.params;
  const proxyRes = await proxyToLucidBackend({ path: `/facturen/${factuurId}`, method: "GET" });
  if (proxyRes.handled) return NextResponse.json(proxyRes.data, { status: proxyRes.status ?? 200 });
  return NextResponse.json(
    { code: "PERSISTENCE_UNAVAILABLE", detail: "Factuuropvraag vereist een geconfigureerde backend." },
    { status: 503 },
  );
}
