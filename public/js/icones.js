// Ícones de linha (24×24, traço 1,5 px, cor do texto) e grupos das abas na lateral. Sem biblioteca.

const TRACOS = {
  visao: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  vendas: '<path d="M3 17l5-5 4 4 8-8"/><path d="M15 8h5v5"/>',
  clientes: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
  estoque: '<path d="M3 7l9-4 9 4-9 4z"/><path d="M3 7v10l9 4 9-4V7"/>',
  pedidos: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  avaliacoes: '<path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  precos: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.2"/>',
  saude: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  usuarios: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  legado: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
};

// SVG inline decorativo: o texto ao lado é quem dá o nome. Nome desconhecido = ''.
export function icone(nome) {
  const tracos = Object.hasOwn(TRACOS, nome ?? '') ? TRACOS[nome] : '';
  if (!tracos) return '';
  return `<svg class="icone" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${tracos}</svg>`;
}

// Grupos da lateral, na ordem do menu.
export const GRUPOS_ABAS = {
  principal: ['visao', 'vendas', 'clientes'],
  operacao: ['estoque', 'pedidos', 'avaliacoes', 'precos', 'saude'],
  admin: ['usuarios'],
};
const TITULOS_GRUPOS = { principal: 'Principal', operacao: 'Operação', admin: 'Administração' };

// Só os grupos que têm alguma das abas permitidas (nunca um título de grupo vazio).
export function gruposVisiveis(abas) {
  const permitidas = new Set(abas);
  return Object.entries(GRUPOS_ABAS)
    .map(([id, lista]) => ({ id, titulo: TITULOS_GRUPOS[id], abas: lista.filter((a) => permitidas.has(a)) }))
    .filter((g) => g.abas.length);
}
