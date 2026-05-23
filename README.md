<div align="center">

<img src="https://usetheo.dev/logo-128.webp" alt="Theo" width="96" height="96" />

**`@usetheo/memory`** · the **managed memory** auxiliary of the [Theo ecosystem](https://usetheo.dev)

# Memory that lives where your agent lives.

A managed memory layer for AI agents — **three tiers (User, Session, Agent)**, vector-based hybridd retrieval, **native to [TheoKit](../theokit), managed by [TheoCloud](../theo)**. The persistent-state verb of **Chat. Build. Deploy.**

*Vector + hybrid retrieval + LLM fact extraction. Local mode for dev. Cloud runtime for production. MIT.*

[![License](https://img.shields.io/badge/license-MIT-7C3AED?style=flat-square)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/typescript-5.8%2B-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Status](https://img.shields.io/badge/status-pre--release-orange?style=flat-square)](#status)
[![Runtime](https://img.shields.io/badge/runtime-local%20%2B%20TheoCloud-7C3AED?style=flat-square)](#two-runtimes-one-api)

[Quickstart](#quickstart) · [Three Tiers](#three-tiers) · [Why](#why-usetheomemory) · [Runtimes](#two-runtimes-one-api) · [Architecture](#architecture) · [Status](#status)

</div>

---

## The shift

There is a version of your agent that remembers who its users are.

It does not greet returning customers as strangers. It does not re-ask the dietary restriction it learned last Tuesday. It does not forget — between yesterday's deploy and today's — the playbook it spent an hour figuring out. The session ends. The user, and the agent, do not.

And the place that **deploys** the agent is the same place that **remembers** for it. One account. One dashboard. One platform.

`@usetheo/memory` is the managed memory layer for the [TheoKit](../theokit) + [TheoCloud](../theo) agent stack — three tiers, vector-based hybrid architecture, MIT-licensed SDK, with a local mode for development and a managed runtime in TheoCloud for production.

## Why `@usetheo/memory`

The agentic-memory space is **crowded and well-funded** — REDACTED ($24M, ~56k stars), REDACTED ($10M, ~23k stars), REDACTED/REDACTED (YC W24, ~26k stars), REDACTED ($5.35M), REDACTED, REDACTED. Each carries a strong opinion on architecture and a strong opinion on lock-in.

`@usetheo/memory` is not trying to win on benchmarks against players with two years of head start. It is trying to be **the memory line item on your TheoCloud invoice** — the managed memory that ships with the platform you already deploy on.

If [Vercel KV](https://vercel.com/storage/kv) is "the key-value store that ships with the framework", `@usetheo/memory` is **the memory store that ships with the agent platform**. Same idea: deep coupling as a feature, not an apology.

| Capability | `@usetheo/memory` | REDACTED | REDACTED | REDACTED / REDACTED | REDACTED |
|---|---|---|---|---|---|
| **Frame** | The managed memory of TheoCloud, optimized for TheoKit | Framework-agnostic drop-in SDK | Stateful agent runtime + memory | Bi-temporal knowledge graph | REDACTED memory store |
| Architecture | vector-based hybrid: vector + LLM extraction + hybrid retrieval (semantic + BM25 + entity matching) | Same — pioneered the shape | OS-hierarchical (RAM + disk paging) | Temporal knowledge graph | Three-type semantic / episodic / procedural |
| User memory (semantic, cross-session) | ✓ | ✓ | ✓ (core blocks) | ✓ | ✓ |
| Session memory (episodic, scoped) | ✓ | ✓ | Implicit (single thread) | ✓ (episodes) | ✓ |
| Agent memory (procedural, learned skills) | ✓ (skill-based) | Limited | Limited (core blocks) | Limited | ✓ (prompt rewriting) |
| Local runtime (dev / CI) | ✓ Postgres + pgvector | ✓ self-host | ✓ Postgres + pgvector | Self-host a graph database etc. | REDACTED `BaseStore` |
| Managed runtime | **TheoCloud — single platform for deploy + memory** | REDACTED Cloud (separate account) | REDACTED Cloud (separate account) | REDACTED Cloud (separate account) | REDACTED Platform |
| Framework coupling | **Native to TheoKit by design** | Framework-agnostic | High (REDACTED owns the agent loop) | Framework-agnostic | High (REDACTED) |
| License | **MIT** | Apache-2.0 | Apache-2.0 | Apache-2.0 (REDACTED) | MIT |
| Single-vendor consolidation | **Yes** — same dashboard as your deploy | No (REDACTED Cloud is separate) | No | No | No |

REDACTED won drop-in. REDACTED won the self-editing agent. REDACTED won bi-temporal auditing. **`@usetheo/memory` is the option you reach for when you have already chosen TheoKit + TheoCloud** — and you want memory on the same invoice, same dashboard, same access control, same support contract.

If you are not on TheoKit, [REDACTED](https://REDACTED.ai) is a great pick.

## Three tiers

Three memory scopes, one API. The taxonomy follows cognitive psychology (episodic, semantic, procedural) mapped onto the surface a real agent needs.

| Tier | Scope | Lifetime | Example |
|---|---|---|---|
| **User memory** | One user, across every session and every agent in the workspace | Durable | "Speaks Portuguese. Lives in São Paulo. Allergic to peanuts." |
| **Session memory** | One conversation thread | Window-bounded | "User asked about pricing tier B in turn 3. We promised a callback." |
| **Agent memory** | One agent, learned procedurally over many runs | Durable | "When the user types `/refund`, check the last 3 invoices before opening a ticket." |

Same `remember` / `recall` / `forget` / `reflect` verbs across all three tiers — the scope is a parameter, not three separate APIs.

## What you'd ship

- **Customer support assistant that knows the user.** Past tickets, dietary restrictions, account tier, prior escalations — recalled without a separate CRM lookup.
- **Healthcare intake bot.** Patient preferences, medication allergies, communication style persist across visits. Session memory bounded by appointment.
- **Productivity copilot.** Adapts to the user's writing voice, project conventions, and recurring workflows. Agent memory accumulates the playbooks that worked.
- **Coding agent with project memory.** Per-repo skill library — fix recipes, file conventions, migration patterns — accumulates across PRs. skill-based procedural memory tied to a real workspace.
- **Multi-tenant agent SaaS.** Workspace-scoped isolation; user identity, session state, and agent skills never cross tenants. Native to TheoKit's per-request context.
- **Game NPC with continuity.** Player history, in-game decisions, and emergent NPC personality survive session restarts.

---

## How it works

Below this line, full technical vocabulary is in play. Installation, the two runtimes, the planned API contract, the three tiers in code, architecture, and status.

## Quickstart (v0.1 local runtime)

> **Pre-release.** Not production-ready. Status: dogfooding via the `/dogfood` gate. The embedding dimension is capped at **1536** at v0.1 (see plan ADR D1.7 in `.claude/knowledge-base/plans/v0-1-local-runtime-plan.md`).

The v0.1 local runtime ships as: TypeScript library + Postgres + pgvector container + your-supplied LLM and Embedder. Wiring:

```bash
# 1. Boot the local pgvector container
docker compose up -d pgvector
# (port conflict on 5432? POSTGRES_PORT=5433 docker compose up -d pgvector — see .env.example)

# 2. Set the connection env var (matches docker-compose.yaml defaults)
export THEOMEM_PG_URI=postgresql://themem:themem@localhost:5432/themem

# 3. Enable pgvector + push schema (dev — uses drizzle-kit push; production should
#    instead run npm run db:generate + apply the SQL migrations via the Drizzle
#    migrator at app boot)
psql $THEOMEM_PG_URI -c "CREATE EXTENSION IF NOT EXISTS vector"
npm run db:push -- --force
```

Minimum usage from TypeScript:

```ts
import { createMemory, PgvectorStore, DrizzleHistoryManager } from '@usetheo/memory'
import { drizzle } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { OpenAILLM, OpenAIEmbedder } from './your-providers' // consumer-supplied

const pool = new pg.Pool({ connectionString: process.env.THEOMEM_PG_URI! })
const db = drizzle(pool)

const memory = await createMemory({
  vectorStore: new PgvectorStore(pool),
  embedder: new OpenAIEmbedder({ model: 'text-embedding-3-small', dimensions: 1536 }),
  llm: new OpenAILLM({ model: 'gpt-4o-mini' }),
  historyManager: new DrizzleHistoryManager(db),
})

// Write
await memory.user('alice').remember('Paulo likes coffee')

// Read
const results = await memory.user('alice').recall('beverages', { topK: 3 })
// → MemoryItemWithScore[] sorted by combined score (semantic + BM25 + entity boost)
```

**Important constraints at v0.1:**

- Embedder MUST return 1536-dim vectors (`createMemory` probes at startup; mismatched dim throws `EmbeddingMismatch` immediately).
- `forget(unknown_id)` throws `MemoryNotFound` (divergence from REDACTED's silent no-op).
- `reset({})` throws `InvalidScope` — explicit scope key required (prevents accidental wipe).
- `recall({ asOf })` throws `BiTemporalNotSupportedLocally` — bi-temporal queries land in the cloud runtime at v0.5.
- `reflect()` throws `ReflectionNotConfigured` — reflection algorithm lands at v0.4a (roadmap Item 5).

For the full Quickstart end-to-end test, see `tests/integration/local-runtime.test.ts`.



## Status — v0.2 PR-A (TheoKit binding) shipped; PR-B + cloud + reflection in design

> `@usetheo/memory` is **pre-release**. v0.0 (type contract) shipped via PR #4 on 2026-05-22; v0.1 (core + local runtime) shipped via PR #8 on 2026-05-23; v0.2 PR-A (TheoKit binding) shipped via PR #11 on 2026-05-23. **No package is published yet** — the `@usetheo/memory` name is reserved. The TheoCloud managed runtime depends on [Theo PaaS](../theo) (pre-release) reaching general availability.
>
> What works today (v0.1 local runtime, against `ankane/pgvector:v0.5.1`):
> - **`createMemory` factory** + `runMigrations` helper + public barrel at `@usetheo/memory`.
> - **Three-tier scope** (`memory.user(id)` / `memory.session(id)` / `memory.agent(id)`) with isolation enforced at the SQL `WHERE` level.
> - **8-phase write pipeline** ported verbatim from REDACTED with per-row fallback at every I/O boundary + OpenTelemetry spans per phase.
> - **9-step search** with additive `(semantic + BM25 + entity_boost) / max_possible` scoring, threshold-gates-semantic-BEFORE-combining invariant, BM25 via Postgres `to_tsvector` + sigmoid normalization adapted to query length.
> - **MD5 hash dedup** (no normalization; matches REDACTED byte-level behavior) + **Porter lemmatization** (optional `natural` peer + in-house `simpleStem` fallback).
> - **Two `VectorStore` adapters**: in-memory (Map-backed, ~200 LoC) for unit tests + dev quickstart; pgvector (raw SQL via `pg`) for production. Both pass identical 17-test conformance suite.
> - **`DrizzleHistoryManager`** for append-only audit trail (`Memory.history(id)` reverse-chronological).
> - **Drizzle schema** with bi-temporal columns (`tValid`/`tInvalid` nullable per ADR-0006), HNSW pgvector index on 1536-dim embedding column (cap locked per plan ADR D1.7 due to pgvector 0.5.1's 2000-dim HNSW limit).
> - **Test coverage**: 229 contract tests (unit + type) + 28 integration tests against real pgvector. Zero CRITICAL/HIGH CVE (4 MODERATE allowlisted, dev-only `esbuild` chain via drizzle-kit, sunset 2026-08-23).
>
> What is still honest:
> - **Pre-release.** No package published. No "production-ready" claim until v1.0 with reproduced benchmarks (LongMemEval + LoCoMo + DMR) per the macro roadmap.
> - **Cloud runtime not built yet.** v0.5 depends on TheoCloud (pre-release) GA.
> - **Reflection algorithm not built yet.** `reflect()` throws `ReflectionNotConfigured` at v0.1; v0.4a roadmap Item 5 lands the actual algorithm behind the `ReflectionPolicy` DIP.
> - **TheoKit binding shipped (PR-A).** `@usetheo/memory/theokit` subpath exports `memoryFromCtx(ctx, memory)` — auto-scopes `user_id` from `ctx.session.userId` via structural typing (zero peer-dep on `theokit`, ADR D1). 3-state resolver per ADR D4 throws `MissingScopeError` for session-null / session-absent / userId-empty. PR-B (sibling `theokit` repo) coordinates default-on memory in scaffolded `create-theo` templates per ADR D7 — pending; until then consumers add `@usetheo/memory` as a dep + wire the singleton manually per the binding example above.
> - **MCP tools not built yet.** `@usetheo/memory/agent-tools` subpath ships at v0.3 (roadmap Item 4).
> - **MIT license is intentional and differs from the monorepo Apache-2.0 standard** (locked 2026-05-14). Maximum permissiveness for proprietary embeds.
>
> If you are evaluating *today* and need something running in production *today*, mature alternatives exist ([REDACTED](https://REDACTED.ai), [REDACTED](https://www.REDACTED.com), [REDACTED](https://www.REDACTED.com)). `@usetheo/memory` is what you reach for when your stack is TheoKit + TheoCloud OR you want a vector-based hybrid memory primitive without the framework lock-in.

## Two runtimes, one API

Runtime is picked by which key you pass to `Memory.create()` — `local` or `cloud`. Same API surface either way; same three tiers either way.

| Runtime | What it does | When to use |
|---|---|---|
| **Local** | Runs against your own Postgres + pgvector. Embeddings via your provider key. | Dev, CI, self-hosted demos, evaluation against your data. |
| **TheoCloud (managed)** | Runs in TheoCloud against a managed vector store with managed embeddings, managed LLM extraction, and managed retrieval. Same TheoCloud account that deploys your TheoKit app. | Production. Same dashboard as your deploy, one invoice, one access control surface. |

Premium capabilities (graph memory, multi-tenant audit trails, managed embedding pricing, cross-region replication) ship in the TheoCloud runtime. The local runtime stays open and useful for development — it is not a crippled demo.

## Planned API contract

The contract below is the design target. Treat snippets as the **shape** the implementation will conform to, not as code you can run today.

### Installation

```bash
npm install @usetheo/memory     # reserved; not yet published
```

### Local runtime — dev and CI

```typescript
import { Memory } from "@usetheo/memory";

const memory = await Memory.create({
  local: {
    storage: { type: "postgres", url: process.env.DATABASE_URL! },
  },
  embeddings: { provider: "openai", model: "text-embedding-3-small" },
  workspace: "acme-support",
});
```

### TheoCloud runtime — production

```typescript
import { Memory } from "@usetheo/memory";

const memory = await Memory.create({
  cloud: { apiKey: process.env.THEOKIT_API_KEY! },
  workspace: "acme-support",
});
```

Same `THEOKIT_API_KEY` as the rest of the Theo ecosystem (`@usetheo/sdk`, TheoCloud deploys). No separate account. No separate billing.

### Three-tier scopes

```typescript
// User memory — durable identity, cross-session
await memory.user("user-42").remember(
  "Speaks Portuguese. Vegetarian. Prefers concise responses."
);

// Session memory — scoped to one conversation
const session = memory.session("session-abc");
await session.remember({
  role: "assistant",
  text: "Promised a callback by Friday about the refund.",
});

// Agent memory — procedural skills the agent learned
await memory.agent("support-bot").remember({
  skill: "refund-flow",
  body: "Check last 3 invoices, verify chargeback window, open ticket.",
});

// Unified recall — pulls from whichever tiers the call enables
const context = await memory.recall("What does the user prefer?", {
  user: "user-42",
  session: "session-abc",
  agent: "support-bot",
  scopes: ["user", "session"],
  limit: 8,
});

console.log(context.items);
// → [{ tier: "user", text: "Speaks Portuguese...", score: 0.91, ... }]
```

Same verbs, scope-aware:

```typescript
// remember(fact, options)
await memory.user(userId).remember("Allergic to peanuts");
await memory.session(sessionId).remember({ role: "user", text: "..." });
await memory.agent(agentId).remember({ skill: "refund-flow", body: "..." });

// recall(query, options)
const userFacts = await memory.user(userId).recall("dietary restrictions");
const recentTurns = await memory.session(sessionId).recall(null, { limit: 20 });
const skill = await memory.agent(agentId).recall("how to refund");

// forget(predicate, options)
await memory.user(userId).forget({ olderThan: "30d" });
await memory.session(sessionId).clear();

// reflect — consolidate episodic into semantic (Generative Agents-shaped)
await memory.agent(agentId).reflect({ window: "7d" });
```

### TheoKit-native binding (`@usetheo/memory/theokit`)

When the consumer is a [TheoKit](../theokit) app, the binding auto-scopes memory from the request context — no explicit `memory.user(id)` thread through every handler. The lock-in surface is **opt-in via a separate subpath** (consumers not using TheoKit pay zero binding bundle cost):

```typescript
// server/routes/notes.ts (TheoKit route)
import { defineRoute, requireAuth } from "theokit/server";
import { memoryFromCtx } from "@usetheo/memory/theokit";
import { z } from "zod";

import { memory } from "../memory.js"; // your app-scoped singleton

export const POST = defineRoute({
  body: z.object({ text: z.string() }),
  handler: async ({ ctx, body }) => {
    requireAuth(ctx.session);
    await memoryFromCtx(ctx, memory).remember(body.text);
    return { ok: true };
  },
});
```

`memoryFromCtx(ctx, memory)` reads `ctx.session.userId` structurally — zero peer-dependency on the `theokit` package. The resolver has three explicit states:

- **(a)** `userId` is a non-empty string → returns `memory.user(userId)`
- **(b)** `ctx.session === null` (unauthenticated) → throws `MissingScopeError` with guidance to call `requireAuth(ctx.session)` first
- **(c)** `session` field absent OR `userId` undefined/non-string/empty/whitespace → throws `MissingScopeError` with guidance to wire `createSessionManager`

`MissingScopeError` is re-exported from the same subpath for `instanceof` checks in error boundaries.

v0.2 resolves the **`userId` tier only**; consumers needing `sessionId` or `agentId` scoping call `memory.session(id)` / `memory.agent(id)` directly per the three-tier API. Multi-tier auto-resolution may land in a later milestone. Default-on memory in scaffolded `create-theokit` templates (`saas` + `postgres`) is **planned** as a follow-up — until that lands, consumers add `@usetheo/memory` as a dep + wire the singleton themselves.

Outside TheoKit the framework-agnostic API is identical — wire `user` / `session` / `agent` manually. **Inside TheoKit, the binding reads them from `ctx.session` for you.** That is the lock-in this project owns explicitly.

### Retrieval — vector-based hybrid, multi-signal

Each `recall` runs the same hybrid retrieval pipeline:

```
candidates = pgvector(semantic ANN) ∪ BM25(lexical) ∪ entity_match(extracted entities)
score      = recency(decay) × importance(LLM-judged 1-10 at write) × relevance(cosine)
```

Pure cosine similarity is provably worse for agent behavior over long horizons (Park et al. 2023, *Generative Agents*). The recency × importance × relevance triad is the default. Hybrid candidate generation matches REDACTED's v2 retrieval shape (semantic + BM25 + entity).

### Write pipeline — two-stage, ADD-only

Following REDACTED v2.0 (April 2026), the write path is two-stage and **ADD-only**:

1. **Extract** — recover top-K related memories for dedup context, single LLM call extracts all distinct facts from the new turn.
2. **Update** — batch embed → hash-dedup → batch insert with entity linking.

Old memories are not overwritten. Conflicts produce new facts with their own `t_valid` window. This trades disk for auditability — every claim the agent ever made is traceable.

### Memory operations as agent tools

When `@usetheo/memory` runs alongside an agent SDK (e.g., [`@usetheo/sdk`](../theokit-sdk)), the tier verbs are exposed as MCP tools — the agent decides when to remember, recall, and forget rather than the framework deciding for it. This follows the REDACTED lesson: **function-calling memory ops outperform hardcoded heuristics**.

```typescript
import { Agent } from "@usetheo/sdk";
import { memoryTools } from "@usetheo/memory/agent-tools";

const agent = await Agent.create({
  apiKey: process.env.THEOKIT_API_KEY!,
  model: { id: "google/gemini-2.0-flash-001" },
  local: { cwd: process.cwd() },
  tools: memoryTools(memory),    // exposes remember/recall/forget/reflect
});
```

## Architecture

```
@usetheo/memory/
├── packages/
│   ├── core/                    Memory class, MemoryStore interface (DIP)
│   │   ├── tiers/               UserMemory, SessionMemory, AgentMemory
│   │   ├── retrieval/           recency × importance × relevance scorer
│   │   ├── pipeline/            two-stage extract → update pipeline
│   │   ├── consolidation/       reflect() — episodic → semantic
│   │   └── types.ts             public type contract
│   ├── local/                   Postgres + pgvector local runtime
│   ├── cloud/                   TheoCloud managed runtime client
│   ├── embeddings/              provider abstraction (OpenAI, Anthropic, local)
│   ├── theokit/                 TheoKit-native binding (request-context aware)
│   └── agent-tools/             MCP tools for @usetheo/sdk agents
```

### Dependency direction (planned, enforced at CI)

```
core              → (nothing, type-only)
local             → core
cloud             → core
embeddings        → core
theokit           → core, embeddings
agent-tools       → core
```

The `MemoryStore` interface in `core/` is the DIP boundary. Both `local/` and `cloud/` implement it. Consumers depend on `core/` only — they switch runtimes by changing one config block.

### Local storage — pgvector

Local mode runs on **Postgres + pgvector** because:

- It is the simplest setup for dev and CI.
- TheoCloud also exposes Postgres, so local-to-cloud migration is feasible.
- pgvector is a single extension, not a separate database, network hop, or query language.
- Hybrid retrieval (vector + BM25 + entity match) fits inside one SQL transaction.

### Cloud storage — TheoCloud-managed

Cloud mode runs against a TheoCloud-managed vector store with managed embeddings, managed LLM extraction, and managed retrieval. The user never sees the underlying engine — that is operational state, not API surface. This follows [Cross-Project Rule 9 (Cloud abstraction)](../CLAUDE.md): user-facing copy says "memory store", not "REDACTED" or "pgvector". The managed runtime is also where premium capabilities live:

- **Graph memory** — entity-relation graph layered on top of fact extraction
- **Bi-temporal audit** — `t_valid` and `t_invalid` windows on every fact for compliance trails
- **Multi-region replication** — for latency-sensitive customer surfaces
- **Managed embedding cost** — no per-call provider billing for embeddings; bundled in TheoCloud usage

## Roadmap

The contract above is the target. The shipping order is:

| Milestone | Scope | Status |
|---|---|---|
| **0.0 — Contract** | Type contract for `Memory`, `MemoryStore`, three tiers, retrieval scorer, two-stage pipeline. | **Shipped 2026-05-22** (PR #4) |
| **0.1 — Core + local runtime** | `core/` + `local/` (Postgres + pgvector). Single backend, three tiers, additive scoring, 8-phase write + 9-step search. | **Shipped 2026-05-23** (PR #8) |
| **0.2 — TheoKit binding** | `theokit/` subpath: `memoryFromCtx(ctx, memory)` auto-scopes from `ctx.session.userId` via structural typing. Default-on in scaffolded TheoKit apps deferred to sibling repo PR-B per ADR D7. | **PR-A shipped 2026-05-23** (PR #11); PR-B pending |
| **0.3 — Agent tools** | `agent-tools/` package: MCP tools for `@usetheo/sdk` agents. | Planned |
| **0.4 — Reflection + forgetting** | `reflect()` pipeline (Generative Agents-shaped). LLM-importance-aware forgetting that preserves long-tail. | Planned |
| **0.5 — TheoCloud runtime** | `cloud/` package + TheoCloud-managed backend. Premium capabilities (graph, multi-region, audit). Depends on Theo PaaS general availability. | Planned |
| **1.0** | Contract stable, benchmarks reproduced independently, production claims allowed. | Planned |

Honest claims only — v0.0 + v0.1 + v0.2 PR-A shipped to git (`main`); package is NOT yet published to npm; no "production-ready" claim until v1.0 with reproduced benchmarks per CLAUDE.md § honesty discipline. The roadmap is the commitment, not the receipt.

## Where this fits

`@usetheo/memory` is a community auxiliary of the [usetheo stack](../README.md), with a managed runtime that lives inside TheoCloud:

| Tier | Project | License | What it does |
|---|---|---|---|
| Apex (paid) | [TheoCloud](../theo) | Commercial | Managed deployment runtime. The product. Hosts the `@usetheo/memory` cloud runtime. |
| Funnel (OSS) | [TheoCode](../theo-code) | Apache-2.0 | Autonomous coding agent. Plan · Code · Infra. |
| Funnel (OSS) | [TheoCreate](../theo-stacks) | Apache-2.0 | Scaffolding for Node/Go/Python/Rust/Java/Ruby/PHP/Next.js. |
| Funnel (OSS) | [TheoKit](../theokit) | Apache-2.0 | Next.js framework for full-stack AI agents. |
| Community auxiliary | [`@usetheo/sdk`](../theokit-sdk) | Apache-2.0 | Build-your-own-agent SDK. |
| Community auxiliary | [`@usetheo/ui`](../theo-ui) | Apache-2.0 | React components for AI agent surfaces. |
| **Community auxiliary** | **`@usetheo/memory`** *(this)* | **MIT** | **Three-tier managed memory layer. Native to TheoKit; runs in TheoCloud.** |

The local runtime is open and works without TheoCloud. The **managed runtime is the strategic focus** — that is where the single-platform consolidation happens (deploy + memory + agent SDK + UI all on one TheoCloud account).

## Development

This package is not yet published. Once implementation begins:

```bash
nvm use                       # Node 22+ per .nvmrc
corepack enable

pnpm install                  # install workspace deps
pnpm typecheck                # tsc --noEmit across packages
pnpm test                     # vitest
pnpm build                    # tsup → dist/
pnpm check                    # biome lint + format
```

Contributions are welcome once the 0.0 contract lands. Until then, the value-add is on the design itself — open issues against the planned API contract above.

## License

[MIT](./LICENSE) © [usetheo.dev](https://usetheo.dev)

> MIT differs from the monorepo's Apache-2.0 standard (locked 2026-05-14). The choice is deliberate — maximum permissiveness for memory primitives that consumers embed deeply into proprietary systems. The rest of the OSS ecosystem stays Apache-2.0.

## Community

- Discord: https://discord.usetheo.dev/
- X: https://x.com/usetheodev
- LinkedIn: https://linkedin.com/company/usetheodev
