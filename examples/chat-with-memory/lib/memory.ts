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
  PgvectorStore,
  runMigrations,
  type LocalEvictionConfig,
  type LocalMemoryConfig,
  type Memory,
} from "@usetheo/memory";
import type {
  Embedder,
  LLM,
  ManualReflectionPolicy,
  ReflectionTrigger,
  Scope,
  VectorStore,
} from "@usetheo/memory/contract";
import { DeterministicStubEmbedder } from "@usetheo/memory/embedders/stub";
import { DeterministicStubLLM } from "@usetheo/memory/llms/stub";
import pg from "pg";
import { OpenAIEmbedder, OpenAILLM } from "./openai-adapters";

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
}

declare global {
  // eslint-disable-next-line no-var
  var _themory_demo_singleton: Promise<MemorySingleton> | undefined;
}

async function buildStore(): Promise<{
  vectorStore: VectorStore;
  backend: BackendKind;
  pgPool: pg.Pool | null;
}> {
  const pgUri = process.env.THEOMEM_PG_URI;
  if (typeof pgUri === "string" && pgUri.length > 0) {
    const pgPool = new pg.Pool({ connectionString: pgUri });
    await runMigrations(pgPool);
    return {
      vectorStore: new PgvectorStore(pgPool),
      backend: "pgvector",
      pgPool,
    };
  }
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
function resolveAdapters(): { embedder: Embedder; llm: LLM; source: "stub" | "openai" } {
  return process.env.THEOMEM_USE_STUB_ADAPTERS === "1"
    ? { embedder: new DeterministicStubEmbedder(), llm: new DeterministicStubLLM(), source: "stub" }
    : { embedder: new OpenAIEmbedder(), llm: new OpenAILLM(), source: "openai" };
}

export function getSingleton(): Promise<MemorySingleton> {
  if (globalThis._themory_demo_singleton === undefined) {
    globalThis._themory_demo_singleton = (async () => {
      const { embedder, llm, source: adapters } = resolveAdapters();
      const reflectionPolicy = new DemoManualReflectionPolicy();
      const { vectorStore, backend, pgPool } = await buildStore();
      const { state: eviction, reason, config: evictionConfig } = resolveEviction(backend);
      const factoryConfig: LocalMemoryConfig = {
        embedder,
        llm,
        vectorStore,
        reflectionPolicy,
        ...(evictionConfig !== undefined ? { eviction: evictionConfig } : {}),
      };
      const memory = await createLocalMemory(factoryConfig);
      const evictionLine = eviction.enabled
        ? `eviction=enabled (capacity, max=${String(eviction.maxMemoriesPerScope)})`
        : `eviction=disabled (reason: ${reason})`;
      /* eslint-disable no-console */
      console.log(`[theomemory-demo] backend=${backend}`);
      console.log(`[theomemory-demo] adapters=${adapters}`);
      console.log(`[theomemory-demo] ${evictionLine}`);
      /* eslint-enable no-console */
      return { memory, backend, pgPool, eviction };
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
