import { ErroHttp } from './resposta.js';

export const LISTAS = ['origem', 'categoria', 'marca', 'pagamento', 'uf', 'cidade', 'entrega'];

const MAX_DIAS = 731;
const MAX_VALORES = 50;
const MAX_TEXTO = 120;
const DIA_MS = 86400000;
const CMPS = ['anterior', 'ano', 'nenhum'];
const ENUMS = {
  entrega: ['retirada', 'entrega'],
  pagamento: ['pix', 'cartao', 'boleto', 'outros'],
};

const invalido = (msg) => new ErroHttp(400, 'filtro-invalido', msg);

const paraMs = (dia) => Date.parse(`${dia}T00:00:00Z`);
const deMs = (ms) => new Date(ms).toISOString().slice(0, 10);
const somarDias = (dia, n) => deMs(paraMs(dia) + n * DIA_MS);

function diaValido(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = paraMs(s);
  return !Number.isNaN(ms) && deMs(ms) === s;
}

function lerDia(params, nome, padrao) {
  const v = params.get(nome);
  if (v === null || v === '') return padrao;
  if (!diaValido(v)) throw invalido(`Data inválida em "${nome}".`);
  return v;
}

function lerLista(params, nome) {
  const valores = [...new Set(params.getAll(nome).filter((v) => v !== ''))];
  if (valores.length > MAX_VALORES) throw invalido(`Filtro "${nome}" aceita no máximo ${MAX_VALORES} valores.`);
  for (const v of valores) {
    if (v.length > MAX_TEXTO) throw invalido(`Valor longo demais em "${nome}".`);
    if (ENUMS[nome] && !ENUMS[nome].includes(v)) throw invalido(`Valor inválido em "${nome}".`);
  }
  return valores;
}

export function lerFiltros(params, hojeLocal) {
  const de = lerDia(params, 'de', somarDias(hojeLocal, -30));
  const ate = lerDia(params, 'ate', somarDias(hojeLocal, -1));
  if (de > ate) throw invalido('A data inicial é posterior à final.');
  if ((paraMs(ate) - paraMs(de)) / DIA_MS + 1 > MAX_DIAS) throw invalido(`Período máximo de ${MAX_DIAS} dias.`);
  const cmp = params.get('cmp') || 'anterior';
  if (!CMPS.includes(cmp)) throw invalido('Comparação inválida.');
  const f = { de, ate, cmp };
  for (const l of LISTAS) f[l] = lerLista(params, l);
  return f;
}

function menosUmAno(dia) {
  const [a, m, d] = dia.split('-').map(Number);
  const r = new Date(Date.UTC(a - 1, m - 1, d));
  // 29/02 sem equivalente: Date rola para 01/03; volta para 28/02
  if (r.getUTCMonth() !== m - 1) return deMs(Date.UTC(a - 1, m - 1, 28));
  return deMs(r.getTime());
}

export function periodoComparacao(f) {
  if (f.cmp === 'ano') return { de: menosUmAno(f.de), ate: menosUmAno(f.ate) };
  if (f.cmp === 'anterior') {
    const dias = (paraMs(f.ate) - paraMs(f.de)) / DIA_MS + 1;
    return { de: somarDias(f.de, -dias), ate: somarDias(f.de, -1) };
  }
  return null;
}

const em = (coluna, valores) => ({ sql: `${coluna} IN (${valores.map(() => '?').join(',')})`, params: valores });

export function whereItens(f) {
  const partes = [];
  if (f.marca.length) partes.push(em('i.marca', f.marca));
  if (f.categoria.length) partes.push(em('i.categoria', f.categoria));
  return { sql: partes.map((p) => p.sql).join(' AND '), params: partes.flatMap((p) => p.params) };
}

export function usaItens(f) {
  return f.marca.length > 0 || f.categoria.length > 0;
}

export function wherePedidos(f, periodo) {
  const sql = ['p.cancelado = 0 AND p.dia BETWEEN ? AND ?'];
  const params = [periodo.de, periodo.ate];
  for (const l of ['origem', 'pagamento', 'uf', 'cidade', 'entrega']) {
    if (!f[l].length) continue;
    const c = em(`p.${l}`, f[l]);
    sql.push(c.sql);
    params.push(...c.params);
  }
  if (usaItens(f)) {
    const wi = whereItens(f);
    sql.push(`EXISTS (SELECT 1 FROM itens i WHERE i.pedido_id = p.id AND ${wi.sql})`);
    params.push(...wi.params);
  }
  return { sql: sql.join(' AND '), params };
}
