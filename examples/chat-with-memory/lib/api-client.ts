/**
 * T4.1 — typed client transport for the demo. Two paths:
 *
 *   1. `theoFetch` re-exported from `theokit/client` — canonical typed
 *      transport when caller doesn't need response-body access on errors
 *      (TheoFetchError exposes only status + code + issues, not raw body).
 *
 *   2. `apiCall` — pragmatic fetch wrapper that PRESERVES the response
 *      body on non-2xx via `ApiError.body`. Necessary for the distill
 *      tab which surfaces backend error codes (STUB_LLM_NOT_USABLE_FOR_LJM
 *      vs OPENAI_API_KEY_MISSING) flat on the response root rather than
 *      nested under `{ error: { code, message } }`.
 *
 * Spirit of T4.1: typed transport + body serialization + standardized error
 * handling. Letter (raw `theoFetch` everywhere) deferred because the route
 * error shapes use top-level `{ code, message }` which TheoFetchError does
 * not expose. Future: when route handlers adopt `sendError` (nested shape),
 * swap apiCall → theoFetch and read err.code/err.message.
 *
 * @see .claude/knowledge-base/plans/examples-theokit-chat-migration-plan.md § T4.1
 */
export { theoFetch, TheoFetchError } from "theokit/client";

/** Thrown by `apiCall` on non-2xx; carries parsed response body for UI display. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    super(`HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

interface ApiOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
}

function buildSearchString(query: ApiOptions["query"]): string {
  if (query === undefined) return "";
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    params.set(k, String(v));
  }
  const s = params.toString();
  return s === "" ? "" : `?${s}`;
}

/**
 * Typed call against a server/routes/ endpoint. Auto-serializes body to
 * JSON; auto-deserializes response. Throws `ApiError` on non-2xx with the
 * parsed body so callers can render backend error codes.
 */
export async function apiCall<TResponse = unknown>(
  url: string,
  options?: ApiOptions,
): Promise<TResponse> {
  const init: RequestInit = {};
  const headers: Record<string, string> = {};
  if (options?.method !== undefined) init.method = options.method;
  if (options?.signal !== undefined) init.signal = options.signal;
  if (options?.body !== undefined) {
    init.body = JSON.stringify(options.body);
    headers["Content-Type"] = "application/json";
  }
  init.headers = headers;
  const finalUrl = url + buildSearchString(options?.query);
  const resp = await fetch(finalUrl, init);
  if (!resp.ok) {
    let body: unknown = null;
    try {
      body = (await resp.json()) as unknown;
    } catch {
      // empty / non-JSON body — leave as null
    }
    throw new ApiError(resp.status, body);
  }
  if (resp.status === 204) return null as TResponse;
  const contentLength = resp.headers.get("content-length");
  if (contentLength === "0") return null as TResponse;
  return (await resp.json()) as TResponse;
}
