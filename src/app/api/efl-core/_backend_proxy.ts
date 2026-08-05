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

export function getLucidBackendUrl(): string | null {
  const url = process.env.LUCID_BACKEND_URL?.trim();
  return url && url.length > 0 ? url.replace(/\/+$/, "") : null;
}

export async function proxyToLucidBackend<T = unknown>(options: ProxyOptions): Promise<ProxyResult<T>> {
  const backendUrl = getLucidBackendUrl();
  if (!backendUrl) {
    return { handled: false };
  }

  try {
    const serviceToken = process.env.LUCID_SERVICE_TOKEN?.trim();
    if (!serviceToken) {
      return { handled: false, error: "LUCID_SERVICE_TOKEN is niet geconfigureerd" };
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    headers["Authorization"] = `Bearer ${serviceToken}`;

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
