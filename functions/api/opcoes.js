// Valores distintos dos últimos 400 dias para a barra de filtros.
import { hojeLocal, opcoes } from '../_lib/consultas.js';
import { somarDias } from '../_lib/filtros.js';
import { semValores } from '../_lib/permissoes.js';
import { ErroHttp, json } from '../_lib/resposta.js';

const DIAS = 400;
const ABAS_COM_FILTRO = ['visao', 'vendas', 'clientes'];

export async function onRequestGet(context) {
  const eu = context.data.eu;
  if (!ABAS_COM_FILTRO.some((a) => eu.abas.includes(a))) {
    throw new ErroHttp(403, 'sem-permissao', 'Você não tem acesso a esta aba.');
  }
  const desde = somarDias(hojeLocal(context.env), -DIAS);
  return json(semValores(await opcoes(context.env.DB, desde), eu.verValores));
}
