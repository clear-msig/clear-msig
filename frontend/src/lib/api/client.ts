// Thin API client: one place for fetch, error parsing, and request defaults.
import { appConfig } from "@/lib/config";
import type { ApiErrorEnvelope } from "@/lib/api/types";

export class BackendApiError extends Error {
  readonly payload?: ApiErrorEnvelope;

  constructor(message: string, payload?: ApiErrorEnvelope) {
    super(message);
    this.name = "BackendApiError";
    this.payload = payload;
  }
}

type HttpMethod = "GET" | "POST";

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function apiRequest<TResponse, TBody = unknown>(
  path: string,
  method: HttpMethod,
  body?: TBody
): Promise<TResponse> {
  const response = await fetch(`${appConfig.backendApiUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json"
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store"
  });

  const json = (await parseJsonSafe(response)) as TResponse | ApiErrorEnvelope | null;

  if (!response.ok) {
    const payload = (json ?? undefined) as ApiErrorEnvelope | undefined;
    throw new BackendApiError(payload?.error ?? `Request failed with status ${response.status}`, payload);
  }

  return json as TResponse;
}
