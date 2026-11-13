/**
 * #241: the extraction calls must be reproducible, so OpenAILLM sends temperature 0 unless the
 * caller asks for another value. The `openai` module is mocked: no request leaves the process.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
vi.mock('openai', () => ({
  default: class {
    chat = { completions: { create } };
  },
}));

const { OpenAILLM } = await import('./openai.js');
const reply = { choices: [{ message: { content: '{"facts": []}' } }] };

describe('OpenAILLM sampling', () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue(reply);
  });

  it('sends temperature 0 on generateResponse by default', async () => {
    await new OpenAILLM().generateResponse([{ role: 'user', content: 'x' }], { type: 'json' });
    expect(create.mock.calls[0]?.[0]).toMatchObject({ temperature: 0 });
  });

  it('sends temperature 0 on generateChat by default', async () => {
    await new OpenAILLM().generateChat([{ role: 'user', content: 'x' }]);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ temperature: 0 });
  });

  it('sends the temperature given to the constructor', async () => {
    await new OpenAILLM({ temperature: 0.7 }).generateResponse([{ role: 'user', content: 'x' }]);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ temperature: 0.7 });
  });

  it('rejects a temperature outside [0, 2] at construction', () => {
    expect(() => new OpenAILLM({ temperature: 3 })).toThrow(/temperature/);
    expect(() => new OpenAILLM({ temperature: -1 })).toThrow(/temperature/);
  });
});
