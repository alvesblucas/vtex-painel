// Remove campos em R$ das respostas para quem não pode ver valores (remove, não zera).
export const CAMPOS_VALOR = ['valor', 'ticket', 'frete', 'desconto', 'preco', 'valorCmp', 'ticketCmp', 'cmpValor', 'varPreco'];

const CAMPOS = new Set(CAMPOS_VALOR);

function limpar(v) {
  if (Array.isArray(v)) return v.map(limpar);
  if (v === null || typeof v !== 'object') return v;
  const saida = {};
  for (const [k, x] of Object.entries(v)) if (!CAMPOS.has(k)) saida[k] = limpar(x);
  return saida;
}

export function semValores(dados, verValores) {
  return verValores ? dados : limpar(dados);
}
