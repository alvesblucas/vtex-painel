// Clientes (só pedidos do site): cartões → novo × recorrente por origem (clique filtra) → % de novos por semana.
import { linha } from '../graficos.js';
import { brlK, classeVariacao, dma, esc, int, num1 } from '../ui.js';
import { bloco, cartoesEsqueleto, estrutura, pintarFileira, rotuloCmp, semDados } from './comum.js';

const APLICAVEIS = ['periodo', 'cmp', 'origem', 'pagamento', 'uf', 'cidade', 'entrega'];
const pctTxt = (n) => `${num1(n)}%`;

// Diferença em pontos percentuais (a variação relativa de um percentual confunde).
function deltaPp(atual, antes) {
  if (antes == null) return '';
  const d = Math.round((atual - antes) * 10) / 10;
  const seta = d > 0 ? '▲' : d < 0 ? '▼' : '=';
  return `<span class="pill ${classeVariacao(d)}" title="em pontos percentuais">${seta} ${num1(Math.abs(d))} p.p.</span>`;
}

export async function render(el, ctx) {
  ctx.aplicaveis(APLICAVEIS);
  const { raiz } = estrutura(el, 'clientes', `
    <section class="secao" aria-label="Resumo" data-b="cartoes">${cartoesEsqueleto(4)}</section>
    <div class="grade secao">
      <section class="card s6" aria-labelledby="t-origem">
        <div class="card-head"><h2 id="t-origem">Novos × recorrentes por origem</h2>
          <div class="legenda"><span><i class="chave-novo"></i>Novos</span><span><i class="chave-rec"></i>Recorrentes</span></div></div>
        <div data-b="origem"></div>
      </section>
      <section class="card s6" aria-labelledby="t-semana">
        <div class="card-head"><h2 id="t-semana">Clientes novos por semana</h2><span class="sub">% dos pedidos do site</span></div>
        <div data-b="semana"></div>
      </section>
    </div>`, 'dados');
  const b = (k) => raiz.querySelector(`[data-b="${k}"]`);
  const f = ctx.filtros;
  // Uma consulta alimenta os três blocos; cada um tem seu estado. Se falhar, "Tentar de novo" refaz a consulta.
  let pedido = null;
  const obter = () => {
    pedido ??= ctx.api('/api/clientes', f).catch((e) => {
      pedido = null;
      throw e;
    });
    return pedido;
  };
  const blocoDe = (k, pintar) => bloco(b(k), ctx, { carregar: obter, pintar });
  await Promise.all([
    blocoDe('cartoes', (d) => pintarCartoes(b('cartoes'), d, ctx)),
    blocoDe('origem', (d) => pintarOrigens(b('origem'), d.porOrigem ?? [], ctx)),
    blocoDe('semana', (d) => pintarSemanas(b('semana'), d.porSemana ?? [])),
  ]);
}

function pintarCartoes(el, d, ctx) {
  const total = d.novo.pedidos + d.recorrente.pedidos + d.indefinido.pedidos;
  if (!total) {
    el.innerHTML = '<div class="card estado-faixa"><span class="estado-icone" aria-hidden="true">∅</span><strong>Sem vendas no período</strong><span class="muted">pedidos do site</span></div>';
    return;
  }
  const vv = ctx.eu.verValores;
  const sub = (t) => (vv && d[t].valor != null ? brlK(d[t].valor) : `${num1((d[t].pedidos / total) * 100)}% dos pedidos`);
  const lista = [
    { rotulo: 'Clientes novos', icone: 'percentual', valor: pctTxt(d.pctNovos), contagem: 'pct-novos', numero: d.pctNovos, formatar: pctTxt, sub: d.cmp ? `${rotuloCmp(ctx.filtros)}: ${pctTxt(d.cmp.pctNovos)}` : 'novos ÷ (novos + recorrentes)', delta: d.cmp ? deltaPp(d.pctNovos, d.cmp.pctNovos) : '' },
    { rotulo: 'Pedidos de novos', icone: 'clientes', valor: int(d.novo.pedidos), contagem: 'pedidos-novos', numero: d.novo.pedidos, formatar: int, sub: sub('novo') },
    { rotulo: 'Pedidos de recorrentes', icone: 'clientes', valor: int(d.recorrente.pedidos), contagem: 'pedidos-recorrentes', numero: d.recorrente.pedidos, formatar: int, sub: sub('recorrente') },
    { rotulo: 'Indefinidos', icone: 'clientes', valor: int(d.indefinido.pedidos), contagem: 'indefinidos', numero: d.indefinido.pedidos, formatar: int, sub: 'sem histórico do cliente' },
  ];
  pintarFileira(el, lista, 's3');
}

// Barra empilhada por origem: comprimento = pedidos da origem; segmentos novo | recorrente.
function pintarOrigens(el, origens, ctx) {
  const lista = origens.filter((o) => o.novo + o.recorrente > 0).slice(0, 10);
  if (!lista.length) {
    semDados(el);
    return;
  }
  const max = Math.max(...lista.map((o) => o.novo + o.recorrente));
  const larg = (n) => `${((n / max) * 100).toFixed(2)}%`;
  el.innerHTML = `<div class="barras" role="group" aria-label="Novos e recorrentes por origem">${lista.map((o) => {
    const tot = o.novo + o.recorrente;
    const pct = (o.novo / tot) * 100;
    const rotulo = `${o.origem}: ${int(o.novo)} novos, ${int(o.recorrente)} recorrentes (${num1(pct)}% novos)`;
    return `<button type="button" class="barra-linha" data-origem="${esc(o.origem)}" title="Filtrar por esta origem" aria-label="${esc(rotulo)}">
      <span class="barra-nome">${esc(o.origem)}</span>
      <span class="barra-trilho"><span class="pilha" style="width:${larg(tot)}">
        <span class="seg-novo" style="flex-grow:${o.novo}"></span><span class="seg-rec" style="flex-grow:${o.recorrente}"></span></span></span>
      <span class="barra-valor num barra-nr"><span class="nr nr-novo">${int(o.novo)}<span class="nr-txt"> novos</span></span><span class="nr nr-rec">${int(o.recorrente)}<span class="nr-txt"> recorrentes</span></span></span>
    </button>`;
  }).join('')}</div>`;
  el.querySelectorAll('[data-origem]').forEach((botao) => {
    botao.addEventListener('click', () => ctx.aplicarFiltro('origem', botao.dataset.origem));
  });
}

function pintarSemanas(el, semanas) {
  const pontos = semanas.map((s) => {
    const tot = s.novo + s.recorrente;
    return {
      x: `${s.inicio.slice(8, 10)}/${s.inicio.slice(5, 7)}`,
      y: tot ? Math.round((s.novo / tot) * 1000) / 10 : 0,
      titulo: `Semana de ${dma(s.inicio)}`,
      dica: [
        { cor: 'serie', rotulo: 'novos', valor: tot ? pctTxt((s.novo / tot) * 100) : '—' },
        { rotulo: 'pedidos de novos', valor: int(s.novo) },
        { rotulo: 'pedidos de recorrentes', valor: int(s.recorrente) },
      ],
    };
  });
  if (!semanas.some((s) => s.novo + s.recorrente)) {
    semDados(el);
    return;
  }
  if (pontos.length < 2) {
    semDados(el, 'A linha semanal aparece com períodos de mais de uma semana.');
    return;
  }
  linha(el, pontos, { fmtY: (v) => `${Math.round(v)}%`, fmtDica: pctTxt, rotulo: '% de novos', titulo: 'Percentual de clientes novos por semana' });
}

