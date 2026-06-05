# @theokit/ui + theokit framework — issues encontrados durante migration

**Origem:** `examples-theokit-chat-migration` v1.1 cycle — migration `examples/chat-with-memory/` Next.js → TheoKit canonical
**Data:** 2026-06-05
**Versões testadas:** `theokit@0.2.4`, `@theokit/ui@0.13.0`, `@theokit/sdk@1.5.0`
**Sandbox:** Linux + Chrome DevTools MCP + real OpenAI key + pgvector container

---

## Para o time TheoKit / @theokit/ui

Olá time. Migrei o demo `@usetheo/memory/examples/chat-with-memory` do Next.js direto para TheoKit canonical para demonstrar o subpath `@usetheo/memory/theokit` (memoryFromCtx). Durante a migration encontrei **15 issues** concretas — algumas são bugs reais, outras documentation gaps, outras API inconsistencies. Todas reproduzíveis. Listo abaixo por **severity** + **type**.

---

## 🔴 BUGS (3) — comportamento incorreto

### B1 — Tailwind v4 preflight triple-injection causa borda branca em dark mode

**Severity:** HIGH — afeta TODO consumer com dark theme + classe `border`
**Repro:** demo com `@import "@theokit/ui/styles.css"` + qualquer `<Card>` ou elemento com `className="border"` em dark theme

**Sintoma:**
```css
/* Esperado: borda dark gray */
border-color: hsl(0 0% 16%)  /* = --border */
/* Observado: borda quase-branca */
border-color: rgb(245, 245, 245)  /* = --foreground (currentColor inherit) */
```

**Root cause** (investigação via `document.styleSheets` walk):
- 3× `@layer base { *, ::before, ::after, ::backdrop { border: 0px solid } }` injetados no dev bundle
- 1ª: via `@theokit/ui/styles.css` `@import "tailwindcss"`
- 2ª + 3ª: pelo `@tailwindcss/vite` plugin auto-chained por `theoPluginAsync` (HMR re-emission)
- O shorthand `border: 0px solid` IMPLICITAMENTE seta `border-color: currentColor`
- A regra `@theokit/ui` `* { border-color: hsl(var(--border)) }` aparece na posição **8 de 13** matching rules — preflights AFTER override
- Workaround necessário no consumer: `* { border-color: hsl(var(--border)) !important }`

**Sugestão de fix no framework:**
- `@tailwindcss/vite` HMR não deveria re-injetar preflight se já presente no bundle
- OR `@theokit/ui/styles.css` deveria emitir a regra `border-color` no final do bundle (via `@layer utilities` que vem após `@layer base`)
- OR document explicitly que consumers precisam de `!important` para dark theme

**Arquivos relevantes:**
- `node_modules/@theokit/ui/dist/styles.css:24` (`@layer base { * { border-color: hsl(var(--border)) } }`)
- `node_modules/theokit/dist/chunk-5OKZY2VL.js` (`integrateUseTheoUI` que auto-chained `@tailwindcss/vite`)

---

### B2 — `theoPluginAsync` auto-detect só procura `@theokit/ui` (legacy `@usetheo/ui` quebra Tailwind compilation)

**Severity:** HIGH — afeta consumers com `@usetheo/ui` (pre-rebranding sibling)
**Repro:** novo demo com `@usetheo/ui@0.12.0` + `tailwindcss@4` + classes Tailwind. CSS utilities NÃO geram.

**Root cause** (`node_modules/theokit/dist/chunk-5OKZY2VL.js § integrateUseTheoUI`):
```js
const uiDetect = detectPackage("@theokit/ui", cwd);
if (!uiDetect.installed) return [];  // ← bail; @tailwindcss/vite NÃO chained
```

Se o consumer tem `@usetheo/ui` (alias publicado paralelo) mas NÃO `@theokit/ui`, `@tailwindcss/vite` plugin NÃO é auto-chained → utility classes não compilam → UI renderiza como texto bruto.

**Sintoma usuário-visível:**
- Plain HTML text sem layout
- `getComputedStyle(button)` mostra `padding: 0px, borderRadius: 0px` apesar de `className` ter `inline-flex items-center px-3 py-1.5 rounded-lg ...`

**Sugestão de fix:**
- `detectPackage("@theokit/ui") || detectPackage("@usetheo/ui")` (ambos namespaces)
- OR emit clear warning no console: `[theokit] @usetheo/ui detected but @theokit/ui expected — install @theokit/ui to enable auto Tailwind compilation`

---

### B3 — `request: Request` type mismatch com runtime IncomingMessage

**Severity:** MEDIUM — afeta consumers seguindo type hints
**Repro:** `defineRoute({ handler: async ({ request }) => { await request.json() } })` em POST endpoint

**Sintoma:**
- TypeScript: `request: Request` (Fetch API) — parece `.json()` funciona
- Runtime: `TypeError: request.json is not a function`
- Plus `request.headers.get('cookie')` quebra mesma razão (Node IncomingMessage `.headers` é plain object, não Headers)
- Plus `new URL(request.url)` quebra porque IncomingMessage.url é relative path (`/api/info`) não absolute

**Causa real:** `executeRoute` invoca handler com `req: IncomingMessage` (Node Connect-style) mas type narrowed como `Request` (Fetch). TheoKit auto-parsea body via `parseRequestBody` e passa via `body` arg do handler — mas type docs/tutorials sugerem usar `request.json()` direto.

**Sugestão de fix:**
- Trocar type de `request: Request` para `request: IncomingMessage` (honest type) OR criar shim que ENVELOPES IncomingMessage como Request-compatible (com `.json()`, `.headers.get()`, absolute `.url`)
- OR documentação explícita "use `body` arg, NOT `request.json()`" no getting-started

---

## 🟡 API INCONSISTENCIES (5)

### I1 — Badge variants ≠ Toast variants

`Toast({ variant })`: `info | success | warning | destructive | default`
`Badge({ variant })`: `accent | primary | destructive | outline | success | warning | default`

**Inconsistência:** `info` existe em Toast mas NÃO em Badge (use `primary`). `secondary` não existe em nenhum (use `accent`). Consumer com mental model unificado vai falhar.

**Sugestão:** alinhar a paleta de variants entre todos os primitives canonical (Badge, Toast, Alert, Button) — single discrim union exportada.

---

### I2 — `EmptyState.icon` é IconComponent (component ref), NÃO ReactNode

```tsx
// Esperado (mental model React):
<EmptyState icon={<Bot className="h-8 w-8" />} />  // ❌ type error
// Real:
<EmptyState icon={Bot} />  // ✓ — component reference
```

**Inconsistência:** maioria dos primitives `icon` props recebem JSX node; `EmptyState` recebe component reference. Confuso.

**Sugestão:** aceitar BOTH (JSX node OR component ref) via union type + runtime branch.

---

### I3 — `Alert` não tem `icon` prop

```tsx
<Alert intent="info" icon={<Sparkles />}>  // ❌ icon não existe
// Workaround:
<Alert title={<span><Sparkles /> Title</span>} description="..." />
```

Comparado a outros primitives (`Button`, `EmptyState`, `Card`) que aceitam icons como prop dedicado, `Alert` força icon dentro do `title`.

**Sugestão:** adicionar `icon?: IconComponent | ReactNode` prop a `AlertProps`.

---

### I4 — `Toaster` exige `children` (provider pattern)

```tsx
<Toaster />  // ❌ children missing
// Real:
<Toaster>{app}</Toaster>  // ← wraps app
```

O nome `Toaster` sugere "toast viewport" (single mount); na verdade é o Radix Toast Provider+Viewport bundle. Sem `<Toaster>` envolvendo a app, `useToast()` em descendants quebra.

**Sugestão:** rename para `ToastProvider` (clarifica role) OR aceitar `<Toaster />` standalone via implicit React Portal (Toaster.tsx detecta ausência de children + mounts only viewport).

---

### I5 — `defineAgentEndpoint` async generator não acomoda metadata

```tsx
defineAgentEndpoint<Body>({
  handler: async function*() {
    yield { type: 'message', content: '...' };
    // ↓ NÃO posso yield metadata sobre o run (reflection counter, run-id, custom)
  },
});
```

`AgentEvent` union = `message | tool_call | tool_result | error` apenas. Para metadata extra (reflection counter, cost, conversation-id), consumer força separate endpoint OR encoda metadata como `tool_result` (semantic abuse).

**Sugestão:** adicionar `metadata?: Record<string, unknown>` no `AgentMessageEvent` OR introduzir `AgentMetaEvent` type.

---

## 🟢 DOCUMENTATION GAPS (7)

### D1 — `@theokit/ui/styles.css` NÃO é mencionado em getting-started

`@theokit/ui/styles.css` é OBRIGATÓRIO (bundles components.css 107KB) mas docs falam apenas em fonts.css + tokens.css + preset.css. Consumer importing files individualmente perde o components.css → Radix primitives renderizam sem animations.

**Repro:** demo com `globals.css` importando individuamente. Tabs / Select / RadioGroup / Tooltip renderizam sem transitions/popovers.

---

### D2 — Vite `@/` tsconfig path aliases não auto-resolvidos

Vite 6.4 (pinned via theokit) não suporta tsconfig paths nativamente. `theoPluginAsync` auto-chained `@tailwindcss/vite` + `@theokit/ui` mas NÃO `vite-tsconfig-paths`. Consumer com `tsconfig.json paths: { "@/*": ["./*"] }` quebra `import "@/lib/foo"` em client OR server.

**Sugestão:** auto-chain vite-tsconfig-paths se detectado (mesma logic do tailwind/vite).

---

### D3 — `createSessionManager` real shape ≠ tutorial expectations

API real: `{ secret, cookieName?, maxAge? }`
Expectativa comum: `{ initialSession: () => UserSession }` (anon-uid bootstrap)

**Sugestão:** docs deveriam ter um exemplo "anonymous-uid for demos" usando o `server/context.ts` createContext convention. Sem isso, todos demos vão escrever custom cookie + UUID code.

---

### D4 — CSRF `X-Theo-Action: 1` header silencioso

`theoFetch` adiciona automaticamente. Raw `fetch()` ou client-side libs sem TheoKit não tem hint que precisa header → 403 `CSRF_INVALID` sem explicação clara em getting-started.

**Sugestão:** documentar em `defineRoute` docs + emit clear 403 error message com "include X-Theo-Action: 1 header OR use theoFetch".

---

### D5 — `process.env` vs `import.meta.env` migration gap

Migration Next.js → TheoKit / Vite consumers tentam `process.env.NEXT_PUBLIC_*` → `ReferenceError: process is not defined` (no client). Vite usa `import.meta.env.VITE_*`.

**Sugestão:** migration guide específico Next.js → TheoKit mencionando este pitfall.

---

### D6 — `better-sqlite3` peerDependency required mas não documentado

`theokit dev` preflight HARD FAILS sem `better-sqlite3`:
```
✗ [theokit preflight] Native binding ABI mismatch detected (Node v22.22.2, ABI 127).
Offending packages:
  - better-sqlite3 (required dep is NOT installed — run `pnpm install`)
```

Consumer não sabe que precisa `npm install better-sqlite3` separadamente. Erro só aparece on dev boot.

**Sugestão:** mover better-sqlite3 para `peerDependencies` em `theokit` package.json OR pre-install via post-install script.

---

### D7 — Body parsing: usar `body` arg, NÃO `request.json()`

Plan tutorials prescrevem `async ({ request }) => { const body = await request.json(); ... }`. Real correto: `async ({ body: rawBody }) => { ... }` (TheoKit auto-parses).

**Sugestão:** docs explícitos "do NOT call request.json() — TheoKit parses body via parseRequestBody and provides via `body` argument".

---

## 📊 Resumo

| Categoria | Count | Severity |
|---|---|---|
| 🔴 Bugs | 3 | 2 HIGH (B1, B2), 1 MEDIUM (B3) |
| 🟡 API Inconsistencies | 5 | LOW-MEDIUM |
| 🟢 Documentation Gaps | 7 | LOW |
| **Total** | **15** | |

**Top 3 prioridades sugeridas:**
1. **B1** (preflight triple-injection) — afeta TODO consumer dark theme; CSS-cascade hard-to-debug sem repro detalhado
2. **B2** (auto-detect @theokit/ui only) — silent failure que quebra UI completamente; emite warning poderia salvar horas
3. **B3** (Request vs IncomingMessage type) — type/runtime mismatch confunde consumers; sugiro Request shim OR honest typing

**Commits no consumer-side workarounds** (deste cycle, para referência cross-repo):
- B1 workaround: commit `80e487a` (`fix(examples-chat-migration): T6.6 — !important override`)
- B2 workaround: commit `0a31519` (`fix(examples-chat-migration): T6.2 — swap @usetheo/ui → @theokit/ui`)
- B3 workaround: commit `d09d03c` (`fix(examples-chat-migration): T6.1 follow-up — 3 E2E-discovered bugs`)
- D1 workaround: commit `91c083e` (`fix(examples-chat-migration): T6.5 — @theokit/ui/styles.css canonical entry`)

---

**Disponível para mais detalhes / pair debug** — todos os repros estão no demo `examples/chat-with-memory/` post-`91c083e`. `theokit dev` + Chrome DevTools dá visibilidade completa.
