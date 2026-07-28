/**
 * A porta (M0 / T1.2).
 *
 * `rules/architecture.md` § 2: o domínio declara a interface, o adaptador a
 * satisfaz. Aqui o "domínio" é o conjunto de verbos do CLI — eles passam a
 * depender só desta interface, e param de saber se há um banco do outro lado ou
 * um servidor a um oceano de distância.
 *
 * A assinatura foi DERIVADA do uso real, não inventada: `run-remember.ts` e
 * `run-recall.ts` chamam `scoped.remember(text, opts)` e `scoped.recall(query,
 * opts)` depois de resolver o escopo. A porta torna o escopo explícito no
 * parâmetro em vez de escondê-lo num objeto pré-vinculado, porque o adaptador
 * HTTP precisa enviá-lo no corpo de cada requisição.
 *
 * Este arquivo não importa NADA. É a fronteira que M0 existe para criar.
 */

/** As três camadas de escopo do produto, na forma que o contrato REST aceita. */
export type Scope =
  | { readonly kind: 'user'; readonly id: string }
  | { readonly kind: 'session'; readonly id: string }
  | { readonly kind: 'agent'; readonly id: string };

export interface MemoryItem {
  readonly id: string;
  readonly text: string;
  readonly score?: number;
}

export interface RememberOptions {
  /** `false` grava verbatim, sem passar pela extração por LLM. */
  readonly infer?: boolean;
}

export interface RecallOptions {
  readonly topK?: number;
  readonly threshold?: number;
  readonly category?: string;
}

export interface ForgetOptions {
  /** `true` apaga de verdade; o padrão é soft-delete. */
  readonly hard?: boolean;
}

export interface ReflectResult {
  readonly derived: number;
}

/**
 * A porta. Dois adaptadores a implementam: um HTTP (que vai no pacote fino) e um
 * in-process (que fica na superfície de operador). Os verbos não sabem qual
 * receberam — é isso que evita duplicá-los.
 */
export interface MemoryClient {
  remember(scope: Scope, text: string, opts?: RememberOptions): Promise<readonly MemoryItem[]>;
  recall(scope: Scope, query: string, opts?: RecallOptions): Promise<readonly MemoryItem[]>;
  forget(scope: Scope, id: string, opts?: ForgetOptions): Promise<void>;
  reflect(scope: Scope): Promise<ReflectResult>;
}

/** Mapeia o escopo para o campo que o contrato REST espera no corpo. */
export function scopeToBody(scope: Scope): Record<string, string> {
  switch (scope.kind) {
    case 'user':
      return { userId: scope.id };
    case 'session':
      return { sessionId: scope.id };
    case 'agent':
      return { agentId: scope.id };
  }
}
