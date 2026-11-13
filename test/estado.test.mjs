import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERIODOS, LISTAS, intervaloDe, lerHash, montarHash, hojeLocal, filtrosPadrao, paramsDosFiltros, rotuloPeriodo,
  comLista, diasEntre, MAX_VALORES_TOTAL,
} from '../public/js/estado.js';
import { LISTAS as LISTAS_API, lerFiltros } from '../functions/_lib/filtros.js';

const HOJE = '2026-11-13';

test('PERIODOS tem os presets da barra', () => {
  assert.deepEqual(Object.keys(PERIODOS), ['hoje', 'ontem', '7d', '30d', 'mes', 'mes-passado']);
  assert.deepEqual(LISTAS, LISTAS_API);
});

test('intervaloDe: presets relativos a hoje', () => {
  assert.deepEqual(intervaloDe('hoje', HOJE), { de: '2026-11-13', ate: '2026-11-13' });
  assert.deepEqual(intervaloDe('ontem', HOJE), { de: '2026-11-12', ate: '2026-11-12' });
  assert.deepEqual(intervaloDe('7d', HOJE), { de: '2026-11-06', ate: '2026-11-12' });
  assert.deepEqual(intervaloDe('30d', HOJE), { de: '2026-10-14', ate: '2026-11-12' });
  assert.deepEqual(intervaloDe('mes', HOJE), { de: '2026-11-01', ate: '2026-11-13' });
  assert.deepEqual(intervaloDe('mes-passado', HOJE), { de: '2026-10-01', ate: '2026-10-31' });
  assert.deepEqual(intervaloDe('mes-passado', '2026-03-05'), { de: '2026-02-01', ate: '2026-02-28' });
  assert.deepEqual(intervaloDe('mes-passado', '2026-01-10'), { de: '2025-12-01', ate: '2025-12-31' });
  assert.deepEqual(intervaloDe('ontem', '2026-03-01'), { de: '2026-02-28', ate: '2026-02-28' });
  assert.equal(intervaloDe('xyz', HOJE), null);
});

test('30d padrão bate com o padrão da API', () => {
  const api = lerFiltros(new URLSearchParams(''), HOJE);
  assert.deepEqual(intervaloDe('30d', HOJE), { de: api.de, ate: api.ate });
});

test('hojeLocal: fuso da loja', () => {
  // 02:30 UTC de 14/11 = 23:30 de 13/11 em Brasília
  assert.equal(hojeLocal(-3, Date.parse('2026-11-14T02:30:00Z')), '2026-11-13');
  assert.equal(hojeLocal(-3, Date.parse('2026-11-14T03:00:00Z')), '2026-11-14');
  assert.equal(hojeLocal(0, Date.parse('2026-11-14T02:30:00Z')), '2026-11-14');
  assert.match(hojeLocal(), /^\d{4}-\d{2}-\d{2}$/);
});

test('hash vazio → visão geral com filtros padrão', () => {
  const padrao = filtrosPadrao(HOJE);
  assert.deepEqual(padrao, {
    periodo: '30d', de: '2026-10-14', ate: '2026-11-12', cmp: 'anterior',
    origem: [], categoria: [], marca: [], pagamento: [], uf: [], cidade: [], entrega: [],
  });
  for (const h of ['', '#', '#?', '#/']) assert.deepEqual(lerHash(h, HOJE), { aba: 'visao', filtros: padrao });
});

test('montarHash omite padrões', () => {
  assert.equal(montarHash('vendas', filtrosPadrao(HOJE)), '#vendas');
  assert.equal(montarHash('visao', { ...filtrosPadrao(HOJE), cmp: 'ano' }), '#visao?cmp=ano');
});

test('ida e volta: listas, cmp e preset', () => {
  const f = {
    ...filtrosPadrao(HOJE),
    ...intervaloDe('7d', HOJE),
    periodo: '7d',
    cmp: 'nenhum',
    marca: ['Marca A, Ltda', 'B&C'],
    uf: ['RJ', 'SP'],
    cidade: ['Rio de Janeiro'],
    entrega: ['retirada'],
  };
  const h = montarHash('vendas', f);
  assert.match(h, /^#vendas\?/);
  assert.ok(h.includes('p=7d'));
  assert.ok(!/[?&](de|ate)=/.test(h), 'preset não grava datas');
  assert.ok(h.includes('marca=Marca+A%2C+Ltda&marca=B%26C'), 'parâmetros repetidos, não vírgula');
  assert.deepEqual(lerHash(h, HOJE), { aba: 'vendas', filtros: f });
});

test('preset continua relativo ao recarregar em outro dia', () => {
  const h = montarHash('vendas', { ...filtrosPadrao(HOJE), ...intervaloDe('7d', HOJE), periodo: '7d' });
  const amanha = lerHash(h, '2026-11-14').filtros;
  assert.deepEqual({ de: amanha.de, ate: amanha.ate }, { de: '2026-11-07', ate: '2026-11-13' });
});

test('período personalizado usa de/ate', () => {
  const f = { ...filtrosPadrao(HOJE), periodo: 'personalizado', de: '2026-01-05', ate: '2026-02-10' };
  const h = montarHash('clientes', f);
  assert.equal(h, '#clientes?de=2026-01-05&ate=2026-02-10');
  assert.deepEqual(lerHash(h, HOJE), { aba: 'clientes', filtros: f });
});

test('lerHash ignora valores inválidos', () => {
  const padrao = filtrosPadrao(HOJE);
  assert.deepEqual(lerHash('#vendas?de=2026-02-30&ate=2026-03-01', HOJE).filtros, padrao);
  assert.deepEqual(lerHash('#vendas?de=2026-03-10&ate=2026-03-01', HOJE).filtros, padrao);
  assert.deepEqual(lerHash('#vendas?p=999d&cmp=xyz', HOJE).filtros, padrao);
  const r = lerHash('#vendas?marca=A&marca=A&marca=&outro=1&uf=SP', HOJE);
  assert.deepEqual(r.filtros.marca, ['A']);
  assert.deepEqual(r.filtros.uf, ['SP']);
  assert.equal('outro' in r.filtros, false);
  assert.equal(lerHash('#<script>', HOJE).aba, 'visao');
  assert.equal(lerHash('#Vendas', HOJE).aba, 'visao');
});

test('paramsDosFiltros: parâmetros da API com listas repetidas', () => {
  const f = { ...filtrosPadrao(HOJE), marca: ['A', 'B'], cmp: 'ano' };
  const p = paramsDosFiltros(f);
  assert.equal(p.toString(), 'de=2026-10-14&ate=2026-11-12&cmp=ano&marca=A&marca=B');
  const api = lerFiltros(p, HOJE);
  assert.deepEqual(api.marca, ['A', 'B']);
});

test('rotuloPeriodo', () => {
  assert.equal(rotuloPeriodo(filtrosPadrao(HOJE)), 'Últimos 30 dias');
  assert.equal(rotuloPeriodo({ periodo: 'personalizado', de: '2026-01-05', ate: '2026-02-10' }), '05/01/2026 – 10/02/2026');
});

test('comLista: teto total e cidades órfãs', async () => {
  const { MAX_VALORES_TOTAL: TETO_API } = await import('../functions/_lib/filtros.js');
  assert.equal(MAX_VALORES_TOTAL, TETO_API);
  const cidades = { RJ: ['Niterói', 'Rio de Janeiro'], SP: ['Campinas'] };
  const f = { ...filtrosPadrao(HOJE), uf: ['RJ', 'SP'], cidade: ['Niterói', 'Campinas'] };
  assert.deepEqual(comLista(f, 'uf', ['RJ'], cidades).cidade, ['Niterói']);
  assert.deepEqual(comLista(f, 'uf', [], cidades).cidade, []);
  assert.deepEqual(comLista(f, 'marca', ['A', 'A', 'B'], cidades).marca, ['A', 'B']);
  const muitos = Array.from({ length: MAX_VALORES_TOTAL - 4 }, (_, i) => `m${i}`);
  assert.ok(comLista(f, 'marca', muitos, cidades));
  assert.equal(comLista(f, 'marca', [...muitos, 'extra'], cidades), null);
  assert.equal(diasEntre('2026-01-01', '2026-01-31'), 31);
});
