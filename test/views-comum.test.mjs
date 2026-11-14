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

test('cartoesEsqueleto marca a grade com data-esqueleto (bloco() não o reescreve)', () => {
  assert.match(cartoesEsqueleto(2), /^<div class="grade cartoes" data-esqueleto>/);
});

// DOM mínimo para pintarFileira: grade com .card que guardam className e style.
function cardFalso(className, nome = '') {
  return { className, style: { viewTransitionName: nome }, innerHTML: '', classList: { remove() {} }, removeAttribute() {}, querySelector: () => ({ textContent: '', dataset: {} }) };
}
function secaoFalsa(cards) {
  const grade = { classList: { contains: (c) => c === 'cartoes' }, children: cards, attrs: new Set(['data-esqueleto']), removeAttribute(a) { this.attrs.delete(a); } };
  const el = {
    childElementCount: 1,
    firstElementChild: grade,
    _html: null,
    set innerHTML(v) { this._html = v; this.childElementCount = 0; this.firstElementChild = null; },
    get innerHTML() { return this._html; },
    querySelectorAll: () => (el._html == null ? cards : []),
  };
  return { el, grade };
}

test('pintarFileira reaproveita os cartões do esqueleto quando quantidade, classe e nomes batem', async () => {
  const { pintarFileira } = await import('../public/js/views/comum.js');
  const cards = [cardFalso('card s6', 'kpi-pedidos'), cardFalso('card s6')];
  const { el, grade } = secaoFalsa(cards);
  pintarFileira(el, [
    { rotulo: 'Pedidos', valor: '3', chave: 'pedidos' },
    { rotulo: 'Cancelados', valor: '1' },
  ], 's6');
  assert.equal(el.innerHTML, null, 'a seção não foi reescrita: o cartão nomeado continua no DOM');
  assert.equal(grade.attrs.has('data-esqueleto'), false);
  assert.match(cards[0].innerHTML, /Pedidos/);
  assert.match(cards[1].innerHTML, /Cancelados/);
});

test('pintarFileira remonta quando a estrutura muda (quantidade, classe ou nome)', async () => {
  const { pintarFileira } = await import('../public/js/views/comum.js');
  const lista = [{ rotulo: 'Pedidos', valor: '3', chave: 'pedidos' }, { rotulo: 'Cancelados', valor: '1' }];
  for (const cards of [
    [cardFalso('card s6', 'kpi-pedidos')],
    [cardFalso('card s3', 'kpi-pedidos'), cardFalso('card s3')],
    [cardFalso('card s6', 'kpi-ticket'), cardFalso('card s6')],
  ]) {
    const { el } = secaoFalsa(cards);
    pintarFileira(el, lista, 's6');
    assert.equal(el.innerHTML, '<div class="grade cartoes"><div class="card s6"></div><div class="card s6"></div></div>');
  }
});
