// Modais compartilhados: abrirModal (foco preso, Esc, inert no resto) e gaveta lateral só de leitura.
import { esc } from '../ui.js';

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const pilhaModais = []; // o Esc e o Tab valem só para o modal de cima

export function abrirModal(caixa, { aoEsc, voltar = null }) {
  const anterior = voltar ?? document.activeElement;
  const inertes = [...document.body.children].filter((c) => c !== caixa && !c.inert);
  inertes.forEach((c) => {
    c.inert = true;
  });
  document.body.append(caixa);
  pilhaModais.push(caixa);
  const tecla = (ev) => {
    if (pilhaModais[pilhaModais.length - 1] !== caixa) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      aoEsc();
      return;
    }
    if (ev.key !== 'Tab') return;
    const f = [...caixa.querySelectorAll(FOCAVEIS)].filter((e) => e.getClientRects().length);
    if (!f.length) return;
    const [primeiro, ultimo] = [f[0], f[f.length - 1]];
    if (!caixa.contains(document.activeElement)) {
      ev.preventDefault();
      primeiro.focus();
    } else if (ev.shiftKey && document.activeElement === primeiro) {
      ev.preventDefault();
      ultimo.focus();
    } else if (!ev.shiftKey && document.activeElement === ultimo) {
      ev.preventDefault();
      primeiro.focus();
    }
  };
  // No documento: mesmo com o foco perdido (ex.: botão desabilitado durante o envio), Esc e Tab continuam presos aqui.
  document.addEventListener('keydown', tecla);
  return function fechar(devolverFoco = true) {
    document.removeEventListener('keydown', tecla);
    pilhaModais.splice(pilhaModais.indexOf(caixa), 1);
    caixa.remove();
    inertes.forEach((c) => {
      c.inert = false;
    });
    if (devolverFoco && anterior?.isConnected) anterior.focus();
  };
}

/**
 * Gaveta lateral só de leitura. Fecha por ×, Esc, clique no fundo ou quando o `signal` (troca de rota) aborta.
 * Devolve { corpo, fechar, aberta() } — `corpo` recebe o conteúdo; `aberta()` diz se ainda vale pintar.
 */
export function gavetaLeitura({ titulo, html = '', gatilho = null, signal = null }) {
  const caixa = document.createElement('div');
  caixa.className = 'modal-fundo gaveta-fundo';
  caixa.innerHTML = `<aside class="gaveta" role="dialog" aria-modal="true" aria-labelledby="gaveta-t">
      <header class="gaveta-topo"><h2 id="gaveta-t">${esc(titulo)}</h2>
        <button type="button" class="btn-fechar" data-fechar aria-label="Fechar">×</button></header>
      <div class="gaveta-corpo">${html}</div>
    </aside>`;
  const corpo = caixa.querySelector('.gaveta-corpo');
  let fechada = false;
  const fechar = (devolverFoco = true) => {
    if (fechada) return;
    fechada = true;
    signal?.removeEventListener('abort', aoTrocarRota);
    fecharModal(devolverFoco);
  };
  const aoTrocarRota = () => fechar(false);
  const fecharModal = abrirModal(caixa, { aoEsc: () => fechar(), voltar: gatilho });
  signal?.addEventListener('abort', aoTrocarRota);
  caixa.querySelector('[data-fechar]').addEventListener('click', () => fechar());
  caixa.addEventListener('mousedown', (ev) => {
    if (ev.target === caixa) fechar();
  });
  caixa.querySelector('[data-fechar]').focus();
  return { corpo, fechar, aberta: () => !fechada };
}
