/**
 * Judges the language of what a `write-run.ts` output stored, for case sets whose users each speak
 * one language (`judge-cases-language*.json`, #254). Models other than the writer name the language
 * of every current memory and every relation label, ignoring proper names; the majority verdict
 * decides, and a text whose majority language is not the user's counts as written in the wrong
 * language. Texts on which the judges disagree are listed, so a reader can see the noise.
 *
 * Env: LANGUAGE_JUDGE_RUN (write-run output JSON), LANGUAGE_JUDGE_USERS (user id → ISO 639-1),
 * LANGUAGE_JUDGE_MODELS (comma-separated, an odd number; default gpt-4o,gpt-4.1,gpt-4.1-mini),
 * OPENAI_BASE_URL, OPENAI_API_KEY.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const runSchema = z.object({
  memories: z.array(z.object({ user: z.string(), text: z.string(), current: z.boolean() })),
  relations: z.array(z.object({ user: z.string(), relation: z.string() })).default([]),
});
const verdictSchema = z.object({ languages: z.array(z.string()) });

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is required`);
  return value;
}

async function judge(texts: readonly string[], model: string): Promise<string[]> {
  const base = process.env['OPENAI_BASE_URL'] ?? 'https://api.openai.com/v1';
  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const response = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${required('OPENAI_API_KEY')}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'For each numbered text, name the language it is written in as an ISO 639-1 code, ignoring proper names, numbers and the word "user". ' +
            'A text that mixes languages gets the code "mixed". Answer with JSON {"languages": [...]}, one code per text, in order.',
        },
        { role: 'user', content: numbered },
      ],
    }),
  });
  if (!response.ok) throw new Error(`Judge request to ${model} failed: HTTP ${response.status}`);
  const body = (await response.json()) as { choices: { message: { content: string } }[] };
  const languages = verdictSchema.parse(JSON.parse(body.choices[0]?.message.content ?? '{}')).languages;
  if (languages.length !== texts.length) throw new Error(`Judge ${model} returned ${languages.length} codes for ${texts.length} texts`);
  return languages.map((l) => l.toLowerCase());
}

function majority(votes: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const v of votes) counts.set(v, (counts.get(v) ?? 0) + 1);
  const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  return top !== undefined && top[1] * 2 > votes.length ? top[0] : null;
}

const run = runSchema.parse(JSON.parse(readFileSync(required('LANGUAGE_JUDGE_RUN'), 'utf8')));
const languageOf = z.record(z.string()).parse(JSON.parse(readFileSync(required('LANGUAGE_JUDGE_USERS'), 'utf8')));
const models = (process.env['LANGUAGE_JUDGE_MODELS'] ?? 'gpt-4o,gpt-4.1,gpt-4.1-mini').split(',').map((m) => m.trim()).filter(Boolean);
if (models.length % 2 === 0) throw new Error(`LANGUAGE_JUDGE_MODELS needs an odd number of models, got ${models.length}`);

interface Verdict { user: string; expected: string; votes: string[]; text: string }
async function judgeAll(kind: 'memory' | 'relation') {
  const wrong: Verdict[] = [];
  const disagreements: Verdict[] = [];
  let judged = 0;
  for (const [user, expected] of Object.entries(languageOf)) {
    const texts = kind === 'memory'
      ? run.memories.filter((m) => m.user === user && m.current).map((m) => m.text)
      : [...new Set(run.relations.filter((r) => r.user === user).map((r) => r.relation))];
    if (texts.length === 0) continue;
    const byModel = await Promise.all(models.map((m) => judge(texts, m)));
    judged += texts.length;
    texts.forEach((text, i) => {
      const votes = byModel.map((v) => v[i]!);
      const verdict = majority(votes);
      if (new Set(votes).size > 1) disagreements.push({ user, expected, votes, text });
      if (verdict !== expected) wrong.push({ user, expected, votes, text });
    });
  }
  return { judged, wrongLanguage: wrong.length, wrong, disagreements };
}

console.log(JSON.stringify({ models, memories: await judgeAll('memory'), relations: await judgeAll('relation') }, null, 2));
