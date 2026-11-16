// Vendas: cartões → linha por dia (comparação tracejada) → barras por dimensão (clique filtra) → produtos.
import { rotuloValor } from '../barra-filtros.js';
import { LISTAS } from '../estado.js';
import { barras, linha } from '../graficos.js';
import { brl, brlEixo, brlK, CSV_MAX_SERVIDOR, delta, deltaPct, dm, dma, erroCartao, esc, int, semana, tabela } from '../ui.js';
import { bloco, cartoesEsqueleto, estrutura, pintarFileira, rotuloCmp, semDados, temCmp } from './comum.js';
import { gavetaLeitura } from './modal.js';

const SEM_CHAVE = '(não informado)';
const QUEBRAS = [
  ['origem', 'Por origem'],
  ['categoria', 'Por categoria'],
  ['marca', 'Por marca'],
  ['pagamento', 'Por pagamento'],
  ['uf', 'Por UF'],
  ['entrega', 'Por entrega'],
];
const DE_ITENS = new Set(['marca', 'categoria']);
const AVISO_ITENS = 'Com filtro de marca/categoria, os valores são só dos itens, sem frete.';

// Preferências da sessão (sobrevivem à troca de filtros).
const pref = { medida: 'valor', ordem: null, busca: '', modo: 'mais' };

// KPIs: os três primeiros fazem morph com os da Visão geral (mesmas chaves).
const chavesResumo = (vv) => (vv ? ['faturamento', 'pedidos', 'ticket'] : ['pedidos']);
const esqueletoResumo = (vv) => cartoesEsqueleto(vv ? 4 : 2, vv ? 's3' : 's6', chavesResumo(vv));

function montar(el, vv) {
  return estrutura(el, `vendas-${vv ? 1 : 0}`, `
    <div class="aviso-info aviso-itens" role="status" hidden><span aria-hidden="true">ⓘ</span>${esc(AVISO_ITENS)}</div>
    <section class="secao" aria-label="Resumo" data-b="resumo">${esqueletoResumo(vv)}</section>
    <section class="card secao" aria-labelledby="t-serie">
      <div class="card-head"><h2 id="t-serie">Por dia</h2>
        ${vv ? `<div class="segmentos" role="group" aria-label="Medida do gráfico">
          <button type="button" class="segmento" data-medida="valor">Faturamento</button>
          <button type="button" class="segmento" data-medida="pedidos">Pedidos</button></div>` : '<span class="sub">Pedidos</span>'}
      </div>
      <div data-b="serie"></div>
    </section>
    <div class="grade secao">
      ${QUEBRAS.map(([por, titulo]) => `<section class="card s6" aria-labelledby="t-${por}">
        <div class="card-head"><h2 id="t-${por}">${titulo}</h2><span class="sub" data-sub="${por}"></span></div>
        <div data-b="q-${por}"></div><div class="quebra-pe muted" data-pe="${por}"></div>
      </section>`).join('')}
    </div>
    <section class="card secao" aria-labelledby="t-produtos">
      <div class="card-head"><h2 id="t-produtos">Produtos</h2><span class="sub">${vv ? 'valores dos itens, sem frete' : 'por quantidade'}</span>
        <div class="segmentos" role="group" aria-label="Lista de produtos">
          ${MODOS_PRODUTOS.map(([m, t]) => `<button type="button" class="segmento" data-modo="${m}">${t}</button>`).join('')}</div>
      </div>
      <div data-b="produtos"></div><div class="quebra-pe muted" data-pe="produtos"></div>
    </section>`, 'dados');
}

// Síncrono, chamado dentro da troca de aba: a View Transition captura esta estrutura e render() a reaproveita.
export function esqueleto(el, { eu }) {
  montar(el, Boolean(eu.verValores));
}

export async function render(el, ctx) {
  const vv = Boolean(ctx.eu.verValores);
  ctx.aplicaveis(['periodo', 'cmp', ...LISTAS]);
  const { raiz } = montar(el, vv);

  const b = (k) => raiz.querySelector(`[data-b="${k}"]`);
  const aviso = raiz.querySelector('.aviso-itens');
  const porItens = {};
  const marcarItens = (fonte, sim) => {
    porItens[fonte] = Boolean(sim);
    aviso.hidden = !Object.values(porItens).some(Boolean);
  };
  const medida = () => (vv ? pref.medida : 'pedidos');
  const f = ctx.filtros;
  // Últimas respostas desta rota: trocar a medida repinta sem consultar de novo.
  const ultimos = {};
  const repintar = () => {
    if (ultimos.serie) pintarSerie(b('serie'), ultimos.serie, medida(), f);
    for (const [por] of QUEBRAS) if (ultimos[por]) pintarQuebra(raiz, b(`q-${por}`), por, ultimos[por], medida(), ctx);
  };
  const marcarMedida = () => raiz.querySelectorAll('[data-medida]').forEach((botao) => {
    botao.setAttribute('aria-pressed', String(botao.dataset.medida === medida()));
  });
  marcarMedida();
  raiz.querySelectorAll('[data-medida]').forEach((botao) => {
    botao.onclick = () => {
      if (pref.medida === botao.dataset.medida || !ctx.vivo()) return;
      pref.medida = botao.dataset.medida;
      marcarMedida();
      repintar();
    };
  });
  const marcarModo = () => raiz.querySelectorAll('[data-modo]').forEach((botao) => {
    botao.setAttribute('aria-pressed', String(botao.dataset.modo === pref.modo));
  });
  marcarModo();
  raiz.querySelectorAll('[data-modo]').forEach((botao) => {
    botao.onclick = () => {
      if (pref.modo === botao.dataset.modo || !ctx.vivo()) return;
      pref.modo = botao.dataset.modo;
      marcarModo();
      produtos(b('produtos'), ctx, vv, raiz);
    };
  });

  await Promise.all([
    bloco(b('resumo'), ctx, {
      esqueleto: esqueletoResumo(vv),
      carregar: () => ctx.api('/api/vendas/resumo', f),
      aoFalhar: () => marcarItens('resumo', false),
      pintar: (d) => {
        marcarItens('resumo', d.porItens);
        pintarResumo(b('resumo'), d, vv, f);
      },
    }),
    bloco(b('serie'), ctx, {
      carregar: () => ctx.api('/api/vendas/serie', f),
      aoFalhar: () => marcarItens('serie', false),
      pintar: (d) => {
        marcarItens('serie', d.porItens);
        ultimos.serie = d;
        pintarSerie(b('serie'), d, medida(), f);
      },
    }),
    ...QUEBRAS.map(([por]) => bloco(b(`q-${por}`), ctx, {
      carregar: () => ctx.api(`/api/vendas/quebra?por=${por}`, f),
      aoFalhar: () => marcarItens(`q-${por}`, false),
      pintar: (d) => {
        if (!DE_ITENS.has(por)) marcarItens(`q-${por}`, d.porItens);
        ultimos[por] = d;
        pintarQuebra(raiz, b(`q-${por}`), por, d, medida(), ctx);
      },
    })),
    produtos(b('produtos'), ctx, vv, raiz),
  ]);
}

// ---------- cartões ----------

function pintarResumo(el, d, vv, f) {
  const a = d.atual;
  const c = d.cmp;
  if (!a.pedidos && !a.cancelados) {
    el.innerHTML = `<div class="card estado-faixa"><span class="estado-icone" aria-hidden="true">∅</span>
      <strong>Sem vendas no período</strong>${c?.pedidos ? `<span class="muted">${esc(rotuloCmp(f))}: ${int(c.pedidos)} pedidos</span>` : ''}</div>`;
    return;
  }
  const antes = (txt) => (c ? `${rotuloCmp(f)}: ${txt}` : '');
  const cartoes = [
    vv && { rotulo: 'Faturamento', icone: 'dinheiro', valor: brlK(a.valor), sub: c ? antes(brlK(c.valor)) : brl(a.valor), delta: c ? delta(a.valor, c.valor) : '', chave: 'faturamento', numero: a.valor, formatar: brlK },
    { rotulo: 'Pedidos', icone: 'sacola', valor: int(a.pedidos), sub: antes(int(c?.pedidos)), delta: c ? delta(a.pedidos, c.pedidos) : '', chave: 'pedidos', numero: a.pedidos, formatar: int },
    vv && { rotulo: 'Ticket médio', icone: 'ticket', valor: brl(a.ticket), sub: antes(brl(c?.ticket)), delta: c ? delta(a.ticket, c.ticket) : '', chave: 'ticket', numero: a.ticket, formatar: brl },
    { rotulo: 'Cancelados', icone: 'cancelado', valor: int(a.cancelados), sub: antes(int(c?.cancelados)), delta: c ? delta(a.cancelados, c.cancelados, { subirEhBom: false }) : '', contagem: 'cancelados', numero: a.cancelados, formatar: int },
  ].filter(Boolean);
  pintarFileira(el, cartoes, vv ? 's3' : 's6');
}

// ---------- série por dia ----------

function pintarSerie(el, d, medida, f) {
  const pontos = d.pontos ?? [];
  if (!pontos.some((p) => p.pedidos)) {
    semDados(el);
    return;
  }
  const emR = medida === 'valor';
  const fmt = emR ? brl : int;
  const ref = (p) => (emR ? p.cmpValor : p.cmpPedidos);
  const nome = emR ? 'Faturamento' : 'Pedidos';
  linha(el, pontos.map((p) => ({
    x: dm(p.dia),
    y: emR ? p.valor : p.pedidos,
    ref: ref(p) ?? null,
    titulo: `${nome} · ${semana(p.dia)}`,
    dica: [
      { cor: 'serie', rotulo: dma(p.dia), valor: fmt(emR ? p.valor : p.pedidos) },
      ...(ref(p) != null && p.cmpDia ? [{ cor: 'ref', rotulo: dma(p.cmpDia), valor: fmt(ref(p)) }] : []),
    ],
  })), {
    fmtY: emR ? brlEixo : int,
    fmtDica: fmt,
    rotulo: 'Período',
    rotuloRef: rotuloCmp(f),
    titulo: `${nome} por dia`,
  });
}

// ---------- quebras ----------

function pintarQuebra(raiz, el, por, d, medida, ctx) {
  const emR = medida === 'valor';
  const deItens = DE_ITENS.has(por);
  const nomeMedida = emR ? 'Faturamento' : deItens ? `Pedidos com a ${por}` : 'Pedidos';
  raiz.querySelector(`[data-sub="${por}"]`).textContent = deItens
    ? (emR ? 'itens, sem frete' : `pedidos com a ${por}`)
    : (emR ? 'faturamento' : 'pedidos');
  const itens = (d.itens ?? []).map((i) => ({
    chave: i.chave,
    rotulo: rotuloValor(por, i.chave),
    valor: emR ? i.valor : i.pedidos,
    cmp: temCmp(ctx.filtros) ? (emR ? i.cmpValor : i.cmpPedidos) ?? null : null,
  }));
  barras(el, itens, {
    formato: emR ? brlK : int,
    rotulo: nomeMedida,
    rotuloRef: rotuloCmp(ctx.filtros),
    titulo: `${nomeMedida} por ${por}`,
    aoClicar: (chave) => {
      if (chave === SEM_CHAVE) return;
      const item = por === 'categoria' ? (d.itens ?? []).find((i) => i.chave === chave) : null;
      if (item) detalheCategoria(ctx, item, document.activeElement);
      else ctx.aplicarFiltro(por, chave);
    },
  });
  const outros = emR ? d.outros?.valor : d.outros?.pedidos;
  const pe = [];
  if (outros) pe.push(`Outros: ${emR ? brlK(outros) : int(outros)}`);
  if (deItens && !emR) pe.push(`um pedido pode estar em mais de uma ${por}`);
  raiz.querySelector(`[data-pe="${por}"]`).textContent = pe.join(' · ');
}

// ---------- gaveta da categoria: produtos que subiram e caíram nela ----------

const TOP_DETALHE = 5;

function listaDetalhe(titulo, lista) {
  if (!lista) return `<section class="detalhe-bloco"><h3>${titulo}</h3><p class="muted">Carregando…</p></section>`;
  const linhas = lista.slice(0, TOP_DETALHE).map((p) => `<li><span class="detalhe-nome">${esc(p.nome ?? p.sku)}</span>${deltaPct(p.varQtd)}</li>`);
  return `<section class="detalhe-bloco"><h3>${titulo}</h3>${linhas.length ? `<ol class="detalhe-lista">${linhas.join('')}</ol>` : '<p class="muted">Nenhum produto com variação.</p>'}</section>`;
}

// HTML do corpo da gaveta; `subiram`/`caiu` null = carregando. Números do topo vêm da própria barra clicada.
export function htmlDetalheCategoria({ item, subiram, caiu, vv, temCmp: comCmp, rotuloCmp: rotulo }) {
  const linha = (nome, atual, antes, fmt) => `<div class="detalhe-kpi"><span class="muted">${nome}</span>
    <strong>${fmt(atual)}</strong>${comCmp ? delta(atual, antes) : ''}</div>`;
  const topo = `<div class="detalhe-topo">${linha('Pedidos', item.pedidos, item.cmpPedidos, int)}${vv ? linha('Faturamento', item.valor, item.cmpValor, brl) : ''}
    ${comCmp ? `<p class="muted detalhe-ref">vs ${esc(rotulo)}</p>` : ''}</div>`;
  const listas = comCmp
    ? `${listaDetalhe('Mais subiram', subiram)}${listaDetalhe('Mais caíram', caiu)}`
    : `<p class="muted">${esc(SEM_CMP_PRODUTOS)}</p>`;
  return `${topo}${listas}<button type="button" class="btn primario" data-filtrar>Filtrar a página por esta categoria</button>`;
}

async function detalheCategoria(ctx, item, gatilho) {
  if (!ctx.vivo()) return; // barra de uma renderização já trocada
  const vv = Boolean(ctx.eu.verValores);
  const comCmp = temCmp(ctx.filtros);
  const base = { item, vv, temCmp: comCmp, rotuloCmp: rotuloCmp(ctx.filtros) };
  const g = gavetaLeitura({ titulo: item.chave, gatilho, signal: ctx.signal, html: htmlDetalheCategoria({ ...base, subiram: null, caiu: null }) });
  const ligar = () => {
    g.corpo.querySelector('[data-filtrar]').addEventListener('click', () => {
      g.fechar(false);
      ctx.aplicarFiltro('categoria', item.chave);
    });
  };
  ligar();
  if (!comCmp) return;
  const filtros = { ...ctx.filtros, categoria: [item.chave] };
  const buscar = (modo) => ctx.api(`/api/vendas/produtos?${new URLSearchParams({ modo, pagina: '1' })}`, filtros);
  try {
    const [subiram, caiu] = await Promise.all([buscar('subiram'), buscar('caiu')]);
    if (!g.aberta() || !ctx.vivo()) return;
    g.corpo.innerHTML = htmlDetalheCategoria({ ...base, subiram: subiram.itens, caiu: caiu.itens });
    ligar();
  } catch (e) {
    if (e?.name === 'AbortError' || !g.aberta() || !ctx.vivo()) return;
    g.corpo.querySelectorAll('.detalhe-bloco').forEach((s) => s.remove());
    g.corpo.insertAdjacentHTML('afterbegin', `<p class="gaveta-erro" role="alert">${esc(e?.mensagem || 'Não foi possível carregar os produtos.')}</p>`);
  }
}

// ---------- produtos (paginação no servidor) ----------

const MODOS_PRODUTOS = [['mais', 'Mais vendidos'], ['subiram', 'Subiram'], ['caiu', 'Caíram']];
const NOTA_VARIACAO = 'Só entram produtos com 3+ pedidos no período de comparação.';
const SEM_CMP_PRODUTOS = 'Escolha uma comparação na barra para ver o que subiu ou caiu.';
const VAZIO_PRODUTOS = { mais: 'Nenhum produto vendido no período.', subiram: 'Nenhum produto com variação no período.', caiu: 'Nenhum produto com variação no período.' };

const colVariacao = (chave, titulo) => ({
  chave, titulo, formato: 'pct', ordenavel: false,
  celula: (l, td) => { td.innerHTML = deltaPct(l[chave]); },
});

// Colunas da tabela de produtos por modo; sem R$ somem Faturamento e a variação de preço.
export function colunasProdutos(modo, vv) {
  const base = [
    { chave: 'nome', titulo: 'Produto', ordenavel: false },
    { chave: 'sku', titulo: 'SKU', ordenavel: false },
    { chave: 'marca', titulo: 'Marca', ordenavel: false },
    { chave: 'categoria', titulo: 'Categoria', ordenavel: false },
  ];
  const valor = vv ? [{ chave: 'valor', titulo: 'Faturamento', formato: 'brl', soDesc: true, ...(modo === 'mais' ? {} : { ordenavel: false }) }] : [];
  if (modo === 'mais') {
    return [...base,
      { chave: 'qtd', titulo: 'Qtd', formato: 'int', soDesc: true },
      { chave: 'pedidos', titulo: 'Pedidos', formato: 'int', soDesc: true },
      ...valor];
  }
  return [...base,
    { chave: 'qtd', titulo: 'Qtd', formato: 'int', ordenavel: false },
    { chave: 'qtdAntes', titulo: 'Antes', formato: 'int', ordenavel: false },
    colVariacao('varQtd', 'Var. %'),
    ...(vv ? [colVariacao('varPreco', 'Var. preço %')] : []),
    ...valor];
}

// Nota do rodapé: só nos modos novos e nunca junto do aviso de "sem comparação".
export const notaProdutos = (modo, semComparacao) => (modo === 'mais' || semComparacao ? '' : NOTA_VARIACAO);

// Troca de aba em sequência rápida: só a geração mais nova pinta.
let geracaoProdutos = 0;

// Resposta ou erro de uma geração que já foi trocada vira AbortError (bloco() ignora em silêncio).
export async function soNaGeracao(promessa, gen, geracaoAtual) {
  const velha = () => new DOMException('Aba de produtos trocada', 'AbortError');
  let d;
  try {
    d = await promessa;
  } catch (e) {
    throw gen === geracaoAtual() ? e : velha();
  }
  if (gen !== geracaoAtual()) throw velha();
  return d;
}

async function produtos(el, ctx, vv, raiz) {
  const gen = ++geracaoProdutos;
  const modo = pref.modo;
  const ordens = vv ? ['valor', 'qtd', 'pedidos'] : ['qtd', 'pedidos'];
  if (!ordens.includes(pref.ordem)) pref.ordem = ordens[0];
  const colunas = colunasProdutos(modo, vv);
  const nota = raiz?.querySelector('[data-pe="produtos"]');
  const marcarNota = (semComparacao) => { if (nota) nota.textContent = notaProdutos(modo, semComparacao); };
  marcarNota(false);
  const atual = () => gen === geracaoProdutos && ctx.vivo();
  const buscar = (pagina) => {
    const q = new URLSearchParams({ pagina: String(pagina), modo });
    if (modo === 'mais') q.set('ordem', pref.ordem);
    if (pref.busca) q.set('busca', pref.busca);
    return ctx.api(`/api/vendas/produtos?${q}`, ctx.filtros);
  };
  let t = null;
  // Página/ordem/busca em sequência rápida: só a resposta mais nova pinta.
  let seq = 0;
  const ir = async (pagina) => {
    const meu = ++seq;
    try {
      const d = await buscar(pagina);
      if (meu !== seq || !atual()) return;
      t.atualizar({ linhas: d.itens, total: d.total, pagina: d.pagina });
    } catch (e) {
      if (e?.name === 'AbortError' || meu !== seq || !atual()) return;
      t.atualizar({});
      delete el.dataset.pintado;
      erroCartao(el, e?.mensagem || 'Não foi possível carregar os produtos.', () => produtos(el, ctx, vv, raiz));
    }
  };
  const csvTodos = async () => {
    const todas = [];
    for (let pagina = 1; todas.length < CSV_MAX_SERVIDOR; pagina++) {
      if (!ctx.vivo()) throw new DOMException('Rota trocada', 'AbortError');
      const d = await buscar(pagina);
      todas.push(...d.itens);
      if (!d.itens.length || todas.length >= d.total) break;
    }
    return todas.slice(0, CSV_MAX_SERVIDOR);
  };
  return bloco(el, ctx, {
    carregar: () => soNaGeracao(buscar(1), gen, () => geracaoProdutos),
    pintar: (d) => {
      marcarNota(Boolean(d.semComparacao));
      if (d.semComparacao) {
        semDados(el, SEM_CMP_PRODUTOS);
        return;
      }
      t = tabela(el, {
        colunas,
        linhas: d.itens,
        busca: true,
        csv: modo === 'mais' ? 'produtos' : `produtos-${modo}`,
        vazioTexto: VAZIO_PRODUTOS[modo],
        servidor: {
          total: d.total,
          pagina: 1,
          porPagina: d.porPagina,
          ordem: modo === 'mais' ? { chave: pref.ordem, dir: 'desc' } : null,
          busca: pref.busca,
          aoPagina: (n) => ir(n),
          aoOrdenar: (chave) => {
            if (modo !== 'mais' || !ordens.includes(chave)) return;
            pref.ordem = chave;
            ir(1);
          },
          aoBuscar: (texto) => {
            pref.busca = texto;
            ir(1);
          },
        },
        csvTodos,
      });
    },
  });
}
