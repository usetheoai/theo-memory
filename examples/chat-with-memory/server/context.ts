/**
 * TheoKit createContext convention — populates the `ctx` arg passed to every
 * defineRoute handler. Implements the ADR D7 anonymous-uid strategy: every
 * browser gets a stable UUID persisted in the `themory_uid` cookie.
 *
 * Honest disclosure (T3.0 plan-vs-reality): plan v1.1 prescribed
 * `createSessionManager({ initialSession })` from theokit/server/auth, but
 * the real `SessionConfig` shape is `{ secret, cookieName?, maxAge? }` —
 * no `initialSession` callback. The SPIRIT (anonymous UUID per browser via
 * cookie) is preserved here via TheoKit's file-convention `server/context.ts`
 * pattern (discovered in `runMiddlewareAndContext`):
 *
 *   const ctx = await createContext({ request, response });
 *
 * Returned `session.userId` satisfies `memoryFromCtx(ctx, memory)` (T3.1)
 * which dereferences `ctx.session.userId` strictly.
 *
 * Cookie write strategy: when `response` is provided (real TheoKit runtime),
 * the function may set-cookie via the response. When `response` is omitted
 * (unit test path), the directive is returned as `cookieToSet` for the
 * caller to apply. Either path produces the same `session.userId`.
 *
 * Note: this is NOT real authentication. The chat-with-memory demo is open;
 * userId is per-browser-cookie only. Real production wiring would use
 * TheoKit's OAuth/OIDC primitives + createSessionManager with a real secret.
 *
 * @see .claude/knowledge-base/plans/examples-theokit-chat-migration-plan.md § T3.0 + ADR D7
 * @see src/theokit/index.ts § memoryFromCtx (consumer)
 */
import { randomUUID } from "node:crypto";

const COOKIE_NAME = "themory_uid";
const UID_PREFIX = "anon-";

export interface AnonymousSession {
  readonly userId: string;
}

export interface CookieDirective {
  readonly name: string;
  readonly value: string;
  /** Suggested cookie attrs when applying via headers. */
  readonly maxAgeSeconds: number;
  readonly path: string;
  readonly httpOnly: boolean;
  readonly sameSite: "lax";
}

export interface DemoContext {
  readonly session: AnonymousSession;
  /** Present when a NEW cookie must be issued; undefined when reusing the existing one. */
  readonly cookieToSet?: CookieDirective;
}

interface CreateContextInput {
  readonly request: Request;
  /** Optional Node ServerResponse — when present, future calls may set-cookie directly. */
  readonly response?: { setHeader?: (name: string, value: string | string[]) => void };
}

function parseCookieHeader(header: string | null): Map<string, string> {
  const out = new Map<string, string>();
  if (header === null || header === "") return out;
  for (const part of header.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx === -1) continue;
    const name = part.slice(0, eqIdx).trim();
    const value = part.slice(eqIdx + 1).trim();
    if (name !== "") out.set(name, value);
  }
  return out;
}

/**
 * Generate a fresh anonymous user id with deterministic prefix so the demo
 * UI can render "anonymous browser" badges without leaking the raw UUID
 * implementation.
 */
function generateAnonUserId(): string {
  return `${UID_PREFIX}${randomUUID()}`;
}

/**
 * Pure helper exposed for unit testing — resolves session from a Request
 * WITHOUT side effects on the response. Returns either the cookie value
 * (treated as the userId) OR a freshly-generated userId + signal that a
 * new Set-Cookie is needed.
 */
export function resolveSession(request: Request): { session: AnonymousSession; isNew: boolean } {
  const cookies = parseCookieHeader(request.headers.get("cookie"));
  const existing = cookies.get(COOKIE_NAME)?.trim();
  if (existing !== undefined && existing !== "") {
    return { session: { userId: existing }, isNew: false };
  }
  return { session: { userId: generateAnonUserId() }, isNew: true };
}

/**
 * TheoKit createContext convention. Invoked by the runtime BEFORE every
 * route handler; the returned object becomes `ctx` in `defineRoute({ handler })`.
 */
export async function createContext(input: CreateContextInput): Promise<DemoContext> {
  const { session, isNew } = resolveSession(input.request);
  if (!isNew) {
    return { session };
  }
  const directive: CookieDirective = {
    name: COOKIE_NAME,
    value: session.userId,
    maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year
    path: "/",
    httpOnly: true,
    sameSite: "lax",
  };
  // Best-effort Set-Cookie when running inside the TheoKit runtime.
  if (input.response?.setHeader !== undefined) {
    const cookieValue =
      `${directive.name}=${directive.value}; Max-Age=${directive.maxAgeSeconds}` +
      `; Path=${directive.path}; HttpOnly; SameSite=${directive.sameSite}`;
    try {
      input.response.setHeader("Set-Cookie", cookieValue);
    } catch {
      // setHeader may throw if headers already sent — non-fatal in dev; the
      // next request without cookie will simply regenerate a UUID.
    }
  }
  return { session, cookieToSet: directive };
}
