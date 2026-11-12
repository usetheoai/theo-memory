/**
 * e2e-qa — LongMemEval answer-generation + judge prompts.
 *
 * The published LongMemEval answer template and category-specific judge templates.
 * The answerer builds an answer from the recalled TheMemory memories; the judge
 * scores it against the gold answer with a binary yes/no verdict.
 *
 * Both are called at temperature=0 (deterministic). The judge verdict is the
 * LAST 'yes'/'no' token after the closing </judge_thinking> tag.
 */

/** Official LongMemEval answer template (CoT variant), for protocol-controlled evals. */
export function buildLongMemEvalAnswerPrompt(params: {
  readonly question: string;
  readonly questionDate: string;
  readonly memories: string;
}): string {
  return [
    'I will give you several history chats between you and a user. Please answer the question based on the relevant chat history. Answer the question step by step: first extract all the relevant information, and then reason over the information to get the answer.',
    '',
    'History Chats:',
    params.memories,
    '',
    `Current Date: ${params.questionDate}`,
    `Question: ${params.question}`,
    'Answer (step by step):',
  ].join('\n');
}

/** Official LongMemEval category-specific binary judge templates. */
export function buildLongMemEvalJudgePrompt(params: {
  readonly questionType: string;
  readonly question: string;
  readonly answer: string;
  readonly response: string;
  readonly abstention: boolean;
}): string {
  if (params.abstention) {
    return [
      'I will give you an unanswerable question, an explanation, and a response from a model. Please answer yes if the model correctly identifies the question as unanswerable. The model could say that the information is incomplete, or some other information is given but the asked information is not.',
      '',
      `Question: ${params.question}`,
      `Explanation: ${params.answer}`,
      `Model Response: ${params.response}`,
      'Does the model correctly identify the question as unanswerable? Answer yes or no only.',
    ].join('\n');
  }
  const shared = 'I will give you a question, a correct answer, and a response from a model. Please answer yes if the response contains the correct answer. Otherwise, answer no. If the response is equivalent to the correct answer or contains all the intermediate steps to get the correct answer, you should also answer yes. If the response only contains a subset of the information required by the answer, answer no.';
  const categoryRule = params.questionType === 'temporal-reasoning'
    ? ' In addition, do not penalize off-by-one errors for the number of days. If the question asks for the number of days/weeks/months, etc., and the model makes off-by-one errors (e.g., predicting 19 days when the answer is 18), the model\'s response is still correct.'
    : params.questionType === 'knowledge-update'
      ? ' If the response contains some previous information along with an updated answer, the response should be considered correct as long as the updated answer is the required answer.'
      : params.questionType === 'single-session-preference'
        ? ' The response is correct as long as it recalls and utilizes the user\'s personal information correctly; it does not need to reflect all points in the rubric.'
        : '';
  const answerLabel = params.questionType === 'single-session-preference' ? 'Rubric' : 'Correct Answer';
  return [
    shared + categoryRule,
    '',
    `Question: ${params.question}`,
    `${answerLabel}: ${params.answer}`,
    `Model Response: ${params.response}`,
    'Is the model response correct? Answer yes or no only.',
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
