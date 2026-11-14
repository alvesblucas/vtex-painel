import { test } from 'node:test';
import assert from 'node:assert/strict';

// Ambiente falso: rAF manual (guarda os callbacks) e relógio controlado.
function relogio() {
  let t = 0;
  let fila = [];
  const raf = (cb) => {
    fila.push(cb);
    return fila.length;
  };
  return {
    raf,
    agora: () => t,
    avancar(ms) {
      t += ms;
      const atuais = fila;
      fila = [];
      atuais.forEach((cb) => cb(t));
    },
    esgotar() {
      for (let i = 0; i < 1000 && fila.length; i++) this.avancar(16);
    },
  };
}

test('importar sem document/window não lança', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
  const mod = await import('../public/js/movimento.js');
  assert.equal(typeof mod.trocarTela, 'function');
  assert.equal(mod.reduzido(), false);
});

test('progresso: ease-out quartic limitado a [0, 1]', async () => {
  const { progresso } = await import('../public/js/movimento.js');
  assert.equal(progresso(0), 0);
  assert.equal(progresso(1), 1);
  assert.equal(progresso(2), 1);
  assert.equal(progresso(-1), 0);
  assert.ok(progresso(0.5) > 0.5);
});

test('trocarTela sem View Transitions chama a função na hora (Review Focus 3)', async () => {
  const { trocarTela } = await import('../public/js/movimento.js');
  let n = 0;
  trocarTela(() => n++, { doc: {} });
  assert.equal(n, 1);
});

test('trocarTela com View Transitions entrega a função ao navegador', async () => {
  const { trocarTela } = await import('../public/js/movimento.js');
  const recebidas = [];
  const fn = () => {};
  trocarTela(fn, { doc: { startViewTransition: (f) => recebidas.push(f) }, reduzido: false });
  assert.deepEqual(recebidas, [fn]);
});

test('trocarTela com movimento reduzido é instantânea (Review Focus 2)', async () => {
  const { trocarTela } = await import('../public/js/movimento.js');
  let chamadas = 0;
  let n = 0;
  trocarTela(() => n++, { doc: { startViewTransition: () => chamadas++ }, reduzido: true });
  assert.equal(chamadas, 0);
  assert.equal(n, 1);
});

test('contar com movimento reduzido escreve o valor final na hora (Review Focus 2)', async () => {
  const { contar } = await import('../public/js/movimento.js');
  const el = { textContent: '', dataset: {} };
  contar(el, 1258, String, { reduzido: true });
  assert.equal(el.textContent, '1258');
  assert.equal(Number(el.dataset.valor), 1258);
});

test('contar sem requestAnimationFrame escreve o valor final na hora', async () => {
  const { contar } = await import('../public/js/movimento.js');
  const el = { textContent: '', dataset: {} };
  contar(el, 42, String, { raf: undefined, reduzido: false });
  assert.equal(el.textContent, '42');
});

test('contar anima do valor anterior até o novo', async () => {
  const { contar } = await import('../public/js/movimento.js');
  const r = relogio();
  const el = { textContent: '', dataset: { valor: '10' } };
  contar(el, 110, (n) => String(Math.round(n)), { raf: r.raf, agora: r.agora, reduzido: false });
  r.avancar(16);
  const meio = Number(el.textContent);
  assert.ok(meio >= 10 && meio < 110, `quadro intermediário: ${meio}`);
  r.esgotar();
  assert.equal(el.textContent, '110');
});

test('filtro trocado no meio da contagem termina no valor mais novo (Review Focus 1)', async () => {
  const { contar } = await import('../public/js/movimento.js');
  const r = relogio();
  const el = { textContent: '', dataset: {} };
  const fmt = (n) => String(Math.round(n));
  contar(el, 100, fmt, { raf: r.raf, agora: r.agora, reduzido: false });
  r.avancar(450); // meio da contagem
  assert.notEqual(el.textContent, '100');
  contar(el, 50, fmt, { raf: r.raf, agora: r.agora, reduzido: false });
  r.esgotar();
  assert.equal(el.textContent, '50');
});

test('trocarTela devolve updateCallbackDone da transição (quem pinta depois espera a troca)', async () => {
  const { trocarTela } = await import('../public/js/movimento.js');
  const feito = Promise.resolve('ok');
  const doc = { startViewTransition: () => ({ updateCallbackDone: feito }) };
  assert.equal(trocarTela(() => {}, { doc, reduzido: false }), feito);
  assert.equal(trocarTela(() => {}, { doc: {} }), undefined);
});

test('crescerBarras: animate() que lança não derruba a pintura', async () => {
  const { crescerBarras } = await import('../public/js/movimento.js');
  let chamadas = 0;
  const barra = { animate() { chamadas++; throw new Error('fora do layout'); } };
  const el = { querySelectorAll: () => [barra, barra] };
  assert.doesNotThrow(() => crescerBarras(el, { reduzido: false }));
  assert.equal(chamadas, 2, 'uma barra que falha não impede as outras');
});
