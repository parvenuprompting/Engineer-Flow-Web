/**
 * Backend Proxy Helper for EFL-Core Next.js API Routes.
 * Proxies requests to the Python FastAPI backend (lucid_backend) when configured.
 */

export interface ProxyOptions {
  method?: string;
  path: string;
  body?: unknown;
  party_id?: string;
  party_type?: "garage" | "fabrikant" | "verzekeraar";
  scopes?: string[];
}

export interface ProxyResult<T = unknown> {
  handled: boolean;
  status?: number;
  data?: T;
  error?: string;
}

let cachedDevToken: string | null = null;
let tokenExpiresAt = 0;

export function getLucidBackendUrl(): string | null {
  const url = process.env.LUCID_BACKEND_URL?.trim();
  return url && url.length > 0 ? url.replace(/\/+$/, "") : null;
}

async function getDevToken(backendUrl: string, partyId = "garage-001", partyType = "garage", scopes = ["diagnosis:read_local"]): Promise<string | null> {
  const now = Date.now();
  if (cachedDevToken && tokenExpiresAt > now + 60000) {
    return cachedDevToken;
  }

  try {
    const res = await fetch(`${backendUrl}/auth/dev-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        party_id: partyId,
        party_type: partyType,
        scopes,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    if (data.access_token) {
      cachedDevToken = data.access_token;
      tokenExpiresAt = now + 3600 * 1000; // 1 hour
      return cachedDevToken;
    }
  } catch {
    // Ignore fetch error, will fallback
  }
  return null;
}

export async function proxyToLucidBackend<T = unknown>(options: ProxyOptions): Promise<ProxyResult<T>> {
  const backendUrl = getLucidBackendUrl();
  if (!backendUrl) {
    return { handled: false };
  }

  try {
    const token = await getDevToken(
      backendUrl,
      options.party_id ?? "garage-001",
      options.party_type ?? "garage",
      options.scopes ?? ["diagnosis:read_local", "claim:read_history"]
    );

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${backendUrl}${options.path}`, {
      method: options.method ?? "POST",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const responseData = await response.json();
    return {
      handled: true,
      status: response.status,
      data: responseData as T,
    };
  } catch (error) {
    return {
      handled: false,
      error: error instanceof Error ? error.message : "Proxy request failed",
    };
  }
}
