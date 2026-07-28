/**
 * Taxonomia de erro do CLI consumidor (M0 / T1.1).
 *
 * Falar HTTP em vez de falar com o banco cria classes de falha que o CLI nunca
 * teve: servidor fora do ar, credencial rejeitada, timeout, resposta fora do
 * contrato. `rules/error-handling.md` exige erro tipado com contexto — não uma
 * string genérica que obrigue o operador a adivinhar.
 *
 * Cada classe carrega um código de saída próprio. Um script que chama o CLI
 * consegue distinguir "servidor caiu" de "minha credencial expirou" sem parsear
 * mensagem, que é o que torna a automação possível.
 *
 * O formato foi inspirado no classificador já existente no workspace — a ideia de
 * classificar por CAUSA e não por texto. O código não é herdado: este pacote não
 * depende de nenhum pacote privado, e essa é a razão de M0 existir.
 */

/** Código de saída genérico, para qualquer erro que não seja do cliente. */
export const EXIT_GENERIC = 1;

/**
 * Códigos 2..6 pertencem ao cliente. São distintos entre si por contrato — há
 * teste que falha se dois colidirem, porque um código repetido destrói a
 * capacidade de um script reagir de forma diferente a causas diferentes.
 */
export const EXIT_CONFIG = 2;
export const EXIT_AUTH = 3;
export const EXIT_UNAVAILABLE = 4;
export const EXIT_TIMEOUT = 5;
export const EXIT_PROTOCOL = 6;

/** Raiz da hierarquia. Serve ao `isClientError` sem recorrer a `instanceof` em cadeia. */
export abstract class ClientError extends Error {
  abstract readonly exitCode: number;

  protected constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/** Faltou configuração para sequer tentar a chamada. */
export class ClientConfigError extends ClientError {
  readonly exitCode = EXIT_CONFIG;

  constructor(
    readonly field: string,
    hint: string,
  ) {
    super(`configuração ausente (${field}): ${hint}`);
  }
}

/**
 * 401/403. O mesmo status tem duas causas que exigem ações opostas: mandar o
 * operador renovar uma credencial que ele nunca configurou o faz procurar no
 * lugar errado.
 */
export class ClientAuthError extends ClientError {
  readonly exitCode = EXIT_AUTH;

  constructor(readonly detail: { status: number; hadCredential: boolean }) {
    super(
      detail.hadCredential
        ? `credencial rejeitada pelo servidor (HTTP ${String(detail.status)}) — verifique se ela é válida para este ambiente`
        : `requisição sem credencial e o servidor exigiu autenticação (HTTP ${String(detail.status)})`,
    );
  }
}

/** O servidor não respondeu, ou respondeu 5xx. A URL entra na mensagem: quase sempre o erro é ela. */
export class ClientUnavailableError extends ClientError {
  readonly exitCode = EXIT_UNAVAILABLE;

  constructor(readonly detail: { url: string; cause: string }) {
    super(`servidor indisponível em ${detail.url} (${detail.cause})`);
  }
}

/** Estourou o tempo. O valor aplicado entra na mensagem para o operador saber o que ajustar. */
export class ClientTimeoutError extends ClientError {
  readonly exitCode = EXIT_TIMEOUT;

  constructor(readonly detail: { url: string; timeoutMs: number }) {
    super(`tempo esgotado após ${String(detail.timeoutMs)}ms ao chamar ${detail.url}`);
  }
}

/** 2xx com corpo que não cumpre o contrato. Nomear o campo poupa uma sessão de depuração. */
export class ClientProtocolError extends ClientError {
  readonly exitCode = EXIT_PROTOCOL;

  constructor(readonly detail: { url: string; missingField: string }) {
    super(
      `resposta de ${detail.url} não cumpre o contrato: campo '${detail.missingField}' ausente ou com tipo inesperado`,
    );
  }
}

export function isClientError(err: unknown): err is ClientError {
  return err instanceof ClientError;
}

/** Traduz qualquer erro em código de saída. Desconhecido cai no genérico, nunca em 0. */
export function exitCodeFor(err: unknown): number {
  return isClientError(err) ? err.exitCode : EXIT_GENERIC;
}
