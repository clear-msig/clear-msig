// Thin API client: one place for fetch, error parsing, and request defaults.
import { getNotificationAuthToken } from "@/lib/notifications/sessionToken";
import { appConfig } from "@/lib/config";
import type { ApiErrorEnvelope } from "@/lib/api/types";

export class BackendApiError extends Error {
  readonly payload?: ApiErrorEnvelope;
  readonly requestId?: string;

  constructor(message: string, payload?: ApiErrorEnvelope, requestId?: string) {
    super(message);
    this.name = "BackendApiError";
    this.payload = payload;
    this.requestId = requestId;
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

async function parseJsonSafe(response: Response, signal: AbortSignal): Promise<unknown> {
  try {
    return await response.json();
  } catch (error) {
    // An interrupted response body is not a successful empty response.
    // Preserve cancellation so callers cannot continue a signing flow with null.
    if (signal.aborted) throw signal.reason;
    if (error instanceof Error && error.name === "AbortError") throw error;
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
  const callerSignal = options?.signal;
  // addEventListener does not replay an abort that already happened.
  // Never submit a request from a workflow that has already been dismissed.
  callerSignal?.throwIfAborted();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // Bridge a caller-provided signal to our controller so an outer
  // cancel still aborts the in-flight fetch.
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  callerSignal?.addEventListener("abort", onCallerAbort, { once: true });

  try {
    const token = typeof window !== "undefined" ? getNotificationAuthToken() : undefined;
    const response = await fetch(`${backendRequestBase()}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal
    });

    const json = (await parseJsonSafe(response, controller.signal)) as TResponse | ApiErrorEnvelope | null;
    controller.signal.throwIfAborted();
    const requestId = response.headers.get("x-request-id") ?? undefined;

    if (!response.ok) {
      const payload = (json ?? undefined) as ApiErrorEnvelope | undefined;
      const suffix = requestId ? ` [request_id=${requestId}]` : "";
      throw new BackendApiError(
        `${payload?.error ?? `Request failed with status ${response.status}`}${suffix}`,
        payload,
        requestId,
      );
    }

    return json as TResponse;
  } catch (err) {
    if (controller.signal.aborted) {
      // Caller-initiated abort surfaces as the caller's own AbortError;
      // a true timeout surfaces as BackendTimeoutError.
      if (callerSignal?.aborted) throw callerSignal.reason;
      throw new BackendTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", onCallerAbort);
  }
}

function backendRequestBase(): string {
  return typeof window === "undefined" ? appConfig.backendApiUrl : "/api/backend";
}
