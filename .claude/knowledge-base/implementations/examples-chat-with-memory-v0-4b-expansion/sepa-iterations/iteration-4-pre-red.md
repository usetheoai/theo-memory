# SEPA — Iteration 4 / Task T2.1 / Phase PRE-RED

**MODE:** TIGHT (inline reasoning; short task)

## Plan-vs-contract divergence detected
- Plan §386 lists BOTH `/api/memory/forget/route.ts` AND `/api/skills/forget/route.ts` for `{ hard }` extension.
- HOWEVER, `ScopedSkillMemory.forget(skillId: string)` at `src/core/skill.ts:168-172` does NOT accept options. JSDoc line 161 declares: "`forget` — **hard-delete** (scope-isolated)". Skills forget is ALREADY hard-delete by design (v0.6 + v0.6.1 EC-2 isolation contract).
- Adding `{ hard }` to the skills endpoint would be either a no-op or a wrong signal that soft-delete is supported.

## Plan accuracy gap
- Plan §381 + §385 cite the T7.1 BREAKING widening of `Memory.forget(memoryId, options?: ForgetOptions)`. T7.1 widened the memory contract only; skills contract was NOT widened.
- Plan §386 says "skills route: same" — inaccurate for the skill surface. The H3 scenario at plan §449 only tests `/api/memory/forget` with `{ hard: true }`, NOT the skills endpoint.

## Decision
- Extend `/api/memory/forget` with optional `{ hard?: boolean }` per plan §381 + EC-2 absorption (400 on invalid type).
- SKIP `/api/skills/forget` extension. Document the deviation in commit body citing skill.ts:161 + plan §381 "Memory.forget" wording.
- Honest BLOCKED > false completion per Inquebrável Rule 3.

## EC-2 absorption from /edge-case-plan review (line 53)
- "SHOULD TEST: InMemoryVectorStore.forget({ hard }) behavior unknown" — when backend is in-memory, `memory.forget(id, { hard: true })` must not crash. Verification: `InMemoryVectorStore` (src/local/in-memory-vector-store.ts) implements `forget(memoryId, options?)` per `MemoryStore` interface. For demo this validates at runtime; if in-memory adapter throws on `hard:true`, demo logs but doesn't crash because the route try/catches the call.

## Recommended action
- Extend `/api/memory/forget` only. Document skills skip honestly.
- Add explicit try/catch around `memory.forget(body.id, options)` to absorb any underlying contract failure (EC-2 safety).
