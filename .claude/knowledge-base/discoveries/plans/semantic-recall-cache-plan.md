# Discovery Plan: Semantic Recall Cache (Roadmap Item 19 — v1.5)

**Version:** 1.1 (2026-06-03) — Absorbs `/discover-edge-cases semantic-recall-cache` report (7 ECs: 2 MUST FIX + 3 SHOULD TEST + 2 DOCUMENT). **2 MUST FIX absorbed**: EC-1 (Q6 Fase A method prefixed with `WebSearch` to resolve canonical arXiv ID before WebFetch — defends against `2310.07831` being wrong paper); EC-2 (Q7 Fase A method prefixed with `WebSearch` to resolve current canonical vendor docs URL before WebFetch — defends against LangChain/LlamaIndex docs reorg rot). **3 SHOULD TEST absorbed** in § Halt-loop Checkpoints: EC-3 (Q4 ↔ Q6 dependency resolution — if `embedchain/cache.py` imports `gptcache`, process Q6 before Q4 final); EC-4 (Q8 sub-budget ≤ 4 min / 8k tokens TOTAL for 4 vendors); EC-5 (Global checkpoint — blueprint MUST contain `## CLAUDE.md claim verdict` section with `VERIFIED | REFUTED | INCONCLUSIVE` verdict before BLUEPRINT_COMPLETE). **2 DOCUMENT absorbed** as ADR D6: EC-6 (Q5 expected-negative outcome — OpenAI prompt cache ≠ recall cache; negative evidence is valid); EC-7 (Q3 pyproject.toml synthesis MUST distinguish `[project.dependencies]` core vs `[project.optional-dependencies]` extras for Rule 9 verdict).

**Version:** 1.0
**Slug:** `semantic-recall-cache`
**Date created:** 2026-06-03
**Owner:** TheMemory
**Topic:** Investigar prior art para o cache semântico de `recall()` antes de invocar `/to-plan` para v1.5. CLAUDE.md afirma "greenfield vs Mem0/Letta/LangMem/Zep" mas grep empírico encontrou `mem0/embedchain/embedchain/cache.py` (sub-projeto dentro do mem0 repo) — claim precisa ser **verificada ou refutada com evidência**.

## Context

### What motivates this discovery NOW

Roadmap Item 19 está marcado `Planned` com 3 acceptance criteria TBD:
1. Cache hit rate ≥ TBD (lock by v1.5 kickoff; baseline measured via dogfood evidence) on the Claude-Code-auto-memory anchor scenario
2. Hit-vs-miss latency ratio observed via OTel histogram `recall_cache_hit_duration_ms` vs `recall_cache_miss_duration_ms`
3. Invalidation correctness test: write to scope → next recall in same scope MUST miss

Sem prior art mapeada, qualquer escolha de:
- **Cache hit threshold** (cosine ≥ 0.95? 0.90? adaptativo?)
- **Backend default** (pgvector via DIP? Redis com `redis-search` HNSW?)
- **Invalidation semantics** (TTL? write-triggered scope invalidation? both?)
- **Cache key composition** (query_embed + scope filter + asOf?)

vira **silent quality regression** se acertarmos por sorte ou **over-engineering** se errarmos pelo lado complexo (Inquebrável Rule 11 — YAGNI).

### Evidence triggering investigation

1. **CLAUDE.md claim** (locked 2026-06-03): "Mem0/Letta/LangMem/Zep do NOT document semantic-recall caching at this layer." Mas grep empírico 2026-06-03 encontrou:
   - `mem0/embedchain/embedchain/cache.py` (existe; conteúdo desconhecido)
   - `mem0/embedchain/embedchain/config/cache_config.py` (existe)
   - `letta/tests/test_openai_prompt_cache_request_fields.py` (camada diferente — LLM prompt cache, não recall — mas adjacente)
   - LangMem dir vazio (sem evidência possível)

   A claim precisa ser **verificada com Fase A/B reading**, não assumida.

2. **State-of-the-art exists outside the references**: GPTCache (zilliztech/GPTCache, arxiv 2310.07831) é a lib canônica para LLM semantic caching (~7k stars GitHub). LangChain ships `RedisSemanticCache` + `InMemoryCache`. LlamaIndex ships `IngestionPipelineCache`. Pinecone/Weaviate/Qdrant podem ter query-result caching nativo na plataforma.

3. **Risk envelope se pularmos prior_art**: escolher threshold 0.95 sem evidência de como GPTCache/LangChain calibram → hit rate quase zero em produção → cache vira overhead morto. Escolher TTL-only sem ver como embedchain invalida → serve resultados stale após writes → correctness bug. **Discover-first is cheap; rework após v1.5.0 ship é caro.**

## Objective

**Produzir um blueprint comparativo "Semantic Recall Cache — State of the Art" que responda, com citações verbatim a `.claude/knowledge-base/references/` AND web prior_art snapshots:**

1. SE algum dos 2 projetos disponíveis (mem0/embedchain + letta) ship semantic cache nessa camada (Fase A negativa = blueprint conclui CLAUDE.md claim REFUTED ou CONFIRMED)
2. Threshold defaults documentados em GPTCache + LangChain + LlamaIndex (range numérico + rationale)
3. Invalidation semantics documentadas (TTL only? write-triggered? both? por que?)
4. Backend escolhido pelos 3-4 frameworks canônicos (Redis? Milvus? vendor-specific?)
5. Cache key composition (apenas query_embed? scope filter? user_id?)
6. Métricas observability adotadas (hit rate counter? latency histogram?)
7. Rule 9 verdict por cada dependência candidata (ADOPT/REJECT/DEFER com rationale)

**Success criterion (binário):**
- Blueprint atinge SHIPPABLE_WITH_CAVEATS (≥ 70) no `/discover-confidence`
- 5/5 corners populated OR ADR-deferred
- 0 citações fabricadas
- Cada questão respondida tem snapshot URL salvo em `.claude/knowledge-base/discoveries/snapshots/semantic-recall-cache/{sha256}.md` para web evidências

## In-scope / Out-of-scope

### In-scope

| Project / Source | Caminho / URL base | Why |
|---|---|---|
| `.claude/knowledge-base/references/mem0/embedchain/` | `embedchain/embedchain/cache.py` + `config/cache_config.py` | Sub-projeto dentro do mem0 repo que MENCIONA cache.py — load-bearing para verificar/refutar CLAUDE.md claim |
| `.claude/knowledge-base/references/mem0/mem0-ts/src/memory/` | `**/*.ts` (recursive) | Onde TheMemory faria espelho — `recall()` flow |
| `.claude/knowledge-base/references/mem0/server/` | `**/*.py` | Possível indicação de cache HTTP-side (vendor product hosted) |
| `.claude/knowledge-base/references/letta/letta/services/` | `**/*.py` | Letta's "summarizer" + memory services — adjacent layer cache? |
| `.claude/knowledge-base/references/letta/tests/test_openai_prompt_cache_request_fields.py` | (verified exists) | LLM prompt cache pattern — cross-pollination de técnicas |
| Web: arXiv | `arxiv.org/abs/2310.07831` (GPTCache paper) | Seminal semantic LLM caching paper |
| Web: GitHub | `github.com/zilliztech/GPTCache` | Reference implementation |
| Web: LangChain | `python.langchain.com/docs/integrations/llms/llm_caching` | RedisSemanticCache + InMemoryCache patterns |
| Web: LlamaIndex | `docs.llamaindex.ai/en/stable/module_guides/loading/ingestion_pipeline/` | IngestionPipelineCache |
| Web: Vendor docs | `docs.pinecone.io`, `docs.weaviate.io`, `qdrant.tech`, `redis.io`, `milvus.io` | Native vector-DB caching docs (where applicable) |

### Out-of-scope (explicit)

| Excluded | Reason |
|---|---|
| `.claude/knowledge-base/references/mem0/docs/`, `mem0/examples/`, `mem0/cookbooks/` | Doc + example surface; not load-bearing for cache implementation patterns |
| `.claude/knowledge-base/references/mem0/cli/`, `mem0/.cursor-plugin/`, `mem0/.claude-plugin/`, `mem0/openclaw/`, `mem0/skills/` | Tooling / plugin surface — orthogonal to cache layer |
| `.claude/knowledge-base/references/letta/alembic/`, `letta/sandbox/`, `letta/certs/`, `letta/db/` | Migration + sandbox infra; no cache logic |
| `.claude/knowledge-base/references/letta/letta/templates/`, `letta/fern/` | Templates + Fern API gen; no cache logic |
| LangMem clone | Empty dir on this machine; cannot investigate without re-cloning (out of token budget for this discovery) |
| Zep (`getzep/zep`) | NOT in references/; if Zep prior_art needed, that's a follow-up discovery slug |
| Cognee / Graphiti / Honcho | Different problem space (graph / theory-of-mind); not semantic-cache layer |
| Browser/HTTP cache layers (Cloudflare KV, Varnish, Service Worker) | Different abstraction layer; consumer-side caching outside SDK boundary |

## ADRs

### D1 — Time + per-question budget

- **Decision:** Total halt-loop budget for `/discover-execute` = **45 min wall-clock + 80k tokens**. Per-project sub-budgets:
  - mem0 (incl. embedchain): 20 min / 30k tokens (load-bearing CLAUDE.md verification)
  - letta: 10 min / 15k tokens (adjacent technique cross-pollination)
  - Web prior_art (arxiv + GitHub + LangChain + LlamaIndex + vendor docs): 15 min / 35k tokens (THE prior_art corner)
- **Per-question stop condition:** if Fase A returns empty after 3 query variants OR Fase B WebFetch fails 2× non-network → mark BLOCKED with reason. Continue to next question. Do NOT pad with fake data.
- **Rationale:** Per `token-budget.md`, `/discover-execute` typical 30-100k. Item 19 has 5 corners populated (max question count 8) → upper-middle range. The prior_art corner is heaviest because it requires WebFetch per snapshot (each adds ~3-5k tokens).
- **Alternatives:** Larger budget (120k tokens, deeper LangChain + LlamaIndex dive) — rejected as YAGNI; first iteration goal is "lock the design space", not exhaustive survey.

### D2 — Investigation depth per corner

- **Decision:** Tests (2 questions): shallow scan (test file head/imports + one assertion example). Deps (1): exact version pin + 1-line rationale per package. Tools (DEFER-CORNER): no question — see D3. Techniques (2): full read of relevant module + 3-paragraph synthesis per question. Prior_art (3): snapshot canonical source URL + verbatim quote of threshold/invalidation/backend rationale per source.
- **Rationale:** Techniques + prior_art carry decision weight; tests + deps are confirmation that the technique ISN'T just paper-theory. Tools doesn't apply (we already ship docker-compose pgvector — no new tool needed).
- **Alternatives:** Equal-depth per corner — rejected; tests + deps are diminishing returns past surface-level confirmation.

### D3 — `<!-- DEFER-CORNER: tools | TheMemory already ships docker-compose pgvector + GHCR distroless. v1.5 cache backend choice (pgvector vs Redis via DIP) requires ZERO new dev tooling; new Redis backend would add docker-compose service, not new tool category. -->`

- **Decision:** Corner "Tools" explicitly deferred via DEFER-CORNER marker.
- **Rationale:** Per cycle-discover.md v1.1, every corner needs ≥ 1 question OR ADR-deferral. Tools corner here has zero load-bearing question because:
  1. TheMemory already ships pgvector via `docker-compose.yaml` (Item 17 distroless)
  2. v1.5 backend choice is a runtime composition concern, not a build tool concern
  3. CI tooling for cache backend is "just add another vitest integration test" — no new tool category

### D4 — Allowlist additions (pre-flight)

- **Decision:** 4 domains added to `.claude/rules/discover-web-allowlist.txt` BEFORE `/discover-execute` runs: `python.langchain.com`, `docs.llamaindex.ai`, `redis.io`, `milvus.io`.
- **Rationale:** Without these, Q6/Q7/Q8 hit cycle-discover.md hard gate #5 (`domain_not_in_allowlist` cap 49 INVALID). All 4 are official vendor / canonical-lib docs. Each carries inline rationale per cycle-discover allowlist format.
- **Alternatives:**
  - **B** (cite only existing allowed domains): rejected — would force prior_art corner to skip LangChain + LlamaIndex (the two MOST consumed semantic-cache patterns in the JS/TS + Python ecosystems). Discovery would be incomplete.

### D5 — Snapshot integrity discipline

- **Decision:** Every URL cited by `/discover-execute` MUST be snapshotted to `.claude/knowledge-base/discoveries/snapshots/semantic-recall-cache/{sha256(url + content)}.md` AT THE SAME ITERATION the URL is referenced in the blueprint. No after-the-fact snapshot regeneration. If WebFetch fails 2×, the question is marked BLOCKED — URL is NOT cited.
- **Rationale:** Cycle-discover.md v1.1 hard gate #6 (`snapshot_missing_or_corrupt` cap 49). Vendor docs drift fast (LangChain v0.1 → v0.3 API breaks); the snapshot is the source of truth, not the live URL.
- **Alternatives:** Snapshot only when URL is the load-bearing citation — rejected; defeats audit purpose. ALL URL citations snapshot or none.

### D6 — Expected-negative outcomes + dependency-classification nuance (EC-6 + EC-7 absorption)

- **EC-6 absorption (Q5 expected outcome):** OpenAI's prompt cache (`prompt_cache_key`, automatic prefix matching) is INPUT-SIDE FIXED-PREFIX caching, NOT semantic similarity matching. Q5's question "pattern transfers to recall caching?" therefore has high prior probability of NEGATIVE answer. **Negative evidence is also evidence per Inquebrável Rule 3** — the blueprint cites Q5's "does not transfer because OpenAI's cache is input-prefix not semantic" verbatim and uses it to REJECT alternative B in the eventual v1.5 plan ("don't blindly copy OpenAI's prompt-cache pattern"). The halt-loop does NOT mark Q5 as BLOCKED when the answer is negative; it marks Q5 as ANSWERED with explicit negative finding.
- **EC-7 absorption (Q3 deps section nuance):** `embedchain/pyproject.toml` may declare cache deps in `[project.optional-dependencies]` extras (e.g., `gptcache` only installed via `pip install embedchain[gptcache]`) rather than `[project.dependencies]` core. Q3 Fase B synthesis MUST distinguish core vs optional and reflect this in the Rule 9 verdict because:
  - **Optional-dependency adoption** has lower coupling risk (consumer opts in)
  - **Core-dependency adoption** has higher coupling risk (always pulled, bundle bloat)
  - A package that's optional in embedchain may need to be optional in `@usetheo/memory` too — the precedent transfers
- **Rationale:** Both ECs are documented (not muted) because the discover-execute agent may otherwise treat negative findings as "incomplete" (Q5) OR conflate core vs optional deps in the Rule 9 verdict (Q3), corrupting the blueprint's downstream usability for `/to-plan`.
- **Alternatives:**
  - B (ignore — let halt-loop figure out): rejected — these are EXPECTED nuances surfaced by `/discover-edge-cases`; explicit ADR documents them so the halt-loop doesn't waste iterations re-deriving them.

## Research Questions

### Corner: Integration tests (2 questions)

**Q1.** Does `embedchain/embedchain/cache.py` ship integration tests that verify cache hit/miss + invalidation behavior? What boundary do they test against (real Redis? in-memory FAISS? mock)?
- **Source:** `.claude/knowledge-base/references/mem0/embedchain/`
- **Fase A method:** `Grep -r "cache" .claude/knowledge-base/references/mem0/embedchain/tests/ 2>/dev/null` + `find .../embedchain/tests -name "*cache*"`
- **Fase B method:** Read the test files surfaced by Fase A (head + first 2 test cases)
- **Expected answer shape:** "embedchain ships N cache test files; tests use {real Redis / FAISS / mock} backend; invalidation is tested by {sequence}; OR embedchain ships ZERO cache tests, in which case the cache.py is paper-only"

**Q2.** Does Letta's `tests/test_openai_prompt_cache_request_fields.py` reveal a pattern for testing prompt-level caching that's transferable to recall caching? (Cross-pollination: prompt cache and recall cache share "is the request semantically equivalent?" challenge)
- **Source:** `.claude/knowledge-base/references/letta/tests/test_openai_prompt_cache_request_fields.py` (verified exists)
- **Fase A method:** `Read .claude/knowledge-base/references/letta/tests/test_openai_prompt_cache_request_fields.py` (full file)
- **Fase B method:** Cross-grep on what `test_openai_prompt_cache_request_fields` references in `letta/services/` or `letta/llm/`
- **Expected answer shape:** "Letta tests OpenAI prompt-cache at REQUEST-FIELD level by checking {field names / structure / nothing}; pattern {transfers / does not transfer} to recall caching because {reason}"

### Corner: Dependencies (1 question)

**Q3.** What dependencies does `embedchain` (the only reference project shipping a cache layer) declare in its `pyproject.toml` for the cache backend? Pin versions + Rule 9 verdict.
- **Source:** `.claude/knowledge-base/references/mem0/embedchain/pyproject.toml`
- **Fase A method:** `Grep -E "cache|redis|gptcache|faiss" .claude/knowledge-base/references/mem0/embedchain/pyproject.toml`
- **Fase B method:** Read `cache.py` import statements; cross-reference with pyproject.toml to confirm declared vs imported
- **Expected answer shape:** "embedchain depends on {gptcache ^X / redis ^Y / FAISS ^Z}; default backend is {X}; Rule 9 verdict for v1.5 TheMemory: {ADOPT package X for backend Y / REJECT because reason / DEFER pending evidence}"

### Corner: Tools

`<!-- DEFER-CORNER: tools | TheMemory already ships docker-compose pgvector + GHCR distroless. v1.5 cache backend choice requires ZERO new dev tooling; new Redis backend would add docker-compose service, not new tool category. See ADR D3. -->`

### Corner: Techniques (2 questions)

**Q4.** What cosine-similarity threshold + invalidation semantics does `embedchain/cache.py` implement? Specifically: hit threshold default value, invalidation triggered by what events, TTL default.
- **Source:** `.claude/knowledge-base/references/mem0/embedchain/embedchain/cache.py` + `embedchain/embedchain/config/cache_config.py` (both verified exist)
- **Fase A method:** `Read .claude/knowledge-base/references/mem0/embedchain/embedchain/cache.py` + `cache_config.py` (full files)
- **Fase B method:** Grep callers of cache.py classes in embedchain/app.py and embedchain.py to see invalidation triggers
- **Expected answer shape:** "embedchain default hit threshold = X (cosine|euclidean); invalidation triggered by {explicit clear() / TTL / never}; default TTL = N seconds OR none"

**Q5.** What technique-lessons does Letta's prompt-cache testing surface that apply to recall caching? (Specifically: does the OpenAI prompt-cache API document a threshold/invalidation pattern that maps to our needs?)
- **Source:** `.claude/knowledge-base/references/letta/tests/test_openai_prompt_cache_request_fields.py` + cross-references
- **Fase A method:** Read test file + grep `cache` in `letta/services/`, `letta/llm/`, `letta/agents/`
- **Fase B method:** If Letta references OpenAI's prompt cache docs, snapshot `platform.openai.com` (allowed) for the canonical OpenAI prompt-cache spec; cross-cite
- **Expected answer shape:** "Letta tests prompt-cache by {field-set verification / response-shape diff}; OpenAI's prompt cache has {automatic / explicit} threshold of {value}; lesson for recall: {pattern X applies / does not apply because reason}"

### Corner: Prior_art (3 questions) — THE LOAD-BEARING CORNER

**Q6.** What does GPTCache (zilliztech/GPTCache, arXiv 2310.07831) document about its DEFAULT hit threshold, invalidation strategy, backend choice, and metric observability?
- **Sources:**
  - `https://arxiv.org/abs/2310.07831` (arxiv — allowed)
  - `https://github.com/zilliztech/GPTCache` README + `examples/` (github — allowed)
  - `https://milvus.io/` (milvus — allowed, added 2026-06-03) — for GPTCache's default Milvus backend rationale
- **Fase A method (EC-1 absorption):** WebSearch-first to RESOLVE canonical arXiv ID before WebFetch. Step 1: `WebSearch query="GPTCache semantic cache LLM paper arxiv"` to confirm `2310.07831` IS the GPTCache paper (or surface the correct ID). Step 2: `WebSearch query="GPTCache semantic cache threshold default" + "site:github.com/zilliztech"` + variants for technique details. Without Step 1, WebFetch direct to `arxiv.org/abs/2310.07831` may snapshot the wrong paper if the ID is mistranscribed.
- **Fase B method:** WebFetch each VERIFIED URL → snapshot to `snapshots/semantic-recall-cache/{sha256}.md`. If Step 1 of Fase A returns a different arXiv ID, the new ID is the one fetched, NOT `2310.07831`.
- **Expected answer shape:** "GPTCache default similarity threshold = {value} (algorithm: {cosine|L2}); invalidation = {TTL N seconds / explicit purge / write-triggered}; default storage = {Milvus / SQLite / Redis}; observability via {Prometheus metric / counter / nothing}"

**Q7.** What does LangChain's `RedisSemanticCache` (Python ecosystem) AND LlamaIndex's `IngestionPipelineCache` document about threshold + invalidation + backend?
- **Sources:**
  - `https://python.langchain.com/docs/integrations/llms/llm_caching` (langchain — allowed, added 2026-06-03)
  - `https://docs.llamaindex.ai/en/stable/module_guides/loading/ingestion_pipeline/` (llamaindex — allowed, added 2026-06-03)
- **Fase A method (EC-2 absorption):** WebSearch-first to RESOLVE current canonical vendor docs URL before WebFetch (LangChain reorganizes docs frequently; LlamaIndex Sphinx structure shifts between versions). Step 1: `WebSearch query="LangChain RedisSemanticCache documentation"` + `"LlamaIndex IngestionPipelineCache documentation"` to confirm `python.langchain.com/docs/integrations/llms/llm_caching` AND `docs.llamaindex.ai/en/stable/module_guides/loading/ingestion_pipeline/` are CURRENT canonical (or surface the new URL after reorg). Step 2: `WebSearch query="LangChain RedisSemanticCache score_threshold" + "LlamaIndex IngestionPipelineCache invalidation"` for technique details. Without Step 1, WebFetch direct to hardcoded URLs may 404 and mark Q7 BLOCKED unnecessarily.
- **Fase B method:** WebFetch each VERIFIED URL → snapshot. If Step 1 surfaces post-reorg URLs, the new URLs are snapshotted; obsolete hardcoded URLs are dropped.
- **Expected answer shape:** "LangChain `RedisSemanticCache` default score_threshold = {value}; uses {RedisVL / langchain-redis} backend; invalidation = {RedisVL TTL / manual}. LlamaIndex `IngestionPipelineCache` uses {disk / redis / mongo} for content-hash dedupe (NOT semantic) — caveat: LlamaIndex doesn't ship semantic-result cache, only ingestion-pipeline content cache"

**Q8.** Do Pinecone, Weaviate, Qdrant, OR Redis (Vector Search) document NATIVE query-result caching at the platform/vendor layer? If yes, what's the threshold + invalidation pattern + cost model?
- **Sources:**
  - `https://docs.pinecone.io/` (allowed)
  - `https://docs.weaviate.io/` (allowed)
  - `https://qdrant.tech/documentation/` (allowed)
  - `https://redis.io/docs/latest/develop/get-started/vector-database/` (allowed, added 2026-06-03)
- **Fase A method:** `WebSearch query="Pinecone query result cache" + "Weaviate query caching" + "Qdrant result cache" + "Redis VSS cache layer"`
- **Fase B method:** WebFetch + snapshot. Per-vendor, focus on the "Querying" or "Performance" docs section
- **Expected answer shape:** "Pinecone {ships|doesn't ship} a query-result cache at platform layer; if yes, {threshold / invalidation / cost}. Same for Weaviate / Qdrant / Redis. The aggregated answer informs whether TheMemory should build at the SDK layer (above vendor) or rely on vendor primitives where present (composition pattern)"

## Coverage Matrix

| Q# | Corner | Project / Source | Method (Fase A) | Method (Fase B) | Path / URL pre-validated? |
|---|---|---|---|---|---|
| Q1 | tests | mem0/embedchain | Grep + find in `references/mem0/embedchain/tests/` | Read surfaced test files | yes — `.../embedchain/` dir exists |
| Q2 | tests | letta | Read `test_openai_prompt_cache_request_fields.py` | Cross-grep `letta/services/` + `letta/llm/` | yes — file verified exists |
| Q3 | deps | mem0/embedchain | Grep `pyproject.toml` | Read cache.py imports + cross-ref | yes — `pyproject.toml` exists in grep output |
| Q4 | techniques | mem0/embedchain | Read `cache.py` + `cache_config.py` | Grep callers in `app.py` + `embedchain.py` | yes — all 4 files verified exist |
| Q5 | techniques | letta + OpenAI docs | Read test file + grep | WebFetch `platform.openai.com` (allowed) | yes — test file + platform.openai.com in allowlist |
| Q6 | prior_art | arxiv + github.com/zilliztech + milvus.io | WebSearch | WebFetch + snapshot each canonical URL | yes — all 3 domains allowed |
| Q7 | prior_art | python.langchain.com + docs.llamaindex.ai | WebSearch | WebFetch + snapshot | yes — both added to allowlist 2026-06-03 |
| Q8 | prior_art | docs.pinecone.io + docs.weaviate.io + qdrant.tech + redis.io | WebSearch per-vendor | WebFetch + snapshot per-vendor | yes — all 4 allowed |
| — | tools | (deferred) | — | — | — DEFER-CORNER marker per ADR D3 |

**Coverage: 8/8 questions mapped to method + path/URL pre-validated. Tools corner deferred via marker (honest deferral, not gap).**

## Halt-loop Checkpoints (for `/discover-execute`)

A sub-task may be marked DONE only when:

| Checkpoint | Pass criterion |
|---|---|
| Per-question Fase A | Returned ≥ 1 concrete result OR explicit `BLOCKED — Fase A exhausted after 3 query variants` marker. NEVER pad with off-scope content. |
| Per-question Fase B | (Local) Read returned the file contents AND blueprint paragraph cites them with line numbers. (Web) WebFetch returned HTTP 200 AND snapshot written to `snapshots/semantic-recall-cache/{sha256}.md` AND blueprint paragraph cites the snapshot file (not the live URL). |
| Per-corner | All questions in the corner either ANSWERED in blueprint OR explicitly BLOCKED with reason. Soft-skip is forbidden. |
| Per-project (mem0 / letta / web) | Time budget D1 not exceeded by > 25%; if exceeded, halt and mark remaining questions for that project BLOCKED with reason `budget-exhausted`. |
| Global | `<promise>BLUEPRINT_COMPLETE</promise>` ONLY when ALL 4 conditions hold: every question answered or BLOCKED; every citation backed by a real path / snapshot; 4 populated corners (tests/deps/techniques/prior_art) have ≥ 1 answered question; tools corner has the DEFER-CORNER marker present in blueprint. |
| **EC-3 absorption — Q4 ↔ Q6 dependency resolution** | When `/discover-execute` reads `embedchain/cache.py` for Q4 (Fase B) and the file IMPORTS `gptcache` (rather than implementing threshold/invalidation directly), Q4 is marked `DEPENDS-ON-Q6` and the halt-loop MUST process Q6 BEFORE finalizing Q4. Q4's blueprint paragraph then synthesizes "embedchain delegates threshold to GPTCache (Q6 default {value})" using verbatim quote from Q6's snapshot. Without this resolution order, Q4 ends up with `(see Q6)` placeholder while Q6 may not yet be processed. |
| **EC-4 absorption — Q8 sub-budget** | Q8 has 4 sub-investigations (Pinecone + Weaviate + Qdrant + Redis VSS). Within ADR D1's Web 15 min / 35k token cap, Q8 sub-budget is **≤ 4 min / 8k tokens TOTAL** (≈ 1 min + 2k tokens per vendor). After Q8 sub-budget exhausts, mark remaining vendors as `BLOCKED — reason: q8-sub-budget-exhausted` and continue. Without this cap, Q8 may consume the entire Web budget leaving Q6 + Q7 BLOCKED — defeats prior_art corner. |
| **EC-5 absorption — CLAUDE.md claim verdict checkpoint** | Before emitting `<promise>BLUEPRINT_COMPLETE</promise>`, blueprint MUST contain a section `## CLAUDE.md claim verdict` with EXACTLY one of `VERIFIED`, `REFUTED`, or `INCONCLUSIVE` and a 1-paragraph rationale citing verbatim quotes from Q1 + Q3 + Q4 answers. This closes the embedchain↔mem0 classification ambiguity that motivated this discovery. Without this section, blueprint may scatter embedchain references across 3 questions without ever stating definitively whether mem0-the-product DOES or DOES NOT document semantic recall caching. |

## Acceptance Criteria

- [ ] Blueprint file exists at `.claude/knowledge-base/discoveries/blueprints/semantic-recall-cache-blueprint.md`
- [ ] All 8 questions present in blueprint, each answered OR BLOCKED with reason
- [ ] Every `.claude/knowledge-base/references/{...}` citation resolves via `Path.exists()` (no fabricated paths — `discover-confidence` hard cap)
- [ ] Every web URL citation has a corresponding snapshot file at `.claude/knowledge-base/discoveries/snapshots/semantic-recall-cache/{sha256}.md` AND the snapshot hash matches the URL+content (discover-confidence v1.1 hard gate #6)
- [ ] Coverage matrix in blueprint reflects 4 populated corners + 1 DEFER-CORNER (tools)
- [ ] Each prior_art dependency-candidate has an explicit Rule 9 verdict in blueprint (`ADOPT` / `REJECT` / `DEFER` with rationale + revisit date)
- [ ] CLAUDE.md claim "Mem0/Letta/LangMem do NOT document semantic-recall caching at this layer" is **VERIFIED or REFUTED** with verbatim evidence (Q1 + Q2 + Q4 jointly answer this)
- [ ] Blueprint section "## Recommendations for v1.5 plan" lists 3-5 specific design choices (backend default, threshold default, invalidation semantics, cache key, observability) with prior_art citations backing each
- [ ] `/discover-confidence` returns verdict ≥ SHIPPABLE_WITH_CAVEATS (70)

## Global Definition of Done

- [ ] Plan archived to `.claude/knowledge-base/discoveries/plans/completed/semantic-recall-cache-plan.md` after blueprint reaches SHIPPABLE_WITH_CAVEATS per cycle-discover archive discipline (analog to cycle-plan archive)
- [ ] If blueprint produces canonical patterns that future `/to-plan` invocations should consult → invoke skill-distillation tail (`/skill-writer` → `/skill-validator` → `/skill-register`) creating `.claude/skills/semantic-cache-patterns/`. Otherwise, blueprint stays as one-off reference and skill distillation skipped per cycle-discover § stop conditions.
- [ ] `/to-plan semantic-recall-cache-v1-5` cites this blueprint as ground truth (paths + verbatim quotes from snapshots)

## Companion artifacts

- This plan: `.claude/knowledge-base/discoveries/plans/semantic-recall-cache-plan.md`
- Future blueprint: `.claude/knowledge-base/discoveries/blueprints/semantic-recall-cache-blueprint.md`
- Future snapshots: `.claude/knowledge-base/discoveries/snapshots/semantic-recall-cache/`
- Future confidence report: `.claude/knowledge-base/reviews/semantic-recall-cache-confidence-{date}.md`
- Allowlist additions (committed pre-flight): 4 domains in `.claude/rules/discover-web-allowlist.txt` (`python.langchain.com`, `docs.llamaindex.ai`, `redis.io`, `milvus.io`)

## Project rules cited

- `.claude/rules/architecture.md § 1 (three-tier scope)` — cache key composition MUST honor 3-tier scope per ADR-0002
- `.claude/rules/architecture.md § 3 (DIP)` — 13th DIP `RecallCacheStore` must respect `core/ ↛ local/cloud/` boundary
- `.claude/rules/discover-web-allowlist.txt` — pre-flight allowlist updated 2026-06-03 with 4 new domains
- `.claude/rules/cycle-discover.md v1.1` — 5-corner coverage discipline + snapshot integrity + Rule 9 prior_art verdict
- `.claude/rules/token-budget.md § /discover-execute` — 30-100k token range; D1 budgets 45 min / 80k inside this range
- Inquebrável Rule 9 (`/home/paulo/.claude/CLAUDE.md § 9`) — Não Reinvente: prior_art verdict per dependency candidate is mandatory before /to-plan locks the 13th DIP backend choice
- Inquebrável Rule 11 (YAGNI) — discovery exists to SHRINK the design space, not expand it

## Honest disclosure

1. **2/3 reference projects available.** LangMem dir is empty on this machine; CLAUDE.md claim about LangMem stays UNVERIFIED at this discovery's end. Either re-clone LangMem in a future discovery OR accept that LangMem caching evidence is gap.
2. **Embedchain is technically a sub-project of mem0 repo, not mem0 itself.** Q1+Q3+Q4 surface CLAUDE.md claim's nuance: "mem0 does not = embedchain does not"? Or are they linked? Blueprint must clarify.
3. **CLAUDE.md's "greenfield vs Zep" claim is NOT investigated here** — Zep is not in references/ on this machine. If Zep is the load-bearing competitor, a follow-up discovery slug `zep-semantic-cache-prior-art` is needed.
4. **Vendor docs may NOT document native query-result caching.** Q8 may return mostly negative evidence (vendors leave caching to consumer-side libs). That's OK — negative evidence is also evidence. The blueprint says so honestly.
