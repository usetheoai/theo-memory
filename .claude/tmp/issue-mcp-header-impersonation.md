## Impacto

Com o servidor MCP exposto **diretamente** (`themory mcp --transport streamable-http --auth api-keys`, sem o gateway na frente), o portador de uma API key pode **operar como qualquer outro usuário do mesmo workspace** enviando o header `X-Theo-User-Id`. O `workspace_id` vem do Principal (auth-trusted, correto), mas o **tier de usuário vem de um header controlado pelo cliente, sem cross-validação contra o `user_id` do Principal**.

Isso contradiz a invariante do M14/ADR-M14-1 ("a identidade vem SEMPRE do Principal no servidor, JAMAIS de entrada controlada pelo cliente") no ponto onde o scope é populado — as tools em si estão corretas (leem de `getScope()`); o problema é o transport que popula esse scope.

**Severidade: HIGH** — escalação de privilégio cross-user dentro do workspace (leitura, escrita e delete no escopo de outro usuário). Mitigado na topologia com gateway (o gateway injeta o header auth-trusted e sobrescreve o do cliente), NÃO mitigado na exposição direta que o próprio CLI oferece.

## Build under test

- `v0.43.0` (merge `68b2247`), build local do mesmo código.
- Servidor: `node dist/agent-tools/cli.js mcp --transport streamable-http --port 8899 --host 127.0.0.1 --auth api-keys`
- DB: `ankane/pgvector:v0.5.1` local.

## Repro (confirmado 1x, determinístico)

1. Criar workspace `ws-live-m14` com dois usuários (`live-alice`, `live-bob`) e uma API key `theo_live_*` para CADA um, com `theo_api_keys.workspace_id='ws-live-m14'` e `user_id` respectivo.
2. Subir o servidor MCP como acima.
3. Conectar um cliente MCP real (`@modelcontextprotocol/sdk`, StreamableHTTPClientTransport) com:
   - `Authorization: Bearer <KEY_DA_ALICE>`
   - `X-Theo-User-Id: live-bob`   ← header do OUTRO usuário
4. Chamar `remember` com qualquer conteúdo.
5. Conectar um segundo cliente com a key do **bob** (`X-Theo-User-Id: live-bob`) e chamar `get_memory` com o id retornado no passo 4.

**Esperado:** o passo 4 deveria falhar (ou escrever no escopo da alice, dono da credencial).
**Atual:** a escrita cai no escopo do **bob** e o bob a lê — a key da alice escreveu como bob.

## Evidência

Saída do live test (`.claude/tmp/live-test-m14.mjs`, passo 9):

```
=== 9. SONDA DE SEGURANÇA: key da alice + header X-Theo-User-Id: live-bob ===
  spoof remember -> Persisted 1 memory item: 014e2506-457a-43da-928d-648e8cd88968
  >>> ACHADO: a key da alice ESCREVEU no escopo do bob (header não cross-validado vs Principal)
```

Os demais 13 casos do mesmo live test passam (o isolamento cross-user das tools em si está correto — o vazamento é só pelo header do transport).

## Causa-raiz

`packages/mcp/src/transports/streamable-http.ts` → `scopeFromRequest()`:

```ts
export function scopeFromRequest(req: IncomingMessage): ScopedContext | undefined {
  const headerScope = scopeFromHeaders(req.headers);   // userId do header X-Theo-User-Id
  const workspaceId = workspaceFromRequest(req);       // workspace do Principal (auth-trusted)
  if (workspaceId === undefined && headerScope === undefined) return undefined;
  return { ...(workspaceId !== undefined ? { workspaceId } : {}), ...(headerScope ?? {}) };
}
```

O `withBearerAuth` já resolve um `Principal` completo via `ApiKeyAuthVerifier.resolvePrincipal` (que retorna `{ workspaceId, userId, role, scopes }` — ver `packages/api/src/server/auth/api-key-verifier.ts`), mas **só o `workspaceId` é anexado ao request** (`attachWorkspace`); o `userId` do Principal é descartado e o header vence.

## Sugestão de fix

Quando o Principal resolvido carrega um `userId` (key ligada a um usuário), esse valor deve ser a fonte da verdade:

1. `withBearerAuth` anexa também o `principal.userId` (ex.: `attachUser(req, principal.userId)`), espelhando o `attachWorkspace` já existente.
2. `scopeFromRequest` passa a preferir o user anexado pelo auth; o header `X-Theo-User-Id` só é honrado quando o Principal **não** carrega user (o caso da credencial workspace-level em que o gateway injeta o usuário).
3. Fail-closed: se ambos existirem e **divergirem**, rejeitar (401/403) e logar um evento tipado — não escolher silenciosamente.

Um teste de transporte cobrindo "key com user A + header user B ⇒ rejeitado (ou escopo A)" tranca a regressão.

## Escopo / relacionados

- Não afeta a topologia com gateway (Model B), onde o header é injetado auth-trusted pela edge.
- O isolamento das 4 tools do M14 (`get_memory`/`list_entities`/`update_memory`/`delete_entities`) e o forget subject-scoped estão corretos e provados ao vivo — este issue é exclusivamente sobre a origem do `userId` no transport.
- Relacionado ao modelo M8/ADR-0021 `(workspace, user)` e ao ADR-M14-1.

---

_Como foi encontrado: live test do M14 (cliente MCP real + servidor real + pgvector real, dois Principals) após o release v0.43.0. Sem secrets no corpo — as chaves usadas foram fixtures locais descartáveis._
