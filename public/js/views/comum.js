// Peças comuns às views: estrutura reaproveitada entre filtros e blocos que carregam sozinhos.
import { CMPS } from '../estado.js';
import { cartao, erroCartao, esc, pronto } from '../ui.js';

// data-esqueleto marca o placeholder: bloco() não o reescreve se ele já está na tela.
const ESQUELETO = '<div class="esqueleto" data-esqueleto aria-label="Carregando"><span></span><span></span><span></span></div>';

/**
 * Monta a estrutura da view uma vez; ao mudar só os filtros, devolve a mesma (sem pulo de layout).
 * A chave inclui o que muda a estrutura (ex.: ver valores).
 */
export function estrutura(el, chave, html, classe = '') {
  const atual = el.firstElementChild;
  if (atual?.classList.contains('view') && atual.dataset.chave === chave) return { raiz: atual, nova: false };
  el.innerHTML = `<div class="view${classe ? ` ${classe}` : ''}" data-chave="${chave}">${html}</div>`;
  return { raiz: el.firstElementChild, nova: true };
}

/**
 * Um bloco independente: esqueleto na 1ª vez (ou depois de erro), quadro esmaecido nas recargas,
 * erro com "Tentar de novo" só nele. Resposta de rota antiga nunca pinta (ctx.vivo()).
 */
export async function bloco(el, ctx, { carregar, pintar, aoFalhar, esqueleto = ESQUELETO, erro = 'Não foi possível carregar.' }) {
  el.setAttribute('aria-busy', 'true');
  if (el.dataset.pintado) el.classList.add('recarregando');
  // O esqueleto pintado na troca de aba fica: reescrevê-lo tiraria do DOM o cartão com
  // view-transition-name no meio da transição, e o Chrome cortaria o morph dos KPIs.
  else if (!el.firstElementChild?.hasAttribute('data-esqueleto')) el.innerHTML = esqueleto;
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
// chaves[i] dá ao i-ésimo cartão o view-transition-name final (kpi-<chave>): a troca de aba
// captura o esqueleto já com o nome, e o KPI da tela anterior faz morph até ele.
export const cartoesEsqueleto = (n, classe = 's3', chaves = []) => {
  const cartoes = Array.from({ length: n }, (_, i) => {
    const nome = chaves[i] ? ` style="view-transition-name: kpi-${esc(chaves[i])}"` : '';
    return `<div class="card ${classe}"${nome}>${ESQUELETO}</div>`;
  });
  return `<div class="grade cartoes" data-esqueleto>${cartoes.join('')}</div>`;
};

const nomeKpi = (item) => (item?.chave ? `kpi-${item.chave}` : '');

/**
 * Pinta a fileira de KPIs. Se os .card na tela (esqueleto ou pintura anterior) têm a mesma
 * quantidade, classe e nomes de morph, reaproveita-os: cartao() só troca o miolo e o elemento
 * nomeado continua no DOM durante a View Transition. Estrutura diferente: monta de novo.
 */
export function pintarFileira(el, lista, classe) {
  const grade = el.childElementCount === 1 ? el.firstElementChild : null;
  const cards = grade?.classList.contains('cartoes') ? [...grade.children] : [];
  const bate = cards.length === lista.length
    && cards.every((card, i) => card.className === `card ${classe}` && (card.style.viewTransitionName || '') === nomeKpi(lista[i]));
  if (bate) grade.removeAttribute('data-esqueleto');
  else el.innerHTML = `<div class="grade cartoes">${lista.map(() => `<div class="card ${classe}"></div>`).join('')}</div>`;
  el.querySelectorAll('.card').forEach((card, i) => cartao(card, lista[i]));
}
