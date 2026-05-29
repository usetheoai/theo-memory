/**
 * OpenAI implementations of theo-memory's Embedder + LLM DIPs.
 *
 * One OPENAI_API_KEY powers both the SDK Agent (chat) and theo-memory
 * (extraction + embeddings) — single secret, two layers.
 */
import OpenAI from "openai";
import type {
  Embedder,
  LLM,
  LLMResponse,
  Message,
} from "@usetheo/memory/contract";

// Lazy singleton — instantiated on first call so build-time page-data
// collection (which runs without runtime env) does not throw.
let _openai: OpenAI | null = null;
function client(): OpenAI {
  if (_openai === null) {
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const EMBED_MODEL = "text-embedding-3-small"; // 1536 dims, fits theo-memory v0.1 cap
const CHAT_MODEL = "gpt-4o-mini";

export class OpenAIEmbedder implements Embedder {
  async embed(text: string): Promise<readonly number[]> {
    const resp = await client().embeddings.create({
      model: EMBED_MODEL,
      input: text,
    });
    return resp.data[0]!.embedding;
  }

  async embedBatch(
    texts: readonly string[],
  ): Promise<readonly (readonly number[])[]> {
    if (texts.length === 0) return [];
    const resp = await client().embeddings.create({
      model: EMBED_MODEL,
      input: texts as string[],
    });
    return resp.data.map((d) => d.embedding);
  }
}

function toOpenAIMessages(
  messages: readonly Message[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content,
  })) as OpenAI.Chat.ChatCompletionMessageParam[];
}

export class OpenAILLM implements LLM {
  async generateResponse(
    messages: readonly Message[],
    responseFormat?: { readonly type: "json" | "text" },
  ): Promise<unknown> {
    const resp = await client().chat.completions.create({
      model: CHAT_MODEL,
      messages: toOpenAIMessages(messages),
      response_format:
        responseFormat?.type === "json"
          ? { type: "json_object" }
          : { type: "text" },
    });
    const content = resp.choices[0]?.message.content ?? "";
    if (responseFormat?.type === "json") {
      try {
        return JSON.parse(content);
      } catch {
        return { error: "non_json_response", raw: content };
      }
    }
    return { text: content };
  }

  async generateChat(messages: readonly Message[]): Promise<LLMResponse> {
    const resp = await client().chat.completions.create({
      model: CHAT_MODEL,
      messages: toOpenAIMessages(messages),
    });
    return {
      content: resp.choices[0]?.message.content ?? "",
      role: "assistant",
    };
  }
}
