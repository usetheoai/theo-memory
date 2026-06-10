/**
 * T2.2 — Per-route contract sentinels for the migrated TheoKit routes.
 *
 * Asserts response shape parity vs pre-migration Next.js shapes. Each test
 * invokes the route's exported `defineRoute({ handler })` directly with a
 * minimal mocked Request; backends + lib/memory adapters are stubbed via
 * THEOMEM_USE_STUB_ADAPTERS=1 (in-memory backend, deterministic stub
 * embedder + LLM — zero infra).
 *
 * Replaces tests/unit/examples/chat-with-memory-info-route.test.ts which
 * asserted the deleted app/api/info/route.ts; the GREEN shape of /api/info
 * is preserved here. Covers 8 critical validation + happy-path contracts
 * across the 15 migrated routes — not 15 redundant tests (parity is
 * structural per T2.1 byte-for-byte copy + 8/8 T0.1 RED sentinels GREEN).
 *
 * @see .claude/knowledge-base/plans/examples-theokit-chat-migration-plan.md § T2.2
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Capture original env to restore in afterAll
const ORIGINAL_ENV: Record<string, string | undefined> = {};
const ENV_KEYS = [
  "THEOMEM_USE_STUB_ADAPTERS",
  "THEOMEM_PG_URI",
  "OPENAI_API_KEY",
  "OPENAI_BASE_URL",
  "OPENROUTER_KEY",
  "OPENROUTER_API_KEY",
] as const;

beforeAll(() => {
  for (const key of ENV_KEYS) ORIGINAL_ENV[key] = process.env[key];
  process.env["THEOMEM_USE_STUB_ADAPTERS"] = "1";
  delete process.env["THEOMEM_PG_URI"];
});

afterAll(() => {
  for (const key of ENV_KEYS) {
    if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
    else process.env[key] = ORIGINAL_ENV[key];
  }
});

/**
 * Minimal mock ctx for `defineRoute` handler invocation. Mirrors the framework
 * behavior: TheoKit auto-parses `application/json` request bodies via
 * `parseRequestBody` BEFORE invoking the handler — the handler receives the
 * parsed object via the `body` arg, NOT via `request.json()` (Node
 * IncomingMessage has no `.json()` method).
 *
 * Pre-fix: mock returned `body: {}` regardless of request body — handlers
 * saw empty object, hit the first required-field validation, and tests
 * asserting LATER validation branches (hard/policy/codeLanguage type checks)
 * always failed on "userId required" / "repoId required" instead. Match
 * framework semantics by parsing the JSON body when content-type indicates.
 */
async function mockCtx(request: Request): Promise<{
  request: Request;
  query: unknown;
  body: unknown;
  params: unknown;
  ctx: unknown;
}> {
  let body: unknown = {};
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      // Clone so the handler can still call request.json() if needed (rare).
      body = await request.clone().json();
    } catch {
      // Invalid JSON → leave body as {} so handler's invalid-body branch fires.
      body = {};
    }
  }
  return { request, query: {}, body, params: {}, ctx: {} };
}

describe("server-routes — T2.2 per-route contract parity", () => {
  it("GET /api/health returns 200 with the consumer-canonical badge object", async () => {
    const { GET } = await import(
      "../../../examples/chat-with-memory/server/routes/health.ts"
    );
    const res = (await GET.handler(await mockCtx(new Request("http://localhost/api/health")))) as Response;
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toEqual({
      ok: true,
      name: "themory-demo-chat",
      sdk: "@theokit/sdk@^1.5.0",
      memory: "@usetheo/memory (local workspace)",
      ui: "@theokit/ui@0.12.0",
    });
  });

  it("GET /api/info returns 200 with backend/reflectionThreshold/adapterSource/embedderDim shape", async () => {
    const { GET } = await import(
      "../../../examples/chat-with-memory/server/routes/info.ts"
    );
    const res = (await GET.handler(await mockCtx(new Request("http://localhost/api/info")))) as Response;
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("backend");
    expect(body).toHaveProperty("reflectionThreshold");
    expect(body).toHaveProperty("adapterSource");
    expect(body).toHaveProperty("embedderDim");
    expect(body["backend"]).toBe("in-memory"); // stub mode → in-memory
    expect(body["adapterSource"]).toBe("stub");
    expect(typeof body["reflectionThreshold"]).toBe("number");
    expect(typeof body["embedderDim"]).toBe("number");
  });

  it("POST /api/memory/forget returns 400 when userId is missing", async () => {
    const { POST } = await import(
      "../../../examples/chat-with-memory/server/routes/memory/forget.ts"
    );
    const request = new Request("http://localhost/api/memory/forget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "some-id" }),
    });
    const res = (await POST.handler(await mockCtx(request))) as Response;
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toMatch(/userId required/i);
  });

  it("POST /api/memory/forget returns 400 when hard is non-boolean", async () => {
    const { POST } = await import(
      "../../../examples/chat-with-memory/server/routes/memory/forget.ts"
    );
    const request = new Request("http://localhost/api/memory/forget", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "u1", id: "m1", hard: "yes" }),
    });
    const res = (await POST.handler(await mockCtx(request))) as Response;
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toMatch(/hard must be boolean/i);
  });

  it("POST /api/memory/distill returns 400 for invalid policy value", async () => {
    const { POST } = await import(
      "../../../examples/chat-with-memory/server/routes/memory/distill.ts"
    );
    const request = new Request("http://localhost/api/memory/distill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: "u1", policy: "bogus" }),
    });
    const res = (await POST.handler(await mockCtx(request))) as Response;
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toMatch(/invalid policy/i);
  });

  it("POST /api/skills returns 400 when repoId is missing", async () => {
    const { POST } = await import(
      "../../../examples/chat-with-memory/server/routes/skills.ts"
    );
    const request = new Request("http://localhost/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: "x", description: "y", codeLanguage: "typescript" }),
    });
    const res = (await POST.handler(await mockCtx(request))) as Response;
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toMatch(/repoId required/i);
  });

  it("POST /api/skills returns 400 for invalid codeLanguage", async () => {
    const { POST } = await import(
      "../../../examples/chat-with-memory/server/routes/skills.ts"
    );
    const request = new Request("http://localhost/api/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: "r1", code: "x", description: "y", codeLanguage: "python" }),
    });
    const res = (await POST.handler(await mockCtx(request))) as Response;
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toMatch(/codeLanguage must be typescript\|javascript/i);
  });

  it("GET /api/memory/recall returns 400 when userId is missing", async () => {
    const { GET } = await import(
      "../../../examples/chat-with-memory/server/routes/memory/recall.ts"
    );
    const request = new Request("http://localhost/api/memory/recall");
    const res = (await GET.handler(await mockCtx(request))) as Response;
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["error"]).toMatch(/userId required/i);
  });
});
