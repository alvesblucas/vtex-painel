// Peças comuns das views: esqueleto dos KPIs com os nomes do morph entre abas.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartoesEsqueleto } from '../public/js/views/comum.js';

const nomes = (html) => [...html.matchAll(/view-transition-name: (kpi-[a-z]+)/g)].map((m) => m[1]);

test('cartoesEsqueleto dá aos primeiros cartões os nomes kpi-<chave> do morph', () => {
  const html = cartoesEsqueleto(3, 's4', ['faturamento', 'pedidos', 'ticket']);
  assert.deepEqual(nomes(html), ['kpi-faturamento', 'kpi-pedidos', 'kpi-ticket']);
  assert.equal(html.match(/class="card s4"/g).length, 3);
});

test('cartoesEsqueleto sem chaves não nomeia nenhum cartão; chaves a menos deixam o resto sem nome', () => {
  assert.deepEqual(nomes(cartoesEsqueleto(4)), []);
  assert.doesNotMatch(cartoesEsqueleto(4), /view-transition-name/);
  const html = cartoesEsqueleto(4, 's3', ['faturamento', 'pedidos', 'ticket']);
  assert.deepEqual(nomes(html), ['kpi-faturamento', 'kpi-pedidos', 'kpi-ticket']);
  assert.equal(html.match(/class="card s3"/g).length, 4);
});
