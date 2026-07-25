import type { ClientAuditEvent } from "@/lib/api/types";

export type DurableSinkForwardResult = {
  durable_sink_state: "not_configured" | "forwarded" | "forward_failed";
  durable_sink_accepted: number;
  durable_sink_http_status: number | null;
  durable_sink_error: string | null;
};

export async function forwardAuditEventsToLucidBackend(events: ClientAuditEvent[]): Promise<DurableSinkForwardResult> {
  const targetUrl = process.env.LUCID_AUDIT_SYNC_URL?.trim();
  if (!targetUrl) {
    return {
      durable_sink_state: "not_configured",
      durable_sink_accepted: 0,
      durable_sink_http_status: null,
      durable_sink_error: null,
    };
  }

  try {
    const response = await fetch(targetUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.LUCID_AUDIT_SYNC_SECRET
          ? { "x-efl-audit-secret": process.env.LUCID_AUDIT_SYNC_SECRET }
          : {}),
      },
      body: JSON.stringify({ events }),
    });

    if (!response.ok) {
      return {
        durable_sink_state: "forward_failed",
        durable_sink_accepted: 0,
        durable_sink_http_status: response.status,
        durable_sink_error: `Lucid ingest returned HTTP ${response.status}`,
      };
    }

    const payload = (await response.json()) as { accepted?: number };
    return {
      durable_sink_state: "forwarded",
      durable_sink_accepted: Number(payload.accepted ?? events.length),
      durable_sink_http_status: response.status,
      durable_sink_error: null,
    };
  } catch (error) {
    return {
      durable_sink_state: "forward_failed",
      durable_sink_accepted: 0,
      durable_sink_http_status: null,
      durable_sink_error: error instanceof Error ? error.message : "Lucid ingest request failed",
    };
  }
}
