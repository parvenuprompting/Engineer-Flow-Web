import { NextResponse } from "next/server";
import { getEflHealthSnapshot } from "@/efl_core/health";
import {
  getAuditStoreHealth,
  listPendingLucidAuditMirrorEvents,
  storeLucidAuditForwardStatuses,
} from "../../_store";
import { forwardAuditEventsToLucidBackend } from "../_durable_sink";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FlushRequestBody = {
  limit?: number;
};

export async function POST(req: Request) {
  try {
    const auditStoreHealth = getAuditStoreHealth();
    const healthSnapshot = getEflHealthSnapshot(auditStoreHealth.audit_store_ok);
    if (!healthSnapshot.integrity_ok) {
      return NextResponse.json(
        {
          code: "EFL_CORE_UNHEALTHY",
          detail: "Canonieke datasets of version manifest zijn niet valide. Audit flush is geblokkeerd.",
          health: healthSnapshot,
        },
        { status: 503 }
      );
    }

    let limit = 100;
    try {
      const body = (await req.json()) as FlushRequestBody;
      if (typeof body?.limit === "number" && Number.isFinite(body.limit)) {
        limit = Math.max(1, Math.min(500, Math.trunc(body.limit)));
      }
    } catch {
      limit = 100;
    }

    const backlogBefore = getAuditStoreHealth().lucid_audit_pending_count;
    const pendingEvents = listPendingLucidAuditMirrorEvents(limit);

    if (pendingEvents.length === 0) {
      return NextResponse.json(
        {
          status: "idle",
          attempted: 0,
          flushed_event_ids: [],
          backlog_before: backlogBefore,
          backlog_after: backlogBefore,
          durable_sink_state: "not_needed",
          audit_store: getAuditStoreHealth(),
        },
        { status: 200 }
      );
    }

    const durableSinkResult = await forwardAuditEventsToLucidBackend(pendingEvents);

    if (durableSinkResult.durable_sink_state !== "not_configured") {
      storeLucidAuditForwardStatuses(
        pendingEvents.map((event) => ({
          status_id: crypto.randomUUID(),
          source_event_id: event.event_id,
          created_at: new Date().toISOString(),
          status: durableSinkResult.durable_sink_state === "forwarded" ? "forwarded" : "forward_failed",
          target_url: process.env.LUCID_AUDIT_SYNC_URL?.trim() ?? "unconfigured",
          response_status: durableSinkResult.durable_sink_http_status,
          accepted_count: durableSinkResult.durable_sink_accepted,
          error: durableSinkResult.durable_sink_error,
        }))
      );
    }

    const auditStoreAfter = getAuditStoreHealth();

    return NextResponse.json(
      {
        status:
          durableSinkResult.durable_sink_state === "forwarded"
            ? "flushed"
            : durableSinkResult.durable_sink_state === "not_configured"
              ? "not_configured"
              : "forward_failed",
        attempted: pendingEvents.length,
        flushed_event_ids: pendingEvents.map((event) => event.event_id),
        backlog_before: backlogBefore,
        backlog_after: auditStoreAfter.lucid_audit_pending_count,
        ...durableSinkResult,
        audit_store: auditStoreAfter,
      },
      { status: durableSinkResult.durable_sink_state === "forward_failed" ? 502 : 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Audit flush route fout";
    return NextResponse.json({ code: "AUDIT_FLUSH_ERROR", detail: message }, { status: 500 });
  }
}
