/**
 * Skill-row CRUD over pgvector — extracted from `pgvector-store.ts` at v0.6.1
 * T3.1 / F3 so the parent file drops below the 500-LoC budget per
 * `architecture.md § Module hygiene`.
 *
 * `PgvectorStore` keeps the public surface (still implements
 * `VectorStoreWithSkillInsert`); it composes one of these internally and
 * delegates the four skill methods. Callers are unaffected.
 *
 * Composition seam: this class owns NO transaction primitive. The owning
 * `PgvectorStore` injects its `withTransaction` method via the constructor's
 * second argument, keeping the class independent of `PgvectorStore` itself
 * (no circular import) and DIP-friendly for future runtime variants.
 *
 * @see .claude/knowledge-base/plans/skill-library-fixes-v0-6-1-plan.md § T3.1
 */
import type { Pool, PoolClient } from 'pg';

import { InvalidSkillError } from '../../domain/errors.js';
import type { SkillLanguage } from '../../domain/skill.js';

import { vectorLiteral } from './pgvector-vector-literal.js';
import type { InsertDerivedSkillArgs, InsertSkillArgs } from './skill-store-args.js';

const ALLOWED_SKILL_LANGUAGES: ReadonlySet<SkillLanguage> = new Set<SkillLanguage>([
  'typescript',
  'javascript',
]);

/**
 * Validate `insertSkill` / `insertDerivedSkill` args at the store boundary.
 * Rejects empty description (the embedding target cannot be empty) and
 * invalid `codeLanguage` BEFORE the SQL INSERT — typed errors over Postgres
 * CHECK violations per error-handling rules.
 *
 * T0.2 split: description check always runs; codeLanguage check only runs
 * when codeLanguage is non-null (derived skills carry NULL per plan ADR D2).
 */
function assertDescriptionPresent(description: string): void {
  if (description.trim().length === 0) {
    throw new InvalidSkillError(
      'empty-description',
      'description is required and must not be whitespace-only (it is the embedding target)',
    );
  }
}

function assertCodeLanguageIfPresent(codeLanguage: SkillLanguage | null): void {
  if (codeLanguage != null && !ALLOWED_SKILL_LANGUAGES.has(codeLanguage)) {
    throw new InvalidSkillError(
      'invalid-code-language',
      `codeLanguage must be one of [${[...ALLOWED_SKILL_LANGUAGES].join(', ')}] OR null; got ${JSON.stringify(codeLanguage)}`,
    );
  }
}

function assertSkillArgs(args: { description: string; codeLanguage: SkillLanguage | null }): void {
  assertDescriptionPresent(args.description);
  assertCodeLanguageIfPresent(args.codeLanguage);
}

export type WithTransactionFn = <T>(fn: (tx: PoolClient) => Promise<T>) => Promise<T>;

export class PgvectorSkillStore {
  constructor(
    private readonly pool: Pool,
    private readonly withTransactionFn: WithTransactionFn,
  ) {}

  async insertSkill(args: InsertSkillArgs): Promise<string> {
    assertSkillArgs(args);
    const result = await this.pool.query<{ id: string }>(
      `INSERT INTO memories (
         text, hash, embedding, payload,
         workspace_id, user_id, session_id, agent_id,
         kind, code, description, code_language
       ) VALUES (
         $1, $2, $3::vector, '{}'::jsonb,
         $4, $5, $6, $7,
         'skill', $8, $9, $10
       ) RETURNING id`,
      [
        args.description,
        args.hash,
        vectorLiteral(args.embedding),
        args.scope.workspaceId ?? 'default',
        args.scope.userId ?? null,
        args.scope.sessionId ?? null,
        args.scope.agentId ?? null,
        args.code,
        args.description,
        args.codeLanguage,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('insertSkill: INSERT returned no rows');
    }
    return row.id;
  }

  async insertDerivedSkill(args: InsertDerivedSkillArgs): Promise<string> {
    assertSkillArgs(args);
    if (args.derivedFrom.length === 0) {
      throw new InvalidSkillError(
        'empty-derived-from',
        'insertDerivedSkill requires at least one source skill id',
      );
    }
    const result = await this.pool.query<{ id: string }>(
      // multi-tenant-rbac-and-slice1-completion (F-dom-db-2): write workspace_id
      // so a derived skill stays in its source workspace — parity with insertSkill
      // + insertDerivedSkillAtomic (a derived skill via this path previously fell
      // back to the column default 'default', a cross-workspace leak).
      `INSERT INTO memories (
         text, hash, embedding, payload,
         workspace_id, user_id, session_id, agent_id,
         kind, derived_from, code, description, code_language
       ) VALUES (
         $1, $2, $3::vector, '{}'::jsonb,
         $4, $5, $6, $7,
         'skill', $8::jsonb, $9, $10, $11
       ) RETURNING id`,
      [
        args.description,
        args.hash,
        vectorLiteral(args.embedding),
        args.scope.workspaceId ?? 'default',
        args.scope.userId ?? null,
        args.scope.sessionId ?? null,
        args.scope.agentId ?? null,
        JSON.stringify([...args.derivedFrom]),
        args.code,
        args.description,
        args.codeLanguage,
      ],
    );
    const row = result.rows[0];
    if (row === undefined) {
      throw new Error('insertDerivedSkill: INSERT returned no rows');
    }
    return row.id;
  }

  async markSuperseded(
    sourceIds: readonly string[],
    supersededBy: string,
  ): Promise<void> {
    if (sourceIds.length === 0) {
      return;
    }
    await this.pool.query(
      `UPDATE memories SET superseded_by = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])`,
      [supersededBy, sourceIds],
    );
  }

  async insertDerivedSkillAtomic(
    args: InsertDerivedSkillArgs,
    sourceIdsToSupersede: readonly string[],
  ): Promise<string> {
    assertSkillArgs(args);
    if (args.derivedFrom.length === 0) {
      throw new InvalidSkillError(
        'empty-derived-from',
        'insertDerivedSkillAtomic requires at least one source skill id',
      );
    }
    return this.withTransactionFn(async (client) => {
      const insertResult = await client.query<{ id: string }>(
        `INSERT INTO memories (
           text, hash, embedding, payload,
           workspace_id, user_id, session_id, agent_id,
           kind, derived_from, code, description, code_language
         ) VALUES (
           $1, $2, $3::vector, '{}'::jsonb,
           $4, $5, $6, $7,
           'skill', $8::jsonb, $9, $10, $11
         ) RETURNING id`,
        [
          args.description,
          args.hash,
          vectorLiteral(args.embedding),
          args.scope.workspaceId ?? 'default',
          args.scope.userId ?? null,
          args.scope.sessionId ?? null,
          args.scope.agentId ?? null,
          JSON.stringify([...args.derivedFrom]),
          args.code,
          args.description,
          args.codeLanguage,
        ],
      );
      const derivedId = insertResult.rows[0]?.id;
      if (derivedId === undefined) {
        throw new Error('insertDerivedSkillAtomic: INSERT returned no rows');
      }
      if (sourceIdsToSupersede.length > 0) {
        await client.query(
          `UPDATE memories SET superseded_by = $1, updated_at = NOW() WHERE id = ANY($2::uuid[])`,
          [derivedId, sourceIdsToSupersede],
        );
      }
      return derivedId;
    });
  }
}
