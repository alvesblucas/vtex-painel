// Faturamento, pedidos, ticket e cancelados do período (+ comparação).
import { dadosAte, filtrosDaRequisicao, resumo } from '../../_lib/consultas.js';
import { usaItens } from '../../_lib/filtros.js';
import { exigirAba, semValores } from '../../_lib/permissoes.js';
import { json } from '../../_lib/resposta.js';

export async function onRequestGet(context) {
  exigirAba(context, 'vendas');
  const db = context.env.DB;
  const { f, cmp } = filtrosDaRequisicao(context);
  const dados = {
    atual: await resumo(db, f, f),
    cmp: cmp ? await resumo(db, f, cmp) : null,
    porItens: usaItens(f),
    dadosAte: await dadosAte(db, 'pedidos'),
  };
  return json(semValores(dados, context.data.eu.verValores));
}
