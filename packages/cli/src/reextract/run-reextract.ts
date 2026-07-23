/**
 * `themory reextract` composition root (M13 T3.2, #111 — blueprint ADR D3).
 *
 * THIN flag-mapper over the deterministic engine (./engine.ts), mirroring the
 * `themory import claude-code` precedent. Env-fail discipline reuses the shared
 * `assertEnvOrExit` specs (single source of truth for the stderr strings).
 * Dry-run needs ONLY the DB (zero LLM calls by contract) — OPENAI_API_KEY is
 * asserted exclusively on the real run.
 *
 * Exit codes: 0 = clean; 1 = partial failures (LLM skips — resume retries);
 * 2 = config/env (via assertEnvOrExit).
 */
import { rmSync } from 'node:fs';

import { PgMemoryEntityStore, PgMemoryGraphStore } from '@usetheo/memory';
import type { Embedder, LLM } from '@usetheo/memory';
import {
  assertEnvOrExit,
  buildEmbedder,
  OPENAI_API_KEY_ENV_SPEC,
  PG_URI_ENV_SPEC,
  resolveEmbedderKind,
} from '@usetheo/memory-agent-core';
import { Pool } from 'pg';

import { runReextract, type ReextractReport } from './engine.js';

export interface ReextractCliOptions {
  readonly dryRun?: boolean;
  readonly resume?: boolean;
  readonly restart?: boolean;
  readonly limit?: string;
  readonly concurrency?: string;
  readonly json?: boolean;
  readonly retireMechanism?: boolean;
  readonly commit?: boolean;
}

const CHECKPOINT_PATH = '.reextract-checkpoint.json';

/** Placeholder providers for dry-run: the engine's dry-run path returns before
 *  any extraction, so these must never be reached — throwing keeps that honest. */
function throwingProviders(): { llm: LLM; embedder: Embedder } {
  const boom = (): never => {
    throw new Error('reextract dry-run must never call a provider');
  };
  return {
    llm: { generateResponse: boom, generateChat: boom },
    embedder: { embed: boom, embedBatch: boom },
  };
}

function parsePositiveInt(value: string | undefined, flag: string, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    process.stderr.write(`Error: ${flag} expects a positive integer, got '${value}'.\n`);
    process.exit(2);
  }
  return n;
}

function renderHuman(report: ReextractReport): string {
  const skips = Object.entries(report.skipped)
    .map(([k, v]) => `  ${k}: ${String(v)}`)
    .join('\n');
  return [
    'themory reextract — report',
    `  targets: ${String(report.targets)}`,
    `  processed: ${String(report.processed)}`,
    `  entities superseded: ${String(report.entitiesSuperseded)}`,
    `  entities newly linked: ${String(report.entitiesCreated)}`,
    `  llm calls: ${String(report.llmCalls)} (~${String(report.estTokens)} est. tokens)`,
    `  duration: ${String(Math.round(report.durationMs / 1000))}s`,
    skips.length > 0 ? `  skipped:\n${skips}` : '  skipped: none',
  ].join('\n');
}

export async function runReextractCli(opts: ReextractCliOptions): Promise<number> {
  assertEnvOrExit([PG_URI_ENV_SPEC]);
  // m13-noise-retirement T1.1: `--commit` only means something under
  // `--retire-mechanism` — reject the stray flag loudly (#252 discipline).
  if (opts.commit === true && opts.retireMechanism !== true) {
    process.stderr.write('Error: --commit requires --retire-mechanism.\n');
    process.exit(2);
  }
  if (opts.retireMechanism === true) {
    const retirePool = new Pool({ connectionString: process.env['THEOMEM_PG_URI'] });
    try {
      const { retireMechanism } = await import('./retire.js');
      const report = await retireMechanism({ pool: retirePool }, { commit: opts.commit === true });
      process.stdout.write(
        opts.json === true
          ? `${JSON.stringify(report)}\n`
          : `themory reextract --retire-mechanism — ${report.dryRun ? 'DRY-RUN' : 'COMMIT'}\n` +
            `  candidates: ${String(report.candidates)}\n  retired: ${String(report.retired)}\n` +
            `  links removed: ${String(report.linksRemoved)}\n  edges removed: ${String(report.edgesRemoved)}\n`,
      );
      return 0;
    } finally {
      await retirePool.end();
    }
  }
  const dryRun = opts.dryRun === true;
  if (!dryRun) assertEnvOrExit([OPENAI_API_KEY_ENV_SPEC]);

  if (opts.restart === true) {
    // Explicit operator decision — the corrupted-checkpoint error points here.
    rmSync(CHECKPOINT_PATH, { force: true });
  }

  const pool = new Pool({ connectionString: process.env['THEOMEM_PG_URI'] });
  try {
    const { llm, embedder } = dryRun
      ? throwingProviders()
      : {
          embedder: await buildEmbedder(resolveEmbedderKind()),
          llm: new (await import('@usetheo/memory/llms/openai')).OpenAILLM(),
        };

    const limit = opts.limit !== undefined ? parsePositiveInt(opts.limit, '--limit', 0) : undefined;
    const report = await runReextract(
      {
        pool,
        llm,
        embedder,
        memoryEntityStore: new PgMemoryEntityStore(pool),
        memoryGraphStore: new PgMemoryGraphStore(pool),
        checkpointPath: CHECKPOINT_PATH,
      },
      {
        dryRun,
        resume: opts.resume === true,
        concurrency: parsePositiveInt(opts.concurrency, '--concurrency', 5),
        chunkSize: 25,
        chunkMaxBytes: 512 * 1024,
        ...(limit !== undefined ? { limit } : {}),
      },
    );

    process.stdout.write(
      opts.json === true ? `${JSON.stringify(report)}\n` : `${renderHuman(report)}\n`,
    );
    // Partial LLM failures → exit 1 so operators/scripts see the incomplete run
    // (the checkpoint excludes the failed ids — `--resume` retries them).
    return (report.skipped['target_failed_llm'] ?? 0) > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}
