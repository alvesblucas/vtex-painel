import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerFiltros, periodoComparacao, wherePedidos, whereItens, usaItens, LISTAS } from '../functions/_lib/filtros.js';
import { ErroHttp, erro, json } from '../functions/_lib/resposta.js';
import { criarD1Falso } from './d1-falso.mjs';

const P = (s) => new URLSearchParams(s);
const HOJE = '2026-11-13';

test('resposta: json e erro', async () => {
  const r = json({ a: 1 }, 201);
  assert.equal(r.status, 201);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await r.json(), { a: 1 });
  const e = erro(400, 'x', 'msg');
  assert.equal(e.status, 400);
  assert.equal(e.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await e.json(), { erro: 'x', mensagem: 'msg' });
  const h = new ErroHttp(400, 'c', 'm');
  assert.ok(h instanceof Error);
  assert.equal(h.status, 400);
  assert.equal(h.codigo, 'c');
  assert.equal(h.mensagem, 'm');
});

test('padrões', () => {
  const f = lerFiltros(P(''), HOJE);
  assert.equal(f.de, '2026-10-14');
  assert.equal(f.ate, '2026-11-12');
  assert.equal(f.cmp, 'anterior');
  for (const l of LISTAS) assert.deepEqual(f[l], []);
});

test('listas repetidas, vazias e duplicadas', () => {
  const f = lerFiltros(P('marca=A, B&marca=C&marca=&marca=C'), HOJE);
  assert.deepEqual(f.marca, ['A, B', 'C']);
});

test('comparação', () => {
  const ano = lerFiltros(P('de=2028-02-29&ate=2028-02-29&cmp=ano'), HOJE);
  assert.deepEqual(periodoComparacao(ano), { de: '2027-02-28', ate: '2027-02-28' });
  const ant = lerFiltros(P('de=2026-11-01&ate=2026-11-07'), HOJE);
  assert.deepEqual(periodoComparacao(ant), { de: '2026-10-25', ate: '2026-10-31' });
  assert.equal(periodoComparacao(lerFiltros(P('cmp=nenhum'), HOJE)), null);
});

test('validações', () => {
  const ruim = (q) =>
    assert.throws(
      () => lerFiltros(P(q), HOJE),
      (e) => e instanceof ErroHttp && e.status === 400 && e.codigo === 'filtro-invalido',
    );
  ruim('de=2026-13-01');
  ruim('de=2026-02-30');
  ruim('de=abc');
  ruim('de=2026-11-10&ate=2026-11-01');
  ruim('de=2024-01-01&ate=2026-11-01');
  ruim('cmp=xx');
  ruim('entrega=foo');
  ruim('pagamento=foo');
  ruim('marca=' + 'a'.repeat(121));
  ruim(Array.from({ length: 51 }, (_, i) => 'marca=m' + i).join('&'));
  assert.doesNotThrow(() => lerFiltros(P('de=2026-01-01&ate=2027-12-31'), HOJE));
});

test('injeção fica só em params', () => {
  const f = lerFiltros(P("origem=x' OR 1=1--&marca=m'--"), HOJE);
  const w = wherePedidos(f, { de: f.de, ate: f.ate });
  assert.ok(!w.sql.includes('OR 1=1'));
  assert.ok(!w.sql.includes("'"));
  assert.ok(w.params.includes("x' OR 1=1--"));
  assert.ok(!/^\s*WHERE/i.test(w.sql));
});

test('whereItens e usaItens', () => {
  const vazio = lerFiltros(P(''), HOJE);
  assert.deepEqual(whereItens(vazio), { sql: '', params: [] });
  assert.equal(usaItens(vazio), false);
  const f = lerFiltros(P('marca=A&marca=B&categoria=C'), HOJE);
  assert.equal(usaItens(f), true);
  assert.deepEqual(whereItens(f), { sql: 'i.marca IN (?,?) AND i.categoria IN (?)', params: ['A', 'B', 'C'] });
});

test('wherePedidos no D1: origem + marca', async () => {
  const d1 = await criarD1Falso();
  const ped = (id, dia, origem, cancelado = 0) =>
    d1.exec(
      `INSERT INTO pedidos VALUES ('${id}','${dia}','${dia}T10:00:00Z','ok',${cancelado},100,0,0,'site','${origem}',NULL,NULL,NULL,'pix',1,'RJ','Rio','entrega',NULL,'x')`,
    );
  const item = (id, marca) => d1.exec(`INSERT INTO itens VALUES ('${id}','s','p','n','${marca}','cat','d',1,100)`);
  ped('1', '2026-11-05', 'Google Ads');
  item('1', 'A');
  ped('2', '2026-11-05', 'Google Ads');
  item('2', 'B');
  ped('3', '2026-11-05', 'Sem UTM');
  item('3', 'A');
  ped('4', '2026-11-05', 'Google Ads', 1);
  item('4', 'A');
  ped('5', '2026-12-05', 'Google Ads');
  item('5', 'A');
  const f = lerFiltros(P('de=2026-11-01&ate=2026-11-30&origem=Google Ads&marca=A'), HOJE);
  const w = wherePedidos(f, { de: f.de, ate: f.ate });
  const r = await d1.prepare(`SELECT p.id FROM pedidos p WHERE ${w.sql} ORDER BY p.id`).bind(...w.params).all();
  assert.deepEqual(r.results.map((x) => x.id), ['1']);
});
