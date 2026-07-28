/**
 * e2e-qa — LongMemEval answer-generation + judge prompts.
 *
 * Faithful replication of the published LongMemEval
 * end-to-end QA prompts. The answerer builds
 * an answer from the recalled TheMemory memories; the judge scores it against
 * the gold answer with an ABSOLUTE binary yes/no verdict.
 *
 * Both are called at temperature=0 (deterministic). The judge verdict is the
 * LAST 'yes'/'no' token after the closing </judge_thinking> tag.
 */

/** Answer-generation prompt — LongMemEval methodology, memories newest-first. */
export function buildAnswerPrompt(params: {
  readonly question: string;
  readonly questionDate: string;
  readonly memories: string;
}): string {
  return [
    'You are a personal assistant with access to memories from past conversations',
    'with a user. Answer the question using information from the memories below. Be',
    'direct and concise.',
    '',
    `IMPORTANT: Today's date is ${params.questionDate}. All relative time`,
    'expressions MUST be computed relative to this date.',
    '',
    'Rules:',
    '- Answer only when a memory DIRECTLY and SPECIFICALLY supports it.',
    '- Most-recent value wins for conflicts.',
    `- Compute time windows from ${params.questionDate}.`,
    "- CRITICAL (#140): if the memories are absent OR only related-but-insufficient,",
    "  DO NOT guess or infer — say you don't have that information (abstention).",
    '  Related-but-insufficient memories are NOT grounds to fabricate an answer.',
    '',
    `Memories (newest-first):\n${params.memories}`,
    '',
    `Today's Date: ${params.questionDate}.`,
    `Question: ${params.question}.`,
    '',
    'Provide full thinking in <mem_thinking> tags BEFORE the answer.',
  ].join('\n');
}

/** Judge prompt — the standard binary rubric with the anti-'no' bias check. */
export function buildJudgePrompt(params: {
  readonly question: string;
  readonly answer: string;
  readonly response: string;
}): string {
  return [
    'I will give you a question, a correct answer (or rubric), and a model',
    'response. Decide whether the model response is correct.',
    '',
    'CORE PRINCIPLE — semantic equivalence: judge by MEANING, not exact words.',
    '',
    "IMPORTANT BIAS CHECK: you tend to say 'no' too quickly; before concluding",
    "'no' verify the answer is truly wrong, not just differently worded; when in",
    "doubt lean 'yes'.",
    '',
    'Rules:',
    '- Extra details acceptable unless factually wrong.',
    '- Match lists by semantic meaning.',
    '- Hedging acceptable if the core number matches; off-by-one on days/weeks ok.',
    '- Date format variations are equivalent.',
    "- '0'/'nothing found' matches 'not enough information' and vice-versa.",
    "- Abstention: any phrasing conveying 'don't have this information' is correct",
    '  when the gold answer is an abstention.',
    '',
    `Question: ${params.question}.`,
    `Correct Answer: ${params.answer}.`,
    `Model Response: ${params.response}.`,
    '',
    'Think in <judge_thinking> tags, then give the final verdict as exactly',
    "'yes' or 'no' on a new line after the closing tag.",
  ].join('\n');
}

/**
 * Parse the judge verdict: the LAST 'yes'/'no' token in the response.
 * Returns `true` when the final verdict is 'yes'. Defaults to `false` (an
 * unparseable judge output is a conservative "incorrect", never a silent pass).
 */
export function parseJudgeVerdict(judgeOutput: string): boolean {
  const matches = judgeOutput.toLowerCase().match(/\b(yes|no)\b/g);
  if (matches === null || matches.length === 0) return false;
  return matches[matches.length - 1] === 'yes';
}
