// Barra de filtros: período, comparação e seleções múltiplas com busca. As mudanças saem por aoMudar(filtros).
// Popovers: Esc fecha, setas navegam, Enter/Espaço marcam; a seleção vale ao fechar (Aplicar, Esc ou clique fora).
import {
  CMPS, LISTAS, MAX_DIAS, MAX_VALORES_TOTAL, PERIODOS, PERSONALIZADO,
  comLista, dataBr, diaValido, diasEntre, filtrosPadrao, hojeLocal, intervaloDe, montarHash, rotuloPeriodo, totalSelecionado,
} from './estado.js';
import { esc } from './ui.js';

export const NOMES = {
  periodo: 'Período', cmp: 'Comparar com',
  origem: 'Origem', categoria: 'Categoria', marca: 'Marca', pagamento: 'Pagamento', uf: 'UF', cidade: 'Cidade', entrega: 'Entrega',
};
const FONTES = { origem: 'origens', categoria: 'categorias', marca: 'marcas', pagamento: 'pagamentos', uf: 'ufs', entrega: 'entregas' };
const ROTULOS_VALOR = {
  pagamento: { pix: 'Pix', cartao: 'Cartão', boleto: 'Boleto', outros: 'Outros' },
  entrega: { retirada: 'Retirada', entrega: 'Entrega' },
};
export const rotuloValor = (lista, v) => ROTULOS_VALOR[lista]?.[v] ?? v;

const NAO_SE_APLICA = 'não se aplica a esta aba';
const MAX_OPCOES = 200;
const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const MASCULINO = new Set(['pagamento']);
const todasTxt = (l) => (MASCULINO.has(l) ? 'Todos' : 'Todas');
const selTxt = (l, n) => `${n} selecionad${MASCULINO.has(l) ? 'o' : 'a'}${n > 1 ? 's' : ''}`;
const ordenar = (a, b) => String(a).localeCompare(String(b), 'pt-BR');

function opcoesDe(lista, opcoes, filtros) {
  const base = lista === 'cidade'
    ? filtros.uf.flatMap((uf) => opcoes?.cidades?.[uf] ?? [])
    : opcoes?.[FONTES[lista]] ?? [];
  // Valores vindos do link que não estão mais nas opções continuam visíveis para poder desmarcar.
  return [...new Set([...base, ...filtros[lista]])].sort(ordenar);
}

let seq = 0;

/**
 * @param {HTMLElement} el
 * @param {{filtros: object, opcoes: object|null, aplicaveis: Set<string>, aoMudar: (f: object) => void, hoje?: string}} cfg
 */
export function montarBarra(el, { filtros, opcoes, aplicaveis, aoMudar, hoje = hojeLocal() }) {
  el._desmontar?.();
  const id = `fb${++seq}`;
  const aplica = (k) => aplicaveis.has(k);
  const padrao = filtrosPadrao(hoje);
  const alterados = totalSelecionado(filtros) > 0 || montarHash('', filtros) !== montarHash('', padrao);

  const disparo = (k, valor, extra = '') => {
    const off = !aplica(k) ? NAO_SE_APLICA : extra;
    const n = LISTAS.includes(k) ? filtros[k].length : 0;
    return `<div class="filtro" data-f="${k}">
      <button type="button" class="filtro-botao${n ? ' ativo' : ''}" id="${id}-${k}" aria-haspopup="dialog" aria-expanded="false"
        aria-controls="${id}-${k}-pop" ${off ? `disabled title="${esc(off)}"` : ''}>
        <span class="filtro-rotulo">${esc(NOMES[k])}</span>
        <span class="filtro-valor">${esc(valor)}</span>${n ? `<span class="contagem num">${n}</span>` : ''}
        <span class="seta" aria-hidden="true">▾</span>
      </button>
      <div class="popover" id="${id}-${k}-pop" role="dialog" aria-label="${esc(NOMES[k])}" hidden></div>
    </div>`;
  };

  const valorLista = (l) => {
    const v = filtros[l];
    if (!v.length) return todasTxt(l);
    return v.length === 1 ? rotuloValor(l, v[0]) : selTxt(l, v.length);
  };

  const pilulas = LISTAS.flatMap((l) => filtros[l].map((v) => {
    const off = !aplica(l);
    return `<button type="button" class="pilula${off ? ' inativa' : ''}" data-l="${l}" data-v="${esc(v)}"
      aria-label="Remover filtro ${esc(NOMES[l])}: ${esc(rotuloValor(l, v))}" ${off ? `title="${NAO_SE_APLICA}"` : ''}>
      <span class="pilula-l">${esc(NOMES[l])}</span><span class="pilula-v">${esc(rotuloValor(l, v))}</span><span aria-hidden="true">×</span></button>`;
  })).join('');

  el.innerHTML = `<div class="filtros-linha" role="toolbar" aria-label="Filtros">
      ${disparo('periodo', rotuloPeriodo(filtros))}
      <label class="filtro filtro-select${aplica('cmp') ? '' : ' desligado'}" ${aplica('cmp') ? '' : `title="${NAO_SE_APLICA}"`}>
        <span class="filtro-rotulo">${NOMES.cmp}</span>
        <select id="${id}-cmp" ${aplica('cmp') ? '' : 'disabled'}>
          ${Object.entries(CMPS).map(([k, t]) => `<option value="${k}" ${filtros.cmp === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
      </label>
      ${LISTAS.map((l) => disparo(l, valorLista(l), l === 'cidade' && !filtros.uf.length ? 'Escolha uma UF primeiro' : '')).join('')}
      ${alterados ? '<button type="button" class="btn-limpar" data-limpar>Limpar tudo</button>' : ''}
    </div>
    ${pilulas ? `<div class="pilulas" aria-label="Filtros ativos">${pilulas}</div>` : ''}`;

  // ---------- abrir / fechar ----------
  let aberto = null; // { k, pop, botao, aoFechar }

  function fechar({ focar = true, aplicar = true } = {}) {
    if (!aberto) return;
    const a = aberto;
    aberto = null;
    a.pop.hidden = true;
    a.pop.classList.remove('a-direita');
    a.botao.setAttribute('aria-expanded', 'false');
    if (focar) a.botao.focus();
    if (aplicar) a.aoFechar?.();
  }

  function abrir(k) {
    const caixa = el.querySelector(`.filtro[data-f="${k}"]`);
    const botao = caixa.querySelector('.filtro-botao');
    const pop = caixa.querySelector('.popover');
    fechar({ focar: false });
    aberto = { k, pop, botao, aoFechar: null };
    aberto.aoFechar = k === 'periodo' ? montarPeriodo(pop) : montarLista(pop, k);
    pop.hidden = false;
    botao.setAttribute('aria-expanded', 'true');
    if (pop.getBoundingClientRect().right > window.innerWidth - 8) pop.classList.add('a-direita');
    (pop.querySelector('[data-inicial]') ?? pop.querySelector('input, [tabindex="-1"], button'))?.focus();
  }

  // ---------- período ----------
  function montarPeriodo(pop) {
    const itens = Object.entries(PERIODOS).map(([k, t]) => {
      const { de, ate } = intervaloDe(k, hoje);
      const sel = filtros.periodo === k;
      const datas = de === ate ? dataBr(de).slice(0, 5) : `${dataBr(de).slice(0, 5)} – ${dataBr(ate).slice(0, 5)}`;
      return `<button type="button" class="opcao" data-p="${k}" aria-pressed="${sel}" ${sel ? 'data-inicial' : ''}>
        <span class="check" aria-hidden="true">✓</span><span class="opcao-t">${esc(t)}</span><span class="opcao-d num">${datas}</span></button>`;
    }).join('');
    const pers = filtros.periodo === PERSONALIZADO;
    pop.innerHTML = `<div class="opcoes-lista" data-nav>${itens}</div>
      <form class="personalizado" novalidate>
        <div class="personalizado-t">Personalizado${pers ? ' <span class="check" aria-hidden="true">✓</span>' : ''}</div>
        <div class="personalizado-campos">
          <label><span>De</span><input class="input" type="date" name="de" value="${filtros.de}" max="${hoje}" required></label>
          <label><span>Até</span><input class="input" type="date" name="ate" value="${filtros.ate}" max="${hoje}" required></label>
        </div>
        <div class="popover-aviso" role="alert" hidden></div>
        <button type="submit" class="btn primario">Aplicar datas</button>
      </form>`;
    pop.querySelector('.opcoes-lista').addEventListener('click', (ev) => {
      const b = ev.target.closest('[data-p]');
      if (!b) return;
      const p = b.dataset.p;
      fechar({ aplicar: false });
      if (p !== filtros.periodo) aoMudar({ ...filtros, periodo: p, ...intervaloDe(p, hoje) });
    });
    pop.querySelector('form').addEventListener('submit', (ev) => {
      ev.preventDefault();
      const de = ev.target.de.value;
      const ate = ev.target.ate.value;
      const aviso = pop.querySelector('.popover-aviso');
      let erro = '';
      if (!diaValido(de) || !diaValido(ate)) erro = 'Informe as duas datas.';
      else if (de > ate) erro = 'A data inicial é depois da final.';
      else if (diasEntre(de, ate) > MAX_DIAS) erro = `Período máximo de ${MAX_DIAS} dias.`;
      aviso.textContent = erro;
      aviso.hidden = !erro;
      if (erro) return;
      fechar({ aplicar: false });
      aoMudar({ ...filtros, periodo: PERSONALIZADO, de, ate });
    });
    return null;
  }

  // ---------- seleção múltipla ----------
  function montarLista(pop, lista) {
    const todas = opcoesDe(lista, opcoes, filtros);
    const rascunho = new Set(filtros[lista]);
    const nome = NOMES[lista].toLowerCase();
    pop.innerHTML = `<label class="sr" for="${id}-${lista}-busca">Buscar ${esc(nome)}</label>
      <input class="input busca" id="${id}-${lista}-busca" type="search" placeholder="Buscar ${esc(nome)}" autocomplete="off"
        ${todas.length > 8 ? 'data-inicial' : ''}>
      <div class="opcoes-lista" role="listbox" aria-multiselectable="true" aria-label="${esc(NOMES[lista])}" data-nav></div>
      <div class="popover-aviso" role="alert" hidden></div>
      <div class="popover-pe"><span class="muted num" data-n></span>
        <span><button type="button" class="btn" data-nenhum>Limpar</button>
        <button type="button" class="btn primario" data-ok>Aplicar</button></span></div>`;
    const caixa = pop.querySelector('.opcoes-lista');
    const busca = pop.querySelector('.busca');
    const aviso = pop.querySelector('.popover-aviso');
    const contador = pop.querySelector('[data-n]');

    const desenhar = () => {
      const t = normalizar(busca.value.trim());
      const achadas = t ? todas.filter((v) => normalizar(rotuloValor(lista, v)).includes(t)) : todas;
      caixa.replaceChildren();
      for (const v of achadas.slice(0, MAX_OPCOES)) {
        const o = document.createElement('div');
        o.className = 'opcao';
        o.setAttribute('role', 'option');
        o.tabIndex = -1;
        o.dataset.v = v;
        o.setAttribute('aria-selected', String(rascunho.has(v)));
        o.innerHTML = '<span class="check" aria-hidden="true">✓</span><span class="opcao-t"></span>';
        o.querySelector('.opcao-t').textContent = rotuloValor(lista, v);
        caixa.append(o);
      }
      if (!achadas.length) caixa.innerHTML = `<div class="opcoes-vazio">${todas.length ? 'Nada encontrado' : 'Sem opções no período'}</div>`;
      else if (achadas.length > MAX_OPCOES) {
        const mais = document.createElement('div');
        mais.className = 'opcoes-vazio';
        mais.textContent = `+${achadas.length - MAX_OPCOES} — refine a busca`;
        caixa.append(mais);
      }
      contador.textContent = rascunho.size ? selTxt(lista, rascunho.size) : todasTxt(lista);
    };

    const alternar = (o) => {
      const v = o.dataset.v;
      aviso.hidden = true;
      if (rascunho.has(v)) rascunho.delete(v);
      else if (!comLista(filtros, lista, [...rascunho, v], opcoes?.cidades)) {
        aviso.textContent = `Máximo de ${MAX_VALORES_TOTAL} valores somando todos os filtros.`;
        aviso.hidden = false;
        return;
      } else rascunho.add(v);
      o.setAttribute('aria-selected', String(rascunho.has(v)));
      contador.textContent = rascunho.size ? selTxt(lista, rascunho.size) : todasTxt(lista);
    };

    caixa.addEventListener('click', (ev) => {
      const o = ev.target.closest('[role="option"]');
      if (o) alternar(o);
    });
    caixa.addEventListener('keydown', (ev) => {
      const o = ev.target.closest('[role="option"]');
      if (o && (ev.key === 'Enter' || ev.key === ' ')) {
        ev.preventDefault();
        alternar(o);
      }
    });
    busca.addEventListener('input', desenhar);
    busca.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const unica = caixa.querySelectorAll('[role="option"]');
        if (unica.length === 1) alternar(unica[0]);
      }
    });
    pop.querySelector('[data-nenhum]').addEventListener('click', () => {
      rascunho.clear();
      aviso.hidden = true;
      desenhar();
    });
    pop.querySelector('[data-ok]').addEventListener('click', () => fechar());
    desenhar();

    return () => {
      const atual = filtros[lista];
      const mesmo = atual.length === rascunho.size && atual.every((v) => rascunho.has(v));
      if (mesmo) return;
      const novo = comLista(filtros, lista, [...rascunho], opcoes?.cidades);
      if (novo) aoMudar(novo);
    };
  }

  // ---------- navegação por teclado dentro do popover ----------
  function navegar(ev) {
    if (!aberto) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      fechar();
      return;
    }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Home' && ev.key !== 'End') return;
    const itens = [...aberto.pop.querySelectorAll('[data-nav] .opcao')];
    if (!itens.length) return;
    const busca = aberto.pop.querySelector('.busca');
    const i = itens.indexOf(document.activeElement);
    if (ev.target.matches('input[type="date"]')) return;
    ev.preventDefault();
    let j;
    if (ev.key === 'Home') j = 0;
    else if (ev.key === 'End') j = itens.length - 1;
    else if (ev.key === 'ArrowDown') j = i < 0 ? 0 : Math.min(itens.length - 1, i + 1);
    else if (i <= 0 && busca) return busca.focus();
    else j = Math.max(0, i - 1);
    itens[j].focus();
  }

  // ---------- eventos ----------
  el.querySelector('.filtros-linha').addEventListener('click', (ev) => {
    const b = ev.target.closest('.filtro-botao');
    if (b && !b.disabled) {
      const k = b.closest('.filtro').dataset.f;
      if (aberto?.k === k) fechar();
      else abrir(k);
      return;
    }
    if (ev.target.closest('[data-limpar]')) {
      fechar({ focar: false, aplicar: false });
      aoMudar(filtrosPadrao(hoje));
    }
  });
  el.querySelector(`#${id}-cmp`)?.addEventListener('change', (ev) => aoMudar({ ...filtros, cmp: ev.target.value }));
  el.querySelector('.pilulas')?.addEventListener('click', (ev) => {
    const p = ev.target.closest('.pilula');
    if (!p) return;
    const { l, v } = p.dataset;
    aoMudar(comLista(filtros, l, filtros[l].filter((x) => x !== v), opcoes?.cidades));
  });
  el.addEventListener('keydown', navegar);

  const foraDoPopover = (ev) => {
    if (aberto && !aberto.pop.closest('.filtro').contains(ev.target)) fechar({ focar: false });
  };
  document.addEventListener('pointerdown', foraDoPopover);
  el._desmontar = () => {
    document.removeEventListener('pointerdown', foraDoPopover);
    el.removeEventListener('keydown', navegar);
  };
}
