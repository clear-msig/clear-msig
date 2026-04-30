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

export class BackendTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Backend did not respond within ${timeoutMs}ms`);
    this.name = "BackendTimeoutError";
  }
}

type HttpMethod = "GET" | "POST";

const DEFAULT_TIMEOUT_MS = 30_000;

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
  body?: TBody,
  options?: { timeoutMs?: number; signal?: AbortSignal }
): Promise<TResponse> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Bridge a caller-provided signal to our controller so an outer
  // cancel still aborts the in-flight fetch.
  const callerSignal = options?.signal;
  const onCallerAbort = () => controller.abort();
  callerSignal?.addEventListener("abort", onCallerAbort);

  try {
    const response = await fetch(`${appConfig.backendApiUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal
    });

    const json = (await parseJsonSafe(response)) as TResponse | ApiErrorEnvelope | null;

    if (!response.ok) {
      const payload = (json ?? undefined) as ApiErrorEnvelope | undefined;
      throw new BackendApiError(payload?.error ?? `Request failed with status ${response.status}`, payload);
    }

    return json as TResponse;
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      // Caller-initiated abort surfaces as the caller's own AbortError;
      // a true timeout surfaces as BackendTimeoutError.
      if (callerSignal?.aborted) throw err;
      throw new BackendTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}
