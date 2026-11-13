// Coletor de pedidos: OMS da VTEX -> D1 (pedidos, itens, coletas), sem dado pessoal.
// Uso: node coletores/coletar-pedidos.mjs --config <caminho> (--dias 15 | --meses 13)
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { carregarConfig } from './config.mjs';
import { chaveCliente, canalDe, linhasDoPedido } from './pedidos-regras.mjs';
import { sqlValor, upsertSql, criarD1Rest, aplicarArquivo } from './d1.mjs';
import { criarVtex } from './vtex.mjs';

const DIA_MS = 86_400_000;
const HISTORICO_DIAS = 730;
const PARALELO = 5;
const PAUSA_MS = 100;
const LIMITE_ERROS = 30;
const BLOCO_DELETE = 200;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- datas ----------
const somaDias = (dia, n) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
const inicioDoDia = (dia, fusoHoras) => Date.parse(`${dia}T00:00:00Z`) - fusoHoras * 3600e3;

export function hojeLocal(fusoHoras, agoraMs = Date.now()) {
  return new Date(agoraMs + fusoHoras * 3600e3).toISOString().slice(0, 10);
}

export function diasDaJanela(hojeLocalDia, dias) {
  return Array.from({ length: dias }, (_, i) => somaDias(hojeLocalDia, i - dias + 1));
}

export function mesesPendentes(meses, hojeLocalDia, feitos) {
  const [ano, mes] = hojeLocalDia.split('-').map(Number);
  const saida = [];
  for (let i = meses; i >= 1; i--) {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
    const am = d.toISOString().slice(0, 7);
    if (!feitos.has(am)) saida.push(am);
  }
  return saida;
}

export function diasDoMes(mes) {
  const [ano, m] = mes.split('-').map(Number);
  const total = new Date(Date.UTC(ano, m, 0)).getUTCDate();
  return Array.from({ length: total }, (_, i) => `${mes}-${String(i + 1).padStart(2, '0')}`);
}

export function limparErro(erro, segredos = []) {
  let msg = String(erro?.message ?? erro);
  for (const s of segredos) if (s && s.length >= 6) msg = msg.replaceAll(s, '***');
  return msg.slice(0, 300);
}

// ---------- OMS ----------
// A listagem para em 30 páginas de 100 (3.000 pedidos); um dia cabe com folga.
async function listarPedidos(vtex, de, ate, extra = {}) {
  const saida = [];
  for (let pagina = 1; pagina <= 30; pagina++) {
    const q = new URLSearchParams({
      f_creationDate: `creationDate:[${new Date(de).toISOString()} TO ${new Date(ate - 1).toISOString()}]`,
      per_page: '100',
      page: String(pagina),
      orderBy: 'creationDate,desc',
      ...extra,
    });
    const r = await vtex.get(`/api/oms/pvt/orders?${q}`);
    saida.push(...(r?.list ?? []));
    if (!r || pagina >= (r.paging?.pages ?? 0)) break;
  }
  return [...new Map(saida.map((o) => [o.orderId, o])).values()];
}

// Regra do relatório de clientes novos: a busca `q` é por texto, então abre até 3 candidatos
// anteriores (não cancelados) e confere se a chave é a mesma.
async function temCompraAnterior(vtex, pedido, chave, cfg) {
  const criado = Date.parse(pedido.creationDate);
  const candidatos = (
    await listarPedidos(vtex, criado - HISTORICO_DIAS * DIA_MS, criado, { q: chave, salesChannelId: String(cfg.canalSite ?? '1') })
  ).filter((o) => o.orderId !== pedido.orderId && o.status !== 'canceled' && Date.parse(o.creationDate) < criado);
  for (const c of candidatos.slice(0, 3)) {
    const anterior = await vtex.get(`/api/oms/pvt/orders/${c.orderId}`);
    if (chaveCliente(anterior) === chave) return true;
  }
  return false;
}

// ---------- um dia ----------
function contarErro(contador, id, erro, log) {
  contador.erros++;
  log(`[erro] ${id} ${erro.message}`);
  if (contador.erros >= LIMITE_ERROS) throw new Error(`${LIMITE_ERROS} pedidos com erro; abortando para não insistir contra a OMS.`);
}

async function abrirPedidos(lista, { vtex, esperar, log, contador }) {
  const abertos = [];
  let proximo = 0;
  async function trabalhador() {
    while (proximo < lista.length) {
      const resumo = lista[proximo++];
      try {
        abertos.push(await vtex.get(`/api/oms/pvt/orders/${resumo.orderId}`));
      } catch (e) {
        contarErro(contador, resumo.orderId, e, log);
      }
      await esperar(PAUSA_MS);
    }
  }
  await Promise.all(Array.from({ length: PARALELO }, trabalhador));
  return abertos.sort((a, b) => Date.parse(a.creationDate) - Date.parse(b.creationDate));
}

// Classifica só pedidos do site sem `cliente_tipo` no D1. `cache`: chave -> primeiro criado (ms)
// nesta execução; a chave fica só em memória.
async function classificar(pedido, existente, deps) {
  const { vtex, cfg, cache, contador, log } = deps;
  const chave = chaveCliente(pedido);
  const criado = Date.parse(pedido.creationDate);
  const vistoAntes = chave !== null && cache.has(chave) && cache.get(chave) < criado;
  if (chave !== null && pedido.status !== 'canceled' && !(cache.get(chave) <= criado)) cache.set(chave, criado);
  if (existente) return existente;
  if (canalDe(pedido, cfg) !== 'Site') return null;
  if (chave === null) return 'indefinido';
  if (vistoAntes) return 'recorrente';
  try {
    return (await temCompraAnterior(vtex, pedido, chave, cfg)) ? 'recorrente' : 'novo';
  } catch (e) {
    contarErro(contador, pedido.orderId, e, log);
    return null;
  }
}

function sqlDoDia(linhas) {
  const ids = linhas.map((l) => l.pedido.id);
  const partes = [];
  for (let i = 0; i < ids.length; i += BLOCO_DELETE) {
    partes.push(`DELETE FROM itens WHERE pedido_id IN (${ids.slice(i, i + BLOCO_DELETE).map(sqlValor).join(', ')})`);
  }
  partes.push(upsertSql('pedidos', linhas.map((l) => l.pedido), ['id']));
  const itens = linhas.flatMap((l) => l.itens);
  if (itens.length) partes.push(upsertSql('itens', itens, ['pedido_id', 'sku']));
  return `${partes.join(';\n')};\n`;
}

async function coletarDia(dia, deps) {
  const { vtex, d1, cfg, aplicar, agora, log } = deps;
  const de = inicioDoDia(dia, cfg.fusoHoras);
  const lista = await listarPedidos(vtex, de, de + DIA_MS);
  const abertos = await abrirPedidos(lista, deps);
  const existentes = new Map(
    (await d1.consulta('SELECT id, cliente_tipo FROM pedidos WHERE dia = ?', [dia])).map((r) => [r.id, r.cliente_tipo]),
  );
  const quando = agora();
  const linhas = [];
  for (const p of abertos) {
    const tipo = await classificar(p, existentes.get(p.orderId) ?? null, deps);
    linhas.push(linhasDoPedido(p, cfg, tipo, quando));
  }
  if (linhas.length) await aplicar(sqlDoDia(linhas));
  const itens = linhas.reduce((n, l) => n + l.itens.length, 0);
  log(`${dia}: ${lista.length} na listagem, ${linhas.length} gravados, ${itens} itens`);
  return { pedidos: linhas.length, itens };
}

export async function registrarColeta(d1, { fonte, quando, ok, registros, erro }) {
  await d1.consulta(
    'INSERT INTO coletas (fonte, quando, ok, registros, erro) VALUES (?, ?, ?, ?, ?) '
      + 'ON CONFLICT(fonte) DO UPDATE SET quando=excluded.quando, ok=excluded.ok, registros=excluded.registros, erro=excluded.erro',
    [fonte, quando, ok, registros, erro],
  );
}

// deps = { vtex, d1, cfg, aplicar(sql), agora(), esperar?, log?, cache?, contador? }
export async function coletarDias(dias, deps, { fonte = 'pedidos' } = {}) {
  const d = {
    esperar: dormir,
    log: console.log,
    cache: new Map(),
    contador: { erros: 0 },
    ...deps,
  };
  const errosAntes = d.contador.erros;
  const total = { pedidos: 0, itens: 0 };
  for (const dia of dias) {
    const r = await coletarDia(dia, d);
    total.pedidos += r.pedidos;
    total.itens += r.itens;
  }
  await registrarColeta(d.d1, { fonte, quando: d.agora(), ok: 1, registros: total.pedidos, erro: null });
  return { ...total, erros: d.contador.erros - errosAntes };
}

// ---------- CLI ----------
function lerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const nome = argv[i]?.replace(/^--/, '');
    if (!['config', 'dias', 'meses'].includes(nome) || argv[i + 1] === undefined) {
      throw new Error('Uso: node coletores/coletar-pedidos.mjs --config <caminho> (--dias 15 | --meses 13)');
    }
    args[nome] = argv[i + 1];
  }
  if (!args.config) throw new Error('Falta --config <caminho>');
  for (const k of ['dias', 'meses']) {
    if (args[k] !== undefined && !/^[1-9]\d*$/.test(args[k])) throw new Error(`--${k} deve ser inteiro positivo`);
  }
  return args;
}

function pastaTemporaria() {
  const t = tmpdir();
  if (!/[\s"&|<>^%]/.test(t)) return t;
  const local = resolve('.tmp');
  mkdirSync(local, { recursive: true });
  return local;
}

function criarAplicar(banco) {
  return async (sql) => {
    const caminho = join(pastaTemporaria(), `painel-${Date.now()}-${process.pid}.sql`);
    writeFileSync(caminho, sql, 'utf8');
    try {
      await aplicarArquivo(caminho, banco);
    } finally {
      try { unlinkSync(caminho); } catch { /* arquivo já removido */ }
    }
  };
}

async function principal() {
  const args = lerArgs(process.argv.slice(2));
  const cfg = carregarConfig(args.config);
  const env = process.env;
  const segredos = [env.VTEX_APP_KEY, env.VTEX_APP_TOKEN, env.CF_API_TOKEN];
  // O wrangler lê as credenciais com estes nomes.
  env.CLOUDFLARE_API_TOKEN ??= env.CF_API_TOKEN;
  env.CLOUDFLARE_ACCOUNT_ID ??= env.CF_ACCOUNT_ID;
  const d1 = criarD1Rest({ accountId: env.CF_ACCOUNT_ID, databaseId: env.CF_D1_ID, token: env.CF_API_TOKEN });
  const agora = () => new Date().toISOString();
  try {
    const deps = {
      vtex: criarVtex({ conta: env.VTEX_CONTA, appKey: env.VTEX_APP_KEY, appToken: env.VTEX_APP_TOKEN }),
      d1,
      cfg,
      aplicar: criarAplicar(env.D1_NOME || 'painel'),
      agora,
      cache: new Map(),
      contador: { erros: 0 },
    };
    const hoje = hojeLocal(cfg.fusoHoras);
    const total = { dias: 0, pedidos: 0, itens: 0 };
    const somar = (dias, r) => { total.dias += dias.length; total.pedidos += r.pedidos; total.itens += r.itens; };

    if (args.meses) {
      const feitas = await d1.consulta("SELECT fonte FROM coletas WHERE fonte LIKE 'carga:%' AND ok = 1");
      const feitos = new Set(feitas.map((r) => r.fonte.slice('carga:'.length)));
      for (const mes of mesesPendentes(Number(args.meses), hoje, feitos)) {
        const dias = diasDoMes(mes);
        somar(dias, await coletarDias(dias, deps, { fonte: `carga:${mes}` }));
      }
    }
    const janela = diasDaJanela(hoje, Number(args.dias ?? 15));
    somar(janela, await coletarDias(janela, deps));
    console.log(`Fim. dias=${total.dias} pedidos=${total.pedidos} itens=${total.itens} erros=${deps.contador.erros}`);
  } catch (e) {
    const erro = limparErro(e, segredos);
    console.error(`Falhou: ${erro}`);
    try {
      await registrarColeta(d1, { fonte: 'pedidos', quando: agora(), ok: 0, registros: 0, erro });
    } catch (e2) {
      console.error(`Não foi possível registrar a falha: ${limparErro(e2, segredos)}`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  principal().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
