import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/_middleware.js';
import { ABAS, carregarEu, exigirAdmin, limparCacheUsuarios } from '../functions/_lib/permissoes.js';
import { ErroHttp } from '../functions/_lib/resposta.js';
import * as usuarios from '../functions/api/admin/usuarios.js';
import * as usuario from '../functions/api/admin/usuarios/[email].js';
import * as perfis from '../functions/api/admin/perfis.js';
import * as perfil from '../functions/api/admin/perfis/[id].js';
import * as auditoria from '../functions/api/admin/auditoria.js';
import { criarD1Falso } from './d1-falso.mjs';

const L = 'http://localhost:8788';
const SUPER = 'chefe@exemplo.com';
const ADMIN = 'bia@exemplo.com';

async function banco() {
  const db = await criarD1Falso();
  const ins = 'INSERT INTO usuarios (email, nome, perfil, ajustes, admin, ativo, criado) VALUES (?,?,?,?,?,?,?)';
  await db.prepare(ins).bind('ana@exemplo.com', 'Ana', 'compras', null, 0, 1, '2026-01-01T00:00:00.000Z').run();
  await db.prepare(ins).bind(ADMIN, 'Bia', 'gestao', null, 1, 1, '2026-01-02T00:00:00.000Z').run();
  await db.prepare(ins).bind('caio@exemplo.com', 'Caio', 'atendimento', JSON.stringify({ abas: { vendas: true } }), 0, 0, null).run();
  return db;
}

const METODO = { GET: 'onRequestGet', POST: 'onRequestPost', PATCH: 'onRequestPatch' };

async function pedir(db, metodo, rota, modulo, opcoes = {}) {
  const { email = ADMIN, corpo, env = {}, params = {}, headers = {}, bruto } = opcoes;
  const h = metodo === 'GET' ? {} : { Origin: L, 'Content-Type': 'application/json' };
  const ctx = {
    request: new Request(`${L}${rota}`, {
      method: metodo,
      headers: { ...h, ...headers },
      body: bruto ?? (corpo === undefined ? undefined : JSON.stringify(corpo)),
    }),
    env: { DB: db, DEV_EMAIL: email, SUPER_ADMIN: ' Chefe@Exemplo.com ', ...env },
    data: {},
    params,
    waitUntil: () => {},
  };
  ctx.next = () => modulo[METODO[metodo]](ctx);
  const r = await onRequest(ctx);
  return { status: r.status, corpo: await r.json() };
}

const linhasAuditoria = async (db) => (await db.prepare('SELECT * FROM auditoria ORDER BY id').all()).results;
const linhaUsuario = (db, email) => db.prepare('SELECT * FROM usuarios WHERE email = ?').bind(email).first();

beforeEach(() => limparCacheUsuarios());

// ---------- exigirAdmin (R11) ----------

test('exigirAdmin', () => {
  exigirAdmin({ data: { eu: { admin: true } } });
  for (const ctx of [{ data: { eu: { admin: false } } }, { data: {} }, {}]) {
    assert.throws(() => exigirAdmin(ctx), (e) => e instanceof ErroHttp && e.status === 403 && e.codigo === 'sem-permissao');
  }
});

test('handler admin recusa não-admin mesmo se chamado direto', async () => {
  const db = await banco();
  const ctx = { request: new Request(`${L}/api/admin/usuarios`), env: { DB: db }, data: { eu: { email: 'ana@exemplo.com', admin: false } }, params: {} };
  for (const fn of [usuarios.onRequestGet, perfis.onRequestGet, auditoria.onRequestGet]) {
    await assert.rejects(() => fn(ctx), (e) => e.status === 403);
  }
});

test('middleware: não-admin recebe 403 no /api/admin', async () => {
  const db = await banco();
  const r = await pedir(db, 'GET', '/api/admin/usuarios', usuarios, { email: 'ana@exemplo.com' });
  assert.equal(r.status, 403);
});

// ---------- usuários ----------

test('POST usuário: normaliza e-mail e audita com depois', async () => {
  const db = await banco();
  const r = await pedir(db, 'POST', '/api/admin/usuarios', usuarios, {
    corpo: { email: 'Fulano@Exemplo.com ', nome: 'Fulano', perfil: 'marketing', ajustes: { abas: { pedidos: true }, ver_valores: false } },
  });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.email, 'fulano@exemplo.com');
  const u = await linhaUsuario(db, 'fulano@exemplo.com');
  assert.equal(u.nome, 'Fulano');
  assert.equal(u.perfil, 'marketing');
  assert.equal(u.admin, 0);
  assert.equal(u.ativo, 1);
  assert.deepEqual(JSON.parse(u.ajustes), { abas: { pedidos: true }, ver_valores: false });
  assert.match(u.criado, /^\d{4}-\d{2}-\d{2}T/);
  const aud = await linhasAuditoria(db);
  assert.equal(aud.length, 1);
  assert.equal(aud[0].acao, 'usuario.criar');
  assert.equal(aud[0].quem, ADMIN);
  assert.equal(aud[0].alvo, 'fulano@exemplo.com');
  assert.equal(aud[0].antes, null);
  assert.equal(JSON.parse(aud[0].depois).email, 'fulano@exemplo.com');
  assert.match(aud[0].quando, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('POST usuário duplicado → 409, sem auditoria', async () => {
  const db = await banco();
  const corpo = { email: 'fulano@exemplo.com', nome: 'Fulano', perfil: 'compras' };
  assert.equal((await pedir(db, 'POST', '/api/admin/usuarios', usuarios, { corpo })).status, 201);
  const r = await pedir(db, 'POST', '/api/admin/usuarios', usuarios, { corpo: { ...corpo, email: ' FULANO@exemplo.com' } });
  assert.equal(r.status, 409);
  assert.equal((await linhasAuditoria(db)).length, 1);
});

test('POST usuário: domínio fora de DOMINIO_PERMITIDO → 400', async () => {
  const db = await banco();
  const env = { DOMINIO_PERMITIDO: 'Exemplo.com' };
  const fora = await pedir(db, 'POST', '/api/admin/usuarios', usuarios, { env, corpo: { email: 'x@outro.com', nome: 'X', perfil: 'compras' } });
  assert.equal(fora.status, 400);
  const sub = await pedir(db, 'POST', '/api/admin/usuarios', usuarios, { env, corpo: { email: 'x@malexemplo.com', nome: 'X', perfil: 'compras' } });
  assert.equal(sub.status, 400);
  const ok = await pedir(db, 'POST', '/api/admin/usuarios', usuarios, { env, corpo: { email: 'x@EXEMPLO.com', nome: 'X', perfil: 'compras' } });
  assert.equal(ok.status, 201);
  assert.equal((await linhasAuditoria(db)).length, 1);
});

test('POST usuário: validações → 400 e nada gravado', async () => {
  const db = await banco();
  const base = { email: 'novo@exemplo.com', nome: 'Novo', perfil: 'compras' };
  const ruins = [
    { ...base, email: 'sem-arroba' },
    { ...base, email: 'a b@exemplo.com' },
    { ...base, nome: '' },
    { ...base, nome: 3 },
    { ...base, perfil: 'inexistente' },
    { email: base.email, nome: 'Novo' },
    { ...base, ajustes: { abas: { cpf: true } } },
    { ...base, ajustes: { abas: { vendas: 'true' } } },
    { ...base, ajustes: { abas: ['vendas'] } },
    { ...base, ajustes: { ver_valores: 'false' } },
    { ...base, ajustes: { outro: 1 } },
    { ...base, ajustes: 'x' },
    { ...base, ajustes: [] },
    { ...base, ativo: 'false' },
    { ...base, ativo: 0 },
    { ...base, admin: 'true' },
    { ...base, extra: 1 },
  ];
  for (const corpo of ruins) {
    const r = await pedir(db, 'POST', '/api/admin/usuarios', usuarios, { corpo });
    assert.equal(r.status, 400, JSON.stringify(corpo));
    assert.equal(typeof r.corpo.mensagem, 'string');
  }
  assert.equal(await linhaUsuario(db, 'novo@exemplo.com'), null);
  assert.equal((await linhasAuditoria(db)).length, 0);
});

test('POST: ajustes.abas.cpf → 400', async () => {
  const db = await banco();
  const r = await pedir(db, 'POST', '/api/admin/usuarios', usuarios, {
    corpo: { email: 'novo@exemplo.com', nome: 'Novo', perfil: 'compras', ajustes: { abas: { cpf: true } } },
  });
  assert.equal(r.status, 400);
});

test('POST: só o super admin cria admin; ninguém cria o super admin', async () => {
  const db = await banco();
  const corpo = { email: 'novo@exemplo.com', nome: 'Novo', perfil: 'compras', admin: true };
  assert.equal((await pedir(db, 'POST', '/api/admin/usuarios', usuarios, { corpo })).status, 403);
  const sup = await pedir(db, 'POST', '/api/admin/usuarios', usuarios, { corpo: { ...corpo, email: ' CHEFE@exemplo.com' }, email: SUPER });
  assert.equal(sup.status, 403);
  assert.equal(sup.corpo.erro, 'super-admin');
  assert.equal((await linhasAuditoria(db)).length, 0);
  const ok = await pedir(db, 'POST', '/api/admin/usuarios', usuarios, { corpo, email: SUPER });
  assert.equal(ok.status, 201);
  assert.equal((await linhaUsuario(db, 'novo@exemplo.com')).admin, 1);
  assert.equal((await linhasAuditoria(db))[0].quem, SUPER);
});

test('POST: corpo precisa ser JSON (415), válido (400) e pequeno (413)', async () => {
  const db = await banco();
  const texto = await pedir(db, 'POST', '/api/admin/usuarios', usuarios, { bruto: 'email=x', headers: { 'Content-Type': 'text/plain' } });
  assert.equal(texto.status, 415);
  assert.equal(texto.corpo.erro, 'tipo');
  assert.equal((await pedir(db, 'POST', '/api/admin/usuarios', usuarios, { bruto: '{x' })).status, 400);
  assert.equal((await pedir(db, 'POST', '/api/admin/usuarios', usuarios, { bruto: '[1]' })).status, 400);
  assert.equal((await pedir(db, 'POST', '/api/admin/usuarios', usuarios, { bruto: 'null' })).status, 400);
  const grande = { email: 'novo@exemplo.com', nome: 'x'.repeat(11000), perfil: 'compras' };
  assert.equal((await pedir(db, 'POST', '/api/admin/usuarios', usuarios, { corpo: grande })).status, 413);
  assert.equal((await linhasAuditoria(db)).length, 0);
});

test('POST sem Origin → 403 (middleware)', async () => {
  const db = await banco();
  const r = await pedir(db, 'POST', '/api/admin/usuarios', usuarios, {
    corpo: { email: 'novo@exemplo.com', nome: 'Novo', perfil: 'compras' },
    headers: { Origin: 'https://mal.exemplo.com' },
  });
  assert.equal(r.status, 403);
  assert.equal((await linhasAuditoria(db)).length, 0);
});

test('PATCH: admin comum no super admin → 403, auditoria inalterada', async () => {
  const db = await banco();
  const r = await pedir(db, 'PATCH', '/api/admin/usuarios/chefe', usuario, { params: { email: ' Chefe@Exemplo.com' }, corpo: { ativo: false } });
  assert.equal(r.status, 403);
  assert.equal(r.corpo.erro, 'super-admin');
  const s = await pedir(db, 'PATCH', '/api/admin/usuarios/chefe', usuario, { email: SUPER, params: { email: SUPER }, corpo: { nome: 'X' } });
  assert.equal(s.status, 403);
  assert.equal((await linhasAuditoria(db)).length, 0);
});

test('PATCH: admin comum em si mesmo {ativo:false} ou {admin:false} → 400', async () => {
  const db = await banco();
  for (const corpo of [{ ativo: false }, { admin: false }]) {
    const r = await pedir(db, 'PATCH', '/api/admin/usuarios/bia', usuario, { params: { email: 'BIA@exemplo.com' }, corpo });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.erro, 'proprio-usuario');
  }
  const u = await linhaUsuario(db, ADMIN);
  assert.equal(u.ativo, 1);
  assert.equal(u.admin, 1);
  // mesmo valor não é mudança; nome pode
  const ok = await pedir(db, 'PATCH', '/api/admin/usuarios/bia', usuario, { params: { email: ADMIN }, corpo: { nome: 'Bia S.', ativo: true } });
  assert.equal(ok.status, 200);
  assert.equal((await linhasAuditoria(db)).length, 1);
});

test('PATCH: admin comum dando admin:true a outro → 403; super admin → 200', async () => {
  const db = await banco();
  const params = { email: 'ana@exemplo.com' };
  const r = await pedir(db, 'PATCH', '/api/admin/usuarios/ana', usuario, { params, corpo: { admin: true } });
  assert.equal(r.status, 403);
  assert.equal((await linhaUsuario(db, 'ana@exemplo.com')).admin, 0);
  assert.equal((await linhasAuditoria(db)).length, 0);

  const s = await pedir(db, 'PATCH', '/api/admin/usuarios/ana', usuario, { email: SUPER, params, corpo: { admin: true } });
  assert.equal(s.status, 200);
  assert.equal(s.corpo.admin, true);
  assert.equal((await linhaUsuario(db, 'ana@exemplo.com')).admin, 1);
  const [a] = await linhasAuditoria(db);
  assert.equal(a.acao, 'usuario.editar');
  assert.equal(a.quem, SUPER);
  assert.equal(a.alvo, 'ana@exemplo.com');
  assert.equal(JSON.parse(a.antes).admin, 0);
  assert.equal(JSON.parse(a.depois).admin, 1);
});

test('PATCH usuário: parcial, ajustes, inexistente 404, validação 400', async () => {
  const db = await banco();
  const params = { email: 'ana@exemplo.com' };
  const ok = await pedir(db, 'PATCH', '/api/admin/usuarios/ana', usuario, { params, corpo: { perfil: 'gestao', ativo: false, ajustes: { ver_valores: null } } });
  assert.equal(ok.status, 200);
  const u = await linhaUsuario(db, 'ana@exemplo.com');
  assert.equal(u.nome, 'Ana');
  assert.equal(u.perfil, 'gestao');
  assert.equal(u.ativo, 0);
  assert.deepEqual(JSON.parse(u.ajustes), { ver_valores: null });

  assert.equal((await pedir(db, 'PATCH', '/x', usuario, { params: { email: 'zeca@exemplo.com' }, corpo: { nome: 'Z' } })).status, 404);
  for (const corpo of [{ ajustes: { abas: { cpf: false } } }, { perfil: 'nao-existe' }, { ativo: 1 }, {}, { email: 'outro@exemplo.com' }]) {
    assert.equal((await pedir(db, 'PATCH', '/x', usuario, { params, corpo })).status, 400, JSON.stringify(corpo));
  }
  assert.equal((await linhasAuditoria(db)).length, 1);
});

test('GET usuários: efetiva e super admin mesmo sem linha', async () => {
  const db = await banco();
  const r = await pedir(db, 'GET', '/api/admin/usuarios', usuarios);
  assert.equal(r.status, 200);
  const sup = r.corpo.filter((u) => u.superAdmin);
  assert.equal(sup.length, 1);
  assert.equal(sup[0].email, SUPER);
  assert.deepEqual(sup[0].efetiva, { abas: ABAS, verValores: true });
  const ana = r.corpo.find((u) => u.email === 'ana@exemplo.com');
  assert.deepEqual(ana, {
    email: 'ana@exemplo.com', nome: 'Ana', perfil: 'compras', ajustes: null, admin: false, ativo: true, superAdmin: false,
    criado: '2026-01-01T00:00:00.000Z', ultimo_acesso: null,
    efetiva: { abas: ['visao', 'estoque', 'avaliacoes', 'precos', 'saude'], verValores: false },
  });
  const caio = r.corpo.find((u) => u.email === 'caio@exemplo.com');
  assert.deepEqual(caio.ajustes, { abas: { vendas: true } });
  assert.equal(caio.ativo, false);
  assert.deepEqual(caio.efetiva, { abas: [], verValores: false });
  assert.equal(r.corpo.length, 4);
});

// ---------- perfis ----------

test('GET perfis com contagem de usuários', async () => {
  const db = await banco();
  const r = await pedir(db, 'GET', '/api/admin/perfis', perfis);
  assert.equal(r.status, 200);
  const g = r.corpo.find((p) => p.id === 'gestao');
  assert.deepEqual(g, { id: 'gestao', nome: 'Gestão', abas: ABAS, ver_valores: true, usuarios: 1 });
  assert.equal(r.corpo.find((p) => p.id === 'marketing').usuarios, 0);
  assert.equal(r.corpo.length, 4);
});

test('POST perfil: cria, audita, duplicado 409, validação 400', async () => {
  const db = await banco();
  const corpo = { id: 'financeiro', nome: 'Financeiro', abas: ['visao', 'vendas'], ver_valores: true };
  const r = await pedir(db, 'POST', '/api/admin/perfis', perfis, { corpo });
  assert.equal(r.status, 201);
  const p = await db.prepare('SELECT * FROM perfis WHERE id = ?').bind('financeiro').first();
  assert.deepEqual({ ...p, abas: JSON.parse(p.abas) }, { id: 'financeiro', nome: 'Financeiro', abas: ['visao', 'vendas'], ver_valores: 1 });
  const [a] = await linhasAuditoria(db);
  assert.equal(a.acao, 'perfil.criar');
  assert.equal(a.alvo, 'financeiro');
  assert.equal(a.antes, null);
  assert.equal((await pedir(db, 'POST', '/api/admin/perfis', perfis, { corpo })).status, 409);
  const ruins = [
    { ...corpo, id: 'Fin' }, { ...corpo, id: '1fin' }, { ...corpo, id: 'f' }, { ...corpo, id: 'f'.repeat(32) },
    { ...corpo, abas: ['visao', 'visao'] }, { ...corpo, abas: ['cpf'] }, { ...corpo, abas: 'visao' },
    { ...corpo, ver_valores: 1 }, { ...corpo, nome: '' }, { id: 'outro', nome: 'Outro', abas: [] }, { ...corpo, id: 'novo2', x: 1 },
  ];
  for (const c of ruins) assert.equal((await pedir(db, 'POST', '/api/admin/perfis', perfis, { corpo: c })).status, 400, JSON.stringify(c));
  assert.equal((await linhasAuditoria(db)).length, 1);
});

test('PATCH perfil inexistente → 404, nada gravado', async () => {
  const db = await banco();
  const r = await pedir(db, 'PATCH', '/api/admin/perfis/x', perfil, { params: { id: 'nao-existe' }, corpo: { nome: 'X' } });
  assert.equal(r.status, 404);
  assert.equal(r.corpo.erro, 'nao-encontrado');
  assert.equal((await linhasAuditoria(db)).length, 0);
});

test('PATCH perfil: reflete na permissão do usuário na próxima requisição (mesmo isolate)', async () => {
  const db = await banco();
  const env = { SUPER_ADMIN: SUPER };
  assert.ok(!(await carregarEu(db, 'ana@exemplo.com', env)).abas.includes('vendas')); // entra no cache
  const r = await pedir(db, 'PATCH', '/api/admin/perfis/compras', perfil, {
    params: { id: 'compras' }, corpo: { abas: ['visao', 'vendas'], ver_valores: true },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.corpo.abas, ['visao', 'vendas']);
  const ana = await carregarEu(db, 'ana@exemplo.com', env);
  assert.deepEqual(ana.abas, ['visao', 'vendas']);
  assert.equal(ana.verValores, true);
  const [a] = await linhasAuditoria(db);
  assert.equal(a.acao, 'perfil.editar');
  assert.equal(JSON.parse(a.antes).ver_valores, 0);
  assert.equal(JSON.parse(a.depois).ver_valores, 1);
  for (const corpo of [{ abas: ['x'] }, { ver_valores: 'sim' }, {}, { id: 'outro' }]) {
    assert.equal((await pedir(db, 'PATCH', '/x', perfil, { params: { id: 'compras' }, corpo })).status, 400);
  }
});

// ---------- auditoria ----------

async function bancoComAuditoria() {
  const db = await banco();
  const ins = 'INSERT INTO auditoria (quando, quem, acao, alvo, antes, depois) VALUES (?,?,?,?,?,?)';
  for (let i = 0; i < 55; i++) {
    const dia = String((i % 28) + 1).padStart(2, '0');
    const quem = i % 2 ? ADMIN : SUPER;
    await db.prepare(ins).bind(`2026-10-${dia}T12:00:${String(i).padStart(2, '0')}.000Z`, quem, 'usuario.editar',
      i % 5 ? 'ana@exemplo.com' : 'caio@exemplo.com', '{"a":1}', '{"a":2}').run();
  }
  return db;
}

test('GET auditoria: paginação, mais recentes primeiro, JSON lido', async () => {
  const db = await bancoComAuditoria();
  const p1 = await pedir(db, 'GET', '/api/admin/auditoria', auditoria);
  assert.equal(p1.status, 200);
  assert.equal(p1.corpo.total, 55);
  assert.equal(p1.corpo.pagina, 1);
  assert.equal(p1.corpo.porPagina, 50);
  assert.equal(p1.corpo.itens.length, 50);
  const q = p1.corpo.itens.map((i) => i.quando);
  assert.deepEqual(q, [...q].sort().reverse());
  assert.deepEqual(p1.corpo.itens[0].antes, { a: 1 });
  const p2 = await pedir(db, 'GET', '/api/admin/auditoria?pagina=2', auditoria);
  assert.equal(p2.corpo.itens.length, 5);
  for (const ruim of ['pagina=0', 'pagina=x', 'de=2026-13-01', 'ate=ontem']) {
    assert.equal((await pedir(db, 'GET', `/api/admin/auditoria?${ruim}`, auditoria)).status, 400, ruim);
  }
});

test('GET auditoria filtra por quem, alvo e período', async () => {
  const db = await bancoComAuditoria();
  const quem = await pedir(db, 'GET', `/api/admin/auditoria?quem=${encodeURIComponent(' BIA@Exemplo.com')}`, auditoria);
  assert.equal(quem.corpo.total, 27);
  assert.ok(quem.corpo.itens.every((i) => i.quem === ADMIN));
  const alvo = await pedir(db, 'GET', '/api/admin/auditoria?alvo=caio@exemplo.com', auditoria);
  assert.equal(alvo.corpo.total, 11);
  const per = await pedir(db, 'GET', '/api/admin/auditoria?de=2026-10-02&ate=2026-10-03', auditoria);
  assert.ok(per.corpo.total > 0);
  assert.ok(per.corpo.itens.every((i) => i.quando >= '2026-10-02' && i.quando < '2026-10-04'));
  assert.equal(per.corpo.total, 4);
  const injecao = await pedir(db, 'GET', `/api/admin/auditoria?quem=${encodeURIComponent("x' OR 1=1 --")}`, auditoria);
  assert.equal(injecao.corpo.total, 0);
});
