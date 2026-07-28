/**
 * Adaptador HTTP da porta `MemoryClient` (M0 / T1.3).
 *
 * Usa `fetch` nativo — `engines.node >= 20` já o garante, e o degrau 2 da
 * `rules/parsimony-ladder.md` manda preferir a biblioteca padrão a uma
 * dependência. Adicionar um cliente HTTP aqui contrariaria o próprio objetivo do
 * milestone, que é reduzir o custo de instalação.
 *
 * Todo erro de transporte é traduzido para a taxonomia tipada de `errors.ts`.
 * Deixar um `TypeError: fetch failed` vazar até o terminal seria devolver ao
 * operador exatamente a mensagem que não diz o que fazer.
 *
 * NÃO IMPORTA driver de banco, ORM nem framework de servidor. Há teste que lê
 * este arquivo e falha se algum aparecer.
 */
import {
  ClientAuthError,
  ClientProtocolError,
  ClientTimeoutError,
  ClientUnavailableError,
} from './errors.js';
import {
  scopeToBody,
  type ForgetOptions,
  type MemoryClient,
  type MemoryItem,
  type RecallOptions,
  type ReflectResult,
  type RememberOptions,
  type Scope,
} from './memory-client.js';

export interface HttpMemoryClientOptions {
  readonly baseUrl: string;
  readonly token?: string;
  readonly timeoutMs?: number;
  /** Injetável para teste; o padrão é o `fetch` global. */
  readonly fetchImpl?: typeof fetch;
  /** Prefixo do gateway, quando houver (ex.: `/v1/memory`). */
  readonly pathPrefix?: string;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export class HttpMemoryClient implements MemoryClient {
  readonly #baseUrl: string;
  readonly #token: string | undefined;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #prefix: string;

  constructor(opts: HttpMemoryClientOptions) {
    this.#baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.#token = opts.token;
    this.#timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#fetch = opts.fetchImpl ?? globalThis.fetch;
    this.#prefix = (opts.pathPrefix ?? '').replace(/\/+$/, '');
  }

  async remember(
    scope: Scope,
    text: string,
    opts?: RememberOptions,
  ): Promise<readonly MemoryItem[]> {
    const body = await this.#post('/v1/remember', {
      ...scopeToBody(scope),
      text,
      ...(opts?.infer === undefined ? {} : { infer: opts.infer }),
    });
    return this.#readItems(body, '/v1/remember');
  }

  async recall(scope: Scope, query: string, opts?: RecallOptions): Promise<readonly MemoryItem[]> {
    const body = await this.#post('/v1/recall', {
      ...scopeToBody(scope),
      query,
      ...(opts?.topK === undefined ? {} : { topK: opts.topK }),
      ...(opts?.threshold === undefined ? {} : { threshold: opts.threshold }),
      ...(opts?.category === undefined ? {} : { category: opts.category }),
    });
    return this.#readItems(body, '/v1/recall');
  }

  async forget(scope: Scope, id: string, opts?: ForgetOptions): Promise<void> {
    await this.#post('/v1/forget', {
      ...scopeToBody(scope),
      id,
      ...(opts?.hard === undefined ? {} : { hard: opts.hard }),
    });
  }

  async reflect(scope: Scope): Promise<ReflectResult> {
    const body = await this.#post('/v1/reflect', scopeToBody(scope));
    const derived = (body as { derived?: unknown }).derived;
    return { derived: typeof derived === 'number' ? derived : 0 };
  }

  #url(path: string): string {
    return `${this.#baseUrl}${this.#prefix}${path}`;
  }

  async #post(path: string, payload: Record<string, unknown>): Promise<unknown> {
    const url = this.#url(path);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, this.#timeoutMs);

    let response: Response;
    try {
      response = await this.#fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(this.#token === undefined ? {} : { authorization: `Bearer ${this.#token}` }),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      // Um abort e uma recusa de conexão exigem ações opostas do operador:
      // aumentar o timeout, ou descobrir por que o servidor não está no ar.
      if (isAbort(err)) {
        throw new ClientTimeoutError({ url, timeoutMs: this.#timeoutMs });
      }
      throw new ClientUnavailableError({ url, cause: causeOf(err) });
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 401 || response.status === 403) {
      throw new ClientAuthError({
        status: response.status,
        hadCredential: this.#token !== undefined,
      });
    }
    if (response.status >= 500) {
      throw new ClientUnavailableError({ url, cause: `HTTP ${String(response.status)}` });
    }
    if (!response.ok) {
      throw new ClientProtocolError({ url, missingField: `HTTP ${String(response.status)}` });
    }

    try {
      return await response.json();
    } catch {
      throw new ClientProtocolError({ url, missingField: 'corpo JSON válido' });
    }
  }

  #readItems(body: unknown, path: string): readonly MemoryItem[] {
    const items = (body as { items?: unknown }).items;
    if (!Array.isArray(items)) {
      throw new ClientProtocolError({ url: this.#url(path), missingField: 'items' });
    }
    return items as readonly MemoryItem[];
  }
}

function isAbort(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { name?: string }).name === 'AbortError';
}

function causeOf(err: unknown): string {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'erro desconhecido de transporte';
}
