# TheMemory · Chat that remembers — professional demo

A Next.js 15 chat app that combines all three OSS products of the usetheo
ecosystem to demonstrate **persistent semantic memory in an agent loop**,
**code-as-skill procedural memory**, **session vs user scoping**, and the
**audit-trail invariant** — all live, side-by-side with the agent itself:

- **`@usetheo/sdk`** — agent harness (`Agent.create` + streaming `Run`)
- **`@usetheo/memory`** — four Scope tiers (`User` / `Session` / `Agent` /
  `Repo` for skills) + reflection (v0.4a) + code-as-skill procedural memory
  (v0.6 / v0.6.1) + ADD-only semantics + bi-runtime (in-memory + pgvector)
- **`@usetheo/ui`** — `ChatThread`, `ChatMessage`, `Card`, `Button`, theme
  system, tabbed sidebar primitives

The chat surface lets you talk to an agent that **remembers facts across
sessions** AND **lets you build a per-repo skill library** consumed by code
agents. The right-side panel surfaces every layer the system exposes.

## What's demonstrated

| Layer | Tab | API verbs in play | What you can do |
|---|---|---|---|
| **User scope** (long-lived, cross-session) | `User` | `memory.user(id).remember/recall/forget/reflect/history/getAll` | Watch facts about you accumulate. Refresh — they stay. Manually fire reflection to consolidate noise into higher-order facts. Inspect any fact's history. |
| **Session scope** (mid-lived, this conversation) | `Session` | `memory.session(id).remember/recall/getAll` | See which facts the agent stored ONLY for this conversation. Open a new session (top-right button) to confirm isolation. |
| **Repo scope / Skills** (v0.6, per-repo procedural memory) | `Skills` | `memory.skills(repoId).add/recall/consolidate/forget` | Add code snippets as skills. Recall by semantic query. Run the 4-phase consolidate orchestrator to derive higher-order skills with `derived_from` provenance + supersession chains. |
| **History / audit trail** | `History` | `memory.history(memoryId)` | Click the history icon on any memory in User/Session tabs. See every `remember` / `forget` / `reflect` event that touched it. ADD-only in action. |

## How it wires together

```
┌────────────────────────────────────────────────────────────────────────┐
│ Browser — ChatSurface + tabbed MemorySidebar (User/Session/Skills/    │
│                                                History)                │
└─────────────────────┬──────────────────────────────────────────────────┘
                      │ POST /api/chat { userId, sessionId, message }
                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Next.js route handlers (server-only)                                   │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │ /api/chat  · @usetheo/sdk Agent.create({ systemPrompt })     │    │
│   │   resolver → memory.user(id).recall + memory.session(id).    │    │
│   │              recall (parallel) → <memory-context> with       │    │
│   │              <user-facts> + <session-facts>                  │    │
│   │   after wait → memory.user(id).remember + memory.session     │    │
│   │              (id).remember (parallel) + threshold-based      │    │
│   │              memory.reflect()                                │    │
│   ├──────────────────────────────────────────────────────────────┤    │
│   │ /api/memory/recall          · user scope recall              │    │
│   │ /api/memory/forget          · user scope forget              │    │
│   │ /api/memory/reflect         · manual reflection trigger      │    │
│   │ /api/memory/session         · session scope recall           │    │
│   │ /api/memory/history         · audit trail viewer             │    │
│   │ /api/memory/reflections     · list derived rows + provenance │    │
│   │ /api/skills (GET/POST)      · recall + add (RepoScope)       │    │
│   │ /api/skills/consolidate     · 4-phase orchestrator           │    │
│   │ /api/skills/forget          · scope-isolated forget          │    │
│   │ /api/info                   · backend + threshold metadata   │    │
│   └──────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────┘
```

## Backend auto-detect

The demo boots **in-memory by default** (zero infra). Set `THEOMEM_PG_URI`
and it transparently swaps to `PgvectorStore` + runs migrations on boot —
the same contract, persisted state, cross-restart survival. The badge in
the sidebar header shows which runtime is active.

## Quick start

Prerequisites: **Node ≥ 22.12** (SDK requirement). The repo uses nvm — run
`nvm use` from this directory if you have it installed.

```bash
cd examples/chat-with-memory
cp .env.example .env
# Edit .env: set OPENAI_API_KEY + THEOKIT_API_KEY

npm install
npm run dev
# → http://localhost:3000
```

## Required env

| Var | What it powers | Where to get it |
|---|---|---|
| `OPENAI_API_KEY` | Embeddings (`text-embedding-3-small`) + extraction LLM (`gpt-4o-mini`) inside theo-memory | [platform.openai.com](https://platform.openai.com) |
| `THEOKIT_API_KEY` | `@usetheo/sdk` `Agent.create()` — the agent loop itself | [usetheo.dev](https://usetheo.dev) (public beta) |

## Optional env

| Var | Default | What it does |
|---|---|---|
| `NEXT_PUBLIC_AGENT_MODEL_ID` | `composer-2` | Model id passed to `Agent.create` |
| `THEOMEM_REFLECTION_THRESHOLD` | `10` | Auto-fire `memory.reflect()` every N turns. Set `0` to disable |
| `THEOMEM_PG_URI` | _(unset)_ | When set, swap `InMemoryVectorStore` → `PgvectorStore` + run migrations automatically |

## Walk-through

1. **Send a few messages.** Tell it your name and something you're working
   on. Watch the **User** tab populate with extracted facts; watch the
   **Session** tab populate IN PARALLEL with the same facts scoped to this
   conversation.

2. **Open a new session** (button top-right). User-tab facts persist;
   Session-tab is empty. Same model, same OpenAI key — different scope.

3. **Refresh the page.** Browser state is wiped. Ask "What am I working on?"
   The agent answers because the `systemPromptResolver` pulled your User
   facts into `<memory-context>`.

4. **Inspect history.** Click the history icon on any User/Session fact.
   The History tab opens and shows every event that touched that memory
   id. (In-memory backend has no HistoryManager wired by default — see the
   tab's note. Wire a `DrizzleHistoryManager` with the pgvector backend
   to see real chains.)

5. **Add a skill.** Switch to the **Skills** tab. Add a code snippet with
   a description like _"retry HTTP fetch with exponential backoff"_. Add a
   semantically-similar second skill (e.g. _"axios-based retry with backoff"_).
   Hit **Consolidate** — the 4-phase orchestrator clusters both, produces a
   derived skill, and surfaces `derived_from` pointing at both source ids
   plus the supersession marker on the originals.

6. **Test scope isolation.** Change the `repoId` to something else (e.g.
   `repo-other`). The skill list resets. Try the same forget on a foreign
   skill id (it'll 404 — `MemoryNotFound`, information-leak-safe per
   v0.6.1 T4.1 EC-2).

7. **Watch the reflection stat.** The top bar tracks
   `writes-since-last-reflection / threshold`. When it crosses the
   threshold, a banner flashes "reflect() fired" and the derived row
   appears in the User tab on the next reload.

## Persistent storage (real pgvector)

```bash
# from the monorepo root:
docker compose up -d pgvector
# in examples/chat-with-memory/.env:
THEOMEM_PG_URI=postgresql://postgres:postgres@localhost:5432/postgres
npm run dev
```

Migrations run automatically on boot. The badge in the sidebar header
will turn green and read `pgvector`. Memories now survive `npm run dev`
restarts AND can be inspected directly via `psql`.

## Layout

```
examples/chat-with-memory/
├── app/
│   ├── api/
│   │   ├── chat/route.ts            # POST → SSE stream + reflection event
│   │   ├── info/route.ts            # GET backend metadata
│   │   ├── memory/
│   │   │   ├── recall/route.ts      # GET ?userId&q&limit
│   │   │   ├── forget/route.ts      # POST { userId, id }
│   │   │   ├── reflect/route.ts     # POST { userId }
│   │   │   ├── session/route.ts     # GET ?sessionId&q&limit  ← NEW
│   │   │   ├── history/route.ts     # GET ?memoryId           ← NEW
│   │   │   └── reflections/route.ts # GET ?userId             ← NEW
│   │   └── skills/                  # ← NEW (v0.6 RepoScope)
│   │       ├── route.ts             # GET (recall) + POST (add)
│   │       ├── consolidate/route.ts # POST { repoId }
│   │       └── forget/route.ts      # POST { repoId, skillId }
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── chat-surface.tsx             # ChatThread + composer + session control
│   ├── memory-sidebar.tsx           # tabbed orchestrator (User/Session/Skills/History)
│   └── memory-tabs/                 # ← NEW
│       ├── user-tab.tsx
│       ├── session-tab.tsx
│       ├── skills-tab.tsx
│       └── history-tab.tsx
├── lib/
│   ├── agent.ts                     # lazy SDKAgent per (userId, sessionId)
│   ├── memory.ts                    # backend auto-detect (pgvector OR in-memory)
│   ├── openai-adapters.ts           # Embedder + LLM DIPs
│   └── theomemory-plugin.ts         # systemPromptResolver + rememberTurn (dual-scope)
└── README.md
```

## Notes on the integration

- **Dual-scope writes.** Every chat turn writes the same conversation into
  the User scope (long-lived) AND the Session scope (this conversation only).
  The two-stage extraction pipeline runs twice — independently per scope —
  per ADR-0003 (ADD-only).

- **RepoScope is the 4th tier (ADR-0010).** Exposed ONLY through
  `memory.skills(repoId)`. Maps to the `agent_id` column internally per
  EC-4. The Skills tab demonstrates per-repo isolation, derived_from
  provenance, and the v0.6.1 T1.2 `hashFact(description)` collision
  invariant — you'll see the 409 surface if you try to add two skills
  with the same description.

- **Why not `kind: "memory"` plugin?** `@usetheo/sdk` v1.3.0's published
  `.d.ts` references a `MemoryProviderFactory` type alias not exported.
  Wired via the SDK's stable `systemPromptResolver` lever + server-side
  `rememberTurn()` after `run.wait()`. Same observable behaviour.

- **Why `userId` in localStorage and `sessionId` in sessionStorage?**
  Demo, not auth. Per-tab session model matches the Scope semantics: open
  a new tab → fresh session_id. Production deployments should derive
  `userId` from real auth (NextAuth, Clerk) and `sessionId` from your
  conversation-thread model.

- **TheMemory is pre-release.** Resolved via `file:../..` workspace link
  from this `package.json`. `npm publish` is a v1.0 milestone gated by
  `/dogfood` per `dogfood-golden-rule.md`.
