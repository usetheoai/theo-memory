---
slug: dashboard-phase2a-attribution-asof
created_at: 2026-06-19
goal: Surface attribution-on-write (attributedTo) + bi-temporal recall (asOf) through the theo-cloud gateway BFF into the dashboard Playground, proven by an e2e that remembers a fact attributed to a peer then recalls it with an asOf timestamp — 0 failed.
---

# Plan: Dashboard Phase 2A — attribution-write + bi-temporal asOf (wiring-only)

> **v1.1** (2026-06-19) — absorbed `/edge-case-plan`: 3 SHOULD-TEST into TDD (EC-1 RFC3339 widening validity, EC-2 whitespace-trim omission, EC-3 future-asOf e2e) + 2 DOCUMENT into Drawbacks (EC-4 no length cap, EC-5 empty as-of correct). Verdict PLAN OK, 0 MUST FIX.

> Surfaces the two NON-frozen advanced TheMemory capabilities the `dashboard-phase2-skills-bitemporal-attribution` blueprint classified as **wiring-only** (ADR D1): `RememberOptions.attributedTo` (write) + `RecallOptions.asOf` (time-travel). Both REST fields ALREADY exist on TheMemory (`schemas.ts:53,72`) — this plan adds NO TheMemory code, only theo-cloud gateway + dashboard wiring. **Skills (Repo tier) is explicitly OUT of scope — FROZEN under P0 (CLAUDE.md Rule 10).**

## Goal

> "Thread `attributedTo` (remember) + `asOf` (recall) through the gateway client + handlers + dashboard Playground so that `tests/e2e` round-trips remember-attributed-to-a-peer → recall-with-asOf against real `ankane/pgvector:v0.5.1` + real TheMemory — 0 failed; and the Playground exposes a peer-attribution input + an as-of date-time picker (vitest green)."

## Context

Source: the `dashboard-phase2-skills-bitemporal-attribution` discovery cycle (blueprint SHIPPABLE 98.5, 2026-06-19). The blueprint's ADR D1 + Recommendation 1 (HIGH priority) decided: attribution-write and bi-temporal asOf are **wiring-only** — both `RememberBody.attributedTo` (`schemas.ts:53`) and `RecallBody.asOf` (`schemas.ts:72`) already exist on TheMemory's REST surface (verified this session), so NO new endpoint is needed; only the gateway client + handlers + dashboard need to forward the fields. Evidence from references: Mem0 confirms actor-on-write (`add()` requires an actor id, `mem0/mem0/memory/main.py:573`); NEITHER Mem0 nor Letta implements true as-of bi-temporal recall — TheMemory's `t_valid/t_invalid` + `recall({asOf})` (ADR-0011, v1.1) is ahead, so exposing `asOf` is purely surfacing an existing capability.

Phase 2A is the immediately-shippable subset of "dashboard Phase 2". Skills (the third item) needs a NEW REST endpoint (`GET /v1/scopes/skill/*` returns `501` today) AND is P0-FROZEN → deferred to a separate cycle on owner unfreeze (blueprint ADR D2).

## Baseline Context (deep review of current state)

### Files that will be touched

| File (repo) | LoC today | sha | Why it exists | Invariant to preserve |
|---|---|---|---|---|
| `theo-cloud internal/themory/client.go` | 501 | c20715b | HTTP client to TheMemory (verbs + List/Metrics/Entities/Forget) | master bearer never leaves Go; conform to real `/v1/openapi.json`; bodies mirror TheMemory zod schemas |
| `theo-cloud internal/routes/memory.go` | 410 | a4cd48e | SDK + BFF-delegate handlers; reads body, derives subject from auth | subject from auth ONLY (never body); new optional fields additive |
| `theo-cloud internal/themory/contract_test.go` | 243 | c20715b | consumer-driven contract test vs `openapi/themory.yaml` | every client request conforms to the spec subset |
| `theo-cloud tests/unit/memory_handlers_test.go` | 744 | a4cd48e | handler unit tests (fake client) | fake mirrors the real client interface |
| `theo-cloud openapi/themory.yaml` | ~155 | c20715b | consumer contract subset of TheMemory's real OpenAPI | stays a subset of the real provider spec |
| `theo-cloud dashboard/src/pages/memory/playground.tsx` | 242 | c20715b | remember/recall/reflect live UI | PageShell + space-y-6; BFF paths only |
| `theo-cloud dashboard/src/pages/memory/playground.test.tsx` | 84 | c20715b | Playground vitest | mocks BFF endpoints |

### Current callers / dependents (verified this session)

- `themory.Client.Remember` (client.go) builds `rememberRequest{UserID,Text,Category,Metadata}` (client.go:269) — `attributedTo` field absent. `Recall` builds `recallRequest{UserID,Query,TopK,Threshold}` (client.go:280) — `asOf` field absent.
- Gateway `MemoryHandler.Remember` reads `rememberRequest{Text,Category,Metadata}` (memory.go:276); `Recall` reads `recallRequest{Query,TopK,Threshold}` (memory.go:323). Both call the client.
- BFF `DashboardMemoryHandler.{Remember,Recall}` mint-then-delegate to `MemoryHandler.{Remember,Recall}` — they pass the request body THROUGH unchanged, so NO BFF code change is needed (the new body fields flow automatically once the handler reads them).
- TheMemory `RememberBody.attributedTo` (`packages/api/src/server/schemas.ts:53`), `RecallBody.asOf` (`schemas.ts:72`), `RecallBody.attributedTo` (`schemas.ts:71`) — ALL exist; the `asOf` is `z.string().datetime()` (RFC3339, 422 on invalid). **No TheMemory change in this plan.**
- Dashboard `playground.tsx`: remember panel posts `{text, category?}` to `/v1/dashboard/memory/remember`; recall panel posts `{query, topK}` to `/v1/dashboard/memory/recall`.

### Architecture boundaries affected

Per `.claude/rules/architecture.md` HTTP-seam: browser → gateway BFF (`/v1/dashboard/memory/*`, requireJWT) → gateway client → TheMemory REST. This plan stays entirely within the gateway client + handler + dashboard layers; the TheMemory REST contract is unchanged (additive optional fields it already accepts).

### Domain glossary

- **attributedTo** — multi-peer attribution: WHO a fact is about/from (v1.1, single string peer id on `remember`).
- **asOf** — bi-temporal point-in-time: recall the memory state valid at an RFC3339 instant (v1.1, `t_valid/t_invalid` predicate).
- **BFF** — Backend-for-Frontend: the gateway mints a server-side `theo_live_*` key per browser session, delegates to the SDK handler; the body passes through.

## Prior Art & Related Work

- Blueprint: `.claude/knowledge-base/discoveries/blueprints/dashboard-phase2-skills-bitemporal-attribution-blueprint.md` (SHIPPABLE 98.5) — ADR D1 (wiring-only) + Recommendation 1 (HIGH) is the direct source of this plan.
- Reference evidence: `mem0/mem0/memory/main.py:573` (actor-on-write); `mem0` + `letta` lack as-of (TheMemory ahead).
- Internal precedent: the `theo-memory-dashboard-full-integration` cycle (READY_TO_MERGE 2026-06-19) added `from`/`to` the same wiring way (client → handler → dashboard) — this plan mirrors that exact shape for `attributedTo`/`asOf`.

## ADRs

### D1 — Wiring-only: NO new TheMemory endpoint; thread the existing REST fields

**Decision:** add `attributedTo` to the gateway remember path and `asOf` to the recall path by forwarding the fields TheMemory already accepts; do not touch TheMemory.

**Rationale:** `RememberBody.attributedTo` + `RecallBody.asOf` exist (`schemas.ts:53,72`, verified). Adding endpoints would duplicate a working contract (blueprint ADR D1). Cites `architecture.md` HTTP-seam (additive optional fields preserve the contract) + KISS.

**Alternatives rejected:** (a) new `/v1/attribution` / `/v1/asof` endpoints — duplicates existing params; (b) defer with skills — no P0-freeze reason applies to shipped v1.1 surfaces.

### D2 — Gateway validates `asOf` is RFC3339 → 400 (not pass-through-to-502)

**Decision:** the recall handler validates `asOf` parses as RFC3339 before calling the client; invalid → `400 INVALID_BODY`.

**Rationale:** closes the F-test-4 caveat from the prior cycle's `/review` (an upstream 422 on a bad datetime is otherwise laundered into a 502). Mirrors the existing topK/threshold validation in the recall handler. Cites `.claude/rules/architecture.md` error-fidelity + Inquebrável Rule 8 (fail clear at the boundary).

**Alternatives rejected:** pass-through (rejected — produces a misleading 502 for a client input error).

### D3 — `attributedTo` is optional + free-text; empty string omitted

**Decision:** the Playground peer field is optional; an empty value is NOT sent (omitted from the body), matching TheMemory's `attributedTo: z.string().optional()`.

**Rationale:** keeps default behavior (no attribution) unchanged; only sends when the operator supplies a peer. KISS + backward-compat.

**Alternatives rejected:** required field (rejected — most memories have no peer); a peer dropdown (rejected — YAGNI, no peer registry in the gateway model).

### D4 — Gateway sends `infer:false` when a peer is attributed (added post-implementation; owner sign-off 2026-06-19)

**Decision:** when the remember body carries a non-empty `attributedTo`, the gateway handler sets `infer:false` (verbatim path); otherwise the default extraction path is unchanged.

**Rationale:** the T3.1 e2e proved that TheMemory v1.1 applies the caller's `RememberOptions.attributedTo` **ONLY** on the verbatim path (`extraction/pipeline.ts:145` — `runInferFalsePath` writes `options.attributedTo` to the row); on the default `infer:true` extraction path attribution comes from the LLM per-fact (`pipeline.ts:434-436`) and the caller's `attributedTo` is discarded. So `infer:false` is the ONLY way to make caller-supplied attribution persist. This was NOT anticipated by ADR D1's "wiring-only" framing — it is a semantic decision, surfaced to + approved by the project owner via AskUserQuestion ("infer:false when a peer is given") 2026-06-19. **Consequence (documented to the user):** an attributed memory is stored VERBATIM (one row, no LLM fact-extraction); the Playground peer field carries a helper text disclosing this ("Stores the fact verbatim (skips auto fact-extraction).").

**Alternatives rejected:** (a) always `infer:true` — caller attribution silently dropped (the bug the e2e caught); (b) always `infer:false` in the Playground — loses extraction for non-attributed memories (changes Phase-1 behavior); (c) explicit `infer` UI toggle — YAGNI for a demo Playground.

## Dependency Graph

```
T1.1 (client: attributedTo/asOf + contract test)
   ↓
T1.2 (handlers: read + validate + thread; BFF unchanged) ─ depends on T1.1 (client signature)
   ↓
T2.1 (dashboard Playground: peer input + asOf picker) ─ depends on T1.2 (BFF body contract)
   ↓
T3.1 (e2e: attributed remember → asOf recall) ─ depends on T1.2
   ↓
T3.2 (/review → READY_TO_MERGE)
```

T1.1 → T1.2 → {T2.1, T3.1} can run after T1.2; T3.2 last.

## Phase 1 — Gateway wiring (Go)

### T1.1 — `themory.Client` Remember/Recall gain `attributedTo` / `asOf`
#### Why this step
Action: add `AttributedTo` to `RememberOptions` + `rememberRequest`; add `AsOf` to `RecallOptions` + `recallRequest`; send them when non-empty.
Reasoning: ADR D1 — the client is the only HTTP path to TheMemory; the bodies must carry the fields TheMemory already accepts. Mirrors the `from`/`to` precedent from the prior cycle.
#### Files to edit
- `internal/themory/client.go` (RememberOptions +AttributedTo; RecallOptions +AsOf; rememberRequest +attributedTo; recallRequest +asOf; omitempty)
- `internal/themory/contract_test.go` (assert the new fields serialize + conform)
- `openapi/themory.yaml` (add `attributedTo` to /v1/remember body; `asOf` + `attributedTo` to /v1/recall body)
#### Deep file dependency analysis
`rememberRequest`/`recallRequest` (client.go:269/:280) are the wire shapes. `RememberOptions`/`RecallOptions` are the public client options consumed by `MemoryHandler`. The contract test validates outgoing requests against `openapi/themory.yaml` — the spec must gain the fields or the test fails.
#### TDD
- RED: contract_test subtests — Remember with `attributedTo:"paulo"` sends `attributedTo` in the body; Recall with `asOf:"2026-06-01T00:00:00Z"` sends `asOf`; both still conform to `themory.yaml`.
- GREEN: implement (omitempty so absent fields are not sent).
- REFACTOR: none expected (additive struct fields).
#### Concurrency tests
(none — single-threaded). `http.Client` is goroutine-safe; each request independent; no shared mutable state.
#### Failure scenarios
- TheMemory 422 on a malformed body → surfaced as `*themory.Error` (existing path; tested by the existing 5xx/4xx contract coverage).
#### Acceptance criteria
- `go test ./internal/themory/...` green; the 2 new fields appear in the captured request bodies; requests conform to `openapi/themory.yaml` (`ValidateRequest` passes).
#### DoD
- `go build ./... && go vet ./...` clean; contract test asserts both new fields.

### T1.2 — Handlers read + validate + thread `attributedTo` / `asOf` (BFF passes through)
#### Why this step
Action: `MemoryHandler.Remember` reads optional `attributedTo` and passes it via `RememberOptions`; `MemoryHandler.Recall` reads optional `asOf`, validates RFC3339 (400 on invalid), threads via `RecallOptions`.
Reasoning: ADR D2 — validate `asOf` at the boundary so a bad datetime is a clear 400, not a laundered 502. The BFF `DashboardMemoryHandler.{Remember,Recall}` delegate to these handlers and pass the body through unchanged, so no BFF code change is needed.
#### Files to edit
- `internal/routes/memory.go` (rememberRequest +AttributedTo; recallRequest +AsOf; recall handler RFC3339 validation; thread into options)
- `tests/unit/memory_handlers_test.go` (fake captures attributedTo/asOf; invalid asOf → 400; subject still from auth)
#### Deep file dependency analysis
`MemoryHandler` is used by BOTH the SDK routes (`/v1/memory/*`) and the BFF (`DashboardMemoryHandler` delegates). The fake `fakeTheMemory` in the unit test must capture the new option fields. `auth.GetUser` still supplies the subject — the body never carries it (invariant preserved).
#### TDD
- RED: handler tests — Remember with `{"text":"x","attributedTo":"paulo"}` → client receives `AttributedTo="paulo"`; Recall with `{"query":"x","asOf":"2026-06-01T00:00:00Z"}` → client receives `AsOf`; Recall with `{"query":"x","asOf":"not-a-date"}` → 400; subject derived from auth not body.
- GREEN: implement (parse `time.RFC3339` for validation).
- REFACTOR: none.
#### Concurrency tests
(none — single-threaded). Request handlers process one request each; no shared state.
#### Failure scenarios
- invalid `asOf` datetime → `400 INVALID_BODY` (tested); upstream 502 on client error → `502 MEMORY_UPSTREAM_UNAVAILABLE` (existing path).
#### Acceptance criteria
- `go test ./internal/routes/... ./tests/unit/...` green; invalid asOf → 400; valid attributedTo/asOf reach the fake client; no `/v1/memory/*` subject-from-body regression.
#### DoD
- build+vet clean; fake + real client both satisfy the interface; BFF unchanged (grep confirms no `dashboard_memory.go` edit needed).

## Phase 2 — Dashboard UI (React)

### T2.1 — Playground: peer-attribution input (remember) + as-of date-time picker (recall)
#### Why this step
Action: add an optional "Attributed to (peer)" text input to the Remember panel (sends `attributedTo` when non-empty); add an optional "As of" `datetime-local` input to the Recall panel (sends `asOf` as RFC3339 when set).
Reasoning: ADR D3 — optional, empty omitted. Fulfills blueprint Recommendation 1. Uses DS primitives (Input) + the existing space-y-6 layout.
#### Files to edit
- `dashboard/src/pages/memory/playground.tsx` (peer Input in remember mutation body; asOf Input in recall mutation body; `datetime-local` → RFC3339 widening like the from/to precedent)
- `dashboard/src/pages/memory/playground.test.tsx` (remember sends attributedTo; recall sends asOf)
#### Deep file dependency analysis
`playground.tsx` posts to the BFF (`/v1/dashboard/memory/{remember,recall}`). The remember `useMutation` body gains `attributedTo`; the recall body gains `asOf`. `datetime-local` yields `YYYY-MM-DDTHH:mm` (no seconds/zone) → widen to RFC3339 (`+":00Z"`) mirroring the memories.tsx from/to widening.
#### TDD
- RED: `playground.test.tsx` (vitest) — typing a peer + clicking Remember posts a body containing `attributedTo`; setting As-of + clicking Recall posts a body containing `asOf` (RFC3339). Empty fields are NOT included.
- RED (EC-1): a `datetime-local` value posts an `asOf` matching `/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/` (valid RFC3339). Implementation guard: append `:00Z` only when the value is minute-precision (`length === 16`); if it already carries seconds, append `Z`. Document inline that no `step` attribute is set (minute precision).
- RED (EC-2): typing whitespace-only (`"   "`) into the peer field → the remember body does NOT include `attributedTo` (send only when `peer.trim() !== ''`, using the trimmed value).
- GREEN: implement with DS `Input` + the space-y-6 layout standard (no ad-hoc padding).
#### Concurrency tests
(none — single-threaded). React event handlers; react-query serializes the per-panel mutation.
#### Acceptance criteria
- vitest green (`npx vitest run src/pages/memory/playground.test.tsx`); uses `PageShell` + `space-y-6`; grep shows no ad-hoc `pt-`/`p-` overrides in the new fields; empty peer/as-of omitted from the body.
#### DoD
- `npx vitest run src/pages/memory/` green; `tsc -b` clean.

## Coverage Matrix

| Capability (blueprint Rec 1) | Task(s) | Status |
|---|---|---|
| attribution-write (`attributedTo` on remember) | T1.1 + T1.2 + T2.1 | mapped |
| bi-temporal recall (`asOf` on recall) | T1.1 + T1.2 + T2.1 | mapped |
| `asOf` boundary validation (RFC3339 → 400) | T1.2 (ADR D2) | mapped |
| e2e proof (attributed remember → asOf recall) | T3.1 | mapped |
| READY_TO_MERGE | T3.2 | mapped |

**Coverage: 5/5 (100%)**

## Drawbacks & Risks

| Risk | Severity | Mitigation | Owner |
|---|---|---|---|
| `asOf` semantic correctness depends on TheMemory's `t_valid/t_invalid` — the dashboard only surfaces it; a wrong as-of result would be a provider bug, not a gateway bug | MEDIUM | e2e asserts the wiring (200 + the field reaches the provider); semantic asOf correctness is owned by TheMemory's v1.1 GOAL TEST (out of scope here) | impl |
| `datetime-local` has no timezone → naive widening to `Z` assumes UTC | LOW | document the UTC assumption in the field label ("As of (UTC)"); RFC3339 `Z` is unambiguous | impl |
| Attribution free-text (no peer registry) could accumulate typos as distinct entities | LOW | acceptable for a demo Playground (ADR D3 YAGNI); the Entities page already aggregates whatever is written | owner |
| EC-4: `attributedTo` has no length cap (free text) | LOW | bounded by the existing 1 MiB body limit + single-line `Input`; a per-field cap is YAGNI for a demo Playground (ADR D3). DOCUMENTED, no action | owner |
| EC-5: `asOf` before any memory's `t_valid` returns empty results | LOW | correct bi-temporal behavior owned by TheMemory (ADR-0011), not a gateway defect; the dashboard renders the empty-results state. DOCUMENTED, no action | impl |

## Unresolved Questions

- (none — every decision resolved at plan time via ADRs D1-D3; the blueprint pre-resolved the wiring-vs-endpoint question with verified evidence.)

## Failure scenarios

- **Gateway → TheMemory unreachable** (recall/remember): handler returns `502 MEMORY_UPSTREAM_UNAVAILABLE` (existing path; reproduced by a closed-port stub in unit tests).
- **Invalid `asOf` datetime** (client input): recall handler returns `400 INVALID_BODY` BEFORE calling the client (ADR D2; reproduced by `{"query":"x","asOf":"not-a-date"}` in T1.2).
- **TheMemory 422** on a body it rejects: surfaced as `*themory.Error` → handler 502 (existing; the asOf 400 guard prevents the common case from reaching here).

## Global Definition of Done

- [ ] All task DoDs checked.
- [ ] `theo-cloud`: `go build ./... && go vet ./... && go test ./... -race` green; dashboard `npx vitest run src/pages/memory/ && tsc -b` green.
- [x] CHANGELOG updated in `theo-cloud` (Playground attribution/asOf) AND `theo-memory` (the metadata-aggregation fix below).
- [x] No `// TODO`/`// FIXME` in changed src; `attributedTo`/`asOf` never fabricated (only forwarded).
- [x] `make e2e` PASS including the attributed-remember → asOf-recall leg. **CAVEAT (F-xval-4, honest disclosure):** the green `make e2e` ran against `themory-e2e:patched` (the prior themory image + the 2 esbuild-transpiled fixed handlers overlaid), NOT a clean `make e2e` rebuild — a clean rebuild is blocked by a TRANSIENT upstream `sharp`/libvips CDN timeout (3 attempts). The theo-memory fix is in source + unit-proven (169/169, the metrics-entities fixture uses the real metadata contract and FAILS against the old handler). Re-run a clean `make e2e` when the CDN recovers to close this gap.
- [x] `/review` (3 independent agents) → READY_TO_MERGE (after absorbing F-xval-1..4 + LOWs).
- [ ] Plan archived to `plans/completed/` after merge.

### Reality reconciliation (post-implementation, per Inquebrável Rule 3 — F-xval-1/F-xval-2)

The "wiring-only, NO theo-memory change" framing in the Goal/ADR D1 held for the **attribution/asOf threading itself**, but implementation surfaced TWO disclosed, owner-aligned divergences the original plan did not anticipate:

1. **theo-memory metadata-aggregation fix (commit `ed481fd`)** — the T3.1 e2e revealed a LATENT bug from the prior cycle: `ScopedMemory.getAll()` projects `attributed_to` into `MemoryItem.metadata`, NOT the top-level `attributedTo` field, so the `metrics`/`entities` handlers (which read the top-level field) returned empty/0 against real pgvector. Fixed: handlers read `metadata.attributed_to` with the top-level as fallback; unit fixtures corrected to the real contract. Disclosed in the theo-memory CHANGELOG + commit body. This is a cross-repo bug fix, not scope creep — but it means the plan is NOT theo-memory-clean.
2. **`infer:false`-when-peer semantic (ADR D4 below)** — see ADR D4.

## Final Phase — Phase 3: Integration Validation (READY_TO_MERGE gate)

### T3.1 — Extend `tests/e2e` for attribution + asOf
- Remember a fact through the gateway with `attributedTo:"e2e-peer"` → 201.
- Recall through the gateway with `asOf` set to a FIXED near-FUTURE RFC3339 instant (EC-3: e.g. a literal `now + 1h`, NOT "now" — so the just-written memory is unambiguously within `[t_valid, asOf]` despite clock skew) → 200 with a `results` array (path proof; semantic ranking deferred to the hermetic-embedder caveat, as in the prior cycle).
- Assert the entities aggregation reflects the attributed peer (`GET /v1/memory/entities?scope=user` contains `e2e-peer`) — proving attribution-write reached the store end-to-end.
#### Concurrency tests
(none — single-threaded). Sequential e2e round-trip.

### T3.2 — `/review` → READY_TO_MERGE
- Run `/review dashboard-phase2a-attribution-asof`; resolve every BLOCKER/HIGH inline.
- Verdict `READY_TO_MERGE` with 0 BLOCKER.
#### Concurrency tests
(none — single-threaded). Review is a process gate; `-race` runs in the Global DoD.
