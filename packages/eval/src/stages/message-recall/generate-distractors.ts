/**
 * One-off generator of distractor messages for the large-scope message-recall run. Writes
 * `distractors.json`, which is committed before the run so the data is fixed before any
 * measurement. Topics are everyday subjects outside the topics of the case files, and every
 * generated message that matches the answer pattern of any question is dropped, so a distractor
 * never holds an answer.
 *
 * Required env: OPENAI_API_KEY. Optional: OPENAI_BASE_URL (default the OpenAI API).
 */
import { readFileSync, writeFileSync } from 'node:fs';

import { z } from 'zod';

import { caseFileSchema, matchesPattern } from './scoring.js';

export const DISTRACTOR_COUNT = 300;
/** One fifth in Portuguese, fixed before generation. */
const PORTUGUESE_COUNT = 60;
const MODEL = 'gpt-4o-mini';
const LINES_PER_TOPIC = 16;

const TOPICS_EN = [
  'cooking a weeknight dinner', 'a TV series being watched', 'last weekend football results', 'brewing coffee at home',
  'a board game night', 'weekly grocery shopping', 'learning photography', 'a favourite podcast', 'a video game being played',
  'redecorating the living room', 'a monthly budget', 'watching the night sky', 'a chess club', 'baking sourdough bread',
  'learning Italian',
];
const TOPICS_PT = ['uma visita a um museu', 'o trajeto de ônibus para o trabalho', 'separar o lixo para reciclagem', 'uma receita de bolo de cenoura', 'um campeonato de vôlei de praia'];

const lineSchema = z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) });
const replySchema = z.object({ messages: z.array(lineSchema) });

async function generate(topic: string, portuguese: boolean): Promise<z.infer<typeof lineSchema>[]> {
  const apiKey = process.env['OPENAI_API_KEY'];
  if (apiKey === undefined || apiKey === '') throw new Error('OPENAI_API_KEY is required');
  const baseUrl = process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1';
  const language = portuguese ? 'Brazilian Portuguese' : 'English';
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [{
        role: 'user',
        content: `Write a casual chat between a user and an assistant about ${topic}, in ${language}. ` +
          `Return JSON {"messages":[{"role":"user"|"assistant","content":"..."}]} with exactly ${String(LINES_PER_TOPIC)} messages, ` +
          'alternating roles and starting with the user. Each message is one or two sentences with concrete details (names, numbers, places).',
      }],
    }),
  });
  if (!res.ok) throw new Error(`Distractor generation failed for '${topic}': HTTP ${String(res.status)}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = body.choices?.[0]?.message?.content;
  if (content === undefined) throw new Error(`Distractor generation for '${topic}' returned no content`);
  return replySchema.parse(JSON.parse(content)).messages;
}

const patterns = ['cases.json', 'cases-paraphrase.json'].flatMap((file) =>
  caseFileSchema.parse(JSON.parse(readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')))
    .users.flatMap((u) => u.questions.map((q) => q.pattern)));

const noAnswer = (m: z.infer<typeof lineSchema>) => !patterns.some((p) => matchesPattern(p, m.content));
const english = (await Promise.all(TOPICS_EN.map((t) => generate(t, false)))).flat();
const portuguese = (await Promise.all(TOPICS_PT.map((t) => generate(t, true)))).flat();
const keptEnglish = english.filter(noAnswer);
const keptPortuguese = portuguese.filter(noAnswer);
// The model may return more lines than asked per topic, so each language is cut to its share.
if (keptEnglish.length < DISTRACTOR_COUNT - PORTUGUESE_COUNT || keptPortuguese.length < PORTUGUESE_COUNT) {
  throw new Error(`Too few distractors survived the answer filter: ${String(keptEnglish.length)} English, ${String(keptPortuguese.length)} Portuguese`);
}
const generatedCount = english.length + portuguese.length;
const out = {
  model: MODEL,
  generated: generatedCount,
  droppedAsAnswers: generatedCount - keptEnglish.length - keptPortuguese.length,
  portuguese: PORTUGUESE_COUNT,
  messages: [...keptEnglish.slice(0, DISTRACTOR_COUNT - PORTUGUESE_COUNT), ...keptPortuguese.slice(0, PORTUGUESE_COUNT)],
};
writeFileSync(new URL('./distractors.json', import.meta.url), `${JSON.stringify(out, null, 2)}\n`);
console.log(`[distractors] generated ${String(generatedCount)}, dropped ${String(out.droppedAsAnswers)}, kept ${String(out.messages.length)}`);
