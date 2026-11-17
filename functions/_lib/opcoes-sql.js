// Valores da barra de filtros guardados prontos na tabela `opcoes` (um por lista/valor, com o último dia em que
// apareceu). O coletor atualiza só os dias que acabou de gravar; a API lê a tabela pequena em vez de varrer o
// histórico. O mesmo SQL alimenta a migração 0004 (carga inicial) e os testes.
import { ORIGEM_SQL } from './filtros.js';

const DIA = /^\d{4}-\d{2}-\d{2}$/;

// [lista, uf, valor, tabela]: `i` junta os itens; as condições de vazio são as mesmas da consulta antiga.
const FONTES = [
  ['origem', "''", ORIGEM_SQL, 'p'],
  ['pagamento', "''", 'p.pagamento', 'p'],
  ['entrega', "''", 'p.entrega', 'p'],
  ['uf', "''", 'p.uf', 'p'],
  ['cidade', 'p.uf', 'p.cidade', 'p', "p.uf IS NOT NULL AND p.uf <> ''"],
  ['marca', "''", 'i.marca', 'i'],
  ['categoria', "''", 'i.categoria', 'i'],
];

export function sqlAtualizarOpcoes(de, ate) {
  if (!DIA.test(de) || !DIA.test(ate)) throw new Error(`Período inválido para opções: ${de}..${ate}`);
  return FONTES.map(([lista, uf, valor, t, extra]) => {
    const from = t === 'i' ? 'pedidos p JOIN itens i ON i.pedido_id = p.id' : 'pedidos p';
    const cond = [`p.dia BETWEEN '${de}' AND '${ate}'`, `${valor} IS NOT NULL`, `${valor} <> ''`, ...(extra ? [extra] : [])];
    return `INSERT INTO opcoes (lista, uf, valor, ultimo_dia)
  SELECT '${lista}', ${uf}, ${valor}, MAX(p.dia) FROM ${from} WHERE ${cond.join(' AND ')} GROUP BY 2, 3
  ON CONFLICT(lista, uf, valor) DO UPDATE SET ultimo_dia = excluded.ultimo_dia WHERE excluded.ultimo_dia > opcoes.ultimo_dia;`;
  }).join('\n');
}
