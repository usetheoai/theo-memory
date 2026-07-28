import { defineConfig } from 'drizzle-kit';

/**
 * Drizzle Kit config for v0.1 local runtime — T0.4 of v0-1-local-runtime plan v1.3.
 *
 * Schema lives at src/local/schema.ts (created by T2.1).
 * Migrations land at src/local/migrations/ (committed to repo per ADR D1.6).
 *
 * Dev workflow:   npm run db:push      (drizzle-kit push  — applies schema directly)
 * Prod workflow:  npm run db:generate  (drizzle-kit generate — produces SQL migrations)
 *
 * CLI subcommand shape: `push` + `generate` (NOT `push:pg` / `generate:pg` — removed in
 * drizzle-kit 0.21+; dialect configured here, not on the CLI). Per ADR D1.10 + SEPA
 * initial-brief MINOR finding.
 *
 * @see ADR D1.10 — forced bump to drizzle-kit ^0.31.0 for security
 */
export default defineConfig({
  schema: './packages/core/src/infrastructure/db/schema.ts',
  out: './packages/core/src/infrastructure/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['THEOMEM_PG_URI'] ?? 'postgresql://themem:themem@localhost:5432/themem',
  },
  verbose: true,
  strict: true,
});
