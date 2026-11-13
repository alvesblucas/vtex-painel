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
