// Ranking de produtos paginado; `busca` em nome/SKU com LIKE literal (% e _ escapados).
import { filtrosDaRequisicao, invalido, produtos } from '../../_lib/consultas.js';
import { exigirAba, semValores } from '../../_lib/permissoes.js';
import { json } from '../../_lib/resposta.js';

const POR_PAGINA = 50;
const MAX_PAGINA = 10000;
const MAX_BUSCA = 120;
const ORDENS = ['valor', 'qtd', 'pedidos'];

function lerPagina(params) {
  const texto = params.get('pagina') || '1';
  const pagina = /^\d{1,5}$/.test(texto) ? Number(texto) : 0;
  if (pagina < 1 || pagina > MAX_PAGINA) throw invalido('Página inválida.');
  return pagina;
}

function lerOrdem(params, verValores) {
  const ordem = params.get('ordem') || 'valor';
  if (!ORDENS.includes(ordem)) throw invalido('Ordem inválida.');
  return ordem === 'valor' && !verValores ? 'qtd' : ordem; // ordenar por R$ revelaria a posição
}

export async function onRequestGet(context) {
  exigirAba(context, 'vendas');
  const { f, params } = filtrosDaRequisicao(context);
  const verValores = context.data.eu.verValores;
  const pagina = lerPagina(params);
  const ordem = lerOrdem(params, verValores);
  const busca = (params.get('busca') ?? '').trim();
  if (busca.length > MAX_BUSCA) throw invalido('Busca longa demais.');
  const { itens, total } = await produtos(context.env.DB, f, f, { pagina, porPagina: POR_PAGINA, ordem, busca });
  return json(semValores({ itens, total, pagina, porPagina: POR_PAGINA }, verValores));
}
