// Vendas: cartões → linha por dia (comparação tracejada) → barras por dimensão (clique filtra) → produtos.
import { rotuloValor } from '../barra-filtros.js';
import { LISTAS } from '../estado.js';
import { barras, linha } from '../graficos.js';
import { brl, brlEixo, brlK, cartao, CSV_MAX_SERVIDOR, delta, dm, dma, erroCartao, esc, int, semana, tabela } from '../ui.js';
import { bloco, cartoesEsqueleto, estrutura, rotuloCmp, semDados, temCmp } from './comum.js';

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
const pref = { medida: 'valor', ordem: null, busca: '' };

export async function render(el, ctx) {
  const vv = Boolean(ctx.eu.verValores);
  ctx.aplicaveis(['periodo', 'cmp', ...LISTAS]);
  const { raiz } = estrutura(el, `vendas-${vv ? 1 : 0}`, `
    <div class="aviso-info aviso-itens" role="status" hidden><span aria-hidden="true">ⓘ</span>${esc(AVISO_ITENS)}</div>
    <section class="secao" aria-label="Resumo" data-b="resumo">${cartoesEsqueleto(vv ? 4 : 2, vv ? 's3' : 's6')}</section>
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
      <div class="card-head"><h2 id="t-produtos">Produtos</h2><span class="sub">${vv ? 'valores dos itens, sem frete' : 'por quantidade'}</span></div>
      <div data-b="produtos"></div>
    </section>`);

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

  await Promise.all([
    bloco(b('resumo'), ctx, {
      esqueleto: cartoesEsqueleto(vv ? 4 : 2, vv ? 's3' : 's6'),
      carregar: () => ctx.api('/api/vendas/resumo', f),
      pintar: (d) => {
        marcarItens('resumo', d.porItens);
        pintarResumo(b('resumo'), d, vv, f);
      },
    }),
    bloco(b('serie'), ctx, {
      carregar: () => ctx.api('/api/vendas/serie', f),
      pintar: (d) => {
        marcarItens('serie', d.porItens);
        ultimos.serie = d;
        pintarSerie(b('serie'), d, medida(), f);
      },
    }),
    ...QUEBRAS.map(([por]) => bloco(b(`q-${por}`), ctx, {
      carregar: () => ctx.api(`/api/vendas/quebra?por=${por}`, f),
      pintar: (d) => {
        if (!DE_ITENS.has(por)) marcarItens(`q-${por}`, d.porItens);
        ultimos[por] = d;
        pintarQuebra(raiz, b(`q-${por}`), por, d, medida(), ctx);
      },
    })),
    produtos(b('produtos'), ctx, vv),
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
    vv && { rotulo: 'Faturamento', valor: brlK(a.valor), sub: c ? antes(brlK(c.valor)) : brl(a.valor), delta: c ? delta(a.valor, c.valor) : '' },
    { rotulo: 'Pedidos', valor: int(a.pedidos), sub: antes(int(c?.pedidos)), delta: c ? delta(a.pedidos, c.pedidos) : '' },
    vv && { rotulo: 'Ticket médio', valor: brl(a.ticket), sub: antes(brl(c?.ticket)), delta: c ? delta(a.ticket, c.ticket) : '' },
    { rotulo: 'Cancelados', valor: int(a.cancelados), sub: antes(int(c?.cancelados)), delta: c ? delta(a.cancelados, c.cancelados, { subirEhBom: false }) : '' },
  ].filter(Boolean);
  const classe = vv ? 's3' : 's6';
  el.innerHTML = `<div class="grade cartoes">${cartoes.map(() => `<div class="card ${classe}"></div>`).join('')}</div>`;
  el.querySelectorAll('.card').forEach((card, i) => cartao(card, cartoes[i]));
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
      if (chave !== SEM_CHAVE) ctx.aplicarFiltro(por, chave);
    },
  });
  const outros = emR ? d.outros?.valor : d.outros?.pedidos;
  const pe = [];
  if (outros) pe.push(`Outros: ${emR ? brlK(outros) : int(outros)}`);
  if (deItens && !emR) pe.push(`um pedido pode estar em mais de uma ${por}`);
  raiz.querySelector(`[data-pe="${por}"]`).textContent = pe.join(' · ');
}

// ---------- produtos (paginação no servidor) ----------

async function produtos(el, ctx, vv) {
  const ordens = vv ? ['valor', 'qtd', 'pedidos'] : ['qtd', 'pedidos'];
  if (!ordens.includes(pref.ordem)) pref.ordem = ordens[0];
  const colunas = [
    { chave: 'nome', titulo: 'Produto', ordenavel: false },
    { chave: 'sku', titulo: 'SKU', ordenavel: false },
    { chave: 'marca', titulo: 'Marca', ordenavel: false },
    { chave: 'categoria', titulo: 'Categoria', ordenavel: false },
    { chave: 'qtd', titulo: 'Qtd', formato: 'int', soDesc: true },
    { chave: 'pedidos', titulo: 'Pedidos', formato: 'int', soDesc: true },
    ...(vv ? [{ chave: 'valor', titulo: 'Faturamento', formato: 'brl', soDesc: true }] : []),
  ];
  const buscar = (pagina) => {
    const q = new URLSearchParams({ pagina: String(pagina), ordem: pref.ordem });
    if (pref.busca) q.set('busca', pref.busca);
    return ctx.api(`/api/vendas/produtos?${q}`, ctx.filtros);
  };
  let t = null;
  const ir = async (pagina) => {
    try {
      const d = await buscar(pagina);
      if (!ctx.vivo()) return;
      t.atualizar({ linhas: d.itens, total: d.total, pagina: d.pagina });
    } catch (e) {
      if (e?.name === 'AbortError' || !ctx.vivo()) return;
      t.atualizar({});
      delete el.dataset.pintado;
      erroCartao(el, e?.mensagem || 'Não foi possível carregar os produtos.', () => produtos(el, ctx, vv));
    }
  };
  const csvTodos = async () => {
    const todas = [];
    for (let pagina = 1; todas.length < CSV_MAX_SERVIDOR; pagina++) {
      const d = await buscar(pagina);
      todas.push(...d.itens);
      if (!d.itens.length || todas.length >= d.total) break;
    }
    return todas.slice(0, CSV_MAX_SERVIDOR);
  };
  return bloco(el, ctx, {
    carregar: () => buscar(1),
    pintar: (d) => {
      t = tabela(el, {
        colunas,
        linhas: d.itens,
        busca: true,
        csv: 'produtos',
        vazioTexto: 'Nenhum produto vendido no período.',
        servidor: {
          total: d.total,
          pagina: 1,
          porPagina: d.porPagina,
          ordem: { chave: pref.ordem, dir: 'desc' },
          busca: pref.busca,
          aoPagina: (n) => ir(n),
          aoOrdenar: (chave) => {
            if (!ordens.includes(chave)) return;
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
