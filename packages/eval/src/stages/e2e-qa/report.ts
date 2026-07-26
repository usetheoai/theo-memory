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
  readonly recalledCount: number;
  readonly ingestErrors: number;
  /** Set when the recall/answer/judge phase threw — the example scores as a miss
   *  (never silently dropped) so one bad example can't abort a 500-question run. */
  readonly error?: string;
}

/** Build a scored-miss result for an example whose pipeline threw (carries `error`). */
export function failedResult(
  ex: { question_id: string; question_type: string; question: string; answer: string },
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
    recalledCount: 0,
    ingestErrors: 0,
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

  console.log('\n================ e2e-qa RESULTS ================');
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
        `${r.questionType.padEnd(28)} turns=${String(r.ingestedTurns)} recalled=${String(
          r.recalledCount,
        )}`,
    );
  }

  const json = {
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
