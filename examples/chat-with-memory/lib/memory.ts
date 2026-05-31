/**
 * theo-memory singleton — boots once per Node process.
 *
 * Backend auto-detect (v0.6.1 demo expansion):
 *   - `THEOMEM_PG_URI` set    → `PgvectorStore` + `runMigrations` (real persistence)
 *   - `THEOMEM_PG_URI` unset  → `InMemoryVectorStore` (zero infra)
 *
 * Eviction opt-in (v0.4b demo expansion, T1.1):
 *   - `THEOMEM_EVICTION_DEMO=1` + pgvector backend → `createLocalMemory({
 *     eviction: { trigger: 'capacity', maxMemoriesPerScope: 10 } })`
 *   - Any other combination → no eviction wired (in-memory backend cannot host
 *     the v0.4b pipeline; eviction requires PG advisory locks + pgvector cosine
 *     distance per `EvictionNotSupported` contract).
 *
 * Demonstrates both runtimes of the contract from a single binary surface,
 * and persistence survives `npm run dev` restarts when pgvector is wired.
 *
 * Public exports: `getSingleton`, `getMemory`, `getBackend` — `getSingleton`
 * widened with a new `eviction` field at T1.1, consumed by
 * `/api/memory/eviction-status` (T1.2) and indirectly by `EvictionTab` (T1.3).
 *
 * `globalThis` shares the singleton across Next.js dev's per-route module
 * instances (writes via /api/chat must land in the SAME store as reads via
 * /api/memory/recall — standard Next.js pattern).
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-4b-expansion-plan.md § T1.1
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
  ManualReflectionPolicy,
  ReflectionTrigger,
  Scope,
  VectorStore,
} from "@usetheo/memory/contract";
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
 * T1.1 (v0.4b demo expansion): opt-in eviction wiring.
 * `THEOMEM_EVICTION_DEMO=1` AND `backend === 'pgvector'` toggles the v0.4b
 * capacity-trigger pipeline (max 10 memories per scope; low cap chosen to
 * exercise eviction inside a realistic demo session). Strict equality with
 * `"1"` per plan ADR D1; `"true"` / `"yes"` / `"on"` are silently ignored
 * (POSIX convention, EC-6 accepted).
 *
 * @see .claude/knowledge-base/plans/examples-chat-with-memory-v0-4b-expansion-plan.md § T1.1 + ADR D1
 */
type DisabledReason = "env" | "backend";

function resolveEviction(backend: BackendKind): {
  state: EvictionState;
  reason: DisabledReason | null;
  config: LocalEvictionConfig | undefined;
} {
  const envOptedIn = process.env.THEOMEM_EVICTION_DEMO === "1";
  if (envOptedIn && backend === "pgvector") {
    const maxMemoriesPerScope = 10;
    return {
      state: { enabled: true, trigger: "capacity", maxMemoriesPerScope },
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

export function getSingleton(): Promise<MemorySingleton> {
  if (globalThis._themory_demo_singleton === undefined) {
    globalThis._themory_demo_singleton = (async () => {
      const embedder = new OpenAIEmbedder();
      const llm = new OpenAILLM();
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
