// Gráficos sem dependências: linha (um eixo, comparação tracejada, cruz + dica) e barras horizontais (top 10).
// Cores: --serie (período) e --serie-ref (comparação), validadas para o fundo escuro (validate_palette.js).
import { crescerBarras, revelarLinha } from './movimento.js';
import { esc, int, pronto } from './ui.js';

// Escala "limpa": 0, passo, 2·passo... com passo 1/2/2,5/5 × 10^n.
export function escala(max, alvo = 4) {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const bruto = max / alvo;
  const pot = 10 ** Math.floor(Math.log10(bruto));
  const passo = [1, 2, 2.5, 5, 10].map((m) => m * pot).find((p) => p >= bruto);
  const topo = Math.ceil(max / passo) * passo;
  const ticks = [];
  for (let v = 0; v <= topo + passo / 2; v += passo) ticks.push(Math.round(v * 1e6) / 1e6);
  return { max: topo, ticks };
}

// Redesenha ao mudar a largura do contêiner.
function aoRedimensionar(el, desenhar) {
  el._ro?.disconnect();
  if (typeof ResizeObserver !== 'function') return;
  let largura = el.clientWidth;
  el._ro = new ResizeObserver(() => {
    if (Math.abs(el.clientWidth - largura) < 8) return;
    largura = el.clientWidth;
    desenhar(); // redesenho por largura: sem animação de entrada
  });
  el._ro.observe(el);
}

function linhaDica(tip, { cor, rotulo, valor }) {
  const r = document.createElement('div');
  r.className = 'dica-linha';
  if (cor) {
    const k = document.createElement('i');
    k.className = `chave-${cor}`;
    r.append(k);
  }
  const b = document.createElement('b');
  b.textContent = valor;
  const s = document.createElement('span');
  s.textContent = rotulo;
  r.append(b, s);
  tip.append(r);
}

function preencherDica(tip, titulo, linhas) {
  tip.replaceChildren();
  if (titulo) {
    const t = document.createElement('div');
    t.className = 'dica-titulo';
    t.textContent = titulo;
    tip.append(t);
  }
  linhas.forEach((l) => linhaDica(tip, l));
}

/**
 * Linha simples (um eixo).
 * pontos: [{ x: rótulo do eixo, y: número, ref?: número|null, titulo?: texto da dica, dica?: [{rotulo, valor, cor?:'serie'|'ref'}] }]
 * opcoes: { altura=220, fmtY=int (eixo; para R$ use brlEixo), fmtDica=fmtY (dica; para R$ use brl), rotulo='Período', rotuloRef='Comparação', titulo (nome acessível) }
 */
export function linha(el, pontos, opcoes = {}) {
  const { altura = 220, fmtY = int, fmtDica = fmtY, rotulo = 'Período', rotuloRef = 'Comparação', titulo = 'Gráfico de linha' } = opcoes;
  pronto(el);
  el._ro?.disconnect();
  if (pontos.length < 2) {
    el.innerHTML = `<div class="estado vazio">${pontos.length ? 'A linha aparece a partir do 2º dia.' : 'Sem dados no período.'}</div>`;
    return;
  }
  // animar só no 1º desenho de dados novos; redesenhos por largura aparecem prontos.
  const desenhar = (animar = false) => {
    const W = Math.max(280, el.clientWidth || 800);
    const H = W < 500 ? Math.round(altura * 0.8) : altura;
    const temRef = pontos.some((p) => p.ref != null);
    const ys = pontos.flatMap((p) => [p.y, p.ref].filter((v) => v != null));
    const { max, ticks } = escala(Math.max(...ys, 0));
    const larguraEixo = Math.max(...ticks.map((t) => fmtY(t).length)) * 6.6 + 12;
    const m = { t: 10, r: 12, b: 26, l: Math.max(40, Math.ceil(larguraEixo)) };
    const n = pontos.length;
    const x = (i) => m.l + (i * (W - m.l - m.r)) / (n - 1);
    const y = (v) => m.t + (1 - v / max) * (H - m.t - m.b);
    const caminho = (k) => pontos.map((p, i) => (p[k] == null ? '' : `${i && pontos[i - 1][k] != null ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[k]).toFixed(1)}`)).join('');
    const passo = Math.max(1, Math.ceil(n / Math.max(3, Math.floor(W / 90))));
    const ultimo = pontos[n - 1];

    el.innerHTML = `${temRef ? `<div class="legenda"><span><i class="chave-serie"></i>${esc(rotulo)}</span><span><i class="chave-ref"></i>${esc(rotuloRef)}</span></div>` : ''}
      <div class="grafico"><svg viewBox="0 0 ${W} ${H}" role="img" tabindex="0" aria-label="${esc(titulo)}. Use as setas para percorrer os dias.">
      ${ticks.map((t) => `<line class="grade-linha" x1="${m.l}" x2="${W - m.r}" y1="${y(t)}" y2="${y(t)}"/><text class="eixo" x="${m.l - 8}" y="${y(t) + 4}" text-anchor="end">${esc(fmtY(t))}</text>`).join('')}
      ${pontos.map((p, i) => ((i % passo === 0 && n - 1 - i >= passo) || i === n - 1 ? `<text class="eixo" x="${x(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${esc(p.x)}</text>` : '')).join('')}
      ${temRef ? `<path d="${caminho('ref')}" class="traco-ref"/>` : ''}
      <path d="${caminho('y')}" class="traco-serie"/>
      ${(W - m.l - m.r) / n >= 16 ? pontos.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="4" class="ponto"/>`).join('') : `<circle cx="${x(n - 1)}" cy="${y(ultimo.y)}" r="4" class="ponto"/>`}
      <line class="cruz" x1="0" x2="0" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
      <circle class="foco" r="5" visibility="hidden"/>
      <circle class="foco-ref" r="4" visibility="hidden"/>
      <rect x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H}" fill="transparent"/>
    </svg><div class="dica" role="status"></div></div>`;

    const svg = el.querySelector('svg');
    if (animar) revelarLinha(svg);
    const tip = el.querySelector('.dica');
    const cruz = svg.querySelector('.cruz');
    const foco = svg.querySelector('.foco');
    const focoRef = svg.querySelector('.foco-ref');
    let atual = -1;

    const mostrar = (i) => {
      atual = i;
      const p = pontos[i];
      cruz.setAttribute('x1', x(i));
      cruz.setAttribute('x2', x(i));
      cruz.setAttribute('visibility', 'visible');
      foco.setAttribute('cx', x(i));
      foco.setAttribute('cy', y(p.y));
      foco.setAttribute('visibility', 'visible');
      if (p.ref != null) {
        focoRef.setAttribute('cx', x(i));
        focoRef.setAttribute('cy', y(p.ref));
        focoRef.setAttribute('visibility', 'visible');
      } else focoRef.setAttribute('visibility', 'hidden');
      const linhas = p.dica ?? [
        { cor: 'serie', rotulo, valor: fmtDica(p.y) },
        ...(p.ref != null ? [{ cor: 'ref', rotulo: rotuloRef, valor: fmtDica(p.ref) }] : []),
      ];
      preencherDica(tip, p.titulo ?? p.x, linhas);
      const r = svg.getBoundingClientRect();
      const px = (x(i) / W) * r.width;
      tip.style.left = `${px}px`;
      tip.style.top = `${(Math.min(y(p.y), p.ref != null ? y(p.ref) : Infinity) / H) * r.height}px`;
      tip.classList.toggle('a-esquerda', px > r.width * 0.75);
      tip.classList.toggle('a-direita', px < r.width * 0.25);
      tip.classList.add('on');
    };
    const esconder = () => {
      atual = -1;
      tip.classList.remove('on');
      [cruz, foco, focoRef].forEach((e) => e.setAttribute('visibility', 'hidden'));
    };
    svg.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      mostrar(Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / (W - m.l - m.r)) * (n - 1)))));
    });
    svg.addEventListener('pointerleave', esconder);
    svg.addEventListener('blur', esconder);
    svg.addEventListener('focus', () => mostrar(n - 1));
    svg.addEventListener('keydown', (ev) => {
      const mapa = { ArrowLeft: -1, ArrowRight: 1, Home: -n, End: n };
      if (ev.key === 'Escape') return esconder();
      if (!(ev.key in mapa)) return;
      ev.preventDefault();
      mostrar(Math.max(0, Math.min(n - 1, (atual < 0 ? n - 1 : atual) + mapa[ev.key])));
    });
  };
  desenhar(true);
  aoRedimensionar(el, () => desenhar());
}

/**
 * Barras horizontais, top 10, uma escala só (valor e comparação).
 * itens: [{ chave, valor, cmp?, rotulo? }]
 * opcoes: { formato=int, aoClicar(chave), rotulo='Período', rotuloRef='Comparação', titulo, limite=10 }
 */
export function barras(el, itens, opcoes = {}) {
  const { formato = int, aoClicar, rotulo = 'Período', rotuloRef = 'Comparação', titulo = 'Gráfico de barras', limite = 10 } = opcoes;
  pronto(el);
  el._ro?.disconnect();
  const lista = itens.slice(0, limite);
  if (!lista.length || lista.every((i) => !i.valor && !i.cmp)) {
    el.innerHTML = '<div class="estado vazio">Sem dados no período.</div>';
    return;
  }
  const temCmp = lista.some((i) => i.cmp != null);
  const max = Math.max(...lista.flatMap((i) => [i.valor ?? 0, i.cmp ?? 0]), 1);
  const largura = (v) => `${Math.max(0, Math.min(100, ((v ?? 0) / max) * 100)).toFixed(2)}%`;

  el.innerHTML = `${temCmp ? `<div class="legenda"><span><i class="chave-barra"></i>${esc(rotulo)}</span><span><i class="chave-marco"></i>${esc(rotuloRef)}</span></div>` : ''}
    <div class="barras" role="group" aria-label="${esc(titulo)}"></div><div class="dica" role="status"></div>`;
  const caixa = el.querySelector('.barras');
  const tip = el.querySelector('.dica');

  lista.forEach((it) => {
    const nome = it.rotulo ?? it.chave;
    const linhaEl = document.createElement(aoClicar ? 'button' : 'div');
    linhaEl.className = 'barra-linha';
    if (aoClicar) {
      linhaEl.type = 'button';
      linhaEl.title = 'Filtrar por este item';
      linhaEl.addEventListener('click', () => aoClicar(it.chave));
    } else linhaEl.tabIndex = 0;
    const valorTxt = formato(it.valor ?? 0);
    linhaEl.setAttribute('aria-label', `${nome}: ${valorTxt}${it.cmp != null ? `; ${rotuloRef}: ${formato(it.cmp)}` : ''}`);
    linhaEl.innerHTML = `<span class="barra-nome"></span>
      <span class="barra-trilho"><span class="barra" style="width:${largura(it.valor)}"></span>${it.cmp != null ? `<span class="marco" style="left:${largura(it.cmp)}"></span>` : ''}</span>
      <span class="barra-valor num"></span>`;
    linhaEl.querySelector('.barra-nome').textContent = nome;
    linhaEl.querySelector('.barra-valor').textContent = valorTxt;
    const mostrar = () => {
      preencherDica(tip, nome, [
        { cor: 'barra', rotulo, valor: valorTxt },
        ...(it.cmp != null ? [{ cor: 'marco', rotulo: rotuloRef, valor: formato(it.cmp) }] : []),
      ]);
      const r = el.getBoundingClientRect();
      const t = linhaEl.querySelector('.barra-trilho').getBoundingClientRect();
      tip.style.left = `${t.left - r.left + t.width / 2}px`;
      tip.style.top = `${t.top - r.top}px`;
      tip.classList.remove('a-esquerda', 'a-direita');
      tip.classList.add('on');
    };
    const esconder = () => tip.classList.remove('on');
    linhaEl.addEventListener('pointerenter', mostrar);
    linhaEl.addEventListener('pointerleave', esconder);
    linhaEl.addEventListener('focus', mostrar);
    linhaEl.addEventListener('blur', esconder);
    caixa.append(linhaEl);
  });
  crescerBarras(caixa);
}
