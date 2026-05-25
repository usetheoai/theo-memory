# Followups — v0-3-agent-tools-mcp

Out-of-scope improvements logged during /implement halt-loop. NOT included in current commit per cycle-implement v1.2 anti-pattern: "NEVER scope-creep mid-task".

## Logged at T0.2 (iteration 2)

- **F-T0.2-1 — `package.json#files` allow-list needs `dist/**` for bin entry tarball inclusion.** T0.2 declares `bin: { "themory-mcp": "./dist/agent-tools/cli.js" }` but `package.json#files` does NOT yet include `dist/**`. `npm pack` does NOT validate bin file existence at pack time (only at consumer install time). Fix in T6.1: add `"dist/**"` to allow-list AND wire `"prepack": "npm run build"` script so published tarball always contains current dist artifacts. SEPA pre-RED MAJOR flag from iter 2.
- **F-T0.2-2 — Add bin-target-in-tarball test row to `tests/integration/publish-readiness.test.ts`.** Mirror the F1 followup pattern that iterates `pkg.exports` and asserts backing source exists; do the same for `pkg.bin` (every bin target's path resolves under the packed tarball OR is documented as a build artifact). Lands at T6.1 alongside F-T0.2-1. SEPA pre-RED MINOR flag from iter 2.

## Logged at T1.1 (iteration 3)

- **F-T1.1-1 — iter-2 SEPA pre-RED brief not persisted on disk.** The iter-2 SEPA pre-RED advisory was rich (1 CRITICAL + multiple MAJOR/MINOR findings on the build pipeline + tripwire regex tightening + EC-1 absorption depth) but was only kept in the halt-loop transcript. Future iterations MUST `Write` the iteration-N-pre-red.md immediately after each pre-RED Agent call, before proceeding to RED phase, to close the audit-trail gap. iter-3 backfilled both pre-red + pre-commit briefs at the cost of slightly larger commit.

## Logged at T2.1 (iteration 4)

- **F-T2.1-1 — plan T2.1 RED test name `test_recall_schema_default_topK_5` contradicts v0.0 contract.** Plan v1.1 declares topK default 5; `src/core/retrieval/pipeline.ts:73` actually defaults to 20 (Mem0 parity locked at v0.0). At T2.1 we honored the contract per `architecture.md § 5` (two surfaces, one contract). Plan needs an amendment at next cycle-plan iteration to rename the RED test name to reflect topK=20 default. SEPA iter-4-pre-red CRITICAL flag absorbed.
- **F-T2.1-2 — plan T2.1 recall OUTPUT_SCHEMA narrative cites `attributedTo` field that does NOT exist in v0.0.** Plan v1.1 § Deep Dives describes recall output as `{id, text, score, attributedTo?, scope, timestamp}`. `attributedTo` is v1.1 Roadmap Item 12 (multi-peer / theory-of-mind) — fabrication for v0.3. `MemoryItemWithScore` from `src/core/memory-item.ts:48` is the actual contract. At T2.1 we shipped minimal honest subset `{id, text, score, scope, createdAt, metadata}` (drop attributedTo + hash + updatedAt + tValid + tInvalid as not-LLM-visible). Plan needs an amendment to reword the OUTPUT_SCHEMA narrative + reference MemoryItemWithScore. SEPA iter-4-pre-red MAJOR flag absorbed.
- **F-T2.1-3 — T2.2 emitter MUST set `target: 'jsonSchema7'` (ADR D9) for reflect-schema.** Without explicit target, `zod-to-json-schema` may emit a dialect that does NOT translate `z.object({}).strict()` (EC-11) into `additionalProperties: false`. Reflect's strict extras-rejection contract would silently break at JSON Schema wire level. `reflect-schema.ts:11-12` JSDoc carries the forward note; T2.2 implementation MUST honor D9 + add an explicit test asserting emitted schema includes `additionalProperties: false`. SEPA iter-4-pre-commit MINOR flag.
