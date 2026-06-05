/**
 * T3.0 — RED then GREEN for the createContext (cookie-bootstrap) pattern.
 *
 * Per ADR D7 (anonymous-uid session): every browser gets a stable UUID
 * persisted in the `themory_uid` cookie. First request: generates UUID +
 * Set-Cookie. Subsequent requests: same UUID in ctx.session.userId.
 *
 * Honest disclosure: plan v1.1 T3.0 § Tasks step 1 prescribed
 * `createSessionManager({ initialSession: () => ({ userId: ... }) })`.
 * Empirical inspection of `theokit@0.2.4` revealed the actual
 * `createSessionManager` API does NOT accept an `initialSession` callback
 * (SessionConfig = { secret, cookieName?, maxAge? } only). The SPIRIT of
 * T3.0 — anonymous UUID per browser via cookie — is implemented via the
 * `server/context.ts` createContext file-convention (TheoKit pattern
 * discovered in chunk-TPCT3MXV.js runMiddlewareAndContext). Same outcome,
 * different file-shape than the plan letter prescribed.
 *
 * @see .claude/knowledge-base/plans/examples-theokit-chat-migration-plan.md § T3.0 + ADR D7
 * @see examples/chat-with-memory/node_modules/theokit/dist/server/auth/index.d.ts (real createSessionManager shape)
 */
import { describe, expect, it } from "vitest";

import { createContext } from "../../../examples/chat-with-memory/server/context.ts";

describe("server/context — T3.0 anonymous-uid cookie bootstrap", () => {
  it("generates an anon-uuid userId on the first request when no themory_uid cookie is present", async () => {
    const request = new Request("http://localhost/api/info");
    const ctx = await createContext({ request });
    expect(ctx.session).toBeTruthy();
    expect(typeof ctx.session.userId).toBe("string");
    expect(ctx.session.userId).toMatch(/^anon-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(ctx.cookieToSet).toBeTruthy();
    expect(ctx.cookieToSet?.name).toBe("themory_uid");
    expect(ctx.cookieToSet?.value).toBe(ctx.session.userId);
  });

  it("reuses the existing themory_uid cookie when present (no new Set-Cookie)", async () => {
    const existingUid = "anon-12345678-1234-1234-1234-123456789012";
    const request = new Request("http://localhost/api/info", {
      headers: { cookie: `themory_uid=${existingUid}; other=foo` },
    });
    const ctx = await createContext({ request });
    expect(ctx.session.userId).toBe(existingUid);
    expect(ctx.cookieToSet).toBeUndefined();
  });

  it("treats whitespace-only cookie as missing and generates a fresh uid", async () => {
    const request = new Request("http://localhost/api/info", {
      headers: { cookie: `themory_uid=   ` },
    });
    const ctx = await createContext({ request });
    expect(ctx.session.userId).toMatch(/^anon-[0-9a-f-]{36}$/i);
    expect(ctx.cookieToSet?.name).toBe("themory_uid");
  });
});
