import { NextResponse } from "next/server";
import { requireEflAuth } from "@/lib/server/firebase-admin";
import { getLucidBackendUrl, proxyToLucidBackend } from "../../_backend_proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authenticate(req: Request) {
  return requireEflAuth(req);
}

export async function GET(
  req: Request,
  context: { params: Promise<{ diagnosisId: string }> }
) {
  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { diagnosisId } = await context.params;
  return forward(req, diagnosisId, "GET");
}

export async function PATCH(
  req: Request,
  context: { params: Promise<{ diagnosisId: string }> }
) {
  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { diagnosisId } = await context.params;
  const body = await req.json();
  return forward(req, diagnosisId, "PATCH", body);
}

export async function DELETE(
  req: Request,
  context: { params: Promise<{ diagnosisId: string }> }
) {
  const authResult = await authenticate(req);
  if (authResult instanceof Response) return authResult;
  const { diagnosisId } = await context.params;
  return forward(req, diagnosisId, "DELETE");
}

async function forward(req: Request, diagnosisId: string, method: "GET" | "PATCH" | "DELETE", body?: unknown) {
  const proxyRes = await proxyToLucidBackend({
    path: `/diagnoses/${encodeURIComponent(diagnosisId)}`,
    method,
    body,
  });
  if (proxyRes.handled) {
    return NextResponse.json(proxyRes.data, { status: proxyRes.status ?? 200 });
  }
  return NextResponse.json(
    {
      code: "PERSISTENCE_UNAVAILABLE",
      detail: getLucidBackendUrl()
        ? "De diagnose is niet bereikbaar."
        : "Het diagnosearchief vereist een geconfigureerde backend.",
    },
    { status: 503 }
  );
}
