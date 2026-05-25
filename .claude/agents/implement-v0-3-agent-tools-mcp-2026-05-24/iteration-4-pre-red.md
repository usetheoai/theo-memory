# SEPA — Iteration 4 / Task T2.1 / Phase PRE-RED

## Plan recap

- T2.1 authors 4 zod schemas (`remember`, `recall`, `forget`, `reflect`) co-located with their future handlers + a shared constants file (per EC-2 absorption) + a unit-test file. Each schema file exports `TOOL_NAME`, `INPUT_SCHEMA`, `OUTPUT_SCHEMA` (recall only), `DESCRIPTION`. ADR D2 (schema codegen pipeline) + ADR D6 (error mechanisms — forget mutual exclusion drives Protocol Error -32602) are the load-bearing references.

## Findings

- **[CRITICAL] — Plan T2.1 RED test contradicts v0.0 contract default for `recall.topK`.**
  Plan line 467: `test_recall_schema_default_topK_5() — parses { query: 'foo' }, asserts topK defaults to 5`.
  `src/core/options.ts:24` (v0.0 contract, locked): `RecallOptions.topK` default `20` (Mem0 parity, JSDoc-anchored).
  Picking either silently breaks contract symmetry between v0.3 MCP surface and v0.0 programmatic surface: agents using MCP would get a different default than callers using the in-process `recall()`. This is exactly the kind of cross-surface drift `architecture.md § 5` ("Two runtimes, one contract") locks down.
  **Recommended action**: HALT before writing this RED test. Two options for the main session to surface to user:
  (1) Trust v0.0 contract → set zod default to `20`, rename test to `test_recall_schema_default_topK_20` (preferred — preserves the contract Inquebrável Rule 1 demands 95% confidence around).
  (2) Trust plan literal → set zod default to `5`, log an ADR/EC explaining why MCP surface intentionally diverges from programmatic (no current evidence supports this; D2 deep-dive does not justify it; would require strategic review per `CLAUDE.md § When this file is wrong`).
  Without explicit user choice, do NOT proceed.

- **[MAJOR] — Recall `OUTPUT_SCHEMA` shape narrated in plan deep-dive does NOT match `MemoryItem` exactly.**
  Plan line: `array of {id, text, score, attributedTo?, scope, timestamp}`.
  Actual `MemoryItemWithScore` shape (verified at `src/core/memory-item.ts:48`): `{id, text, hash, scope: Scope, createdAt: Date, updatedAt: Date, metadata, tValid, tInvalid, score}`. Notes:
  - `timestamp` is not a field — `createdAt` is. Use `createdAt` in the output schema.
  - `attributedTo` does NOT exist in v0.0 `MemoryItem` (it is planned for v1.1 Item 12 per `CLAUDE.md § Roadmap`). Including it in v0.3 schema is fabrication.
  - `scope: Scope` is a discriminated union (`UserScope | SessionScope | AgentScope`) per `src/core/scope.ts`. Schema must emit a `z.discriminatedUnion('kind', [...])` shape OR a serialized projection — implementer must decide and JSDoc the choice.
  **Recommended action**: drop `attributedTo`, rename `timestamp` → `createdAt`, emit `scope` as `z.discriminatedUnion('kind', [...])` to preserve type narrowing in agent callers consuming `structuredContent`.

- **[MAJOR] — EC-2 constants placement.**
  Plan says `src/agent-tools/tools/constants.ts`. There is already a `src/core/constants.ts` (sibling of `dedup.ts`, etc.) holding v0.1 core constants. Per `architecture.md § 3` (DIP), `agent-tools/` MAY depend on `core/`. The choice to keep MCP-specific payload caps at the `agent-tools/tools/` layer is correct (these are transport-boundary concerns, not core domain), but ensure no naming collision: name the file `src/agent-tools/tools/constants.ts` exactly per plan; do NOT introduce magic-number duplicates inside individual schema files. Reference the constant by named import in each schema's `.max()` call. JSDoc each constant `@see EC-2`.

- **[MAJOR] — EC-11 `z.object({}).strict()` for `reflect` schema: confirm zod-to-json-schema downstream behavior.**
  T2.1 does NOT emit JSON Schema yet (downstream task), but the test `test_reflect_schema_rejects_extra_keys` should ALSO be paired with a comment/JSDoc anchored to `EC-11` so the downstream emission task can validate `additionalProperties: false` in the JSON Schema output. Pure-zod strict mode does not auto-translate to `additionalProperties: false` without target `'jsonSchema7'` (D9 + EC-3 lock). Surface this as a forward note in the schema's JSDoc.

- **[MINOR] — Test file placement matches convention.**
  `src/agent-tools/tools/__tests__/schemas.test.ts` matches the established `src/{module}/__tests__/` convention from T0.1 (also matches `testing.md § Pyramid`: unit tests live next to source). OK.

- **[MINOR] — `forget` mutual-exclusion XOR pattern is correct.**
  `Boolean(d.id) !== Boolean(d.all)` evaluates XOR semantics: rejects `{id, all}` AND `{}`. Matches plan deep-dive. The `.refine` `message` field surfaces as zod error; downstream dispatch (Phase 5) will map this to Protocol Error -32602 per D6. JSDoc the refinement with `@see ADR D6`.

- **[MINOR] — `TOOL_NAME` regex (`/^[A-Za-z0-9_.-]{1,128}$/`).**
  Verbs `remember`, `recall`, `forget`, `reflect` are all 6-7 chars, lowercase letters only — pass trivially. Test `test_each_tool_name_matches_spec_regex` is a defense-in-depth check for future verbs (e.g., v0.4a `reflect.background`). OK.

- **[INFO] — RED count: plan declares 7 baseline + 2 inline upgrades (EC-10, EC-11) = 9 tests minimum.**
  Implementer should write all 9 BEFORE any schema code. RED phase fails on each (no schemas yet). Confirm by running `npm test -- src/agent-tools/tools/__tests__/schemas.test.ts` and observing 9 failures, not test-runner errors.

- **[INFO] — JSDoc cross-reference checklist for COMMIT phase.**
  Each new file must carry top-of-file JSDoc citing: `@see ADR D2` (schema codegen), `@see ADR D6` (errors — for forget mutual exclusion), `@see EC-2` (payload caps — for remember + recall), `@see EC-10` (recall.threshold range), `@see EC-11` (reflect strict). The constants file cites EC-2 only.

## Recommended action

1. **HALT before writing `test_recall_schema_default_topK_5`.** Surface the topK default contradiction to the user with both options (20 per v0.0 contract vs 5 per plan literal). Do not silently pick.
2. After user resolves topK: rewrite plan recall `OUTPUT_SCHEMA` narrative to match `MemoryItemWithScore` faithfully — drop `attributedTo`, rename `timestamp` → `createdAt`, emit `scope` as discriminated union. JSDoc-anchor the choice. If this constitutes a plan revision, log to followups (do NOT edit plan mid-implement per cycle-implement.md § Anti-patterns #3) — surface to user for decision.
3. Author all 9 RED tests FIRST (7 plan-declared + EC-10 + EC-11). Run, confirm 9 failures.
4. Author the 4 schema files + `constants.ts` with EC-2/EC-10/EC-11 absorption, JSDoc cross-refs to ADR D2/D6 + EC-2/EC-10/EC-11.
5. REFACTOR: extract any shared validation helper if duplication emerges (DRY watch — likely none for 4 leaf schemas).

## Main session resolution (recorded 2026-05-25)

CRITICAL + MAJOR resolved by honoring v0.0 contract per `architecture.md § 5` (two surfaces, one contract). Plan T2.1 RED test names + OUTPUT_SCHEMA prose were transcription-level errors, NOT architectural decisions. Resolution does NOT require mid-implement plan edit (anti-pattern #3 honored); both deviations are aligned to the EXISTING contract.

- **topK default: 20** (matches `src/core/retrieval/pipeline.ts:73`). RED test renamed BDD: `defaults topK to 20 (matches @usetheo/memory contract)`. Logged F-T2.1-1 (plan amendment at next cycle-plan iteration).
- **OUTPUT_SCHEMA: minimal `MemoryItemWithScore` subset** = `{id, text, score, scope, createdAt, metadata}`. Drop `attributedTo` (v1.1 future fabrication for v0.3), drop `hash` (internal dedup key), drop `updatedAt` (==createdAt under ADD-only ADR-0003), drop `tValid/tInvalid` (bi-temporal v0.5+ asOf surface). Agents need only LLM-visible fields. Logged F-T2.1-2 (plan amendment).
- Scope as `z.discriminatedUnion('kind', [...])` per `src/core/scope.ts` (UserScope/SessionScope/AgentScope discriminator).
- Proceeding to RED phase with 9 tests + corrected names/shapes.

6. WIRING triad for T2.1: pillar (a) — schemas have no production caller YET (Phase 5 dispatch will import them); mark pillar (a) as `pending-T5.x` in `.wiring-evidence.json` with explicit deferral note. Pillar (b) — unit tests ARE the integration surface for schemas (schemas are pure validators, no I/O). Pillar (c) — n/a (no runtime metric declared for T2.1).
