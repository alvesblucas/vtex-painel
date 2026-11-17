// Ranking de produtos paginado; `busca` em nome/SKU com LIKE literal (% e _ escapados).
// `modo=subiram|caiu` compara com o período de comparação da barra (sem comparação → semComparacao).
import { filtrosDaRequisicao, invalido, produtos, produtosVariacao } from '../../_lib/consultas.js';
import { exigirAba, semValores } from '../../_lib/permissoes.js';
import { json } from '../../_lib/resposta.js';

const POR_PAGINA = 50;
const MAX_PAGINA = 10000;
const MAX_BUSCA = 120;
const ORDENS = ['valor', 'qtd', 'pedidos'];
const MODOS = ['mais', 'subiram', 'caiu'];

function lerModo(params) {
  const modo = params.get('modo') || 'mais';
  if (!MODOS.includes(modo)) throw invalido('Modo inválido.');
  return modo;
}

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
  const { f, params, cmp } = filtrosDaRequisicao(context);
  const verValores = context.data.eu.verValores;
  const pagina = lerPagina(params);
  const modo = lerModo(params);
  const busca = (params.get('busca') ?? '').trim();
  if (busca.length > MAX_BUSCA) throw invalido('Busca longa demais.');
  if (modo !== 'mais') {
    if (!cmp) return json({ itens: [], total: 0, pagina, porPagina: POR_PAGINA, semComparacao: true });
    const r = await produtosVariacao(context.env.DB, f, f, cmp, { modo, pagina, porPagina: POR_PAGINA, busca });
    return json(semValores({ ...r, pagina, porPagina: POR_PAGINA }, verValores));
  }
  const ordem = lerOrdem(params, verValores);
  const { itens, total } = await produtos(context.env.DB, f, f, { pagina, porPagina: POR_PAGINA, ordem, busca });
  return json(semValores({ itens, total, pagina, porPagina: POR_PAGINA }, verValores));
}
