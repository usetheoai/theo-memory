# SEPA — Iteration 2 / Task T0.2 / Phase pre-RED

## Findings (condensed)
- G1: `session?:` + `| null` both needed — distinct TS states; test BOTH.
- G2: `expectTypeOf` is justified (5 heterogeneous fixtures = tricky inference). Note rationale in test file header.
- G3: JSDoc on ScopedContext MUST land in T0.2 with EC-8 reservation note (sessionId/agentId reserved for v0.3+).
- G4: File header MUST cite ADR D1 (structural typing, no peer-dep on theokit).
- Both files NEW; src/theokit/ directory creation allowed by boundary-check.sh.

## 5 fixture shapes to assert
| Fixture | Shape |
|---|---|
| F1 sessions-auth | `{ session: { userId, username } }` |
| F2 template-saas | `{ session: { userId, email }, db }` |
| F3 authjs | `{ session: { userId, email, name? } }` |
| F4a diy-github (unauth) | `{ session: null }` |
| F4b diy-github (pre-callback) | `{ session: { userId?: undefined, login, pending } }` |
| F5 template-postgres | `{ db }` (NO session key) |

## RED guidance
1. Write types.test-d.ts with 6 fixture assertions + reserved-fields assertion.
2. Run vitest typecheck — MUST fail (file doesn't exist).
