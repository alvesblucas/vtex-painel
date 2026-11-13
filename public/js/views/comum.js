// Peças comuns às views: estrutura reaproveitada entre filtros e blocos que carregam sozinhos.
import { CMPS } from '../estado.js';
import { erroCartao, esc, pronto } from '../ui.js';

const ESQUELETO = '<div class="esqueleto" aria-label="Carregando"><span></span><span></span><span></span></div>';

/**
 * Monta a estrutura da view uma vez; ao mudar só os filtros, devolve a mesma (sem pulo de layout).
 * A chave inclui o que muda a estrutura (ex.: ver valores).
 */
export function estrutura(el, chave, html) {
  const atual = el.firstElementChild;
  if (atual?.classList.contains('view') && atual.dataset.chave === chave) return { raiz: atual, nova: false };
  el.innerHTML = `<div class="view" data-chave="${chave}">${html}</div>`;
  return { raiz: el.firstElementChild, nova: true };
}

/**
 * Um bloco independente: esqueleto na 1ª vez (ou depois de erro), quadro esmaecido nas recargas,
 * erro com "Tentar de novo" só nele. Resposta de rota antiga nunca pinta (ctx.vivo()).
 */
export async function bloco(el, ctx, { carregar, pintar, aoFalhar, esqueleto = ESQUELETO, erro = 'Não foi possível carregar.' }) {
  el.setAttribute('aria-busy', 'true');
  if (el.dataset.pintado) el.classList.add('recarregando');
  else el.innerHTML = esqueleto;
  try {
    const dados = await carregar();
    if (!ctx.vivo()) return;
    pronto(el);
    el._ro?.disconnect(); // gráfico anterior não pode se redesenhar por cima
    el.dataset.pintado = '1';
    pintar(dados);
  } catch (e) {
    if (e?.name === 'AbortError' || !ctx.vivo()) return;
    delete el.dataset.pintado;
    el._ro?.disconnect();
    aoFalhar?.(e);
    erroCartao(el, e?.mensagem || erro, () => bloco(el, ctx, { carregar, pintar, aoFalhar, esqueleto, erro }));
  }
}

// Estado vazio dentro de um bloco de gráfico (desliga o redesenho do gráfico anterior).
export function semDados(el, texto = 'Sem vendas no período.') {
  el._ro?.disconnect();
  el.innerHTML = `<div class="estado vazio"><span class="estado-icone" aria-hidden="true">∅</span>${esc(texto)}</div>`;
}

export const rotuloCmp = (filtros) => CMPS[filtros.cmp] ?? 'Comparação';
export const temCmp = (filtros) => filtros.cmp !== 'nenhum';

// Placeholder com formato de cartão (mantém a altura da fileira enquanto carrega).
export const cartoesEsqueleto = (n, classe = 's3') =>
  `<div class="grade cartoes">${`<div class="card ${classe}">${ESQUELETO}</div>`.repeat(n)}</div>`;
