import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { ferramentas } from '../functions/_lib/mcp/ferramentas.js';
import { ErroParametro } from '../functions/_lib/mcp/protocolo.js';
import { carregarRegistro, limparCacheUsuarios, CAMPOS_VALOR } from '../functions/_lib/permissoes.js';
import { banco, TODOS } from './fixture-pedidos.mjs';

const PERIODO = { de: '2026-03-01', ate: '2026-03-07' };
const soma = (l, f) => l.reduce((s, x) => s + f(x), 0);
const MARCO_OK = TODOS.filter((p) => p.dia >= '2026-03-01' && p.dia <= '2026-03-07' && !p.cancelado);

async function chamar(db, nome, args = {}, email = 'gestao@exemplo.com') {
  const env = { DB: db, SUPER_ADMIN: 'chefe@exemplo.com', FUSO_HORAS: '-3' };
  const { eu } = await carregarRegistro(db, email, env);
  return ferramentas[nome].executar(args, { eu, env, db });
}

function chavesDe(v, saida = new Set()) {
  if (Array.isArray(v)) v.forEach((x) => chavesDe(x, saida));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { saida.add(k); chavesDe(x, saida); }
  return saida;
}

const rejeitaParametro = (p, re) => assert.rejects(p, (e) => e instanceof ErroParametro && (!re || re.test(e.message)));

beforeEach(() => limparCacheUsuarios());

test('lista: 9 ferramentas, todas com descrição e additionalProperties:false', () => {
  const nomes = Object.keys(ferramentas).sort();
  assert.deepEqual(nomes, ['campanhas', 'clientes', 'opcoes_filtro', 'produtos', 'quem_sou_eu', 'resumo_geral', 'vendas_quebra', 'vendas_resumo', 'vendas_serie']);
  for (const [n, t] of Object.entries(ferramentas)) {
    assert.ok(t.description.length > 20, n);
    assert.equal(t.inputSchema.type, 'object', n);
    assert.equal(t.inputSchema.additionalProperties, false, n);
  }
});

test('vendas_resumo: valores em reais (centavos ÷ 100)', async () => {
  const db = await banco();
  const r = await chamar(db, 'vendas_resumo', PERIODO);
  assert.equal(r.atual.valor, soma(MARCO_OK, (p) => p.valor) / 100);
  assert.equal(r.atual.pedidos, MARCO_OK.length);
  assert.ok(r.cmp);
});

test('produtos: varPreco continua em % (não divide)', async () => {
  const db = await banco();
  const mais = await chamar(db, 'produtos', { ...PERIODO, modo: 'mais' });
  assert.ok(mais.itens.length > 0);
  const subiram = await chamar(db, 'produtos', { de: '2026-03-01', ate: '2026-03-07', modo: 'subiram' });
  for (const i of subiram.itens ?? []) if (i.varPreco != null) assert.ok(Math.abs(i.varPreco) < 1000);
});

test('sem ver_valores: nenhuma ferramenta devolve campo de R$', async () => {
  const db = await banco();
  const casos = [
    ['resumo_geral', PERIODO], ['vendas_resumo', PERIODO], ['vendas_serie', PERIODO], ['vendas_quebra', { ...PERIODO, por: 'origem' }],
    ['produtos', PERIODO], ['clientes', PERIODO], ['campanhas', PERIODO], ['opcoes_filtro', {}], ['quem_sou_eu', {}],
  ];
  for (const [nome, args] of casos) {
    const r = await chamar(db, nome, args, 'mkt@exemplo.com');
    const proibidas = [...chavesDe(r)].filter((k) => CAMPOS_VALOR.includes(k));
    assert.deepEqual(proibidas, [], nome);
  }
});

test('perfil compras: resumo_geral sem vendas nem campanhas; vendas_resumo recusado', async () => {
  const db = await banco();
  const r = await chamar(db, 'resumo_geral', PERIODO, 'compras@exemplo.com');
  assert.ok(!('vendas' in (r.visao?.cartoes ?? {})));
  assert.equal(r.campanhas, undefined);
  assert.equal(r.porOrigem, undefined);
  await rejeitaParametro(chamar(db, 'vendas_resumo', PERIODO, 'compras@exemplo.com'), /acesso/);
});

test('resumo_geral (gestão): visão + top 5 origens/categorias + campanhas', async () => {
  const db = await banco();
  const r = await chamar(db, 'resumo_geral', PERIODO);
  assert.ok(r.visao.cartoes.vendas);
  assert.ok(r.porOrigem.length > 0 && r.porOrigem.length <= 5);
  assert.ok(r.porCategoria.length > 0 && r.porCategoria.length <= 5);
  assert.ok(r.campanhas.length > 0 && r.campanhas.length <= 5);
});

test('vendas_serie: > 92 dias agrupa por semana sem perder pedidos', async () => {
  const db = await banco();
  const args = { de: '2026-01-05', ate: '2026-04-30', cmp: 'nenhum' }; // 116 dias
  const r = await chamar(db, 'vendas_serie', args);
  assert.equal(r.agrupamento, 'semana');
  assert.ok(r.pontos.every((p) => new Date(`${p.dia}T12:00:00Z`).getUTCDay() === 1), 'cada ponto começa numa segunda');
  const diaria = TODOS.filter((p) => p.dia >= args.de && p.dia <= args.ate && !p.cancelado).length;
  assert.equal(soma(r.pontos, (p) => p.pedidos), diaria);
  const curta = await chamar(db, 'vendas_serie', PERIODO);
  assert.equal(curta.agrupamento, 'dia');
  assert.equal(curta.pontos.length, 7);
});

test('argumentos errados viram erro de parâmetro', async () => {
  const db = await banco();
  await rejeitaParametro(chamar(db, 'vendas_resumo', { de: 20260301 }), /de/);
  await rejeitaParametro(chamar(db, 'vendas_resumo', { ...PERIODO, origem: 'Google Ads' }), /origem/);
  await rejeitaParametro(chamar(db, 'vendas_resumo', { ...PERIODO, foo: 1 }), /foo/);
  await rejeitaParametro(chamar(db, 'vendas_resumo', { de: '2025-01-01', ate: '2026-02-05' }), /400 dias/);
  await rejeitaParametro(chamar(db, 'vendas_resumo', { de: '2026-13-01', ate: '2026-03-07' }));
  await rejeitaParametro(chamar(db, 'vendas_quebra', { ...PERIODO, por: 'sabor' }), /por/);
  await rejeitaParametro(chamar(db, 'vendas_resumo', { ...PERIODO, cmp: 'ontem' }), /cmp/);
});

test('filtros funcionam como no painel', async () => {
  const db = await banco();
  const r = await chamar(db, 'vendas_resumo', { ...PERIODO, origem: ['Google Ads'] });
  assert.equal(r.atual.pedidos, MARCO_OK.filter((p) => p.origem === 'Google Ads').length);
});

test('emReais: divide só campos de R$ (varPreco é % e fica igual)', async () => {
  const { emReais } = await import('../functions/_lib/mcp/adaptar.js');
  assert.deepEqual(emReais({ valor: 123457, varPreco: 12.5, pedidos: 3, itens: [{ ticket: 999, cmpValor: null }] }),
    { valor: 1234.57, varPreco: 12.5, pedidos: 3, itens: [{ ticket: 9.99, cmpValor: null }] });
});
