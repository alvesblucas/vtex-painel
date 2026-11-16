// Consultas de leitura reaproveitadas pelos handlers. Todo valor vai por `?`; cada consulta aplica os filtros uma vez.
import { CANAL_SITE, lerFiltros, ORIGEM_SQL, periodoComparacao, somarDias, usaItens, whereItens, wherePedidos } from './filtros.js';
import { ErroHttp } from './resposta.js';

const HORA_MS = 3600000;
const FUSO_PADRAO = -3;
const SEM_CHAVE = '(não informado)';

// Fuso da loja em horas (env.FUSO_HORAS); vazio ou inválido = -3.
export function fusoHoras(env) {
  const bruto = env?.FUSO_HORAS;
  const h = bruto === undefined || bruto === null || bruto === '' ? FUSO_PADRAO : Number(bruto);
  return Number.isFinite(h) ? h : FUSO_PADRAO;
}

export function hojeLocal(env, agora = Date.now()) {
  return new Date(agora + fusoHoras(env) * HORA_MS).toISOString().slice(0, 10);
}

// Última coleta boa da fonte: com a última tentativa ok, o próprio quando; se ela falhou, ultimo_ok
// (gravado pelo coletor; uma falha não apaga o "dados até").
export const SQL_ULTIMO_OK = 'CASE WHEN ok = 1 THEN quando ELSE ultimo_ok END';

export async function dadosAte(db, fonte) {
  const r = await db.prepare(`SELECT ${SQL_ULTIMO_OK} AS ate FROM coletas WHERE fonte = ?`).bind(fonte).first();
  return r?.ate ?? null;
}

export function filtrosDaRequisicao(context) {
  const params = new URL(context.request.url).searchParams;
  const f = lerFiltros(params, hojeLocal(context.env));
  return { f, params, cmp: periodoComparacao(f) };
}

export function diasDoPeriodo({ de, ate }) {
  const dias = [];
  for (let d = de; d <= ate; d = somarDias(d, 1)) dias.push(d);
  return dias;
}

export const pct = (atual, antes) => (antes > 0 ? Math.round(((atual - antes) / antes) * 1000) / 10 : null);

async function todas(db, sql, params) {
  return (await db.prepare(sql).bind(...params).all()).results ?? [];
}

// FROM/WHERE dos pedidos filtrados. Com marca/categoria (ou `itens: true`) junta `itens i` e soma i.valor (sem frete).
function base(f, periodo, { cancelado = 0, itens = false, extra = null } = {}) {
  const wp = wherePedidos(f, periodo, { cancelado, itens: false });
  const sql = [wp.sql];
  const params = [...wp.params];
  if (extra) {
    sql.push(extra.sql);
    params.push(...extra.params);
  }
  if (!itens && !usaItens(f)) return { from: 'pedidos p', where: sql.join(' AND '), params, valor: 'p.valor' };
  if (usaItens(f)) {
    const wi = whereItens(f);
    sql.push(wi.sql);
    params.push(...wi.params);
  }
  return { from: 'pedidos p JOIN itens i ON i.pedido_id = p.id', where: sql.join(' AND '), params, valor: 'i.valor' };
}

const ticket = (valor, pedidos) => (pedidos ? Math.round(valor / pedidos) : 0);

export async function resumo(db, f, periodo) {
  const b = base(f, periodo, { cancelado: null });
  const r = await db
    .prepare(
      `SELECT COALESCE(SUM(CASE WHEN p.cancelado = 0 THEN ${b.valor} END), 0) AS valor,
              COUNT(DISTINCT CASE WHEN p.cancelado = 0 THEN p.id END) AS pedidos,
              COUNT(DISTINCT CASE WHEN p.cancelado = 1 THEN p.id END) AS cancelados
         FROM ${b.from} WHERE ${b.where}`,
    )
    .bind(...b.params)
    .first();
  const valor = r?.valor ?? 0;
  const pedidos = r?.pedidos ?? 0;
  return { valor, pedidos, ticket: ticket(valor, pedidos), cancelados: r?.cancelados ?? 0 };
}

export async function serie(db, f, periodo) {
  const b = base(f, periodo);
  const linhas = await todas(
    db,
    `SELECT p.dia AS dia, SUM(${b.valor}) AS valor, COUNT(DISTINCT p.id) AS pedidos
       FROM ${b.from} WHERE ${b.where} GROUP BY p.dia`,
    b.params,
  );
  const porDia = new Map(linhas.map((l) => [l.dia, l]));
  return diasDoPeriodo(periodo).map((dia) => ({ dia, valor: porDia.get(dia)?.valor ?? 0, pedidos: porDia.get(dia)?.pedidos ?? 0 }));
}

export const QUEBRAS = {
  origem: ORIGEM_SQL, categoria: 'i.categoria', marca: 'i.marca', pagamento: 'p.pagamento', uf: 'p.uf', entrega: 'p.entrega',
};

// Todos os grupos, sem ordem; quem chama ordena e corta o top N.
export async function quebra(db, f, periodo, por) {
  const coluna = QUEBRAS[por];
  const b = base(f, periodo, { itens: coluna.startsWith('i.') });
  return todas(
    db,
    `SELECT COALESCE(${coluna}, ?) AS chave, SUM(${b.valor}) AS valor, COUNT(DISTINCT p.id) AS pedidos
       FROM ${b.from} WHERE ${b.where} GROUP BY 1`,
    [SEM_CHAVE, ...b.params],
  );
}

const escaparLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

const filtroBusca = (busca) => (busca
  ? { sql: "(i.nome LIKE ? ESCAPE '\\' OR i.sku LIKE ? ESCAPE '\\')", params: [`%${escaparLike(busca)}%`, `%${escaparLike(busca)}%`] }
  : null);

export async function produtos(db, f, periodo, { pagina, porPagina, ordem, busca }) {
  const b = base(f, periodo, { itens: true, extra: filtroBusca(busca) });
  const agrupado = `SELECT i.sku AS sku, MAX(i.nome) AS nome, MAX(i.marca) AS marca, MAX(i.categoria) AS categoria,
       SUM(i.qtd) AS qtd, SUM(i.valor) AS valor, COUNT(DISTINCT p.id) AS pedidos
       FROM ${b.from} WHERE ${b.where} GROUP BY i.sku`;
  const itens = await todas(db, `${agrupado} ORDER BY ${ordem} DESC, sku LIMIT ? OFFSET ?`, [...b.params, porPagina, (pagina - 1) * porPagina]);
  const total = await db.prepare(`SELECT COUNT(*) AS n FROM (${agrupado})`).bind(...b.params).first();
  return { itens, total: total?.n ?? 0 };
}

// Produtos que subiram/caíram em quantidade contra o período de comparação. O lado "antes" manda (só SKUs com
// 3+ pedidos lá): quem zerou aparece com -100%, quem não vendia antes fica de fora (sem base não há variação).
const MIN_PEDIDOS_ANTES = 3;
const FILTRO_MODO = { subiram: 'qtd > qtdAntes', caiu: 'qtd < qtdAntes' };
const ORDEM_MODO = { subiram: 'varQtd DESC, sku', caiu: 'varQtd ASC, sku' };

export async function produtosVariacao(db, f, atual, antes, { modo, pagina, porPagina, busca }) {
  const extra = filtroBusca(busca);
  const agregado = (periodo) => {
    const b = base(f, periodo, { itens: true, extra });
    return {
      sql: `SELECT i.sku AS sku, MAX(i.nome) AS nome, MAX(i.marca) AS marca, MAX(i.categoria) AS categoria,
              SUM(i.qtd) AS qtd, SUM(i.valor) AS valor, COUNT(DISTINCT p.id) AS pedidos
            FROM ${b.from} WHERE ${b.where} GROUP BY i.sku`,
      params: b.params,
    };
  };
  const at = agregado(atual);
  const an = agregado(antes);
  const juntos = `WITH atual AS (${at.sql}), antes AS (${an.sql} HAVING COUNT(DISTINCT p.id) >= ${MIN_PEDIDOS_ANTES}),
    j AS (SELECT a.sku AS sku, COALESCE(t.nome, a.nome) AS nome, COALESCE(t.marca, a.marca) AS marca,
            COALESCE(t.categoria, a.categoria) AS categoria, COALESCE(t.qtd, 0) AS qtd, a.qtd AS qtdAntes,
            COALESCE(t.pedidos, 0) AS pedidos, COALESCE(t.valor, 0) AS valor, a.valor AS valorAntes,
            ROUND((COALESCE(t.qtd, 0) - a.qtd) * 100.0 / a.qtd, 1) AS varQtd
          FROM antes a LEFT JOIN atual t ON t.sku = a.sku)`;
  const where = FILTRO_MODO[modo];
  const params = [...at.params, ...an.params];
  const itens = await todas(
    db,
    `${juntos} SELECT sku, nome, marca, categoria, qtd, qtdAntes, pedidos, varQtd, valor,
       CASE WHEN qtd = 0 OR qtdAntes = 0 OR valorAntes = 0 THEN NULL
            ELSE ROUND(((valor * 1.0 / qtd) / (valorAntes * 1.0 / qtdAntes) - 1) * 100, 1) END AS varPreco
     FROM j WHERE ${where} ORDER BY ${ORDEM_MODO[modo]} LIMIT ? OFFSET ?`,
    [...params, porPagina, (pagina - 1) * porPagina],
  );
  const total = await db.prepare(`${juntos} SELECT COUNT(*) AS n FROM j WHERE ${where}`).bind(...params).first();
  return { itens, total: total?.n ?? 0 };
}

const TIPOS = ['novo', 'recorrente', 'indefinido'];

function segundaFeira(dia) {
  const dow = new Date(`${dia}T00:00:00Z`).getUTCDay();
  return somarDias(dia, -((dow + 6) % 7));
}

const pctNovos = (novo, recorrente) => (novo + recorrente ? Math.round((novo / (novo + recorrente)) * 1000) / 10 : 0);

// Só pedidos do site (marketplace não tem cliente classificado).
export async function clientes(db, f, periodo) {
  const b = base(f, periodo, { extra: { sql: 'p.canal = ?', params: [CANAL_SITE] } });
  const linhas = await todas(
    db,
    `SELECT p.dia AS dia, p.origem AS origem, p.cliente_tipo AS tipo, SUM(${b.valor}) AS valor, COUNT(DISTINCT p.id) AS pedidos
       FROM ${b.from} WHERE ${b.where} GROUP BY p.dia, p.origem, p.cliente_tipo`,
    b.params,
  );
  const tot = Object.fromEntries(TIPOS.map((t) => [t, { pedidos: 0, valor: 0 }]));
  const origens = new Map();
  const semanas = new Map();
  for (let s = segundaFeira(periodo.de); s <= periodo.ate; s = somarDias(s, 7)) semanas.set(s, { inicio: s, novo: 0, recorrente: 0 });
  for (const l of linhas) {
    const tipo = TIPOS.includes(l.tipo) ? l.tipo : 'indefinido';
    tot[tipo].pedidos += l.pedidos;
    tot[tipo].valor += l.valor;
    if (tipo === 'indefinido') continue;
    if (!origens.has(l.origem)) origens.set(l.origem, { origem: l.origem, novo: 0, recorrente: 0 });
    origens.get(l.origem)[tipo] += l.pedidos;
    semanas.get(segundaFeira(l.dia))[tipo] += l.pedidos;
  }
  const porOrigem = [...origens.values()].sort((a, b2) => b2.novo + b2.recorrente - (a.novo + a.recorrente) || a.origem.localeCompare(b2.origem));
  return { ...tot, pctNovos: pctNovos(tot.novo.pedidos, tot.recorrente.pedidos), porOrigem, porSemana: [...semanas.values()] };
}

const ordenar = (a, b) => String(a).localeCompare(String(b), 'pt-BR');

export async function opcoes(db, desde) {
  const distintos = async (coluna) =>
    (await todas(db, `SELECT DISTINCT ${coluna} AS v FROM pedidos p WHERE p.dia >= ? AND ${coluna} IS NOT NULL AND ${coluna} <> ''`, [desde])).map((l) => l.v).sort(ordenar);
  const deItens = async (coluna) =>
    (await todas(
      db,
      `SELECT DISTINCT ${coluna} AS v FROM itens i JOIN pedidos p ON p.id = i.pedido_id
        WHERE p.dia >= ? AND ${coluna} IS NOT NULL AND ${coluna} <> ''`,
      [desde],
    )).map((l) => l.v).sort(ordenar);
  const pares = await todas(
    db,
    `SELECT DISTINCT p.uf AS uf, p.cidade AS cidade FROM pedidos p
      WHERE p.dia >= ? AND p.uf IS NOT NULL AND p.uf <> '' AND p.cidade IS NOT NULL AND p.cidade <> ''`,
    [desde],
  );
  const cidades = {};
  for (const { uf, cidade } of pares) (cidades[uf] ??= []).push(cidade);
  for (const uf of Object.keys(cidades)) cidades[uf].sort(ordenar);
  return {
    origens: await distintos(ORIGEM_SQL),
    pagamentos: await distintos('p.pagamento'),
    entregas: await distintos('p.entrega'),
    ufs: await distintos('p.uf'),
    cidades,
    marcas: await deItens('i.marca'),
    categorias: await deItens('i.categoria'),
  };
}

export async function coletas(db) {
  const linhas = await todas(
    db,
    `SELECT fonte, quando, ok, ${SQL_ULTIMO_OK} AS ultimo_ok FROM coletas WHERE fonte NOT LIKE 'carga:%' ORDER BY fonte`,
    [],
  );
  // quando/ok: última tentativa; ultimoOk: última coleta boa (null se nunca houve).
  return linhas.map((l) => ({ fonte: l.fonte, quando: l.quando, ok: Boolean(l.ok), ultimoOk: l.ultimo_ok ?? null }));
}

export function lerAgenda(env) {
  try {
    const a = JSON.parse(env?.AGENDA_JSON || '{}');
    return a && typeof a === 'object' && !Array.isArray(a) ? a : {};
  } catch {
    return {};
  }
}

export const invalido = (msg) => new ErroHttp(400, 'filtro-invalido', msg);
