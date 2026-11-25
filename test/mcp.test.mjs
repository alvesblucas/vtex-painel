import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/mcp.js';
import { limparCacheUsuarios } from '../functions/_lib/permissoes.js';
import { criarD1Falso } from './d1-falso.mjs';

async function banco() {
  const db = await criarD1Falso();
  const iu = 'INSERT INTO usuarios (email, nome, perfil, ajustes, admin, ativo) VALUES (?,?,?,?,?,?)';
  await db.prepare(iu).bind('gestao@exemplo.com', 'Gê', 'gestao', null, 0, 1).run();
  await db.prepare(iu).bind('inativo@exemplo.com', 'Ina', 'gestao', null, 0, 0).run();
  await db.prepare('INSERT INTO coletas (fonte, quando, ok, registros, erro) VALUES (?,?,?,?,?)').bind('pedidos', '2026-03-08T03:00:00.000Z', 1, 1, null).run();
  return db;
}

async function mcp(db, corpo, { email = 'gestao@exemplo.com', metodo = 'POST', env = {} } = {}) {
  const init = { method: metodo, headers: { 'Content-Type': 'application/json' } };
  if (metodo === 'POST') init.body = typeof corpo === 'string' ? corpo : JSON.stringify(corpo);
  const ctx = {
    request: new Request('http://localhost:8788/mcp', init),
    env: { DB: db, DEV_EMAIL: email, SUPER_ADMIN: 'chefe@exemplo.com', MCP_ATIVO: '1', ...env },
    data: {},
    params: {},
    waitUntil: () => {},
  };
  const r = await onRequest(ctx);
  const texto = await r.text();
  return { status: r.status, corpo: texto ? JSON.parse(texto) : null, headers: r.headers };
}

const rpc = (method, params, id = 1) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });

beforeEach(() => limparCacheUsuarios());

test('mcp: initialize anuncia ferramentas e negocia a versão', async () => {
  const db = await banco();
  const { status, corpo } = await mcp(db, rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } }));
  assert.equal(status, 200);
  assert.equal(corpo.id, 1);
  assert.equal(corpo.result.serverInfo.name, 'painel');
  assert.ok(corpo.result.capabilities.tools);
  assert.equal(corpo.result.protocolVersion, '2025-06-18');
  const outra = await mcp(db, rpc('initialize', { protocolVersion: '1999-01-01' }));
  assert.equal(outra.corpo.result.protocolVersion, '2025-11-25');
});

test('mcp: tools/list e quem_sou_eu', async () => {
  const db = await banco();
  const lista = await mcp(db, rpc('tools/list'));
  assert.ok(lista.corpo.result.tools.some((t) => t.name === 'quem_sou_eu' && t.description && t.inputSchema));
  const eu = await mcp(db, rpc('tools/call', { name: 'quem_sou_eu', arguments: {} }));
  const dados = eu.corpo.result.structuredContent;
  assert.equal(eu.corpo.result.isError, undefined);
  assert.equal(dados.email, 'gestao@exemplo.com');
  assert.equal(dados.perfil, 'gestao');
  assert.equal(dados.verValores, true);
  assert.ok(dados.abas.includes('vendas'));
  assert.equal(dados.dadosAte, '2026-03-08T03:00:00.000Z');
  assert.deepEqual(JSON.parse(eu.corpo.result.content[0].text), dados);
});

test('mcp: erros de protocolo', async () => {
  const db = await banco();
  assert.equal((await mcp(db, '{nao json')).corpo.error.code, -32700);
  assert.equal((await mcp(db, [rpc('ping')])).corpo.error.code, -32600);
  assert.equal((await mcp(db, { id: 1, method: 'ping' })).corpo.error.code, -32600);
  assert.equal((await mcp(db, rpc('foo/bar'))).corpo.error.code, -32601);
  assert.equal((await mcp(db, rpc('tools/call', { name: 'nao_existe', arguments: {} }))).corpo.error.code, -32602);
  assert.deepEqual((await mcp(db, rpc('ping'))).corpo.result, {});
  const notif = await mcp(db, { jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal(notif.status, 202);
  assert.equal(notif.corpo, null);
});

test('mcp: desligado → 404; GET → 405; inativo ou desconhecido → 403', async () => {
  const db = await banco();
  assert.equal((await mcp(db, rpc('ping'), { env: { MCP_ATIVO: undefined } })).status, 404);
  assert.equal((await mcp(db, rpc('ping'), { env: { MCP_ATIVO: '0' } })).status, 404);
  assert.equal((await mcp(db, null, { metodo: 'GET' })).status, 405);
  assert.equal((await mcp(db, rpc('ping'), { email: 'inativo@exemplo.com' })).status, 403);
  assert.equal((await mcp(db, rpc('ping'), { email: 'ninguem@exemplo.com' })).status, 403);
});

test('mcp: sem login → 401 com WWW-Authenticate', async () => {
  const db = await banco();
  const ctx = {
    request: new Request('https://meu-painel.pages.dev/mcp', { method: 'POST', body: JSON.stringify(rpc('ping')) }),
    env: { DB: db, MCP_ATIVO: '1', ACCESS_TEAM: 'equipe', ACCESS_AUD: 'a', ACCESS_AUD_MCP: 'b' },
    data: {}, params: {}, waitUntil: () => {},
  };
  const r = await onRequest(ctx);
  assert.equal(r.status, 401);
  assert.match(r.headers.get('WWW-Authenticate') ?? '', /^Bearer/);
});
