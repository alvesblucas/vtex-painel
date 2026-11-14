// Visão geral: cartões das abas permitidas → "Precisa de atenção" → atalhos para as abas.
import { montarHash } from '../estado.js';
import { brl, brlK, deltaPct, esc, int, num1 } from '../ui.js';
import { bloco, cartoesEsqueleto, estrutura, pintarFileira, rotuloCmp } from './comum.js';

const ATALHOS = {
  vendas: ['Vendas', 'faturamento, origens, marcas e produtos'],
  clientes: ['Clientes', 'novos × recorrentes'],
  estoque: ['Estoque', ''],
  pedidos: ['Pedidos', ''],
  avaliacoes: ['Avaliações', ''],
  precos: ['Preços e Outlet', ''],
  saude: ['Saúde', ''],
};
const PRONTAS = new Set(['vendas', 'clientes']);

const pctTxt = (n) => `${num1(n)}%`;

// chave = morph entre abas (as mesmas de Vendas); numero + formatar = contagem do valor;
// contagem = só a memória da contagem (sem morph), para o número partir do valor anterior.
function cartoesDe(c, eu, f) {
  const lista = [];
  const v = c.vendas;
  if (v) {
    const d = deltaPct(v.delta);
    const sub = v.pedidos ? `vs ${rotuloCmp(f).toLowerCase()}` : 'sem vendas no período';
    const pedidos = { rotulo: 'Pedidos', valor: int(v.pedidos), chave: 'pedidos', numero: v.pedidos, formatar: int };
    if (eu.verValores) {
      lista.push({ rotulo: 'Faturamento', valor: brlK(v.valor), sub: v.pedidos ? brl(v.valor) : sub, delta: f.cmp === 'nenhum' ? '' : d, chave: 'faturamento', numero: v.valor, formatar: brlK });
      lista.push({ ...pedidos, sub: v.pedidos ? '' : sub });
      lista.push({ rotulo: 'Ticket médio', valor: brl(v.ticket), chave: 'ticket', numero: v.ticket, formatar: brl });
    } else {
      lista.push({ ...pedidos, sub, delta: f.cmp === 'nenhum' ? '' : d });
    }
  }
  if (c.clientes) {
    lista.push({ rotulo: 'Clientes novos', valor: pctTxt(c.clientes.pctNovos), sub: `${int(c.clientes.novos)} pedidos de novos (site)`, contagem: 'pct-novos', numero: c.clientes.pctNovos, formatar: pctTxt });
  }
  return lista;
}

// Fileira de KPIs que a tela vai ter (para o esqueleto já nascer com os nomes do morph).
function layout(eu) {
  const atalhos = eu.abas.filter((a) => a in ATALHOS);
  const temVendas = eu.abas.includes('vendas');
  const temCartoes = temVendas || eu.abas.includes('clientes');
  const chaves = temVendas ? (eu.verValores ? ['faturamento', 'pedidos', 'ticket'] : ['pedidos']) : [];
  const n = chaves.length + (eu.abas.includes('clientes') ? 1 : 0);
  const classe = n >= 4 ? 's3' : n === 3 ? 's4' : n === 2 ? 's6' : 's12';
  return { atalhos, temCartoes, chaves, n, classe };
}

function montar(el, eu) {
  const { atalhos, temCartoes, chaves, n, classe } = layout(eu);
  return estrutura(el, `visao-${atalhos.join('.')}-${eu.verValores ? 1 : 0}`, `
    ${temCartoes ? `<section class="secao" aria-label="Resumo do período" data-b="cartoes">${cartoesEsqueleto(n, classe, chaves)}</section>` : ''}
    <div class="grade secao topo-alinhado">
      <section class="card ${atalhos.length ? 's8' : 's12'}" aria-labelledby="t-atencao">
        <div class="card-head"><h2 id="t-atencao">Precisa de atenção</h2><span class="sub">loja toda</span></div>
        <div data-b="alertas"></div>
      </section>
      ${atalhos.length ? `<nav class="card s4" aria-labelledby="t-atalhos">
        <div class="card-head"><h2 id="t-atalhos">Ir para</h2></div>
        <ul class="atalhos" data-atalhos></ul>
      </nav>` : ''}
    </div>`, 'dados');
}

// Síncrono, chamado dentro da troca de aba: a View Transition captura esta estrutura e render() a reaproveita.
export function esqueleto(el, { eu }) {
  montar(el, eu);
}

export async function render(el, ctx) {
  const { eu, filtros: f } = ctx;
  const { atalhos, temCartoes, classe } = layout(eu);
  ctx.aplicaveis(temCartoes ? ['periodo', 'cmp'] : []); // sem cartões, nada na tela depende do período
  const { raiz } = montar(el, eu);

  // Atalhos levam os filtros atuais junto (atualizados a cada filtro).
  const ul = raiz.querySelector('[data-atalhos]');
  if (ul) {
    ul.innerHTML = atalhos.map((a) => `<li><a class="atalho" href="${esc(montarHash(a, f))}">
      <span class="atalho-nome">${esc(ATALHOS[a][0])}</span>
      ${PRONTAS.has(a) ? `<span class="muted">${esc(ATALHOS[a][1])}</span>` : '<span class="selo">em breve</span>'}
      <span class="atalho-seta" aria-hidden="true">→</span></a></li>`).join('');
  }

  const alvoCartoes = raiz.querySelector('[data-b="cartoes"]');
  if (alvoCartoes?.dataset.pintado) alvoCartoes.classList.add('recarregando');
  await bloco(raiz.querySelector('[data-b="alertas"]'), ctx, {
    carregar: async () => {
      const d = await ctx.api('/api/visao', f);
      // Os cartões vêm na mesma resposta: pinta aqui mesmo (cada bloco com seu estado).
      if (alvoCartoes && ctx.vivo()) pintarCartoes(alvoCartoes, cartoesDe(d.cartoes ?? {}, eu, f), classe);
      return d;
    },
    pintar: (d) => pintarAlertas(raiz.querySelector('[data-b="alertas"]'), d.alertas ?? [], eu, f),
  });
  // Falhou: o erro (com "tentar de novo", que repinta os dois) fica só no bloco de alertas.
  if (alvoCartoes && ctx.vivo() && raiz.querySelector('[data-b="alertas"] .estado.erro')) {
    delete alvoCartoes.dataset.pintado;
    alvoCartoes.classList.remove('recarregando');
    alvoCartoes.innerHTML = '';
  }
}

function pintarCartoes(el, lista, classe) {
  el.dataset.pintado = '1';
  el.classList.remove('recarregando');
  el.removeAttribute('aria-busy');
  pintarFileira(el, lista, classe);
}

function pintarAlertas(el, alertas, eu, f) {
  if (!alertas.length) {
    el.innerHTML = '<div class="tudo-certo"><span class="pill st-ok"><i aria-hidden="true"></i>ok</span><span>Nada pedindo atenção agora</span></div>';
    return;
  }
  const pode = (aba) => aba && eu.abas.includes(aba);
  el.innerHTML = `<ul class="alertas">${alertas.map((a) => {
    const nivel = a.nivel === 'erro' ? 'erro' : 'aviso';
    const conteudo = `<span class="pill st-${nivel}"><i aria-hidden="true"></i>${nivel === 'erro' ? 'problema' : 'atenção'}</span>
      <span class="alerta-texto">${esc(a.texto)}</span>`;
    return `<li>${pode(a.aba) && a.aba !== 'visao'
      ? `<a class="alerta" href="${esc(montarHash(a.aba, f))}">${conteudo}<span class="atalho-seta" aria-hidden="true">→</span></a>`
      : `<div class="alerta">${conteudo}</div>`}</li>`;
  }).join('')}</ul>`;
}
