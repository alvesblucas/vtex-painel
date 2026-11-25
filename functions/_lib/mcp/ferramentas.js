// Ferramentas do MCP (só leitura). Cada uma devolve um objeto JSON; erros esperados lançam ErroParametro.
import { dadosAte } from '../consultas.js';

const SEM_ARGS = { type: 'object', properties: {}, additionalProperties: false };

export const ferramentas = {
  quem_sou_eu: {
    description: 'Mostra quem está conectado: e-mail, perfil, abas que pode consultar, se vê valores em R$ e até quando há dados.',
    inputSchema: SEM_ARGS,
    async executar(_args, { eu, env }) {
      return { email: eu.email, perfil: eu.perfil, abas: eu.abas, verValores: eu.verValores, dadosAte: await dadosAte(env.DB, 'pedidos') };
    },
  },
};
