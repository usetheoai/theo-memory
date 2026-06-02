/**
 * Cost tracker for v0.8 benchmark runner.
 *
 * Implements ADR D7 (tiktoken + pricing-table.json; cost/session not
 * cost/run). The runner invokes `compute({prompt, completion}, model)`
 * per query; the result feeds `cost/session` aggregation downstream.
 *
 * EC-3 absorbed: throws `PricingTableMiss` when the model is absent
 * from the pricing table. Runner catches and flags the per-question
 * record (`pricing_table_miss: true, cost: NaN`) so docs/benchmarks/
 * v0.8.md surfaces it honestly as "cost N/A — see notes".
 *
 * EC-11 absorbed: tokensUsed `{prompt: 0, completion: 0}` returns
 * `0.00` (not NaN), even for models present in the table — multiplication
 * by zero is mathematically defined.
 *
 * EC-13 absorbed: `pricing-table.json` carries `fetched_at`; the tracker
 * emits `console.warn` when the table is more than 30 days stale (NOT
 * a hard error per Inquebrável Rule 3 honest signal).
 *
 * Drift-T4.1-1: the `Tokenizer` interface remains inline in
 * `src/benchmarks/themory/adapter.ts` (T3.1 Drift-T3.1-3 deferred).
 * Cost-tracker is the 2nd consumer; promotion to `src/core/dip/` waits
 * for a 3rd consumer (rule-of-three).
 *
 * @see plan v1.2 § T4.1 + ADR D7 + EC-3 + EC-11 + EC-13
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Tokenizer } from '../themory/adapter.js';

import { PricingTableMiss } from './pricing-table-miss.js';

interface ModelRates {
  readonly input_per_1k: number;
  readonly output_per_1k: number;
}

interface PricingTable {
  readonly fetched_at: string;
  readonly models: Readonly<Record<string, ModelRates>>;
}

export interface TokenUsage {
  readonly prompt: number;
  readonly completion: number;
}

const DEFAULT_PRICING_TABLE_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  'pricing-table.json',
);

const SUNSET_DAYS = 30;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

function loadPricingTable(path: string): PricingTable {
  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as PricingTable;
}

function isStale(fetchedAt: string, now: Date = new Date()): boolean {
  const fetchedDate = new Date(fetchedAt);
  if (Number.isNaN(fetchedDate.getTime())) return false;
  const ageDays = (now.getTime() - fetchedDate.getTime()) / MS_PER_DAY;
  return ageDays > SUNSET_DAYS;
}

export interface CostTrackerConfig {
  readonly tokenizer: Tokenizer;
  readonly pricingTablePath?: string;
  readonly now?: Date;
}

function emitStaleWarning(fetchedAt: string): void {
  // EC-13 honest signal — surfaces stale pricing data via process.stderr,
  // not the project's structured logger (cost-tracker is a leaf module
  // with no logger DI yet; warning is informational, not blocking).
  process.stderr.write(
    `[cost-tracker] pricing-table.json was fetched on ${fetchedAt}; ` +
      `more than ${String(SUNSET_DAYS)} days stale — refresh recommended (EC-13)\n`,
  );
}

export class CostTracker {
  private readonly table: PricingTable;

  constructor(config: CostTrackerConfig) {
    void config.tokenizer; // reserved for future per-call tokenize convenience
    this.table = loadPricingTable(config.pricingTablePath ?? DEFAULT_PRICING_TABLE_PATH);
    if (isStale(this.table.fetched_at, config.now)) {
      emitStaleWarning(this.table.fetched_at);
    }
  }

  compute(tokens: TokenUsage, modelName: string): number {
    if (tokens.prompt === 0 && tokens.completion === 0) {
      return 0;
    }
    const rates = this.table.models[modelName];
    if (rates === undefined) {
      throw new PricingTableMiss(modelName);
    }
    const promptCost = (tokens.prompt / 1000) * rates.input_per_1k;
    const completionCost = (tokens.completion / 1000) * rates.output_per_1k;
    return promptCost + completionCost;
  }

  fetchedAt(): string {
    return this.table.fetched_at;
  }
}
