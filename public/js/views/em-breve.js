// Aba ainda não implementada nesta fase.
import { esc } from '../ui.js';

export function render(el, ctx) {
  el.innerHTML = `<div class="estado-grande">
    <span class="selo">Em breve</span>
    <strong>${esc(ctx.rotulo ?? 'Esta aba')}</strong>
    <span class="muted">Chega numa próxima fase do painel</span>
  </div>`;
}
