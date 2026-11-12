/**
 * Judges the language of the memories a `write-run.ts` output stored, for case sets whose users
 * each speak one language (`judge-cases-language.json`, #254). A different model than the writer
 * names the language of every current memory, ignoring proper names; a memory whose language is
 * not the user's counts as written in the wrong language.
 *
 * Env: LANGUAGE_JUDGE_RUN (write-run output JSON), LANGUAGE_JUDGE_USERS (user id → ISO 639-1),
 * LANGUAGE_JUDGE_MODEL (default gpt-4o), OPENAI_BASE_URL, OPENAI_API_KEY.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

const runSchema = z.object({ memories: z.array(z.object({ user: z.string(), text: z.string(), current: z.boolean() })) });
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
  if (!response.ok) throw new Error(`Judge request failed: HTTP ${response.status}`);
  const body = (await response.json()) as { choices: { message: { content: string } }[] };
  const languages = verdictSchema.parse(JSON.parse(body.choices[0]?.message.content ?? '{}')).languages;
  if (languages.length !== texts.length) throw new Error(`Judge returned ${languages.length} codes for ${texts.length} texts`);
  return languages.map((l) => l.toLowerCase());
}

const run = runSchema.parse(JSON.parse(readFileSync(required('LANGUAGE_JUDGE_RUN'), 'utf8')));
const languageOf = z.record(z.string()).parse(JSON.parse(readFileSync(required('LANGUAGE_JUDGE_USERS'), 'utf8')));
const model = process.env['LANGUAGE_JUDGE_MODEL'] ?? 'gpt-4o';
const wrong: { user: string; expected: string; judged: string; text: string }[] = [];
let judged = 0;
for (const [user, expected] of Object.entries(languageOf)) {
  const texts = run.memories.filter((m) => m.user === user && m.current).map((m) => m.text);
  if (texts.length === 0) continue;
  const languages = await judge(texts, model);
  judged += texts.length;
  languages.forEach((judgedLanguage, i) => {
    if (judgedLanguage !== expected) wrong.push({ user, expected, judged: judgedLanguage, text: texts[i]! });
  });
}
console.log(JSON.stringify({ model, judged, wrongLanguage: wrong.length, wrong }, null, 2));
