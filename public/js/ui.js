// Formatação e componentes de tela. Dinheiro chega em centavos inteiros.
import { contar } from './movimento.js';
import { VERSAO } from './versao.js';

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

const reais = (c, casas = 2) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });
export const brl = (c) => (c == null ? '—' : `R$ ${reais(c)}`);
export const brlK = (c) => {
  if (c == null) return '—';
  const r = Math.abs(c) / 100;
  const sinal = c < 0 ? '-' : '';
  if (r >= 1e6) return `${sinal}R$ ${(r / 1e6).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (r >= 1e4) return `${sinal}R$ ${(r / 1e3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mil`;
  return brl(c);
};
// Eixo: compacto a partir de R$ 10 mil, sem centavos abaixo disso.
export const brlEixo = (c) => (Math.abs(c) >= 1e6 ? brlK(c) : `R$ ${Math.round(c / 100).toLocaleString('pt-BR')}`);
export const int = (n) => (n == null ? '—' : Math.round(n).toLocaleString('pt-BR'));
export const pct = (a, b) => (b ? `${((a / b) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '—');
export const num1 = (n) => (n == null ? '—' : n.toLocaleString('pt-BR', { maximumFractionDigits: 1 }));

export const dm = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
export const dma = (dia) => `${dm(dia)}/${dia.slice(0, 4)}`;
const SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
export const semana = (dia) => SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()];

// Data e hora no fuso da loja a partir de um ISO em UTC.
export function quando(iso, fusoHoras = -3) {
  const ms = Date.parse(iso ?? '');
  if (Number.isNaN(ms)) return '—';
  const d = new Date(ms + fusoHoras * 3600000).toISOString();
  return `${dm(d)} ${d.slice(11, 16)}`;
}

export function ha(iso) {
  const h = (Date.now() - Date.parse(iso)) / 3600000;
  if (Number.isNaN(h)) return '—';
  if (h < 1) return 'há menos de 1 h';
  if (h < 24) return `há ${Math.floor(h)} h`;
  const d = Math.floor(h / 24);
  return `há ${d} dia${d > 1 ? 's' : ''}`;
}

// Variação percentual já calculada (ex.: 12.5) → seta, cor e número.
export function deltaPct(p, { subirEhBom = true } = {}) {
  if (p == null || !Number.isFinite(p)) return '<span class="delta flat" title="sem base de comparação">—</span>';
  const r = Math.round(p * 10) / 10;
  const dir = r > 0 ? 'up' : r < 0 ? 'down' : 'flat';
  const bom = r === 0 ? 'flat' : (r > 0) === subirEhBom ? 'up' : 'down';
  const seta = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '=';
  const txt = Math.abs(r).toLocaleString('pt-BR', { maximumFractionDigits: Math.abs(r) < 10 ? 1 : 0 });
  return `<span class="delta ${bom} num">${seta} ${txt}%</span>`;
}

// Variação de a sobre b.
export const delta = (a, b, opcoes) => (b ? deltaPct((a / b - 1) * 100, opcoes) : deltaPct(null));

const STATUS = { ok: 'ok', aviso: 'atenção', erro: 'problema', fora: 'fora do dia' };
export const pill = (status, texto) => `<span class="pill st-${esc(status)}"><i aria-hidden="true"></i>${esc(texto || STATUS[status] || status)}</span>`;

// Rodapé do produto (crédito do autor), igual em toda instância.
export const rodapeHtml = () => `<footer class="rodape"><span>vtex-painel · v${esc(VERSAO)}</span>
  <a href="https://github.com/alvesblucas" target="_blank" rel="noopener">Designed &amp; developed by Lucas Alves</a></footer>`;

// Tira o estado "recarregando" que carregando() põe quando já havia conteúdo.
export function pronto(el) {
  el.classList.remove('recarregando');
  el.removeAttribute('aria-busy');
}

// Carregando: na 1ª vez, esqueleto; se já há conteúdo, mantém o quadro esmaecido (sem pulo de layout).
export function carregando(el, { linhas = 3 } = {}) {
  el.setAttribute('aria-busy', 'true');
  if (el.childElementCount && !el.querySelector('.esqueleto, .estado')) {
    el.classList.add('recarregando');
    return;
  }
  el.innerHTML = `<div class="esqueleto" aria-label="Carregando">${'<span></span>'.repeat(linhas)}</div>`;
}

export function vazio(el, texto = 'Sem dados no período.') {
  pronto(el);
  el.innerHTML = `<div class="estado vazio"><span class="estado-icone" aria-hidden="true">∅</span>${esc(texto)}</div>`;
}

export function erroCartao(el, mensagem, tentar) {
  pronto(el);
  el.innerHTML = `<div class="estado erro" role="alert"><span class="estado-icone" aria-hidden="true">!</span>
    <span>${esc(mensagem || 'Não foi possível carregar.')}</span></div>`;
  if (typeof tentar === 'function') {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = 'Tentar de novo';
    b.addEventListener('click', () => tentar());
    el.querySelector('.estado').append(b);
  }
}

// Cartão de número: rótulo, valor (texto já formatado), sub e variação (html de delta()/deltaPct()).
// Ordem da mockup: rótulo em caixa alta → valor grande → variação e sub numa linha abaixo.
export const cartaoHtml = ({ rotulo, valor, sub, delta: variacao }) => `<div class="cartao-rotulo">${esc(rotulo)}</div>
    <div class="cartao-valor num">${esc(valor ?? '—')}</div>
    ${variacao || sub ? `<div class="cartao-pe">${variacao ?? ''}${sub ? `<span class="cartao-sub">${esc(sub)}</span>` : ''}</div>` : ''}`;

// Último elemento de valor de cada métrica: a contagem nova parte do que está na tela (troca de filtro ou de aba).
const valorPorChave = new Map();

// Opcionais: chave (nome da métrica, vira view-transition-name "kpi-<chave>" para o morph entre abas)
// e numero + formatar (o valor conta até numero). Sem numero finito, mostra valor (ou —) sem contar.
export function cartao(el, opcoes) {
  const { chave, numero, formatar } = opcoes;
  pronto(el);
  if (chave) el.style.viewTransitionName = `kpi-${chave}`;
  el.innerHTML = cartaoHtml(opcoes);
  if (!Number.isFinite(numero) || typeof formatar !== 'function') return;
  const valorEl = el.querySelector('.cartao-valor');
  const anterior = chave ? valorPorChave.get(chave) : null;
  if (chave) valorPorChave.set(chave, valorEl);
  const de = anterior ? anterior._contagem?.atual ?? Number(anterior.dataset.valor) : undefined;
  if (anterior) anterior._contagem = null; // o elemento antigo saiu da tela: para de contar
  contar(valorEl, numero, formatar, Number.isFinite(de) ? { de } : {});
}

// Aviso amarelo quando a fonte está atrasada em relação à agenda ({fonte: {horasMax}}) ou a última coleta falhou.
export function avisoDados(el, coletas = [], agenda = {}, { agora = Date.now(), fusoHoras = -3 } = {}) {
  const avisos = [];
  const porFonte = new Map(coletas.map((c) => [c.fonte, c]));
  const fontes = new Set([...porFonte.keys(), ...Object.keys(agenda)]);
  for (const fonte of fontes) {
    const c = porFonte.get(fonte);
    const horasMax = Number(agenda[fonte]?.horasMax);
    if (!c) {
      avisos.push(`Coleta de ${fonte}: nenhuma coleta concluída`);
    } else if (!c.ok) {
      avisos.push(`Última coleta de ${fonte} falhou (${quando(c.quando, fusoHoras)}) — dados podem estar incompletos`);
    } else if (Number.isFinite(horasMax) && horasMax > 0 && agora - Date.parse(c.quando) > horasMax * 3600000) {
      avisos.push(`Dados de ${fonte} até ${quando(c.quando, fusoHoras)} (${ha(c.quando)}; esperado a cada ${horasMax} h)`);
    }
  }
  el.innerHTML = avisos.map((t) => `<div class="aviso-dados" role="status"><span aria-hidden="true">⚠</span>${esc(t)}</div>`).join('');
  el.hidden = avisos.length === 0;
  return avisos.length > 0;
}

// ---------- tabela ----------

const FORMATOS = {
  brl: { tela: brl, csv: (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ',')), num: true },
  brlK: { tela: brlK, csv: (c) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ',')), num: true },
  int: { tela: int, csv: (n) => (n == null ? '' : String(Math.round(n))), num: true },
  pct: { tela: (n) => (n == null ? '—' : `${num1(n)}%`), csv: (n) => (n == null ? '' : String(n).replace('.', ',')), num: true },
  data: { tela: (d) => (d ? dma(d) : '—'), csv: (d) => d ?? '' },
  quando: { tela: (iso) => quando(iso), csv: (iso) => iso ?? '' },
  texto: { tela: (v) => (v == null || v === '' ? '—' : String(v)), csv: (v) => (v == null ? '' : String(v)) },
};

function formatoDe(col) {
  if (typeof col.formato === 'function') return { tela: col.formato, csv: (v) => (v == null ? '' : String(v)), num: col.alinhar === 'direita' };
  return FORMATOS[col.formato] ?? FORMATOS.texto;
}

const normalizar = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Texto que começa com = + - @ TAB ou CR vira fórmula no Excel: prefixa ' (só em valores que não são números).
const PERIGO_CSV = /^[=+\-@\t\r]/;
export const celulaSegura = (bruto, texto) => (typeof bruto !== 'number' && PERIGO_CSV.test(texto) ? `'${texto}` : texto);

// CSV para Excel: separador ;, BOM, CRLF, centavos → 1234,56.
export function csvTexto(colunas, linhas) {
  const cel = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const cab = colunas.map((c) => cel(celulaSegura(c.titulo, String(c.titulo)))).join(';');
  const corpo = linhas.map((l) => colunas.map((c) => {
    const bruto = l[c.chave];
    return cel(celulaSegura(bruto, formatoDe(c).csv(bruto)));
  }).join(';'));
  return `﻿${[cab, ...corpo].join('\r\n')}`;
}

export function baixarCsv(nome, texto) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([texto], { type: 'text/csv;charset=utf-8' }));
  a.download = nome.endsWith('.csv') ? nome : `${nome}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const CSV_MAX_SERVIDOR = 5000;
const ESPERA_BUSCA_MS = 300;
let idTabela = 0;

/**
 * Tabela com busca, ordenação, paginação e CSV.
 * Colunas: { chave, titulo, formato?, alinhar?, ordenavel? (false = cabeçalho sem ordenação), soDesc? (só ordem decrescente) }.
 *   celula?(linha, td): monta a célula com DOM próprio (escapar é com ela); busca/CSV continuam usando `formato`.
 * Modo cliente (padrão): recebe todas as linhas; busca/ordem/página locais; CSV do conjunto filtrado e ordenado.
 * Modo servidor: `servidor: { total, pagina, porPagina, ordem?: {chave, dir}, busca?, aoPagina(n), aoOrdenar(chave, dir), aoBuscar(texto) }`
 *   mostra só a página recebida; navegação chama os ganchos (busca com espera de 300 ms); `csvTodos: async () => linhas`
 *   gera o CSV (até 5.000 linhas; quem chama busca as páginas).
 * Devolve `{ atualizar({ linhas, total, pagina }) }` para trocar a página sem perder busca, ordem e foco.
 */
export function tabela(el, { colunas, linhas, porPagina = 25, busca = false, csv = '', vazioTexto = 'Nada para mostrar.', servidor = null, csvTodos = null }) {
  pronto(el);
  const id = `tb${++idTabela}`;
  const srv = servidor ? { ...servidor } : null;
  const tamanho = srv?.porPagina ?? porPagina;
  const st = {
    termo: srv?.busca ?? '',
    ordem: srv?.ordem?.chave ?? null,
    desc: srv?.ordem ? srv.ordem.dir !== 'asc' : true,
    pagina: srv?.pagina ?? 1,
  };
  let dados = linhas ?? [];
  const rotuloCsv = srv ? `Baixar CSV (até ${int(CSV_MAX_SERVIDOR)})` : 'Baixar CSV';
  el.innerHTML = `${busca || csv ? `<div class="tabela-barra">
      ${busca ? `<label class="campo-busca"><span class="sr">Buscar na tabela</span>
        <input class="input" type="search" placeholder="Buscar" autocomplete="off" id="${id}-busca" value="${esc(st.termo)}"></label>` : '<span></span>'}
      ${csv ? `<button type="button" class="btn" data-csv>${rotuloCsv}</button>` : ''}
    </div>` : ''}
    <div class="tabela-wrap"><table><thead><tr></tr></thead><tbody></tbody></table></div>
    <div class="tabela-pe"></div>`;
  const tr = el.querySelector('thead tr');
  const tbody = el.querySelector('tbody');
  const pe = el.querySelector('.tabela-pe');
  const wrap = el.querySelector('.tabela-wrap');
  const esperando = () => {
    wrap.classList.add('recarregando');
    wrap.setAttribute('aria-busy', 'true');
  };

  function cabecalho() {
    [...tr.children].forEach((th, i) => {
      const c = colunas[i];
      th.setAttribute('aria-sort', st.ordem === c.chave ? (st.desc ? 'descending' : 'ascending') : 'none');
      const b = th.querySelector('button');
      if (b) b.dataset.seta = st.ordem === c.chave ? (st.desc ? '↓' : '↑') : '';
    });
  }

  colunas.forEach((c) => {
    const th = document.createElement('th');
    th.scope = 'col';
    if (formatoDe(c).num || c.alinhar === 'direita') th.className = 'r';
    if (c.ordenavel === false) {
      const s = document.createElement('span');
      s.className = 'th-fixo';
      s.textContent = c.titulo;
      th.append(s);
      tr.append(th);
      return;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = c.titulo;
    b.addEventListener('click', () => {
      if (c.soDesc && st.ordem === c.chave && st.desc) return; // só decrescente: clicar de novo não muda nada
      st.desc = c.soDesc ? true : st.ordem === c.chave ? !st.desc : formatoDe(c).num;
      st.ordem = c.chave;
      st.pagina = 1;
      if (!srv) return desenhar();
      cabecalho();
      esperando();
      srv.aoOrdenar?.(c.chave, st.desc ? 'desc' : 'asc');
    });
    th.append(b);
    tr.append(th);
  });

  function filtradas() {
    let ls = dados;
    if (st.termo) {
      const t = normalizar(st.termo);
      ls = ls.filter((l) => colunas.some((c) => normalizar(formatoDe(c).tela(l[c.chave])).includes(t)));
    }
    if (st.ordem) {
      const k = st.ordem;
      const s = st.desc ? -1 : 1;
      ls = [...ls].sort((a, b) => {
        const x = a[k];
        const y = b[k];
        if (x == null && y == null) return 0;
        if (x == null) return 1;
        if (y == null) return -1;
        return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pt-BR')) * s;
      });
    }
    return ls;
  }

  // visiveis = linhas desta página; total = linhas do conjunto inteiro; ini = índice da 1ª visível.
  function pintar(visiveis, total, ini) {
    wrap.classList.remove('recarregando');
    wrap.removeAttribute('aria-busy');
    cabecalho();
    tbody.replaceChildren();
    if (!visiveis.length) {
      const td = document.createElement('td');
      td.colSpan = colunas.length;
      td.className = 'tabela-vazia';
      td.textContent = st.termo ? 'Nenhum resultado para a busca.' : vazioTexto;
      const vaziaTr = document.createElement('tr');
      vaziaTr.append(td);
      tbody.append(vaziaTr);
    }
    for (const l of visiveis) {
      const linha = document.createElement('tr');
      for (const c of colunas) {
        const f = formatoDe(c);
        const td = document.createElement('td');
        if (f.num || c.alinhar === 'direita') td.className = 'r num';
        if (c.celula) c.celula(l, td);
        else td.textContent = f.tela(l[c.chave]);
        linha.append(td);
      }
      tbody.append(linha);
    }
    const paginas = Math.max(1, Math.ceil(total / tamanho));
    pe.innerHTML = total > tamanho
      ? `<span class="num muted">${int(ini + 1)}–${int(Math.min(ini + visiveis.length, total))} de ${int(total)}</span>
        <span class="paginas"><button type="button" class="btn" data-pg="-1" ${st.pagina <= 1 ? 'disabled' : ''} aria-label="Página anterior">‹</button>
        <button type="button" class="btn" data-pg="1" ${st.pagina >= paginas ? 'disabled' : ''} aria-label="Próxima página">›</button></span>`
      : `<span class="num muted">${int(total)} ${total === 1 ? 'linha' : 'linhas'}</span>`;
  }

  function desenhar() {
    if (srv) return pintar(dados, srv.total ?? dados.length, (st.pagina - 1) * tamanho);
    const ls = filtradas();
    st.pagina = Math.min(st.pagina, Math.max(1, Math.ceil(ls.length / tamanho)));
    const ini = (st.pagina - 1) * tamanho;
    return pintar(ls.slice(ini, ini + tamanho), ls.length, ini);
  }

  pe.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pg]');
    if (!b) return;
    st.pagina += Number(b.dataset.pg);
    if (!srv) return desenhar();
    esperando();
    srv.aoPagina?.(st.pagina);
  });

  let espera = null;
  el.querySelector('input[type=search]')?.addEventListener('input', (ev) => {
    st.termo = ev.target.value.trim();
    st.pagina = 1;
    if (!srv) return desenhar();
    clearTimeout(espera);
    espera = setTimeout(() => {
      esperando();
      srv.aoBuscar?.(st.termo);
    }, ESPERA_BUSCA_MS);
  });

  el.querySelector('[data-csv]')?.addEventListener('click', async (ev) => {
    const b = ev.currentTarget;
    if (!srv) return baixarCsv(csv, csvTexto(colunas, filtradas()));
    if (typeof csvTodos !== 'function') return baixarCsv(csv, csvTexto(colunas, dados));
    b.disabled = true;
    b.textContent = 'Gerando CSV…';
    try {
      const todas = await csvTodos();
      baixarCsv(csv, csvTexto(colunas, (todas ?? []).slice(0, CSV_MAX_SERVIDOR)));
      b.textContent = rotuloCsv;
    } catch {
      b.textContent = 'CSV falhou — tentar de novo';
    } finally {
      b.disabled = false;
    }
  });

  desenhar();
  return {
    atualizar({ linhas: novas, total, pagina } = {}) {
      if (novas) dados = novas;
      if (srv && total != null) srv.total = total;
      if (pagina != null) st.pagina = pagina;
      desenhar();
    },
  };
}
