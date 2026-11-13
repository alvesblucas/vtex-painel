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
