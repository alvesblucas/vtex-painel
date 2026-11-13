// Histórico de mudanças (somente leitura): filtros quem, alvo, de/ate (data de `quando`), 50 por página.
import { invalido, lerJson } from '../../_lib/admin.js';
import { normalizarEmail } from '../../_lib/acesso.js';
import { exigirAdmin } from '../../_lib/permissoes.js';
import { json } from '../../_lib/resposta.js';

const POR_PAGINA = 50;
const MAX_PAGINA = 100000;
const DIA_MS = 86400000;
const RE_DIA = /^\d{4}-\d{2}-\d{2}$/;

function lerDia(v, campo) {
  const d = new Date(`${v}T00:00:00Z`);
  if (!RE_DIA.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) {
    throw invalido(`"${campo}" deve ser uma data AAAA-MM-DD.`);
  }
  return d;
}

// `quando` é ISO; comparar como texto com o início do dia (e do dia seguinte) usa o índice.
function filtros(params) {
  const onde = [];
  const valores = [];
  for (const campo of ['quem', 'alvo']) {
    const v = normalizarEmail(params.get(campo));
    if (v) {
      onde.push(`${campo} = ?`);
      valores.push(v);
    }
  }
  const de = params.get('de');
  if (de) {
    onde.push('quando >= ?');
    valores.push(lerDia(de, 'de').toISOString().slice(0, 10));
  }
  const ate = params.get('ate');
  if (ate) {
    onde.push('quando < ?');
    valores.push(new Date(lerDia(ate, 'ate').getTime() + DIA_MS).toISOString().slice(0, 10));
  }
  return { where: onde.length ? `WHERE ${onde.join(' AND ')}` : '', valores };
}

function lerPagina(params) {
  const v = params.get('pagina');
  if (v === null || v === '') return 1;
  const n = Number(v);
  if (!/^\d+$/.test(v) || n < 1 || n > MAX_PAGINA) throw invalido('"pagina" deve ser um número inteiro a partir de 1.');
  return n;
}

export async function onRequestGet(context) {
  exigirAdmin(context);
  const db = context.env.DB;
  const params = new URL(context.request.url).searchParams;
  const pagina = lerPagina(params);
  const { where, valores } = filtros(params);
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM auditoria ${where}`).bind(...valores).first();
  const { results } = await db
    .prepare(`SELECT id, quando, quem, acao, alvo, antes, depois FROM auditoria ${where}
               ORDER BY quando DESC, id DESC LIMIT ? OFFSET ?`)
    .bind(...valores, POR_PAGINA, (pagina - 1) * POR_PAGINA)
    .all();
  const itens = results.map((l) => ({ ...l, antes: lerJson(l.antes), depois: lerJson(l.depois) }));
  return json({ itens, total: Number(total?.n ?? 0), pagina, porPagina: POR_PAGINA });
}
