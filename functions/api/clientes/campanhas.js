// Novos x recorrentes por origem → campanha (utm_campaign), com os novos do período de comparação.
import { campanhas, dadosAte, filtrosDaRequisicao } from '../../_lib/consultas.js';
import { exigirAba, semValores } from '../../_lib/permissoes.js';
import { json } from '../../_lib/resposta.js';

const LIMITE = 50;
const LIMITE_CMP = 1000;
const chave = (c) => `${c.origem}\u0000${c.campanha}`;

export async function onRequestGet(context) {
  exigirAba(context, 'clientes');
  const db = context.env.DB;
  const { f, cmp } = filtrosDaRequisicao(context);
  const atuais = await campanhas(db, f, f, { limite: LIMITE });
  const antes = cmp ? new Map((await campanhas(db, f, cmp, { limite: LIMITE_CMP })).map((c) => [chave(c), c.novo])) : null;
  const lista = atuais.map((c) => ({ ...c, novoCmp: antes ? antes.get(chave(c)) ?? 0 : null }));
  return json(semValores({ campanhas: lista, dadosAte: await dadosAte(db, 'pedidos') }, context.data.eu.verValores));
}
