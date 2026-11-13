// Novos x recorrentes (só canal Site), por origem e por semana (segunda-feira), + % de novos na comparação.
import { clientes, dadosAte, filtrosDaRequisicao } from '../_lib/consultas.js';
import { exigirAba, semValores } from '../_lib/permissoes.js';
import { json } from '../_lib/resposta.js';

export async function onRequestGet(context) {
  exigirAba(context, 'clientes');
  const db = context.env.DB;
  const { f, cmp } = filtrosDaRequisicao(context);
  const dados = {
    ...(await clientes(db, f, f)),
    cmp: cmp ? { pctNovos: (await clientes(db, f, cmp)).pctNovos } : null,
    dadosAte: await dadosAte(db, 'pedidos'),
  };
  return json(semValores(dados, context.data.eu.verValores));
}
