import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/_middleware.js';
import { limparCacheUsuarios, CAMPOS_VALOR } from '../functions/_lib/permissoes.js';
import { hojeLocal, dadosAte } from '../functions/_lib/consultas.js';
import * as eu from '../functions/api/eu.js';
import * as opcoes from '../functions/api/opcoes.js';
import * as resumo from '../functions/api/vendas/resumo.js';
import * as serie from '../functions/api/vendas/serie.js';
import * as quebra from '../functions/api/vendas/quebra.js';
import * as produtos from '../functions/api/vendas/produtos.js';
import * as clientes from '../functions/api/clientes.js';
import * as visao from '../functions/api/visao.js';
import { criarD1Falso } from './d1-falso.mjs';
import { registrarColeta } from '../coletores/coletar-pedidos.mjs';

// ---------- fixture fictícia (centavos distintos, impossíveis de confundir com contagens) ----------

const it = (sku, nome, marca, categoria, qtd, valor) => ({ sku, nome, marca, categoria, qtd, valor });
const A1 = (q, v) => it('A1', 'Curativo adesivo', 'A', 'Curativos', q, v);
const A2 = (q, v) => it('A2', 'Luva de procedimento', 'A', 'Luvas', q, v);
const B1 = (q, v) => it('B1', 'Seringa 10 ml', 'B', 'Seringas', q, v);
const B2 = (q, v) => it('B2', 'Seringa 5 ml', 'B', 'Seringas', q, v);

// [id, dia, origem, pagamento, uf, cidade, entrega, cliente_tipo, frete, itens, extra]
const PEDIDOS = [
  ['p01', '2026-03-01', 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1501, [A1(2, 123457)]],
  ['p02', '2026-03-01', 'Sem UTM', 'cartao', 'RJ', 'Niterói', 'entrega', 'recorrente', 2203, [B1(1, 98765)]],
  ['p03', '2026-03-01', 'Marketplace', 'boleto', 'SP', 'São Paulo', 'entrega', null, 3307, [A2(3, 45671), B1(1, 98713)]],
  ['p04', '2026-03-02', 'Google Ads', 'pix', 'MG', 'Belo Horizonte', 'entrega', 'novo', 1109, [A1(1, 61237)]],
  ['p05', '2026-03-02', 'Google Ads', 'cartao', 'SP', 'Campinas', 'entrega', 'recorrente', 1999, [B2(4, 77731)]],
  ['p06', '2026-03-02', 'Sem UTM', 'pix', 'SP', 'Santos', 'entrega', 'novo', 2711, [A2(2, 33397)]],
  ['p07', '2026-03-03', 'Marketplace', 'cartao', 'RJ', 'Rio de Janeiro', 'entrega', null, 1871, [B2(1, 54329)]],
  ['p08', '2026-03-03', 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1433, [it('A3', 'Gaze 50% algodão', 'A', 'Curativos', 1, 27191)]],
  ['p09', '2026-03-03', 'Sem UTM', 'boleto', 'SP', 'Santos', 'entrega', 'recorrente', 2557, [it('A4', 'Gaze 500 unidades', 'A', 'Curativos', 1, 39163)]],
  ['p10', '2026-03-05', 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1667, [B1(2, 187319)]],
  ['p11', '2026-03-05', 'Sem UTM', 'pix', 'RJ', 'Niterói', 'entrega', 'indefinido', 1201, [A1(1, 58943)]],
  ['p12', '2026-03-05', 'Marketplace', 'pix', 'SP', 'São Paulo', 'entrega', null, 2099, [A2(1, 71129)]],
  ['p13', '2026-03-05', 'Google Ads', 'cartao', 'SP', 'Campinas', 'entrega', 'recorrente', 10231, [A1(5, 903347)], { cancelado: 1 }],
  ['p14', '2026-03-06', 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1381, [A1(1, 66851)]],
  ['p15', '2026-03-06', 'Sem UTM', 'pix', 'RJ', 'Rio de Janeiro', 'retirada', 'recorrente', 0, [B2(2, 84463)]],
  ['p16', '2026-03-06', 'Marketplace', 'cartao', 'MG', 'Belo Horizonte', 'entrega', null, 2441, [B1(1, 92347)]],
  ['p17', '2026-03-07', 'Google Ads', 'pix', 'SP', 'Santos', 'entrega', 'novo', 1777, [A2(2, 49157), B2(1, 36541)]],
  ['p18', '2026-03-07', 'Sem UTM', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1553, [A1(1, 52783)]],
  ['p19', '2026-03-07', 'Google Ads', 'boleto', 'RJ', 'Rio de Janeiro', 'entrega', 'recorrente', 2963, [B1(3, 112589)]],
  ['p20', '2026-03-07', 'Marketplace', 'pix', 'SP', 'São Paulo', 'entrega', null, 1123, [A1(1, 43577)]],
  // período de comparação "anterior" (22–28/02)
  ['c01', '2026-02-22', 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1299, [A1(1, 57193)]],
  ['c02', '2026-02-24', 'Sem UTM', 'pix', 'SP', 'Campinas', 'entrega', 'recorrente', 1847, [B1(1, 81239)]],
  ['c03', '2026-02-28', 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1361, [A2(1, 63541)]],
];

// abril: 12 origens para testar top 10 + outros
const ABRIL = Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return [`q${n}`, '2026-04-01', `Origem ${n}`, 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1000 + i, [A1(1, 100003 + i * 11113)]];
});

const linha = (p) => {
  const [id, dia, origem, pagamento, uf, cidade, entrega, tipo, frete, itens, extra = {}] = p;
  const valor = frete + itens.reduce((s, i) => s + i.valor, 0);
  const canal = origem === 'Marketplace' ? 'Canal 2' : 'Site';
  return { id, dia, origem, pagamento, uf, cidade, entrega, tipo, frete, itens, valor, canal, cancelado: extra.cancelado ?? 0 };
};
const TODOS = [...PEDIDOS, ...ABRIL].map(linha);
const CENTAVOS = new Set(TODOS.flatMap((p) => [p.valor, p.frete, ...p.itens.map((i) => i.valor)]).filter((v) => v >= 1000));

async function inserirPedidos(db, lista) {
  const ip = `INSERT INTO pedidos (id, dia, criado, status, cancelado, valor, frete, desconto, canal, origem, pagamento,
    uf, cidade, entrega, cliente_tipo, atualizado) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const ii = 'INSERT INTO itens (pedido_id, sku, nome, marca, categoria, qtd, valor) VALUES (?,?,?,?,?,?,?)';
  for (const p of lista) {
    await db.prepare(ip).bind(p.id, p.dia, `${p.dia}T15:00:00.000Z`, p.cancelado ? 'canceled' : 'invoiced', p.cancelado,
      p.valor, p.frete, 0, p.canal, p.origem, p.pagamento, p.uf, p.cidade, p.entrega, p.tipo, '2026-03-08T00:00:00Z').run();
    for (const i of p.itens) await db.prepare(ii).bind(p.id, i.sku, i.nome, i.marca, i.categoria, i.qtd, i.valor).run();
  }
}

async function banco() {
  const db = await criarD1Falso();
  await inserirPedidos(db, TODOS);
  const iu = 'INSERT INTO usuarios (email, nome, perfil, ajustes, admin, ativo) VALUES (?,?,?,?,?,1)';
  await db.prepare(iu).bind('gestao@exemplo.com', 'Gê', 'gestao', null, 0).run();
  await db.prepare(iu).bind('compras@exemplo.com', 'Cris', 'compras', null, 0).run();
  await db.prepare(iu).bind('mkt@exemplo.com', 'Mari', 'marketing', JSON.stringify({ ver_valores: false }), 0).run();
  await db.prepare(iu).bind('nada@exemplo.com', 'Nadia', 'compras', JSON.stringify({ abas: { visao: false } }), 0).run();
  const ic = 'INSERT INTO coletas (fonte, quando, ok, registros, erro) VALUES (?,?,?,?,?)';
  await db.prepare(ic).bind('pedidos', '2026-03-08T03:00:00.000Z', 1, 23, null).run();
  await db.prepare(ic).bind('carga:2026-01', '2026-03-01T03:00:00.000Z', 1, 10, null).run();
  return db;
}

const L = 'http://localhost:8788';

async function pedir(db, rota, handler, { email = 'gestao@exemplo.com', env = {} } = {}) {
  const ctx = {
    request: new Request(`${L}${rota}`),
    env: { DB: db, DEV_EMAIL: email, SUPER_ADMIN: 'chefe@exemplo.com', ...env },
    data: {},
    params: {},
    waitUntil: () => {},
  };
  ctx.next = () => handler.onRequestGet(ctx);
  const r = await onRequest(ctx);
  return { status: r.status, corpo: await r.json() };
}

const soma = (lista, f) => lista.reduce((s, x) => s + f(x), 0);
const MARCO = TODOS.filter((p) => p.dia >= '2026-03-01' && p.dia <= '2026-03-07');
const MARCO_OK = MARCO.filter((p) => !p.cancelado);
const PERIODO = 'de=2026-03-01&ate=2026-03-07';

beforeEach(() => limparCacheUsuarios());

// ---------- utilitários ----------

test('hojeLocal usa FUSO_HORAS (padrão -3)', () => {
  const agora = Date.parse('2026-11-13T02:30:00Z');
  assert.equal(hojeLocal({}, agora), '2026-11-12');
  assert.equal(hojeLocal({ FUSO_HORAS: '0' }, agora), '2026-11-13');
  assert.equal(hojeLocal({ FUSO_HORAS: 'x' }, agora), '2026-11-12');
});

test('dadosAte: só coleta ok', async () => {
  const db = await banco();
  assert.equal(await dadosAte(db, 'pedidos'), '2026-03-08T03:00:00.000Z');
  await db.prepare('UPDATE coletas SET ok = 0 WHERE fonte = ?').bind('pedidos').run();
  assert.equal(await dadosAte(db, 'pedidos'), null);
  assert.equal(await dadosAte(db, 'estoque'), null);
});

// ---------- /api/vendas/resumo ----------

test('resumo: soma manual, exclui cancelado, comparação anterior', async () => {
  const db = await banco();
  const { status, corpo } = await pedir(db, `/api/vendas/resumo?${PERIODO}`, resumo);
  assert.equal(status, 200);
  const valor = soma(MARCO_OK, (p) => p.valor);
  assert.deepEqual(corpo.atual, { valor, pedidos: 19, ticket: Math.round(valor / 19), cancelados: 1 });
  const cmp = soma(TODOS.filter((p) => p.id.startsWith('c')), (p) => p.valor);
  assert.deepEqual(corpo.cmp, { valor: cmp, pedidos: 3, ticket: Math.round(cmp / 3), cancelados: 0 });
  assert.equal(corpo.porItens, false);
  assert.equal(corpo.dadosAte, '2026-03-08T03:00:00.000Z');
  const sem = await pedir(db, `/api/vendas/resumo?${PERIODO}&cmp=nenhum`, resumo);
  assert.equal(sem.corpo.cmp, null);
});

test('resumo com marca=A: soma dos itens da marca (sem frete) e porItens', async () => {
  const db = await banco();
  const { corpo } = await pedir(db, `/api/vendas/resumo?${PERIODO}&marca=A`, resumo);
  const comA = MARCO_OK.filter((p) => p.itens.some((i) => i.marca === 'A'));
  const valor = soma(comA, (p) => soma(p.itens.filter((i) => i.marca === 'A'), (i) => i.valor));
  assert.equal(corpo.porItens, true);
  assert.equal(corpo.atual.valor, valor);
  assert.equal(corpo.atual.pedidos, comA.length);
  assert.equal(corpo.atual.cancelados, 1);
  // combinação com filtro de pedido
  const r2 = await pedir(db, `/api/vendas/resumo?${PERIODO}&marca=A&origem=Marketplace`, resumo);
  const mk = comA.filter((p) => p.origem === 'Marketplace');
  assert.equal(r2.corpo.atual.pedidos, mk.length);
  assert.equal(r2.corpo.atual.valor, soma(mk, (p) => soma(p.itens.filter((i) => i.marca === 'A'), (i) => i.valor)));
});

test('resumo: período sem pedidos → zeros e dadosAte', async () => {
  const db = await banco();
  const { status, corpo } = await pedir(db, '/api/vendas/resumo?de=2026-05-01&ate=2026-05-03', resumo);
  assert.equal(status, 200);
  assert.deepEqual(corpo.atual, { valor: 0, pedidos: 0, ticket: 0, cancelados: 0 });
  assert.deepEqual(corpo.cmp, { valor: 0, pedidos: 0, ticket: 0, cancelados: 0 });
  assert.equal(corpo.dadosAte, '2026-03-08T03:00:00.000Z');
});

test('resumo: marketing sem R$ por ajuste recebe pedidos mas não valor', async () => {
  const db = await banco();
  const { status, corpo } = await pedir(db, `/api/vendas/resumo?${PERIODO}`, resumo, { email: 'mkt@exemplo.com' });
  assert.equal(status, 200);
  assert.equal(corpo.atual.pedidos, 19);
  assert.ok(!('valor' in corpo.atual));
  assert.ok(!('ticket' in corpo.atual));
});

test('resumo: compras sem aba vendas → 403; filtro inválido → 400', async () => {
  const db = await banco();
  assert.equal((await pedir(db, '/api/vendas/resumo', resumo, { email: 'compras@exemplo.com' })).status, 403);
  const r = await pedir(db, '/api/vendas/resumo?de=2026-02-30', resumo);
  assert.equal(r.status, 400);
  assert.equal(r.corpo.erro, 'filtro-invalido');
});

// ---------- /api/vendas/serie ----------

test('série: um ponto por dia, dia vazio com zeros, comparação alinhada', async () => {
  const db = await banco();
  const { corpo } = await pedir(db, `/api/vendas/serie?${PERIODO}`, serie);
  assert.equal(corpo.pontos.length, 7);
  assert.deepEqual(corpo.pontos.map((p) => p.dia), ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05', '2026-03-06', '2026-03-07']);
  const d1 = MARCO_OK.filter((p) => p.dia === '2026-03-01');
  const c01 = TODOS.find((p) => p.id === 'c01');
  assert.deepEqual(corpo.pontos[0], { dia: '2026-03-01', valor: soma(d1, (p) => p.valor), pedidos: 3, cmpDia: '2026-02-22', cmpValor: c01.valor, cmpPedidos: 1 });
  assert.deepEqual(corpo.pontos[3], { dia: '2026-03-04', valor: 0, pedidos: 0, cmpDia: '2026-02-25', cmpValor: 0, cmpPedidos: 0 });
  assert.equal(corpo.pontos[2].cmpDia, '2026-02-24');
  assert.equal(corpo.pontos[2].cmpPedidos, 1);
  assert.equal(corpo.pontos[4].pedidos, 3, 'cancelado fora');
  assert.equal(corpo.dadosAte, '2026-03-08T03:00:00.000Z');

  const ano = await pedir(db, `/api/vendas/serie?${PERIODO}&cmp=ano`, serie);
  assert.equal(ano.corpo.pontos[0].cmpDia, '2025-03-01');
  assert.equal(ano.corpo.pontos[0].cmpValor, 0);
  const nenhum = await pedir(db, `/api/vendas/serie?${PERIODO}&cmp=nenhum`, serie);
  assert.deepEqual(nenhum.corpo.pontos[0].cmpDia, null);
  assert.deepEqual(nenhum.corpo.pontos[0].cmpPedidos, null);
});

test('série: período vazio → zeros', async () => {
  const db = await banco();
  const { corpo } = await pedir(db, '/api/vendas/serie?de=2026-05-01&ate=2026-05-03', serie);
  assert.equal(corpo.pontos.length, 3);
  assert.ok(corpo.pontos.every((p) => p.valor === 0 && p.pedidos === 0));
});

// ---------- /api/vendas/quebra ----------

test('quebra por origem: ordena por valor', async () => {
  const db = await banco();
  const { status, corpo } = await pedir(db, `/api/vendas/quebra?${PERIODO}&por=origem`, quebra);
  assert.equal(status, 200);
  assert.equal(corpo.por, 'origem');
  const esperado = ['Google Ads', 'Sem UTM', 'Marketplace']
    .map((o) => ({ chave: o, valor: soma(MARCO_OK.filter((p) => p.origem === o), (p) => p.valor), pedidos: MARCO_OK.filter((p) => p.origem === o).length }))
    .sort((a, b) => b.valor - a.valor);
  assert.deepEqual(corpo.itens.map(({ chave, valor, pedidos }) => ({ chave, valor, pedidos })), esperado);
  const ga = corpo.itens.find((i) => i.chave === 'Google Ads');
  assert.equal(ga.cmpPedidos, 2);
  assert.deepEqual(corpo.outros, { valor: 0, pedidos: 0 });
});

test('quebra: top 10 e o resto em outros', async () => {
  const db = await banco();
  const { corpo } = await pedir(db, '/api/vendas/quebra?de=2026-04-01&ate=2026-04-01&por=origem', quebra);
  const abril = TODOS.filter((p) => p.dia === '2026-04-01').sort((a, b) => b.valor - a.valor);
  assert.equal(corpo.itens.length, 10);
  assert.deepEqual(corpo.itens.map((i) => i.chave), abril.slice(0, 10).map((p) => p.origem));
  assert.deepEqual(corpo.outros, { valor: soma(abril.slice(10), (p) => p.valor), pedidos: 2 });
  assert.equal(corpo.itens[0].cmpPedidos, 0);
});

test('quebra por marca soma itens; sem R$ ordena por pedidos', async () => {
  const db = await banco();
  const { corpo } = await pedir(db, `/api/vendas/quebra?${PERIODO}&por=marca`, quebra);
  const somaMarca = (m) => soma(MARCO_OK, (p) => soma(p.itens.filter((i) => i.marca === m), (i) => i.valor));
  const porMarca = Object.fromEntries(corpo.itens.map((i) => [i.chave, i]));
  assert.equal(porMarca.A.valor, somaMarca('A'));
  assert.equal(porMarca.B.valor, somaMarca('B'));
  const mkt = await pedir(db, `/api/vendas/quebra?${PERIODO}&por=uf`, quebra, { email: 'mkt@exemplo.com' });
  const pedidos = mkt.corpo.itens.map((i) => i.pedidos);
  assert.deepEqual(pedidos, [...pedidos].sort((a, b) => b - a));
  assert.equal(mkt.corpo.itens[0].chave, 'SP');
});

test('quebra: por inválido → 400', async () => {
  const db = await banco();
  const r = await pedir(db, `/api/vendas/quebra?${PERIODO}&por=cpf`, quebra);
  assert.equal(r.status, 400);
  assert.equal((await pedir(db, `/api/vendas/quebra?${PERIODO}`, quebra)).status, 400);
});

// ---------- /api/vendas/produtos ----------

test('produtos: busca com % literal, ordem e paginação', async () => {
  const db = await banco();
  const { corpo } = await pedir(db, `/api/vendas/produtos?${PERIODO}&busca=${encodeURIComponent('50%')}`, produtos);
  assert.deepEqual(corpo.itens.map((i) => i.sku), ['A3']);
  assert.equal(corpo.total, 1);
  const sub = await pedir(db, `/api/vendas/produtos?${PERIODO}&busca=Gaze_5`, produtos);
  assert.equal(sub.corpo.total, 0, '_ não é curinga');

  const todos = await pedir(db, `/api/vendas/produtos?${PERIODO}`, produtos);
  assert.equal(todos.corpo.pagina, 1);
  assert.equal(todos.corpo.porPagina, 50);
  assert.equal(todos.corpo.total, 6);
  const b1 = todos.corpo.itens.find((i) => i.sku === 'B1');
  const b1Itens = MARCO_OK.flatMap((p) => p.itens.filter((i) => i.sku === 'B1'));
  assert.deepEqual(b1, { sku: 'B1', nome: 'Seringa 10 ml', marca: 'B', categoria: 'Seringas', qtd: soma(b1Itens, (i) => i.qtd), valor: soma(b1Itens, (i) => i.valor), pedidos: b1Itens.length });
  const valores = todos.corpo.itens.map((i) => i.valor);
  assert.deepEqual(valores, [...valores].sort((a, b) => b - a));
  const qtd = await pedir(db, `/api/vendas/produtos?${PERIODO}&ordem=qtd`, produtos);
  const q = qtd.corpo.itens.map((i) => i.qtd);
  assert.deepEqual(q, [...q].sort((a, b) => b - a));
  const p2 = await pedir(db, `/api/vendas/produtos?${PERIODO}&pagina=2`, produtos);
  assert.deepEqual(p2.corpo.itens, []);
  assert.equal(p2.corpo.total, 6);
  assert.equal((await pedir(db, `/api/vendas/produtos?${PERIODO}&ordem=nome`, produtos)).status, 400);
  assert.equal((await pedir(db, `/api/vendas/produtos?${PERIODO}&pagina=0`, produtos)).status, 400);
});

// ---------- /api/vendas/produtos?modo=subiram|caiu ----------

const PV = 'de=2026-05-08&ate=2026-05-14&cmp=anterior';
const pick = (o, chaves) => Object.fromEntries(chaves.map((k) => [k, o[k]]));

// comparação 01–07/05, atual 08–14/05; um item por pedido
function pedidosVariacao() {
  const lista = [];
  let n = 0;
  const add = (dia, sku, marca, qtd, valor, extra) => {
    n += 1;
    lista.push([`v${String(n).padStart(3, '0')}`, dia, 'Sem UTM', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 0,
      [it(sku, `Produto ${sku}`, marca, 'Cat', qtd, valor)], extra]);
  };
  const vezes = (k, dia, sku, marca, qtd, valor) => { for (let i = 0; i < k; i++) add(dia, sku, marca, qtd, valor); };
  vezes(3, '2026-05-02', 'S1', 'A', 1, 1000);
  add('2026-05-09', 'S1', 'A', 3, 3300); add('2026-05-10', 'S1', 'A', 1, 1100);
  add('2026-05-11', 'S1', 'A', 1, 1100); add('2026-05-12', 'S1', 'A', 1, 1100);
  vezes(4, '2026-05-03', 'S2', 'A', 1, 1000);
  add('2026-05-09', 'S2', 'A', 1, 1000);
  add('2026-05-10', 'S2', 'A', 10, 10000, { cancelado: 1 });
  vezes(3, '2026-05-04', 'S3', 'B', 1, 1000);
  vezes(2, '2026-05-05', 'S4', 'A', 1, 1000);
  vezes(5, '2026-05-12', 'S4', 'A', 1, 1000);
  vezes(5, '2026-05-13', 'S5', 'A', 1, 1000);
  vezes(3, '2026-05-06', 'S6', 'B', 1, 1000);
  vezes(3, '2026-05-13', 'S6', 'B', 1, 1000);
  return lista.map(linha);
}

async function bancoVariacao() {
  const db = await banco();
  await inserirPedidos(db, pedidosVariacao());
  return db;
}

test('produtos modo=subiram: só quem subiu com 3+ pedidos antes', async () => {
  const { corpo } = await pedir(await bancoVariacao(), `/api/vendas/produtos?${PV}&modo=subiram`, produtos);
  assert.deepEqual(corpo.itens.map((i) => i.sku), ['S1']);
  assert.equal(corpo.total, 1);
  assert.deepEqual(
    pick(corpo.itens[0], ['qtd', 'qtdAntes', 'pedidos', 'varQtd', 'varPreco', 'valor']),
    { qtd: 6, qtdAntes: 3, pedidos: 4, varQtd: 100, varPreco: 10, valor: 6600 },
  );
});

test('produtos modo=caiu: ordem por queda, inclui quem zerou', async () => {
  const { corpo } = await pedir(await bancoVariacao(), `/api/vendas/produtos?${PV}&modo=caiu`, produtos);
  assert.deepEqual(corpo.itens.map((i) => [i.sku, i.varQtd, i.varPreco]), [['S3', -100, null], ['S2', -75, 0]]);
  assert.equal(corpo.itens[0].qtd, 0);
  assert.equal(corpo.itens[0].nome, 'Produto S3');
});

test('produtos modo novo respeita filtro de marca nos dois períodos', async () => {
  const { corpo } = await pedir(await bancoVariacao(), `/api/vendas/produtos?${PV}&modo=caiu&marca=B`, produtos);
  assert.deepEqual(corpo.itens.map((i) => i.sku), ['S3']);
});

test('produtos modo novo com busca, cmp=nenhum e modo inválido', async () => {
  const db = await bancoVariacao();
  assert.deepEqual((await pedir(db, `/api/vendas/produtos?${PV}&modo=caiu&busca=S2`, produtos)).corpo.itens.map((i) => i.sku), ['S2']);
  const sem = await pedir(db, '/api/vendas/produtos?de=2026-05-08&ate=2026-05-14&cmp=nenhum&modo=subiram', produtos);
  assert.equal(sem.status, 200);
  assert.equal(sem.corpo.semComparacao, true);
  assert.deepEqual(sem.corpo.itens, []);
  assert.equal(sem.corpo.total, 0);
  assert.equal((await pedir(db, `/api/vendas/produtos?${PV}&modo=outro`, produtos)).status, 400);
});

test('produtos modo novo sem R$ não traz valor nem varPreco', async () => {
  const { corpo } = await pedir(await bancoVariacao(), `/api/vendas/produtos?${PV}&modo=subiram`, produtos, { email: 'mkt@exemplo.com' });
  assert.equal('valor' in corpo.itens[0], false);
  assert.equal('varPreco' in corpo.itens[0], false);
  assert.equal(corpo.itens[0].varQtd, 100);
});

// ---------- /api/clientes ----------

test('clientes: só canal Site, novos x recorrentes, por origem e semana', async () => {
  const db = await banco();
  const { status, corpo } = await pedir(db, `/api/clientes?${PERIODO}`, clientes);
  assert.equal(status, 200);
  const site = MARCO_OK.filter((p) => p.canal === 'Site');
  const grupo = (t) => site.filter((p) => (p.tipo ?? 'indefinido') === t);
  for (const t of ['novo', 'recorrente', 'indefinido']) {
    assert.deepEqual(corpo[t], { pedidos: grupo(t).length, valor: soma(grupo(t), (p) => p.valor) });
  }
  const n = grupo('novo').length;
  const r = grupo('recorrente').length;
  assert.equal(corpo.pctNovos, Math.round((n / (n + r)) * 1000) / 10);
  assert.ok(!corpo.porOrigem.some((o) => o.origem === 'Marketplace'));
  const ga = corpo.porOrigem.find((o) => o.origem === 'Google Ads');
  assert.deepEqual(ga, { origem: 'Google Ads', novo: 6, recorrente: 2 });
  // 01/03/2026 é domingo: semanas começam em 23/02 e 02/03
  assert.deepEqual(corpo.porSemana.map((s) => s.inicio), ['2026-02-23', '2026-03-02']);
  assert.equal(soma(corpo.porSemana, (s) => s.novo), n);
  assert.deepEqual(corpo.cmp, { pctNovos: 66.7 });
  assert.equal((await pedir(db, '/api/clientes', clientes, { email: 'compras@exemplo.com' })).status, 403);
  const vazio = await pedir(db, '/api/clientes?de=2026-05-01&ate=2026-05-03&cmp=nenhum', clientes);
  assert.equal(vazio.corpo.pctNovos, 0);
  assert.equal(vazio.corpo.cmp, null);
});

// ---------- /api/visao ----------

test('visão: compras (sem R$, sem vendas) não recebe cartoes.vendas nem valor', async () => {
  const db = await banco();
  const { status, corpo } = await pedir(db, `/api/visao?${PERIODO}`, visao, { email: 'compras@exemplo.com' });
  assert.equal(status, 200);
  assert.ok(!('vendas' in corpo.cartoes));
  assert.ok(!('clientes' in corpo.cartoes));
  assert.ok(!JSON.stringify(corpo).includes('"valor"'));
  assert.ok(Array.isArray(corpo.alertas));
});

test('visão: gestão recebe cartões com delta', async () => {
  const db = await banco();
  const { corpo } = await pedir(db, `/api/visao?${PERIODO}`, visao);
  const valor = soma(MARCO_OK, (p) => p.valor);
  const cmp = soma(TODOS.filter((p) => p.id.startsWith('c')), (p) => p.valor);
  assert.equal(corpo.cartoes.vendas.valor, valor);
  assert.equal(corpo.cartoes.vendas.pedidos, 19);
  assert.equal(corpo.cartoes.vendas.ticket, Math.round(valor / 19));
  assert.equal(corpo.cartoes.vendas.delta, Math.round(((valor - cmp) / cmp) * 1000) / 10);
  assert.equal(corpo.cartoes.clientes.novos, 8);
  assert.equal(typeof corpo.cartoes.clientes.pctNovos, 'number');
  const mkt = await pedir(db, `/api/visao?${PERIODO}`, visao, { email: 'mkt@exemplo.com' });
  assert.equal(mkt.corpo.cartoes.vendas.delta, Math.round(((19 - 3) / 3) * 1000) / 10, 'sem R$: delta de pedidos');
});

// banco com 1 pedido ontem x 2 no mesmo dia da semana anterior (queda de 50 %)
async function bancoQueda(quandoColeta) {
  const db = await criarD1Falso();
  const hoje = hojeLocal({});
  const menos = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
  const ontem = menos(hoje, 1);
  const semana = menos(ontem, 7);
  await inserirPedidos(db, [
    linha(['o1', ontem, 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1000, [A1(1, 40009)]]),
    linha(['s1', semana, 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1000, [A1(1, 40009)]]),
    linha(['s2', semana, 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1000, [A1(1, 40009)]]),
  ]);
  await db.prepare("INSERT INTO usuarios (email, nome, perfil, ajustes, admin, ativo) VALUES ('gestao@exemplo.com','Gê','gestao',NULL,0,1)").run();
  await db.prepare("INSERT INTO usuarios (email, nome, perfil, ajustes, admin, ativo) VALUES ('compras@exemplo.com','Cris','compras',NULL,0,1)").run();
  await db.prepare("INSERT INTO usuarios (email, nome, perfil, ajustes, admin, ativo) VALUES ('mkt@exemplo.com','Mari','marketing','{\"ver_valores\":false}',0,1)").run();
  if (quandoColeta) await db.prepare('INSERT INTO coletas (fonte, quando, ok, registros) VALUES (?,?,1,1)').bind('pedidos', quandoColeta).run();
  return { db, hoje };
}

// meia-noite local (fuso -3) de hoje, em ISO UTC, deslocada em minutos
const meiaNoiteLocal = (hoje, minutos) => new Date(Date.parse(`${hoje}T00:00:00Z`) + 3 * 3600000 + minutos * 60000).toISOString();

test('visão: alertas de coleta atrasada ou ausente', async () => {
  const { db } = await bancoQueda(new Date(Date.now() - 5 * 3600000).toISOString());
  const env = { AGENDA_JSON: JSON.stringify({ pedidos: { horasMax: 3 }, estoque: { horasMax: 24 } }) };
  const { corpo } = await pedir(db, '/api/visao', visao, { env });
  const coleta = corpo.alertas.filter((a) => a.aba === 'visao');
  assert.equal(coleta.length, 2, JSON.stringify(corpo.alertas));
  assert.ok(coleta.every((a) => a.nivel === 'aviso'));
  assert.ok(coleta.some((a) => a.texto.includes('pedidos')) && coleta.some((a) => a.texto.includes('estoque')));
  const ok = await pedir(db, '/api/visao', visao, { env: { AGENDA_JSON: JSON.stringify({ pedidos: { horasMax: 6 } }) } });
  assert.ok(!ok.corpo.alertas.some((a) => a.aba === 'visao'));
  const ruim = await pedir(db, '/api/visao', visao, { env: { AGENDA_JSON: '{x' } });
  assert.equal(ruim.status, 200);
});

test('visão: queda de ontem com ontem já coletado (loja toda, sem filtros da tela)', async () => {
  const { db, hoje } = await bancoQueda(null);
  await db.prepare('INSERT INTO coletas (fonte, quando, ok, registros) VALUES (?,?,1,1)').bind('pedidos', meiaNoiteLocal(hoje, 1)).run();
  const { corpo } = await pedir(db, '/api/visao', visao);
  const queda = corpo.alertas.find((a) => a.aba === 'vendas');
  assert.ok(queda, JSON.stringify(corpo.alertas));
  assert.equal(queda.nivel, 'aviso');
  assert.match(queda.texto, /^Vendas de ontem 50% abaixo/);
  assert.ok(corpo.alertas.every((a) => !a.texto.includes('R$')));
  // filtro da tela que zera tudo não muda o alerta
  const filtrado = await pedir(db, '/api/visao?origem=Inexistente', visao);
  assert.ok(filtrado.corpo.alertas.some((a) => a.aba === 'vendas'));
  // sem R$: compara pedidos
  const mkt = await pedir(db, '/api/visao', visao, { email: 'mkt@exemplo.com' });
  assert.match(mkt.corpo.alertas.find((a) => a.aba === 'vendas').texto, /^Pedidos de ontem 50% abaixo/);
  // compras não tem aba vendas
  const c = await pedir(db, '/api/visao', visao, { email: 'compras@exemplo.com' });
  assert.ok(!c.corpo.alertas.some((a) => a.aba === 'vendas'));
});

test('visão: sem alerta de queda se ontem não foi coletado por inteiro', async () => {
  const antes = await bancoQueda(null);
  await antes.db.prepare('INSERT INTO coletas (fonte, quando, ok, registros) VALUES (?,?,1,1)').bind('pedidos', meiaNoiteLocal(antes.hoje, -1)).run();
  const r = await pedir(antes.db, '/api/visao', visao);
  assert.ok(!r.corpo.alertas.some((a) => a.aba === 'vendas'), JSON.stringify(r.corpo.alertas));
  const nunca = await bancoQueda(null);
  assert.ok(!(await pedir(nunca.db, '/api/visao', visao)).corpo.alertas.some((a) => a.aba === 'vendas'));
  const falhou = await bancoQueda(null);
  await falhou.db.prepare('INSERT INTO coletas (fonte, quando, ok, registros) VALUES (?,?,0,0)').bind('pedidos', meiaNoiteLocal(falhou.hoje, 30)).run();
  assert.ok(!(await pedir(falhou.db, '/api/visao', visao)).corpo.alertas.some((a) => a.aba === 'vendas'));
});

test('403 sem-permissao: visão, série, quebra e produtos', async () => {
  const db = await banco();
  const casos = [
    ['/api/visao', visao, 'nada@exemplo.com'],
    [`/api/vendas/serie?${PERIODO}`, serie, 'compras@exemplo.com'],
    [`/api/vendas/quebra?${PERIODO}&por=origem`, quebra, 'compras@exemplo.com'],
    [`/api/vendas/produtos?${PERIODO}`, produtos, 'compras@exemplo.com'],
  ];
  for (const [rota, handler, email] of casos) {
    const r = await pedir(db, rota, handler, { email });
    assert.equal(r.status, 403, rota);
    assert.equal(r.corpo.erro, 'sem-permissao', rota);
  }
});

test('porItens em série e quebra', async () => {
  const db = await banco();
  assert.equal((await pedir(db, `/api/vendas/serie?${PERIODO}`, serie)).corpo.porItens, false);
  assert.equal((await pedir(db, `/api/vendas/serie?${PERIODO}&categoria=Luvas`, serie)).corpo.porItens, true);
  assert.equal((await pedir(db, `/api/vendas/quebra?${PERIODO}&por=origem`, quebra)).corpo.porItens, false);
  assert.equal((await pedir(db, `/api/vendas/quebra?${PERIODO}&por=origem&marca=A`, quebra)).corpo.porItens, true);
  assert.equal((await pedir(db, `/api/vendas/quebra?${PERIODO}&por=marca`, quebra)).corpo.porItens, true);
  assert.equal((await pedir(db, `/api/vendas/quebra?${PERIODO}&por=categoria`, quebra)).corpo.porItens, true);
});

// ---------- /api/opcoes e /api/eu ----------

test('opções: listas distintas ordenadas, cidades por UF, últimos 400 dias, permissão', async () => {
  const db = await banco();
  const ontem = new Date(Date.parse(`${hojeLocal({})}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
  await inserirPedidos(db, [
    linha(['r1', ontem, 'E-mail', 'boleto', 'SP', 'Barueri', 'retirada', 'novo', 1000, [it('C1', 'Termômetro', 'C', 'Aparelhos', 1, 30011)]]),
    linha(['v1', '2020-01-01', 'Antiga', 'pix', 'AC', 'Rio Branco', 'entrega', 'novo', 1000, [it('Z1', 'Velho', 'Z', 'Velharia', 1, 30013)]]),
  ]);
  const { status, corpo } = await pedir(db, '/api/opcoes', opcoes);
  assert.equal(status, 200);
  const ordenada = (a) => assert.deepEqual(a, [...a].sort((x, y) => x.localeCompare(y)));
  for (const k of ['origens', 'pagamentos', 'entregas', 'ufs', 'marcas', 'categorias']) {
    assert.ok(Array.isArray(corpo[k]), k);
    ordenada(corpo[k]);
    assert.equal(new Set(corpo[k]).size, corpo[k].length, k);
  }
  assert.ok(corpo.origens.includes('E-mail'));
  assert.ok(corpo.marcas.includes('C'));
  assert.ok(corpo.categorias.includes('Aparelhos'));
  assert.ok(corpo.entregas.includes('retirada'));
  assert.ok(corpo.cidades.SP.includes('Barueri'));
  Object.values(corpo.cidades).forEach(ordenada);
  assert.ok(!corpo.ufs.includes('AC'));
  assert.ok(!corpo.origens.includes('Antiga'));
  assert.ok(!corpo.marcas.includes('Z'));
  assert.ok(!('AC' in corpo.cidades));
  assert.equal((await pedir(db, '/api/opcoes', opcoes, { email: 'compras@exemplo.com' })).status, 200);
  const nada = await pedir(db, '/api/opcoes', opcoes, { email: 'nada@exemplo.com' });
  assert.equal(nada.status, 403);
  assert.equal(nada.corpo.erro, 'sem-permissao');
});

test('eu: dados do usuário, loja e coletas', async () => {
  const db = await banco();
  const { corpo } = await pedir(db, '/api/eu', eu, { email: 'mkt@exemplo.com', env: { LOJA_NOME: 'Minha Loja' } });
  assert.equal(corpo.email, 'mkt@exemplo.com');
  assert.equal(corpo.nome, 'Mari');
  assert.equal(corpo.perfil, 'marketing');
  assert.equal(corpo.ativo, true);
  assert.equal(corpo.verValores, false);
  assert.equal(corpo.admin, false);
  assert.equal(corpo.superAdmin, false);
  assert.ok(corpo.abas.includes('vendas'));
  assert.deepEqual(corpo.loja, { nome: 'Minha Loja' });
  assert.deepEqual(corpo.coletas, [{ fonte: 'pedidos', quando: '2026-03-08T03:00:00.000Z', ok: true, ultimoOk: '2026-03-08T03:00:00.000Z' }]);
  assert.equal(corpo.fusoHoras, -3);
  assert.deepEqual(corpo.agenda, {});
  const padrao = await pedir(db, '/api/eu', eu, { email: 'fora@exemplo.com' });
  assert.equal(padrao.status, 200);
  assert.equal(padrao.corpo.ativo, false);
  assert.deepEqual(padrao.corpo.loja, { nome: 'Painel' });
  assert.deepEqual(padrao.corpo.coletas, []);
  assert.equal(padrao.corpo.fusoHoras, -3);
});

test('coleta ok → coleta falha: /api/eu, dadosAte e a visão mantêm a última coleta boa', async () => {
  const db = await banco();
  const d1 = { consulta: (s, p = []) => db.prepare(s).bind(...p).all().then((r) => r.results) };
  const boa = new Date(Date.now() - 2 * 3600000).toISOString();
  const falha = new Date(Date.now() - 600000).toISOString();
  await registrarColeta(d1, { fonte: 'pedidos', quando: boa, ok: 1, registros: 10, erro: null });
  await registrarColeta(d1, { fonte: 'pedidos', quando: falha, ok: 0, registros: 0, erro: 'ETARGET' });
  const { corpo } = await pedir(db, '/api/eu', eu);
  assert.deepEqual(corpo.coletas, [{ fonte: 'pedidos', quando: falha, ok: false, ultimoOk: boa }]);
  assert.equal(await dadosAte(db, 'pedidos'), boa);
  const r = await pedir(db, `/api/vendas/resumo?${PERIODO}`, resumo);
  assert.equal(r.corpo.dadosAte, boa);
  // dentro do prazo da agenda: sem "nenhuma coleta concluída" nem atraso
  const env = { AGENDA_JSON: JSON.stringify({ pedidos: { horasMax: 3 } }) };
  const v = await pedir(db, '/api/visao', visao, { env });
  assert.ok(!v.corpo.alertas.some((a) => a.aba === 'visao'), JSON.stringify(v.corpo.alertas));
  // passou do prazo: atraso conta a partir da última coleta boa
  const v2 = await pedir(db, '/api/visao', visao, { env: { AGENDA_JSON: JSON.stringify({ pedidos: { horasMax: 1 } }) } });
  assert.match(v2.corpo.alertas.find((a) => a.aba === 'visao').texto, /atrasada: última há 2 h/);
});

test('eu: agenda e fuso vêm do ambiente (R16); inválidos caem no padrão; inativo não recebe agenda', async () => {
  const db = await banco();
  const agenda = { pedidos: { horasMax: 3 }, estoque: { horasMax: 24 } };
  const env = { AGENDA_JSON: JSON.stringify(agenda), FUSO_HORAS: '-4' };
  const { corpo } = await pedir(db, '/api/eu', eu, { env });
  assert.deepEqual(corpo.agenda, agenda);
  assert.equal(corpo.fusoHoras, -4);
  const zero = await pedir(db, '/api/eu', eu, { env: { FUSO_HORAS: '0' } });
  assert.equal(zero.corpo.fusoHoras, 0);
  for (const ruim of [{ AGENDA_JSON: '{x', FUSO_HORAS: 'x' }, { AGENDA_JSON: '[1]', FUSO_HORAS: '' }]) {
    const r = await pedir(db, '/api/eu', eu, { env: ruim });
    assert.deepEqual(r.corpo.agenda, {});
    assert.equal(r.corpo.fusoHoras, -3);
  }
  const fora = await pedir(db, '/api/eu', eu, { email: 'fora@exemplo.com', env });
  assert.deepEqual(fora.corpo.agenda, {});
  assert.equal(fora.corpo.fusoHoras, -4);
});

// ---------- R10: vazamento de valores ----------

function numeros(v, saida = []) {
  if (typeof v === 'number') saida.push(v);
  else if (Array.isArray(v)) v.forEach((x) => numeros(x, saida));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => numeros(x, saida));
  return saida;
}

function valoresDeDinheiro(v, saida = []) {
  if (Array.isArray(v)) v.forEach((x) => valoresDeDinheiro(x, saida));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      if (CAMPOS_VALOR.includes(k) && typeof x === 'number') saida.push(x);
      else valoresDeDinheiro(x, saida);
    }
  }
  return saida;
}

const ROTAS_VAZAMENTO = [
  ['eu', '/api/eu', eu],
  ['opcoes', '/api/opcoes', opcoes],
  ['resumo', `/api/vendas/resumo?${PERIODO}`, resumo],
  ['resumo marca', `/api/vendas/resumo?${PERIODO}&marca=A`, resumo],
  ['serie', `/api/vendas/serie?${PERIODO}`, serie],
  ['quebra origem', `/api/vendas/quebra?${PERIODO}&por=origem`, quebra],
  ['quebra marca', `/api/vendas/quebra?${PERIODO}&por=marca`, quebra],
  ['quebra abril', '/api/vendas/quebra?de=2026-04-01&ate=2026-04-01&por=origem', quebra],
  ['produtos', `/api/vendas/produtos?${PERIODO}`, produtos],
  ['produtos ordem=valor', `/api/vendas/produtos?${PERIODO}&ordem=valor`, produtos],
  ['produtos subiram', `/api/vendas/produtos?${PV}&modo=subiram`, produtos, bancoVariacao],
  ['produtos caiu', `/api/vendas/produtos?${PV}&modo=caiu`, produtos, bancoVariacao],
  ['clientes', `/api/clientes?${PERIODO}`, clientes],
  ['visao', `/api/visao?${PERIODO}`, visao],
];

for (const [nome, rota, handler, criar = banco] of ROTAS_VAZAMENTO) {
  test(`R10 vazamento: ${nome} sem R$ não traz nenhum valor em centavos`, async () => {
    const db = await criar();
    const cheio = await pedir(db, rota, handler);
    assert.equal(cheio.status, 200);
    const proibidos = new Set([...CENTAVOS, ...valoresDeDinheiro(cheio.corpo).filter((v) => v >= 1000)]);
    const r = await pedir(db, rota, handler, { email: 'mkt@exemplo.com' });
    assert.equal(r.status, 200);
    const achados = numeros(r.corpo).filter((n) => proibidos.has(n));
    assert.deepEqual(achados, [], `${nome}: ${JSON.stringify(r.corpo)}`);
    assert.deepEqual(valoresDeDinheiro(r.corpo), []);
  });
}
