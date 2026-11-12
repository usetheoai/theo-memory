/**
 * e2e-qa — result aggregation + reporting (split from run.ts for SRP + file
 * budget). Computes overall / per-question_type / abstention accuracy and emits
 * a human-readable table plus a machine-readable JSON block.
 */

export interface ExampleResult {
  readonly questionId: string;
  readonly questionType: string;
  readonly abstention: boolean;
  readonly question: string;
  readonly goldAnswer: string;
  readonly modelAnswer: string;
  readonly correct: boolean;
  readonly ingestedTurns: number;
  /** Full source turn count; integrity gate rejects any silently truncated example. */
  readonly availableTurns?: number;
  readonly ingestedMemories: number;
  readonly recalledCount: number;
  readonly recallEvidence: readonly { readonly id: string; readonly text: string; readonly score: number }[];
  readonly ingestErrors: number;
  readonly ingestErrorTypes: readonly string[];
  readonly reflectionError?: string;
  /** Set when the recall/answer/judge phase threw — the example scores as a miss
   *  (never silently dropped) so one bad example can't abort a 500-question run. */
  readonly error?: string;
}

/**
 * An ingest failure for the JSONL: the error's name, then each cause's name, SQLSTATE and
 * constraint. Messages stay out because they can quote dataset text.
 */
export function describeIngestError(error: unknown): string {
  const parts: string[] = [];
  for (let current = error, depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
    const { code, constraint, cause } = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    parts.push([
      current instanceof Error ? current.name : 'UnknownError',
      typeof code === 'string' ? `code=${code}` : '',
      typeof constraint === 'string' ? `constraint=${constraint}` : '',
    ].filter((part) => part !== '').join(' '));
    current = cause;
  }
  return parts.join(' <- ');
}

export function assessRunIntegrity(results: readonly ExampleResult[]): {
  readonly valid: boolean;
  readonly invalidExamples: number;
} {
  const invalidExamples = results.filter(
    (r) => r.ingestErrors > 0
      || r.reflectionError !== undefined
      || r.error !== undefined
      || (r.availableTurns !== undefined && r.ingestedTurns !== r.availableTurns),
  ).length;
  return { valid: invalidExamples === 0, invalidExamples };
}

/** Build a scored-miss result for an example whose pipeline threw (carries `error`). */
export function failedResult(
  ex: {
    question_id: string;
    question_type: string;
    question: string;
    answer: string;
    haystack_sessions?: readonly (readonly unknown[])[];
  },
  message: string,
): ExampleResult {
  return {
    questionId: ex.question_id,
    questionType: ex.question_type,
    abstention: ex.question_id.endsWith('_abs'),
    question: ex.question,
    goldAnswer: ex.answer,
    modelAnswer: '',
    correct: false,
    ingestedTurns: 0,
    ...(ex.haystack_sessions === undefined
      ? {}
      : { availableTurns: ex.haystack_sessions.reduce((sum, session) => sum + session.length, 0) }),
    ingestedMemories: 0,
    recalledCount: 0,
    recallEvidence: [],
    ingestErrors: 0,
    ingestErrorTypes: [],
    error: message,
  };
}

export function report(results: ExampleResult[]): void {
  const n = results.length;
  const correct = results.filter((r) => r.correct).length;
  const overall = n === 0 ? 0 : correct / n;

  const byType = new Map<string, { n: number; ok: number }>();
  for (const r of results) {
    const b = byType.get(r.questionType) ?? { n: 0, ok: 0 };
    b.n += 1;
    if (r.correct) b.ok += 1;
    byType.set(r.questionType, b);
  }

  const absResults = results.filter((r) => r.abstention);
  const absOk = absResults.filter((r) => r.correct).length;
  const integrity = assessRunIntegrity(results);

  console.log('\n================ e2e-qa RESULTS ================');
  console.log(
    `Run integrity: ${integrity.valid ? 'VALID' : 'INVALID'} (${String(integrity.invalidExamples)} examples with stage errors)`,
  );
  console.log(
    `Overall accuracy: ${(overall * 100).toFixed(1)}% (${String(correct)}/${String(n)})`,
  );
  console.log('\nPer question_type:');
  for (const [type, b] of [...byType.entries()].sort()) {
    console.log(
      `  ${type.padEnd(28)} ${((b.ok / b.n) * 100).toFixed(1)}% (${String(b.ok)}/${String(b.n)})`,
    );
  }
  console.log(
    `\nAbstention subset: ${
      absResults.length === 0
        ? 'n/a'
        : ((absOk / absResults.length) * 100).toFixed(1) + '%'
    } (${String(absOk)}/${String(absResults.length)})`,
  );

  console.log('\n---- Per-example ----');
  for (const r of results) {
    console.log(
    `  [${r.correct ? 'YES' : ' no'}] ${r.questionId.padEnd(22)} ` +
        `${r.questionType.padEnd(28)} turns=${String(r.ingestedTurns)}` +
        (r.availableTurns === undefined ? '' : `/${String(r.availableTurns)}`) +
        ` recalled=${String(
          r.recalledCount,
        )} memories=${String(r.ingestedMemories)}` +
        (r.reflectionError === undefined ? '' : ' reflect=ERROR'),
    );
  }

  const json = {
    integrityValid: integrity.valid,
    invalidExamples: integrity.invalidExamples,
    overallAccuracy: overall,
    n,
    correct,
    perType: Object.fromEntries(
      [...byType.entries()].map(([t, b]) => [
        t,
        { n: b.n, ok: b.ok, acc: b.ok / b.n },
      ]),
    ),
    abstention: {
      n: absResults.length,
      ok: absOk,
      acc: absResults.length === 0 ? null : absOk / absResults.length,
    },
    examples: results,
  };
  console.log('\n---- JSON ----');
  console.log(JSON.stringify(json, null, 2));
}
