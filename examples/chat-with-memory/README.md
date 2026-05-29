# TheMemory · Chat that remembers — professional demo

A Next.js 15 chat app that combines all three OSS products of the usetheo
ecosystem to demonstrate **persistent semantic memory in an agent loop**:

- **`@usetheo/sdk`** — agent harness (`Agent.create` + streaming `Run`)
- **`@usetheo/memory`** — three-tier scoped memory (`User` / `Session` / `Agent`)
  with reflection (v0.4a), pgvector / in-memory adapters, ADD-only semantics
- **`@usetheo/ui`** — `ChatThread`, `ChatMessage`, `Card`, `Button`, theme system

The chat surface lets you have a conversation with an agent that **remembers
facts about you across sessions**. Refresh the page, ask "what's my name?" —
it answers because TheMemory recalled the fact from your last turn.

## How it wires together

```
┌────────────────────────────────────────────────────────────────────────┐
│ Browser — @usetheo/ui chat surface + memory sidebar                    │
└─────────────────────┬──────────────────────────────────────────────────┘
                      │ POST /api/chat { userId, message }
                      ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Next.js route handler (server only)                                    │
│                                                                        │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │ @usetheo/sdk Agent.create({ systemPrompt: resolver })        │    │
│   └────────────────────────┬──────────────────────────────────────┘   │
│                            │                                            │
│                            │ on every send():                           │
│                            ▼                                            │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │ systemPromptResolver(ctx)                                    │    │
│   │   → @usetheo/memory.user(userId).recall(ctx.userMessage, 5)  │    │
│   │   → returns BASE_PROMPT + <memory-context>…</memory-context> │    │
│   └──────────────────────────────────────────────────────────────┘    │
│                            │                                            │
│                            ▼                                            │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │ LLM call → stream → reply                                    │    │
│   └────────────────────────┬──────────────────────────────────────┘   │
│                            │                                            │
│                            │ after run.wait():                          │
│                            ▼                                            │
│   ┌──────────────────────────────────────────────────────────────┐    │
│   │ rememberTurn({ userId, prompt, reply })                      │    │
│   │   → @usetheo/memory.user(userId).remember(conversation)      │    │
│   │   → every N turns → memory.reflect() (v0.4a consolidation)   │    │
│   └──────────────────────────────────────────────────────────────┘    │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

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

The first run uses theo-memory's **in-memory adapter** (zero infra).
Memories live in the Node process and are cleared when you restart `npm run dev`.

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
| `THEOMEM_PG_URI` | _(unset)_ | When set, swap `InMemoryVectorStore` → `PgvectorStore` (see § Persistent storage) |

## What to try

1. **First conversation.** Tell it your name and what you do.
   _"Hi, I'm Paulo. I'm building a memory layer for AI agents called TheMemory."_

2. **Watch the sidebar.** TheMemory's two-stage write extracted facts. You'll
   see one or more rows like _"User's name is Paulo"_ and _"User is building TheMemory."_

3. **Refresh the page.** State is wiped from the React side. Now ask:
   _"What am I working on?"_

   The agent answers correctly because the `systemPromptResolver` recalled
   your facts and injected them as `<memory-context>` before the model saw
   your prompt.

4. **Click _"Run reflection (v0.4a)"_.** This triggers the consolidation
   pipeline — TheMemory's reflection LLM clusters your raw memories into
   higher-order facts, with provenance (`derived_from`).

5. **Forget a fact** by clicking the trash icon on any sidebar card. The next
   recall skips it.

## Persistent storage (optional)

By default, memories live in `InMemoryVectorStore` and disappear when the
Node process restarts. To persist across server restarts:

```bash
# from the monorepo root:
docker compose up -d pgvector
export THEOMEM_PG_URI="postgresql://postgres:postgres@localhost:5432/postgres"
npm run db:push
```

Then edit `lib/memory.ts` to swap `InMemoryVectorStore` for `PgvectorStore`:

```ts
import { PgvectorStore } from "@usetheo/memory";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.THEOMEM_PG_URI });
const vectorStore = new PgvectorStore({ pool });
```

## Layout

```
examples/chat-with-memory/
├── app/
│   ├── api/
│   │   ├── chat/route.ts            # POST → SSE stream of agent events
│   │   └── memory/
│   │       ├── recall/route.ts      # GET ?userId&q&limit
│   │       ├── forget/route.ts      # POST { userId, id }
│   │       └── reflect/route.ts     # POST { userId }
│   ├── layout.tsx                   # ThemeProvider + globals.css
│   └── page.tsx                     # mounts <ChatSurface />
├── components/
│   ├── chat-surface.tsx             # ChatThread + ChatMessage + composer
│   ├── memory-sidebar.tsx           # live view of TheMemory facts
│   └── theme-bootstrap.tsx          # @usetheo/ui ThemeProvider client wrapper
├── lib/
│   ├── agent.ts                     # lazy SDKAgent per userId
│   ├── memory.ts                    # createMemory() singleton
│   ├── openai-adapters.ts           # Embedder + LLM DIPs backed by OpenAI
│   └── theomemory-plugin.ts         # systemPromptResolver + rememberTurn
└── README.md
```

## Notes on the integration

- **Why not `kind: "memory"` plugin?** `@usetheo/sdk` v1.3.0's published
  `.d.ts` references a `MemoryProviderFactory` type alias whose definition is
  not exported. Until that's resolved, we wire via the SDK's public
  `systemPromptResolver` lever (stable, fully typed) and a server-side
  `rememberTurn()` call after `run.wait()`. Same observable behaviour as
  `pre_user_send` + `post_assistant_reply`, no dependency on internals.

- **Why does the user message go into memory verbatim?** TheMemory's two-stage
  write pipeline extracts atomic facts via LLM internally — you `remember()`
  the conversation, the layer decides what to persist.

- **Why a `userId` in localStorage?** This is a demo, not auth. Production
  deployments should derive `userId` from your real session (NextAuth, Clerk,
  whatever).

- **TheMemory is pre-release.** Resolved via `file:../..` workspace link from
  this `package.json`. `npm publish` is a v1.0 milestone.
