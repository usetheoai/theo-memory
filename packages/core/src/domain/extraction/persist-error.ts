/**
 * What an event may say about a failed row write (#231): the error's name, SQLSTATE and
 * constraint. Never the message, which can quote row values.
 */
export function persistErrorAttributes(error: unknown): Record<string, string> {
  const { code, constraint } = (error ?? {}) as { code?: unknown; constraint?: unknown };
  return {
    error_name: error instanceof Error ? error.name : 'UnknownError',
    ...(typeof code === 'string' ? { error_code: code } : {}),
    ...(typeof constraint === 'string' ? { constraint } : {}),
  };
}
