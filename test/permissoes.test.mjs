import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  ABAS, CAMPOS_VALOR, permissaoEfetiva, semValores, exigirAba, carregarEu, limparCacheUsuarios,
} from '../functions/_lib/permissoes.js';
import { ErroHttp, json } from '../functions/_lib/resposta.js';
import { onRequest } from '../functions/api/_middleware.js';
import { criarD1Falso } from './d1-falso.mjs';

const PERFIS = {
  compras: { id: 'compras', nome: 'Compras', abas: '["visao","estoque","avaliacoes","precos","saude"]', ver_valores: 0 },
  gestao: { id: 'gestao', nome: 'Gestão', abas: JSON.stringify(ABAS), ver_valores: 1 },
};
const usuario = (extra = {}) => ({ email: 'ana@exemplo.com', nome: 'Ana', perfil: 'compras', ajustes: null, admin: 0, ativo: 1, ...extra });

beforeEach(() => limparCacheUsuarios());

test('CAMPOS_VALOR', () => {
  assert.deepEqual(CAMPOS_VALOR, ['valor', 'ticket', 'frete', 'desconto', 'preco', 'valorCmp', 'ticketCmp', 'cmpValor', 'varPreco']);
});

test('perfil sem ajustes', () => {
  assert.deepEqual(permissaoEfetiva(usuario(), PERFIS.compras, { superAdmin: false }), {
    ativo: true, abas: ['visao', 'estoque', 'avaliacoes', 'precos', 'saude'], verValores: false, admin: false, superAdmin: false,
  });
});

test('ajuste libera aba e mantém ver R$ do perfil quando nulo', () => {
  const u = usuario({ ajustes: JSON.stringify({ abas: { vendas: true }, ver_valores: null }) });
  const p = permissaoEfetiva(u, PERFIS.compras, { superAdmin: false });
  assert.ok(p.abas.includes('vendas'));
  assert.deepEqual(p.abas, ['visao', 'vendas', 'estoque', 'avaliacoes', 'precos', 'saude']);
  assert.equal(p.verValores, false);
});

test('ajuste bloqueia aba e sobrescreve ver R$', () => {
  const u = usuario({ ajustes: { abas: { estoque: false, inexistente: true }, ver_valores: true }, admin: 1 });
  const p = permissaoEfetiva(u, PERFIS.compras, { superAdmin: false });
  assert.ok(!p.abas.includes('estoque'));
  assert.ok(!p.abas.includes('inexistente'));
  assert.equal(p.verValores, true);
  assert.equal(p.admin, true);
});

test('JSON inválido em ajustes/abas vira vazio', () => {
  const p = permissaoEfetiva(usuario({ ajustes: '{x' }), { ...PERFIS.compras, abas: 'não-json' }, { superAdmin: false });
  assert.deepEqual(p.abas, []);
  assert.equal(p.ativo, true);
});

test('inativo, sem usuário e super admin', () => {
  const vazio = { ativo: false, abas: [], verValores: false, admin: false, superAdmin: false };
  assert.deepEqual(permissaoEfetiva(usuario({ ativo: 0, admin: 1 }), PERFIS.gestao, { superAdmin: false }), vazio);
  assert.deepEqual(permissaoEfetiva(null, null, { superAdmin: false }), vazio);
  assert.deepEqual(permissaoEfetiva(null, null, { superAdmin: true }), {
    ativo: true, abas: ABAS, verValores: true, admin: true, superAdmin: true,
  });
  assert.equal(permissaoEfetiva(usuario({ ativo: 0 }), PERFIS.compras, { superAdmin: true }).ativo, true);
});

test('semValores', () => {
  const dados = { atual: { valor: 1, pedidos: 2 }, itens: [{ valor: 3, chave: 'x' }] };
  assert.deepEqual(semValores(dados, false), { atual: { pedidos: 2 }, itens: [{ chave: 'x' }] });
  assert.deepEqual(dados, { atual: { valor: 1, pedidos: 2 }, itens: [{ valor: 3, chave: 'x' }] });
  assert.equal(semValores(dados, true), dados);
  const todos = Object.fromEntries(CAMPOS_VALOR.map((c) => [c, 1]));
  assert.deepEqual(semValores({ ...todos, n: [1, null, { ticket: 2, ok: true }] }, false), { n: [1, null, { ok: true }] });
});

test('exigirAba', () => {
  const ctx = { data: { eu: { abas: ['visao'] } } };
  exigirAba(ctx, 'visao');
  assert.throws(() => exigirAba(ctx, 'vendas'), (e) => e instanceof ErroHttp && e.status === 403 && e.codigo === 'sem-permissao');
  assert.throws(() => exigirAba({ data: {} }, 'visao'), (e) => e.status === 403);
});

// ---------- carregarEu + middleware ----------

const SUPER = 'Chefe@Exemplo.com';

async function banco() {
  const db = await criarD1Falso();
  const ins = 'INSERT INTO usuarios (email, nome, perfil, ajustes, admin, ativo, ultimo_acesso) VALUES (?,?,?,?,?,?,?)';
  await db.prepare(ins).bind('ana@exemplo.com', 'Ana', 'compras', null, 0, 1, null).run();
  await db.prepare(ins).bind('bia@exemplo.com', 'Bia', 'gestao', null, 1, 1, new Date().toISOString()).run();
  await db.prepare(ins).bind('caio@exemplo.com', 'Caio', 'gestao', null, 1, 0, null).run();
  return db;
}

function contexto(db, url, { email = 'ana@exemplo.com', method = 'GET', headers = {}, next } = {}) {
  const pendentes = [];
  const ctx = {
    request: new Request(url, { method, headers }),
    env: { DB: db, DEV_EMAIL: email, SUPER_ADMIN: SUPER },
    data: {},
    params: {},
    waitUntil: (p) => pendentes.push(p),
    next: next ?? (async () => json({ ok: true, eu: ctx.data.eu })),
  };
  return { ctx, pendentes };
}

const L = 'http://localhost:8788';

async function corpo(r) {
  return { status: r.status, ...(await r.json()) };
}

test('carregarEu: usuário cadastrado, normalização, super admin sem linha e cache', async () => {
  const db = await banco();
  const env = { SUPER_ADMIN: SUPER };
  const ana = await carregarEu(db, ' ANA@exemplo.com ', env);
  assert.deepEqual(ana, {
    email: 'ana@exemplo.com', nome: 'Ana', perfil: 'compras',
    ativo: true, abas: ['visao', 'estoque', 'avaliacoes', 'precos', 'saude'], verValores: false, admin: false, superAdmin: false,
  });
  const chefe = await carregarEu(db, 'chefe@exemplo.com', env);
  assert.equal(chefe.superAdmin, true);
  assert.equal(chefe.admin, true);
  assert.deepEqual(chefe.abas, ABAS);
  const fora = await carregarEu(db, 'ninguem@exemplo.com', env);
  assert.equal(fora.ativo, false);

  await db.prepare('UPDATE usuarios SET ativo = 0 WHERE email = ?').bind('ana@exemplo.com').run();
  assert.equal((await carregarEu(db, 'ana@exemplo.com', env)).ativo, true, 'cache de 60 s');
  limparCacheUsuarios();
  assert.equal((await carregarEu(db, 'ana@exemplo.com', env)).ativo, false);
});

test('middleware: não cadastrado → 403 sem-acesso, exceto /api/eu', async () => {
  const db = await banco();
  const a = contexto(db, `${L}/api/vendas/resumo`, { email: 'ninguem@exemplo.com' });
  const ra = await corpo(await onRequest(a.ctx));
  assert.equal(ra.status, 403);
  assert.equal(ra.erro, 'sem-acesso');
  const b = contexto(db, `${L}/api/eu`, { email: 'ninguem@exemplo.com' });
  const r = await corpo(await onRequest(b.ctx));
  assert.equal(r.status, 200);
  assert.equal(r.eu.ativo, false);
  assert.equal(r.eu.email, 'ninguem@exemplo.com');
  const c = contexto(db, `${L}/api/eu/x`, { email: 'caio@exemplo.com' });
  assert.equal((await onRequest(c.ctx)).status, 403);
});

test('middleware: sem login → 401', async () => {
  const db = await banco();
  const a = contexto(db, 'https://meu-painel.pages.dev/api/eu');
  assert.equal((await corpo(await onRequest(a.ctx))).erro, 'sem-login');
});

test('middleware: usuário ativo passa e recebe context.data.eu; ultimo_acesso gravado', async () => {
  const db = await banco();
  const { ctx, pendentes } = contexto(db, `${L}/api/visao`, { email: 'Ana@Exemplo.com ' });
  const r = await corpo(await onRequest(ctx));
  assert.equal(r.status, 200);
  assert.equal(r.eu.email, 'ana@exemplo.com');
  assert.equal(r.eu.nome, 'Ana');
  assert.equal(pendentes.length, 1);
  await Promise.all(pendentes);
  const linha = await db.prepare('SELECT ultimo_acesso FROM usuarios WHERE email = ?').bind('ana@exemplo.com').first();
  assert.ok(linha.ultimo_acesso);
  // segunda requisição dentro de 1 h não grava de novo
  const dois = contexto(db, `${L}/api/visao`);
  await onRequest(dois.ctx);
  assert.equal(dois.pendentes.length, 0);
  // acesso recente (bia) e super admin sem linha não gravam
  const bia = contexto(db, `${L}/api/visao`, { email: 'bia@exemplo.com' });
  await onRequest(bia.ctx);
  assert.equal(bia.pendentes.length, 0);
  const chefe = contexto(db, `${L}/api/visao`, { email: SUPER });
  assert.equal((await onRequest(chefe.ctx)).status, 200);
  assert.equal(chefe.pendentes.length, 0);
});

test('middleware: admin e origem', async () => {
  const db = await banco();
  const naoAdmin = contexto(db, `${L}/api/admin/usuarios`);
  const r1 = await corpo(await onRequest(naoAdmin.ctx));
  assert.equal(r1.status, 403);
  assert.equal(r1.erro, 'sem-permissao');

  const admin = contexto(db, `${L}/api/admin/usuarios`, { email: 'bia@exemplo.com' });
  assert.equal((await onRequest(admin.ctx)).status, 200);

  const semOrigem = contexto(db, `${L}/api/admin/usuarios`, { email: 'bia@exemplo.com', method: 'POST' });
  const r2 = await corpo(await onRequest(semOrigem.ctx));
  assert.equal(r2.status, 403);
  assert.equal(r2.erro, 'origem');

  const outraOrigem = contexto(db, `${L}/api/admin/usuarios`, { email: 'bia@exemplo.com', method: 'POST', headers: { Origin: 'https://mal.exemplo.com' } });
  assert.equal((await onRequest(outraOrigem.ctx)).status, 403);

  const ok = contexto(db, `${L}/api/admin/usuarios`, { email: 'bia@exemplo.com', method: 'POST', headers: { Origin: L } });
  assert.equal((await onRequest(ok.ctx)).status, 200);
});

test('middleware: erros dos handlers', async () => {
  const db = await banco();
  const http = contexto(db, `${L}/api/visao`, { next: async () => { throw new ErroHttp(400, 'filtro-invalido', 'Data inválida.'); } });
  assert.deepEqual(await corpo(await onRequest(http.ctx)), { status: 400, erro: 'filtro-invalido', mensagem: 'Data inválida.' });
  const outro = contexto(db, `${L}/api/visao`, { next: async () => { throw new Error('SQLITE segredo interno'); } });
  const r = await onRequest(outro.ctx);
  assert.equal(r.status, 500);
  const texto = await r.text();
  assert.equal(JSON.parse(texto).erro, 'interno');
  assert.ok(!texto.includes('segredo'));
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});
