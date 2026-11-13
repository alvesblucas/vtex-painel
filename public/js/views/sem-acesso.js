// Tela para quem entrou pelo Access mas não está cadastrado (ou foi desativado).
import { esc } from '../ui.js';

export function render(el, { eu }) {
  el.innerHTML = `<span class="selo selo-aviso">Sem acesso</span>
    <strong>Você ainda não tem acesso</strong>
    <dl class="sem-acesso-dados">
      <dt>Entrou como</dt><dd class="num">${esc(eu?.email || '—')}</dd>
      <dt>O que fazer</dt><dd>Peça ao administrador para liberar este e-mail</dd>
    </dl>
    <button type="button" class="btn" data-recarregar>Já fui liberado — recarregar</button>`;
  el.querySelector('[data-recarregar]').addEventListener('click', () => window.location.reload());
  el.focus();
}
