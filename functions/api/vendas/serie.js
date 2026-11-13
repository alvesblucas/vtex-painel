// Um ponto por dia do período; comparação alinhada por posição (ponto i = dia i da comparação).
import { dadosAte, filtrosDaRequisicao, serie } from '../../_lib/consultas.js';
import { exigirAba, semValores } from '../../_lib/permissoes.js';
import { json } from '../../_lib/resposta.js';

export async function onRequestGet(context) {
  exigirAba(context, 'vendas');
  const db = context.env.DB;
  const { f, cmp } = filtrosDaRequisicao(context);
  const atual = await serie(db, f, f);
  const antes = cmp ? await serie(db, f, cmp) : [];
  const pontos = atual.map((p, i) => {
    const c = antes[i];
    return { ...p, cmpDia: c?.dia ?? null, cmpValor: c ? c.valor : null, cmpPedidos: c ? c.pedidos : null };
  });
  return json(semValores({ pontos, dadosAte: await dadosAte(db, 'pedidos') }, context.data.eu.verValores));
}
