// Movimento nativo do navegador: troca de tela (View Transitions), contagem de números e revelação dos gráficos.
// Nada aqui toca em window/document no topo do módulo: o ambiente vem por parâmetro (testável em Node).
// Com prefers-reduced-motion ou sem suporte do navegador, tudo aparece pronto, sem efeito.

const DUR_LONGA = 900;
const DUR_MEDIA = 600;
const PASSO_BARRAS = 40;

// true se o usuário pediu menos movimento; false fora do navegador.
export function reduzido() {
  const w = globalThis.window;
  if (!w || typeof w.matchMedia !== 'function') return false;
  return w.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// Troca de tela: a callback é síncrona (nada de await dentro) para a captura não esperar a API.
// Com View Transition, o navegador roda a callback no quadro seguinte: devolve updateCallbackDone
// para quem for pintar depois esperar a troca (um quadro, nunca a API). Sem transição, roda na hora.
export function trocarTela(atualizar, { doc = globalThis.document, reduzido: r = reduzido() } = {}) {
  if (!r && typeof doc?.startViewTransition === 'function') {
    return doc.startViewTransition(atualizar)?.updateCallbackDone;
  }
  atualizar();
  return undefined;
}

// Ease-out quartic, com t limitado a [0, 1].
export function progresso(t) {
  const x = Math.min(1, Math.max(0, Number(t) || 0));
  return 1 - (1 - x) ** 4;
}

/**
 * Conta de `de` até `ate`, escrevendo formatar(valor) em el.textContent a cada quadro.
 * Uma nova chamada no mesmo el cancela a anterior (token em el._contagem) e parte do valor que está na tela.
 */
export function contar(el, ate, formatar, {
  de = el._contagem?.atual ?? (Number(el.dataset.valor) || 0),
  duracao = DUR_LONGA,
  reduzido: r = reduzido(),
  raf = globalThis.requestAnimationFrame,
  agora = () => performance.now(),
} = {}) {
  el.dataset.valor = ate;
  if (r || typeof raf !== 'function' || de === ate || !(duracao > 0)) {
    el._contagem = null;
    el.textContent = formatar(ate);
    return;
  }
  const token = { atual: de };
  el._contagem = token;
  const inicio = agora();
  const quadro = () => {
    if (el._contagem !== token) return; // outra contagem assumiu este elemento
    const t = (agora() - inicio) / duracao;
    if (t >= 1) {
      el._contagem = null;
      el.textContent = formatar(ate);
      return;
    }
    token.atual = de + (ate - de) * progresso(t);
    el.textContent = formatar(token.atual);
    raf(quadro);
  };
  el.textContent = formatar(de);
  raf(quadro);
}

// Curva --ease-peso da Task 1 (linear(), sem passar do alvo); 'ease-out' se não houver CSS.
function curva() {
  try {
    const v = globalThis.getComputedStyle?.(globalThis.document.documentElement).getPropertyValue('--ease-peso').trim();
    return v || 'ease-out';
  } catch {
    return 'ease-out';
  }
}

const anima = (alvo) => typeof alvo?.animate === 'function';

// Linha: o traço principal se desenha; depois área, comparação e pontos aparecem (total ≤ 900 ms).
export function revelarLinha(svg, { reduzido: r = reduzido() } = {}) {
  const traco = svg?.querySelector('.traco-serie');
  if (r || !anima(traco) || typeof traco.getTotalLength !== 'function') return;
  const easing = curva();
  const len = Math.ceil(traco.getTotalLength());
  if (!(len > 0)) return;
  traco.animate(
    [
      { strokeDasharray: `${len} ${len}`, strokeDashoffset: len },
      { strokeDasharray: `${len} ${len}`, strokeDashoffset: 0 },
    ],
    { duration: DUR_MEDIA, easing },
  );
  svg.querySelectorAll('.area, .traco-ref, .ponto').forEach((e) => {
    if (anima(e)) e.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DUR_LONGA - DUR_MEDIA, delay: DUR_MEDIA, easing, fill: 'backwards' });
  });
}

// Barras crescem do zero, escalonadas em até 40 ms × índice; a última termina em ≤ 900 ms.
export function crescerBarras(el, { reduzido: r = reduzido() } = {}) {
  if (r || !el) return;
  const easing = curva();
  const lista = [...el.querySelectorAll('.barra')];
  const atrasoMax = DUR_LONGA - DUR_MEDIA;
  lista.forEach((b, i) => {
    if (!anima(b)) return;
    b.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
      duration: DUR_MEDIA,
      delay: Math.min(i * PASSO_BARRAS, atrasoMax),
      easing,
      fill: 'backwards',
    });
  });
}
