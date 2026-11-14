import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brl, brlK, csvTexto, delta, deltaPct, esc, int, pct } from '../public/js/ui.js';
import { escala } from '../public/js/graficos.js';

const NBSP = /\u00a0/g;
const limpo = (s) => s.replace(NBSP, ' ');

test('formatação de dinheiro em centavos', () => {
  assert.equal(limpo(brl(123456)), 'R$ 1.234,56');
  assert.equal(brl(null), '—');
  assert.equal(limpo(brlK(123456)), 'R$ 1.234,56');
  assert.equal(limpo(brlK(4_500_000)), 'R$ 45 mil');
  assert.equal(limpo(brlK(250_000_000)), 'R$ 2,5 mi');
  assert.equal(int(1234.4), '1.234');
  assert.equal(pct(1, 4), '25%');
  assert.equal(pct(1, 0), '—');
});

test('esc e variação', () => {
  assert.equal(esc('<img src=x onerror="a">&\''), '&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;');
  assert.match(delta(110, 100), /class="delta up num">▲ 10%/);
  assert.match(delta(90, 100), /down.*▼ 10%/);
  assert.match(delta(90, 0), /—/);
  assert.match(deltaPct(5, { subirEhBom: false }), /class="delta down num">▲ 5%/);
});

test('CSV: ;, BOM, CRLF, centavos com vírgula, aspas escapadas', () => {
  const colunas = [
    { chave: 'nome', titulo: 'Produto' },
    { chave: 'valor', titulo: 'Faturamento', formato: 'brl' },
    { chave: 'qtd', titulo: 'Qtd', formato: 'int' },
  ];
  const txt = csvTexto(colunas, [{ nome: 'Luva "P"; caixa', valor: 123456, qtd: 3 }, { nome: 'X', valor: 5, qtd: null }]);
  assert.equal(txt, '\uFEFF"Produto";"Faturamento";"Qtd"\r\n"Luva ""P""; caixa";"1234,56";"3"\r\n"X";"0,05";""');
});

test('escala do eixo com números redondos', () => {
  assert.deepEqual(escala(87), { max: 100, ticks: [0, 25, 50, 75, 100] });
  assert.deepEqual(escala(0), { max: 1, ticks: [0, 1] });
  assert.deepEqual(escala(123456), { max: 150000, ticks: [0, 50000, 100000, 150000] });
});

test('brlEixo: sem centavos, compacto a partir de R$ 10 mil', async () => {
  const { brlEixo } = await import('../public/js/ui.js');
  assert.equal(limpo(brlEixo(800000)), 'R$ 8.000');
  assert.equal(limpo(brlEixo(0)), 'R$ 0');
  assert.equal(limpo(brlEixo(1_500_000)), 'R$ 15 mil');
});

test('CSV: texto que vira fórmula no Excel ganha apóstrofo; números negativos não', async () => {
  const { celulaSegura } = await import('../public/js/ui.js');
  const colunas = [
    { chave: 'nome', titulo: 'Nome' },
    { chave: 'valor', titulo: 'Valor', formato: 'brl' },
    { chave: 'qtd', titulo: 'Qtd', formato: 'int' },
    { chave: 'obs', titulo: 'Obs', formato: (v) => String(v) },
  ];
  const linhas = [
    { nome: '=HYPERLINK("http://exemplo.com")', valor: -1234, qtd: -2, obs: '+1' },
    { nome: '-2+3', valor: 0, qtd: 0, obs: '@SUM(A1)' },
    { nome: '\tx', valor: 1, qtd: 1, obs: '\rx' },
    { nome: 'Normal - ok', valor: 1, qtd: 1, obs: 'a=b' },
  ];
  const [, ...corpo] = csvTexto(colunas, linhas).slice(1).split('\r\n');
  assert.equal(corpo[0], '"\'=HYPERLINK(""http://exemplo.com"")";"-12,34";"-2";"\'+1"');
  assert.equal(corpo[1], '"\'-2+3";"0,00";"0";"\'@SUM(A1)"');
  assert.equal(corpo[2], '"\'\tx";"0,01";"1";"\'\rx"');
  assert.equal(corpo[3], '"Normal - ok";"0,01";"1";"a=b"');
  assert.equal(celulaSegura(-5, '-5'), '-5');
  assert.equal(csvTexto([{ chave: 'a', titulo: '=x' }], []).slice(1), '"\'=x"');
});

test('CSV do modo servidor: linhas de várias páginas juntas, mesmo formato', () => {
  const colunas = [{ chave: 'sku', titulo: 'SKU' }, { chave: 'valor', titulo: 'Faturamento', formato: 'brl' }];
  const paginas = [[{ sku: 'A', valor: 100 }], [{ sku: 'B', valor: 250 }]];
  const txt = csvTexto(colunas, paginas.flat());
  assert.equal(txt, '\uFEFF"SKU";"Faturamento"\r\n"A";"1,00"\r\n"B";"2,50"');
});

test('rodapeHtml: crédito com link e versão do produto', async () => {
  const { rodapeHtml } = await import('../public/js/ui.js');
  const { VERSAO } = await import('../public/js/versao.js');
  const html = rodapeHtml();
  assert.match(html, /^<footer class="rodape"/);
  assert.ok(html.includes('Designed &amp; developed by Lucas Alves'));
  const link = html.match(/<a [^>]*href="https:\/\/github\.com\/alvesblucas"[^>]*>/)?.[0] ?? '';
  assert.ok(link, 'link para o GitHub do autor');
  assert.match(link, /rel="noopener"/);
  assert.match(link, /target="_blank"/);
  assert.ok(html.includes(`vtex-painel · v${VERSAO}`));
});

test('cartao sem número e com valor nulo mostra — sem contar (Review Focus 4)', async () => {
  const { cartao, cartaoHtml } = await import('../public/js/ui.js');
  assert.match(cartaoHtml({ rotulo: 'Pedidos', valor: null }), /<div class="cartao-valor num">—<\/div>/);
  assert.match(cartaoHtml({ rotulo: 'Pedidos', valor: '—' }), /<div class="cartao-valor num">—<\/div>/);
  // Elemento falso mínimo: o que pronto() e cartao() usam.
  const valorEl = { textContent: '', dataset: {} };
  const el = {
    innerHTML: '',
    style: {},
    classList: { remove() {} },
    removeAttribute() {},
    querySelector: () => valorEl,
  };
  cartao(el, { rotulo: 'Pedidos', valor: null, numero: null, formatar: String });
  assert.match(el.innerHTML, /cartao-valor num">—</);
  assert.equal(valorEl.textContent, '', 'não chamou contar');
  assert.equal(el.style.viewTransitionName, undefined);
  cartao(el, { rotulo: 'Pedidos', valor: '7', chave: 'pedidos', numero: 7, formatar: String });
  assert.equal(el.style.viewTransitionName, 'kpi-pedidos');
  assert.equal(valorEl.textContent, '7', 'sem rAF no Node, escreve o valor final na hora');
});

test('cartaoHtml segue a mockup: rótulo, valor e a variação abaixo do valor', async () => {
  const { cartaoHtml } = await import('../public/js/ui.js');
  const html = cartaoHtml({ rotulo: 'Pedidos', valor: '7', sub: 'vs anterior', delta: '<span class="delta up num">▲ 2%</span>' });
  const iValor = html.indexOf('cartao-valor');
  assert.ok(html.indexOf('cartao-rotulo') < iValor);
  assert.ok(html.indexOf('class="delta') > iValor, 'variação abaixo do valor');
  assert.match(html, /<div class="cartao-pe">.*<span class="cartao-sub">vs anterior<\/span><\/div>/s);
  assert.doesNotMatch(cartaoHtml({ rotulo: 'Pedidos', valor: '7' }), /cartao-pe/);
});

test('cartaoHtml: valor longo nunca some calado; o title guarda o valor inteiro', async () => {
  const { cartaoHtml } = await import('../public/js/ui.js');
  const html = cartaoHtml({ rotulo: 'Faturamento', valor: 'R$ 12.345.678.901,23' });
  assert.ok(html.includes('class="cartao-valor num" title="R$ 12.345.678.901,23">'), html);
  assert.doesNotMatch(cartaoHtml({ rotulo: 'Pedidos', valor: null }), /title=/);
  assert.doesNotMatch(cartaoHtml({ rotulo: 'Pedidos', valor: '—' }), /title=/);
});

// Cartão falso: o que pronto(), cartao() e contar() usam.
const cartaoFalso = () => {
  const valorEl = { textContent: '', dataset: {} };
  return { valorEl, el: { innerHTML: '', style: {}, classList: { remove() {} }, removeAttribute() {}, querySelector: () => valorEl } };
};

// rAF guardado (não roda): o 1º texto escrito por contar() é formatar(de), o ponto de partida da contagem.
async function comRafParado(fn) {
  const antes = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = () => 0;
  try {
    return await fn();
  } finally {
    if (antes === undefined) delete globalThis.requestAnimationFrame;
    else globalThis.requestAnimationFrame = antes;
  }
}

test('cartao com contagem (sem chave) parte do valor anterior e não ganha nome de morph', async () => {
  const { cartao } = await import('../public/js/ui.js');
  const a = cartaoFalso();
  cartao(a.el, { rotulo: 'Cancelados', valor: '5', contagem: 'teste-cancelados', numero: 5, formatar: String });
  assert.equal(a.valorEl.textContent, '5');
  await comRafParado(() => {
    const b = cartaoFalso();
    cartao(b.el, { rotulo: 'Cancelados', valor: '9', contagem: 'teste-cancelados', numero: 9, formatar: String });
    assert.equal(b.valorEl.textContent, '5', 'contagem começa em 5 (o valor anterior), não em 0');
    assert.equal(b.valorEl.dataset.valor, 9);
    assert.equal(b.el.style.viewTransitionName, undefined, 'contagem não dá view-transition-name');
    // Sem contagem nem chave: parte do zero.
    const c = cartaoFalso();
    cartao(c.el, { rotulo: 'X', valor: '9', numero: 9, formatar: String });
    assert.equal(c.valorEl.textContent, '0');
  });
});

test('brlK com ref: a unidade vem do valor final, os intermediários não trocam de unidade', async () => {
  const { brlK, cartao } = await import('../public/js/ui.js');
  assert.equal(limpo(brlK(1_890_000, 935_506)), 'R$ 18.900,00');
  assert.equal(limpo(brlK(935_506, 1_890_000)), 'R$ 9,4 mil');
  assert.equal(limpo(brlK(935_506)), 'R$ 9.355,06');
  const a = cartaoFalso();
  cartao(a.el, { rotulo: 'Faturamento', valor: brlK(1_890_000), contagem: 'teste-fat', numero: 1_890_000, formatar: brlK });
  assert.equal(limpo(a.valorEl.textContent), 'R$ 18,9 mil');
  await comRafParado(() => {
    const b = cartaoFalso();
    cartao(b.el, { rotulo: 'Faturamento', valor: brlK(935_506), contagem: 'teste-fat', numero: 935_506, formatar: brlK });
    assert.equal(limpo(b.valorEl.textContent), 'R$ 18.900,00', 'ponto de partida já na unidade do valor final');
  });
});
