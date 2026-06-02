/**
 * theo-memory singleton — boots once per Node process.
 *
 * Backend auto-detect (v0.6.1 demo expansion):
 *   - `THEOMEM_PG_URI` set    → `PgvectorStore` + `runMigrations` (real persistence)
 *   - `THEOMEM_PG_URI` unset  → `InMemoryVectorStore` (zero infra)
 *
 * **Eviction wiring (lifted 2026-06-01 — hotfix `b2909ff` reverted by f-t4-1-2
 * T3.1):** `THEOMEM_EVICTION_DEMO=1` + `THEOMEM_PG_URI` set → eviction enabled
 * via `createLocalMemory({ eviction: { trigger: 'capacity', maxMemoriesPerScope: 10 } })`.
 * The regression guard for the F-T4.1-2 race lives at
 * `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` — 3 race-
 * attempt variants × 400+ trials PASS against real pgvector. SDK code path is
 * empirically sound; if regression surfaces in Next.js demo runtime with real
 * OpenAI adapters, re-apply hotfix immediately + file follow-up cycle.
 *
 * Demonstrates both runtimes of the contract from a single binary surface,
 * and persistence survives `npm run dev` restarts when pgvector is wired.
 *
 * Public exports: `getSingleton`, `getMemory`, `getBackend`. `getSingleton`
 * carries an `eviction` field consumed by `/api/memory/eviction-status` +
 * `EvictionTab`.
 *
 * `globalThis` shares the singleton across Next.js dev's per-route module
 * instances (writes via /api/chat must land in the SAME store as reads via
 * /api/memory/recall — standard Next.js pattern).
 */
import "server-only";
import {
  createLocalMemory,
  InMemoryVectorStore,
  LastWriteWinsConflictPolicy,
  LlmJudgedMergeConflictPolicy,
  NoopConflictPolicy,
  PgvectorStore,
  runMigrations,
  type LocalEvictionConfig,
  type LocalMemoryConfig,
  type Memory,
} from "@usetheo/memory";
import type {
  ConflictResolutionPolicy,
  Embedder,
  LLM,
  ManualReflectionPolicy,
  ReflectionTrigger,
  Scope,
  VectorStore,
} from "@usetheo/memory/contract";
import { LocalTransformerEmbedder } from "@usetheo/memory/embedders/local";
import { OpenAIEmbedder } from "@usetheo/memory/embedders/openai";
import { DeterministicStubEmbedder } from "@usetheo/memory/embedders/stub";
import { OpenAILLM } from "@usetheo/memory/llms/openai";
import { DeterministicStubLLM } from "@usetheo/memory/llms/stub";
import pg from "pg";

/** Explicit-only reflection policy (ADR-0005). */
class DemoManualReflectionPolicy implements ManualReflectionPolicy {
  readonly kind = "manual" as const;
  async shouldReflect(_scope: Scope, _trigger: ReflectionTrigger): Promise<boolean> {
    return true;
  }
}

export type BackendKind = "pgvector" | "in-memory";

/**
 * Runtime eviction state surfaced via `/api/memory/eviction-status` (T1.2).
 * `enabled === true` only when `THEOMEM_EVICTION_DEMO=1` AND
 * `backend === 'pgvector'`. Per plan ADR D1 the demo opt-in is strict equality
 * with `"1"`; per plan §216 this shape is the contract consumed by the
 * `EvictionTab` UI (T1.3).
 */
interface EvictionState {
  readonly enabled: boolean;
  readonly trigger: "capacity" | "time" | null;
  readonly maxMemoriesPerScope: number | null;
}

interface MemorySingleton {
  readonly memory: Memory;
  readonly backend: BackendKind;
  readonly pgPool: pg.Pool | null;
  readonly eviction: EvictionState;
  /** v0.7 T0.1 (ADR D5): the LLM instance, surfaced so `getConflictResolutionPolicy('llm-judged-merge')` can close over it (lazy reuse — no second OpenAI client init per request). */
  readonly llm: LLM;
  /**
   * v0.7 T0.1 (EC-1) + adapters-or-local T2.1 (ADR D6):
   * which adapter source resolved at boot. `'stub'` →
   * `getConflictResolutionPolicy('llm-judged-merge')` throws
   * `StubLlmNotUsableForLjmError` (would silently abstain otherwise; violates
   * Rule 3 + ADR D3). `'local-openrouter'` passes the LJM guard intentionally
   * because the LLM is `OpenAILLM` routed via `OPENAI_BASE_URL` env var to
   * OpenRouter's chat-completion API (real LLM; JSON-judged-merge works).
   */
  readonly adapterSource: "stub" | "openai" | "local-openrouter";
  /**
   * adapters-or-local T2.1 (ADR D2 + ADR D6): embedding dim resolved at boot.
   * Surfaced via `/api/info` so the operator UI can show which embedder
   * dim the demo is running with (1536 for stub/openai, 384 for
   * local-openrouter via Xenova/all-MiniLM-L6-v2).
   */
  readonly embedderDim: number;
}

/**
 * adapters-or-local T2.1 (ADR D6 + EC-11): canonical demo backend mode
 * selector. Reads `THEOMEM_DEMO_BACKEND` first (canonical signal); falls back
 * to legacy `THEOMEM_USE_STUB_ADAPTERS=1` for backward compat (sunset
 * 2026-09-01 per ADR D6).
 *
 * EC-11 absorption: unknown values (e.g., `local_openrouter` underscore
 * typo, `LOCAL-OPENROUTER` uppercase, generic typos) throw an explicit
 * Error at boot listing the 3 valid values + the offending value verbatim.
 * Silent fall-through to default would mislead the operator into thinking
 * their explicit selection took effect, violating Inquebrável Rule 3.
 *
 * Exported for unit-testing the precedence ladder in isolation
 * (tests/unit/examples/chat-with-memory-memory.test.ts per EC-13).
 *
 * /review F-Mi3 — module-boundary discipline: this helper is exported
 * SOLELY so the env-var precedence ladder + EC-11 loud-fail can be
 * tested without bootstrapping the full singleton (which would require
 * starting a pgvector container + downloading the Xenova model). It is
 * NOT part of the demo's public API; consumers should call
 * `getMemory()` / `getSingleton()` instead.
 *
 * @see .claude/knowledge-base/plans/adapters-openrouter-local-embedder-plan.md § T2.1 + ADR D6
 * @see .claude/knowledge-base/reviews/adapters-openrouter-local-embedder-edge-cases-2026-06-01.md § EC-11 + EC-13
 */
export type BackendMode = "stub" | "openai" | "local-openrouter";
const VALID_BACKEND_MODES: readonly BackendMode[] = ["stub", "openai", "local-openrouter"];

/**
 * /review F-M12 EC-10 — exported for unit-testing the silent-misroute
 * guard in isolation (so the test does NOT have to construct
 * `LocalTransformerEmbedder` which would download the Xenova model).
 *
 * Emits a `console.warn` ONLY when the mode is `local-openrouter` AND
 * `OPENAI_BASE_URL` is missing or empty. Operator's OpenRouter-only key
 * would otherwise return 401 against the OpenAI default URL with no
 * diagnostic context. Inquebrável Rule 8: fail-loud over silent misroute.
 *
 * @internal demo-only helper; not part of the SDK public API.
 */
export function warnIfLocalOpenrouterMissingBaseUrl(): void {
  if (
    process.env.OPENAI_BASE_URL === undefined ||
    process.env.OPENAI_BASE_URL === ""
  ) {
    // eslint-disable-next-line no-console
    console.warn(
      "[theomemory-demo] THEOMEM_DEMO_BACKEND=local-openrouter is set but " +
        "OPENAI_BASE_URL is missing. OpenAILLM will route to the OpenAI " +
        "default URL — if your key is OpenRouter-only this will 401. " +
        "Set OPENAI_BASE_URL=https://openrouter.ai/api/v1 in .env.",
    );
  }
}

/**
 * Demo env-shift for local-openrouter mode.
 *
 * The OpenAI Node SDK is hardcoded to read `OPENAI_API_KEY`. Operators using
 * OpenRouter naturally store their key under `OPENROUTER_KEY` (or
 * `OPENROUTER_API_KEY`) in `.env`. When mode is `local-openrouter` and
 * `OPENAI_API_KEY` is missing but `OPENROUTER_KEY` / `OPENROUTER_API_KEY` is
 * present, promote the OpenRouter var into `OPENAI_API_KEY` so the OpenAI
 * SDK (running against `OPENAI_BASE_URL=https://openrouter.ai/api/v1`) picks
 * it up. Demo-only; SDK contract is untouched.
 *
 * Also defaults `OPENAI_BASE_URL=https://openrouter.ai/api/v1` when the
 * operator forgot to set it — this is the ONLY URL that makes sense for
 * `local-openrouter` mode, and the missing-baseURL warn (above) still fires
 * before the override so the operator sees the gap.
 *
 * @internal demo-only helper; not part of the SDK public API.
 */
export function adaptOpenrouterEnvForDemo(): void {
  // In local-openrouter mode, the SDK's chat-completions call goes to
  // `OPENAI_BASE_URL=https://openrouter.ai/api/v1`. The key MUST be an
  // OpenRouter key (`sk-or-...`) — an OpenAI key (`sk-...` or `sk-svca-...`)
  // sent to that URL returns 401. So:
  //   1. If OPENROUTER_KEY or OPENROUTER_API_KEY is set, OVERWRITE
  //      OPENAI_API_KEY with the OpenRouter key (even if OPENAI_API_KEY
  //      was already set — the existing value would 401 against OpenRouter).
  //   2. If only OPENAI_API_KEY is set and it already starts with `sk-or-`,
  //      it's an OpenRouter key stored under the OpenAI var name — leave alone.
  //   3. Else (only an OpenAI key, no OpenRouter key): leave alone but the
  //      EC-10 warn already fired explaining the misroute risk.
  const openrouterKey =
    (process.env.OPENROUTER_KEY ?? "") !== ""
      ? process.env.OPENROUTER_KEY
      : process.env.OPENROUTER_API_KEY;
  if (openrouterKey !== undefined && openrouterKey !== "") {
    const existing = process.env.OPENAI_API_KEY ?? "";
    if (existing !== openrouterKey) {
      process.env.OPENAI_API_KEY = openrouterKey;
      // eslint-disable-next-line no-console
      console.log(
        "[theomemory-demo] local-openrouter mode: OPENAI_API_KEY override → " +
          "OPENROUTER_(API_)KEY. The previous value (if any) would have 401'd " +
          "against https://openrouter.ai/api/v1.",
      );
    }
  }
  if (
    process.env.OPENAI_BASE_URL === undefined ||
    process.env.OPENAI_BASE_URL === ""
  ) {
    process.env.OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
    // eslint-disable-next-line no-console
    console.log(
      "[theomemory-demo] OPENAI_BASE_URL defaulted to https://openrouter.ai/api/v1 " +
        "for local-openrouter mode.",
    );
  }
  // OpenRouter requires fully-qualified model ids (`openai/gpt-4o-mini` etc.);
  // the SDK default `gpt-4o-mini` returns 404 against OpenRouter. Default to
  // the most common cheap routable model; operator can override in .env.
  if (
    process.env.OPENAI_CHAT_MODEL === undefined ||
    process.env.OPENAI_CHAT_MODEL === ""
  ) {
    process.env.OPENAI_CHAT_MODEL = "openai/gpt-4o-mini";
    // eslint-disable-next-line no-console
    console.log(
      "[theomemory-demo] OPENAI_CHAT_MODEL defaulted to openai/gpt-4o-mini " +
        "for local-openrouter mode (OpenRouter requires provider/model format).",
    );
  }
}

export function resolveBackendMode(): BackendMode {
  const raw = process.env.THEOMEM_DEMO_BACKEND;
  if (raw !== undefined && raw !== "") {
    if (!(VALID_BACKEND_MODES as readonly string[]).includes(raw)) {
      throw new Error(
        `Invalid THEOMEM_DEMO_BACKEND='${raw}'; expected one of stub / openai / local-openrouter`,
      );
    }
    return raw as BackendMode;
  }
  // Legacy compat: pre-T2.1 callers used THEOMEM_USE_STUB_ADAPTERS=1.
  // Sunset 2026-09-01 per ADR D6.
  if (process.env.THEOMEM_USE_STUB_ADAPTERS === "1") {
    return "stub";
  }
  return "openai";
}

declare global {
  // eslint-disable-next-line no-var
  var _themory_demo_singleton: Promise<MemorySingleton> | undefined;
}

async function buildStore(embeddingDim: number): Promise<{
  vectorStore: VectorStore;
  backend: BackendKind;
  pgPool: pg.Pool | null;
}> {
  const pgUri = process.env.THEOMEM_PG_URI;
  if (typeof pgUri === "string" && pgUri.length > 0) {
    const pgPool = new pg.Pool({ connectionString: pgUri });
    // T2.1 + T0.3 wiring: when running in local-openrouter mode with
    // embeddingDim=384, runMigrations triggers the atomic DROP+ALTER+RECREATE
    // sequence so the pgvector schema matches the Xenova embedder dim.
    // Backward-compat: omit options when dim=1536 (the default) so the
    // ALTER sequence does NOT run for stub/openai callers.
    await runMigrations(pgPool, { embeddingDim });
    return {
      vectorStore: new PgvectorStore(pgPool, { embeddingDim }),
      backend: "pgvector",
      pgPool,
    };
  }
  // InMemoryVectorStore is dim-agnostic (uses array.length dynamically;
  // verified empirically during T2.1 SEPA pre-RED). No dim parameter
  // needed for the in-memory path.
  return {
    vectorStore: new InMemoryVectorStore(),
    backend: "in-memory",
    pgPool: null,
  };
}

/**
 * Eviction is enabled iff `THEOMEM_EVICTION_DEMO=1` (strict equality) AND
 * `backend === 'pgvector'` (advisory locks + cosine distance are PG-only;
 * `EvictionNotSupported` would throw otherwise). Per plan ADR D1 the demo
 * opt-in is strict equality with `"1"`; per plan §216 this shape is the
 * contract consumed by the `EvictionTab` UI (T1.3).
 *
 * Hotfix `b2909ff` (`hotfix-2026-05-31`) was lifted 2026-06-01 by
 * f-t4-1-2-eviction-race-debug T3.1. SDK regression guard:
 * `tests/integration/forgetting/f-t4-1-2-stub-reproduction.test.ts` (400+
 * trials PASS). The `hotfix-2026-05-31` reason value is retained in the
 * DisabledReason union for backward compat with `/api/memory/eviction-status`
 * snapshots but is no longer emitted by `resolveEviction`.
 */
type DisabledReason = "env" | "backend" | "hotfix-2026-05-31";

function resolveEviction(backend: BackendKind): {
  state: EvictionState;
  reason: DisabledReason | null;
  config: LocalEvictionConfig | undefined;
} {
  const envOptedIn = process.env.THEOMEM_EVICTION_DEMO === "1";
  if (envOptedIn && backend === "pgvector") {
    const maxMemoriesPerScope = 10;
    return {
      state: {
        enabled: true,
        trigger: "capacity",
        maxMemoriesPerScope,
      },
      reason: null,
      config: { trigger: "capacity", maxMemoriesPerScope },
    };
  }
  return {
    state: { enabled: false, trigger: null, maxMemoriesPerScope: null },
    reason: envOptedIn ? "backend" : "env",
    config: undefined,
  };
}

/**
 * T3.1 (adapters-cycle-1 / ADR D5): `THEOMEM_USE_STUB_ADAPTERS=1` swaps
 * OpenAI for deterministic stubs. Unblocks offline debug + reproducible
 * runs without external API.
 *
 * @see .claude/knowledge-base/plans/adapters-stub-embedder-llm-cycle-1-plan.md § T3.1
 */
/**
 * adapters-or-local T2.1 (ADR D6): 3-way adapter resolution based on
 * `resolveBackendMode()`. `embedderDim` is the canonical dim for each mode
 * (1536 for stub + openai matching MAX_EMBEDDING_DIM; 384 for
 * local-openrouter matching the Xenova/all-MiniLM-L6-v2 default).
 */
function resolveAdapters(
  mode: BackendMode,
): { embedder: Embedder; llm: LLM; source: BackendMode; embedderDim: number } {
  switch (mode) {
    case "stub":
      return {
        embedder: new DeterministicStubEmbedder(),
        llm: new DeterministicStubLLM(),
        source: "stub",
        embedderDim: 1536,
      };
    case "openai":
      return {
        embedder: new OpenAIEmbedder(),
        llm: new OpenAILLM(),
        source: "openai",
        embedderDim: 1536,
      };
    case "local-openrouter":
      // OpenAILLM SDK natively reads OPENAI_BASE_URL env var per ADR D5
      // (verified at node_modules/openai/index.mjs:46). Operator sets
      // OPENAI_BASE_URL=https://openrouter.ai/api/v1 in .env. No SDK code
      // change required for LLM routing.
      // Embedder runs locally via Xenova Wasm (no OpenAI account needed).
      //
      // /review F-M12 EC-10: warn loudly when local-openrouter mode is
      // selected but OPENAI_BASE_URL is missing (silent misroute → 401
      // when the operator has an OpenRouter-only key).
      warnIfLocalOpenrouterMissingBaseUrl();
      // Demo env-shift: promote OPENROUTER_KEY → OPENAI_API_KEY + default
      // OPENAI_BASE_URL to the OpenRouter v1 URL so the OpenAI SDK works
      // with the operator's natural .env shape. Runs AFTER the warn so the
      // missing-baseURL signal is preserved.
      adaptOpenrouterEnvForDemo();
      return {
        embedder: new LocalTransformerEmbedder(),
        llm: new OpenAILLM(),
        source: "local-openrouter",
        embedderDim: 384,
      };
  }
}

export function getSingleton(): Promise<MemorySingleton> {
  if (globalThis._themory_demo_singleton === undefined) {
    globalThis._themory_demo_singleton = (async () => {
      const mode = resolveBackendMode();
      const { embedder, llm, source: adapters, embedderDim } = resolveAdapters(mode);
      const reflectionPolicy = new DemoManualReflectionPolicy();
      const { vectorStore, backend, pgPool } = await buildStore(embedderDim);
      const { state: eviction, reason, config: evictionConfig } = resolveEviction(backend);
      const factoryConfig: LocalMemoryConfig = {
        embedder,
        llm,
        vectorStore,
        reflectionPolicy,
        embeddingDim: embedderDim,
        ...(evictionConfig !== undefined ? { eviction: evictionConfig } : {}),
      };
      const memory = await createLocalMemory(factoryConfig);
      const evictionLine = eviction.enabled
        ? `eviction=enabled (capacity, max=${String(eviction.maxMemoriesPerScope)})`
        : `eviction=disabled (reason: ${reason})`;
      /* eslint-disable no-console */
      console.log(`[theomemory-demo] backend=${backend}`);
      console.log(`[theomemory-demo] adapters=${adapters}`);
      console.log(`[theomemory-demo] embedderDim=${String(embedderDim)}`);
      console.log(`[theomemory-demo] ${evictionLine}`);
      /* eslint-enable no-console */
      return { memory, backend, pgPool, eviction, llm, adapterSource: adapters, embedderDim };
    })();
  }
  return globalThis._themory_demo_singleton;
}

export async function getMemory(): Promise<Memory> {
  return (await getSingleton()).memory;
}

export async function getBackend(): Promise<BackendKind> {
  return (await getSingleton()).backend;
}

/**
 * v0.7 T0.1 (ADR D2 + ADR D5 + EC-1 absorption) — type union surfaced for
 * reuse by the `/api/memory/distill` route (T1.1) + `DistillationTab` (T2.1).
 */
export type PolicyName = "noop" | "last-write-wins" | "llm-judged-merge";

/**
 * v0.7 T0.1 / EC-1: thrown when the consumer asks for `'llm-judged-merge'`
 * while the demo is running with `THEOMEM_USE_STUB_ADAPTERS=1`. The stub LLM
 * returns empty `{}` from `generateResponse({type:'json'})` → policy abstains
 * silently → operator misled about which policy actually executed. ADR D3
 * mandates NO silent fallback; this error is the structured signal the
 * `/api/memory/distill` route catches + maps to `422 { code:
 * 'STUB_LLM_NOT_USABLE_FOR_LJM' }`.
 *
 * Follows the `Object.setPrototypeOf` pattern from `src/core/errors.ts` so
 * `instanceof` survives ESM/CJS boundary + dynamic imports.
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-7-distillation-plan.md § T0.1 + ADR D3
 * @see .claude/knowledge-base/reviews/examples-chat-with-memory-v0-7-distillation-edge-cases-2026-06-01.md § EC-1
 */
export class StubLlmNotUsableForLjmError extends Error {
  override readonly name = "StubLlmNotUsableForLjmError" as const;
  constructor(options?: ErrorOptions) {
    super(
      "LlmJudgedMergeConflictPolicy requires a real LLM (OpenAI/Anthropic/...). " +
        "Currently THEOMEM_USE_STUB_ADAPTERS=1, so DeterministicStubLLM is wired. " +
        "Unset THEOMEM_USE_STUB_ADAPTERS or pick 'noop' / 'last-write-wins'.",
      options,
    );
    Object.setPrototypeOf(this, StubLlmNotUsableForLjmError.prototype);
  }
}

/**
 * v0.7 T0.1 (ADR D2 + ADR D5): policy factory for the demo. Closes over the
 * singleton's `llm` instance for `llm-judged-merge` (lazy — only instantiated
 * inside the matching switch case so `noop` / `last-write-wins` paths don't
 * touch the OpenAI client).
 *
 * EC-1 absorption: when `adapterSource === 'stub'` AND `name ===
 * 'llm-judged-merge'`, throws `StubLlmNotUsableForLjmError`. The detection
 * uses the boot-time `adapterSource` field (NOT `llm.constructor.name`
 * which is fragile under minification / subclass).
 *
 * EC-3 defense-in-depth: throws on unknown `name` via exhaustive `never`
 * guard. Primary validation lives in the `/api/memory/distill` route (T1.1).
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-7-distillation-plan.md § T0.1 + ADR D2 + D5
 * @see .claude/knowledge-base/reviews/examples-chat-with-memory-v0-7-distillation-edge-cases-2026-06-01.md § EC-1
 */
export async function getConflictResolutionPolicy(
  name: PolicyName,
): Promise<ConflictResolutionPolicy> {
  switch (name) {
    case "noop":
      return new NoopConflictPolicy();
    case "last-write-wins":
      return new LastWriteWinsConflictPolicy();
    case "llm-judged-merge": {
      const singleton = await getSingleton();
      if (singleton.adapterSource === "stub") {
        throw new StubLlmNotUsableForLjmError();
      }
      return new LlmJudgedMergeConflictPolicy({ llm: singleton.llm });
    }
    default: {
      const exhaustive: never = name;
      throw new Error(`Unknown policy name: ${String(exhaustive)}`);
    }
  }
}
