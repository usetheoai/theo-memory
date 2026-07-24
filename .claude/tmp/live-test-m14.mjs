#!/usr/bin/env node
// LIVE TEST M14 — real MCP client vs the real v0.43.0 MCP server (streamable-http + api-keys),
// two Principals (live-alice / live-bob) in the SAME workspace, against real pgvector.
// Proves: the 4 new tools ship + work, and the cross-user IDOR BLOCKER fix holds LIVE.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const URL_ = 'http://127.0.0.1:8899/mcp';
const ALICE = 'theo_live_1ObBWui5h-StC3SaYt64HbMDhUn3JWmC6-1rSObB1Zn';
const BOB = 'theo_live_d6PVNxkjXaECXgdh1QfYlFkabkH9WrW_7f-SSqBzc7P';

async function connect(token, name, userHeader) {
  const transport = new StreamableHTTPClientTransport(new URL(URL_), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${token}`,
        ...(userHeader ? { 'X-Theo-User-Id': userHeader } : {}),
      },
    },
  });
  const client = new Client({ name, version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

const textOf = (r) => (r?.content?.[0]?.text ?? '');
let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  if (ok) { pass++; console.log(`  PASS  ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); }
}

const alice = await connect(ALICE, 'live-alice', 'live-alice');
const bob = await connect(BOB, 'live-bob', 'live-bob');

console.log('\n=== 1. tools/list (o servidor publicado expõe as 4 tools do M14?) ===');
const tools = (await alice.listTools()).tools.map((t) => t.name);
console.log('  tools:', tools.join(', '));
check('13 tools registradas', tools.length === 13, `got ${tools.length}`);
for (const t of ['get_memory', 'list_entities', 'update_memory', 'delete_entities']) {
  check(`tool ${t} presente`, tools.includes(t));
}

console.log('\n=== 2. alice: remember (infer:false, sem LLM) ===');
const CANARY = 'ALICE-LIVE-CANARY-M14-7788 prefere pnpm e TDD estrito';
const rem = await alice.callTool({ name: 'remember', arguments: { content: CANARY, infer: false } });
const remTxt = textOf(rem);
const ids = [...remTxt.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)].map((m) => m[0]);
console.log('  remember ->', remTxt.slice(0, 120));
check('remember persistiu (id retornado)', ids.length >= 1, remTxt.slice(0, 80));
const aliceId = ids[0];

console.log('\n=== 3. get_memory: alice lê a PRÓPRIA memória ===');
const own = await alice.callTool({ name: 'get_memory', arguments: { id: aliceId } });
check('alice LÊ a própria memória', textOf(own).includes('7788'), textOf(own).slice(0, 90));

console.log('\n=== 4. get_memory CROSS-USER (o fix do IDOR, AO VIVO) ===');
const cross = await bob.callTool({ name: 'get_memory', arguments: { id: aliceId } });
check('bob NÃO lê a memória de alice', /No memory found/i.test(textOf(cross)), textOf(cross).slice(0, 90));

console.log('\n=== 5. forget CROSS-USER (o BLOCKER: subject-scoped forget, AO VIVO) ===');
const bobForget = await bob.callTool({ name: 'forget', arguments: { id: aliceId } });
console.log('  bob forget ->', textOf(bobForget).slice(0, 100));
const survives = await alice.callTool({ name: 'get_memory', arguments: { id: aliceId } });
check('memória de alice SOBREVIVE ao forget do bob', textOf(survives).includes('7788'), textOf(survives).slice(0, 90));

console.log('\n=== 6. list_entities + delete_entities (escopo do Principal) ===');
const le = await alice.callTool({ name: 'list_entities', arguments: {} });
check('list_entities responde JSON', textOf(le).startsWith('{'), textOf(le).slice(0, 80));
const de = await alice.callTool({ name: 'delete_entities', arguments: { name: 'EntidadeInexistente' } });
check('delete_entities idempotente (0 removidos)', /"entities_removed":\s*0/.test(textOf(de)), textOf(de).slice(0, 80));

console.log('\n=== 7. update_memory cross-user NÃO destrói o alvo ===');
await bob.callTool({ name: 'update_memory', arguments: { id: aliceId, content: 'hijack do bob tentando sobrescrever' } }).catch(() => null);
const after = await alice.callTool({ name: 'get_memory', arguments: { id: aliceId } });
check('memória de alice intacta após update do bob', textOf(after).includes('7788'), textOf(after).slice(0, 90));

console.log('\n=== 8. alice apaga a PRÓPRIA memória (forget subject-scoped funciona no dono) ===');
const ownForget = await alice.callTool({ name: 'forget', arguments: { id: aliceId } });
console.log('  alice forget ->', textOf(ownForget).slice(0, 90));
const gone = await alice.callTool({ name: 'get_memory', arguments: { id: aliceId } });
check('memória removida após o forget do dono', /No memory found/i.test(textOf(gone)), textOf(gone).slice(0, 90));

console.log('\n=== 9. SONDA DE SEGURANÇA: key da alice + header X-Theo-User-Id: live-bob ===');
const spoof = await connect(ALICE, 'spoof', 'live-bob');
const spoofRem = await spoof.callTool({ name: 'remember', arguments: { content: 'SPOOF-PROBE escrito com a key da alice mas header do bob', infer: false } });
const spoofTxt = textOf(spoofRem);
const spoofIds = [...spoofTxt.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g)].map((m) => m[0]);
console.log('  spoof remember ->', spoofTxt.slice(0, 100));
if (spoofIds.length) {
  const asBob = await bob.callTool({ name: 'get_memory', arguments: { id: spoofIds[0] } });
  const impersonated = textOf(asBob).includes('SPOOF-PROBE');
  console.log(impersonated
    ? '  >>> ACHADO: a key da alice ESCREVEU no escopo do bob (header não cross-validado vs Principal)'
    : '  >>> OK: a escrita NÃO caiu no escopo do bob');
} else {
  console.log('  (remember do spoof não persistiu — inconclusivo)');
}
await spoof.close();

console.log(`\n===== LIVE TEST M14: ${pass} PASS / ${fail} FAIL =====`);
await alice.close(); await bob.close();
process.exit(fail === 0 ? 0 : 1);
