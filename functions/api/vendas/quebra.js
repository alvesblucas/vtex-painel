// Top 10 por valor (por pedidos sem R$) + "outros", com comparação por chave.
import { dadosAte, filtrosDaRequisicao, invalido, quebra, QUEBRAS } from '../../_lib/consultas.js';
import { usaItens } from '../../_lib/filtros.js';
import { exigirAba, semValores } from '../../_lib/permissoes.js';
import { json } from '../../_lib/resposta.js';

const TOP = 10;

const somar = (grupos, campo) => grupos.reduce((s, g) => s + g[campo], 0);

export async function onRequestGet(context) {
  exigirAba(context, 'vendas');
  const db = context.env.DB;
  const { f, cmp, params } = filtrosDaRequisicao(context);
  const por = params.get('por') ?? '';
  if (!Object.hasOwn(QUEBRAS, por)) throw invalido('Quebra inválida.');
  const verValores = context.data.eu.verValores;
  const campo = verValores ? 'valor' : 'pedidos';
  const grupos = (await quebra(db, f, f, por)).sort((a, b) => b[campo] - a[campo] || String(a.chave).localeCompare(String(b.chave)));
  const antes = cmp ? new Map((await quebra(db, f, cmp, por)).map((g) => [g.chave, g])) : null;
  const itens = grupos.slice(0, TOP).map((g) => ({
    chave: g.chave,
    valor: g.valor,
    pedidos: g.pedidos,
    cmpValor: antes ? antes.get(g.chave)?.valor ?? 0 : null,
    cmpPedidos: antes ? antes.get(g.chave)?.pedidos ?? 0 : null,
  }));
  const resto = grupos.slice(TOP);
  const outros = { valor: somar(resto, 'valor'), pedidos: somar(resto, 'pedidos') };
  const porItens = usaItens(f) || por === 'marca' || por === 'categoria';
  return json(semValores({ por, itens, outros, porItens, dadosAte: await dadosAte(db, 'pedidos') }, verValores));
}
