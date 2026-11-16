import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colunasProdutos } from '../public/js/views/vendas.js';

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
  assert.deepEqual(colunasProdutos('subiram', true).map((c) => c.titulo), ['Produto', 'SKU', 'Marca', 'Categoria', 'Qtd', 'Antes', 'Var.', 'Var. preço', 'Faturamento']);
});
