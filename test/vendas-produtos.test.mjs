import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colunasProdutos, dicaCliqueQuebra, htmlDetalheCategoria, notaProdutos, soNaGeracao } from '../public/js/views/vendas.js';

const chaves = (m, vv) => colunasProdutos(m, vv).map((c) => c.chave);

test('colunasProdutos: modo mais igual ao de antes', () => {
  assert.deepEqual(chaves('mais', true), ['nome', 'sku', 'marca', 'categoria', 'qtd', 'pedidos', 'valor']);
  assert.deepEqual(chaves('mais', false), ['nome', 'sku', 'marca', 'categoria', 'qtd', 'pedidos']);
});

test('colunasProdutos: modos novos e sem R$', () => {
  assert.deepEqual(chaves('subiram', true), ['nome', 'sku', 'marca', 'categoria', 'qtd', 'qtdAntes', 'varQtd', 'varPreco', 'valor']);
  assert.deepEqual(chaves('caiu', false), ['nome', 'sku', 'marca', 'categoria', 'qtd', 'qtdAntes', 'varQtd']);
  const vars = colunasProdutos('caiu', true).filter((c) => ['varQtd', 'varPreco'].includes(c.chave));
  assert.ok(vars.every((c) => c.formato === 'pct' && c.ordenavel === false));
  assert.deepEqual(colunasProdutos('subiram', true).map((c) => c.titulo), ['Produto', 'SKU', 'Marca', 'Categoria', 'Qtd', 'Antes', 'Var. %', 'Var. preço %', 'Faturamento']);
});

test('soNaGeracao: resposta ou erro de geração velha vira AbortError', async () => {
  let gen = 1;
  const atual = () => gen;
  assert.equal(await soNaGeracao(Promise.resolve('ok'), 1, atual), 'ok');
  await assert.rejects(soNaGeracao(Promise.reject(new Error('falhou')), 1, atual), /falhou/);
  const velhaOk = soNaGeracao(new Promise((r) => setTimeout(() => r('x'), 5)), 1, atual);
  const velhaErro = soNaGeracao(new Promise((_, j) => setTimeout(() => j(new Error('500')), 5)), 1, atual);
  gen = 2;
  await assert.rejects(velhaOk, (e) => e.name === 'AbortError');
  await assert.rejects(velhaErro, (e) => e.name === 'AbortError');
});

test('notaProdutos: só nos modos novos e nunca junto do aviso de sem comparação', () => {
  assert.equal(notaProdutos('mais', false), '');
  assert.equal(notaProdutos('caiu', false), 'Só entram produtos com 3+ pedidos no período de comparação.');
  assert.equal(notaProdutos('subiram', true), '');
});

const ITEM = { chave: '<b>"Cur"</b>', pedidos: 12, cmpPedidos: 10, valor: 50000, cmpValor: 40000 };
const P = (n, v) => ({ nome: `P${n}`, sku: String(n), varQtd: v });

test('htmlDetalheCategoria: top 5, escapa e mostra variação', () => {
  const h = htmlDetalheCategoria({ item: ITEM, subiram: [1, 2, 3, 4, 5, 6].map((n) => P(n, 10 * n)), caiu: [P(9, -50), { nome: '<img src=x>', sku: '77', varQtd: -10 }], vv: true, temCmp: true, rotuloCmp: 'Período anterior' });
  assert.ok(!h.includes('<img src=x>') && h.includes('&lt;img src=x&gt;'));
  assert.ok(h.includes('P5') && !h.includes('P6'));
  assert.ok(h.includes('P9') && h.includes('Filtrar a página por esta categoria'));
  assert.ok(h.includes('R$'));
});

test('htmlDetalheCategoria: sem R$, sem comparação, carregando e lista vazia', () => {
  assert.ok(!htmlDetalheCategoria({ item: ITEM, subiram: [], caiu: [], vv: false, temCmp: true, rotuloCmp: 'x' }).includes('R$'));
  assert.ok(htmlDetalheCategoria({ item: ITEM, subiram: [], caiu: [], vv: true, temCmp: true, rotuloCmp: 'x' }).includes('Nenhum produto com variação.'));
  const sem = htmlDetalheCategoria({ item: ITEM, subiram: null, caiu: null, vv: true, temCmp: false, rotuloCmp: 'x' });
  assert.ok(sem.includes('Escolha uma comparação na barra para ver o que subiu ou caiu.'));
  assert.ok(htmlDetalheCategoria({ item: ITEM, subiram: null, caiu: null, vv: true, temCmp: true, rotuloCmp: 'x' }).includes('Carregando'));
});

test('dicaCliqueQuebra: categoria abre detalhe, as outras filtram', () => {
  assert.equal(dicaCliqueQuebra('categoria'), 'Ver produtos que subiram e caíram nesta categoria');
  assert.equal(dicaCliqueQuebra('origem'), 'Filtrar por este item');
});

test('htmlDetalheCategoria: rótulos iguais aos do cartão de categoria', () => {
  const h = htmlDetalheCategoria({ item: ITEM, subiram: [], caiu: [], vv: true, temCmp: true, rotuloCmp: 'x' });
  assert.ok(h.includes('Pedidos com a categoria'));
  assert.ok(h.includes('Faturamento dos itens, sem frete'));
});
