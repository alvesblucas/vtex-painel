// Coletor de pedidos: OMS da VTEX -> D1 (pedidos, itens, coletas), sem dado pessoal.
// Uso: node coletores/coletar-pedidos.mjs --config <caminho> [--dias 15] [--meses 13] [--limite-minutos 300]
// Roda primeiro a janela dos últimos --dias (padrão 15) e depois, com --meses, a carga histórica até o
// limite de tempo (padrão 300 min, contado desde o início da execução).
import { writeFileSync, unlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { carregarConfig } from './config.mjs';
import { chaveCliente, canalDe, linhasDoPedido } from './pedidos-regras.mjs';
import { sqlValor, upsertSql, criarD1Rest, aplicarComRetentativa } from './d1.mjs';
import { criarVtex } from './vtex.mjs';
import { sqlAtualizarOpcoes } from '../functions/_lib/opcoes-sql.js';

const DIA_MS = 86_400_000;
const HISTORICO_DIAS = 730;
const PARALELO = 5;
const PAUSA_MS = 100;
const LIMITE_ERROS = 30;
const BLOCO_DELETE = 200;
const LIMITE_MINUTOS = 300;
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

// Plano da carga: os meses anteriores ao atual ainda sem marcador e, no mês corrente, os dias antes da
// janela (nenhuma janela futura volta a eles). `feitos`: fontes `carga:` com ok = 1, sem o prefixo —
// mês fechado (AAAA-MM) ou dia gravado por uma carga anterior (AAAA-MM-DD), que fica de fora: um mês
// interrompido retoma do próximo dia que falta. `fecha`: o mês ganha o marcador quando terminar sem erro;
// o mês corrente nunca fecha (só fecha na carga do mês seguinte, como mês anterior).
export function planoDaCarga(meses, hojeLocalDia, inicioJanela, feitos) {
  const atual = hojeLocalDia.slice(0, 7);
  const plano = [
    ...mesesPendentes(meses, hojeLocalDia, feitos).map((mes) => ({ mes, fecha: true, dias: diasDoMes(mes) })),
    { mes: atual, fecha: false, dias: diasDoMes(atual).filter((d) => d < inicioJanela) },
  ];
  return plano
    .map((m) => ({ ...m, dias: m.dias.filter((d) => !feitos.has(d)) }))
    .filter((m) => m.fecha || m.dias.length);
}

export function limparErro(erro, segredos = []) {
  let msg = String(erro?.message ?? erro);
  for (const s of segredos) if (s && s.length >= 6) msg = msg.replaceAll(s, '***');
  return msg.slice(0, 300);
}

// ---------- OMS ----------
// A listagem para em 30 páginas de 100 (3.000 pedidos); um dia cabe com folga.
// `dia`: listagem de um dia inteiro; se passar de 30 páginas, falha em vez de contar a menos.
async function listarPedidos(vtex, de, ate, extra = {}, dia = null, paginas = 30) {
  const saida = [];
  for (let pagina = 1; pagina <= paginas; pagina++) {
    const q = new URLSearchParams({
      f_creationDate: `creationDate:[${new Date(de).toISOString()} TO ${new Date(ate - 1).toISOString()}]`,
      per_page: '100',
      page: String(pagina),
      orderBy: 'creationDate,desc',
      ...extra,
    });
    const r = await vtex.get(`/api/oms/pvt/orders?${q}`);
    if (dia && pagina === 1 && (r?.paging?.pages ?? 0) > 30) {
      throw new Error(`mais de 3.000 pedidos em ${dia}; listagem incompleta`);
    }
    saida.push(...(r?.list ?? []));
    if (!r || pagina >= (r.paging?.pages ?? 0)) break;
  }
  return [...new Map(saida.map((o) => [o.orderId, o])).values()];
}

// Regra do relatório de clientes novos: a busca `q` é por texto, então abre até 3 candidatos
// anteriores (não cancelados) e confere se a chave é a mesma. Só a 1ª página (mais recentes primeiro):
// paginar até 30 páginas para usar 3 candidatos era o que mais pesava na carga.
async function temCompraAnterior(vtex, pedido, chave, cfg) {
  const criado = Date.parse(pedido.creationDate);
  const filtro = { q: chave, salesChannelId: String(cfg.canalSite ?? '1'), per_page: '20' };
  const candidatos = (
    await listarPedidos(vtex, criado - HISTORICO_DIAS * DIA_MS, criado, filtro, null, 1)
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
  if (contador.erros >= LIMITE_ERROS) {
    contador.parar = true;
    throw new Error(`${LIMITE_ERROS} pedidos com erro; abortando para não insistir contra a OMS.`);
  }
}

async function abrirPedidos(lista, { vtex, esperar, log, contador }) {
  const abertos = [];
  let proximo = 0;
  async function trabalhador() {
    while (proximo < lista.length && !contador.parar) {
      const resumo = lista[proximo++];
      try {
        const pedido = await vtex.get(`/api/oms/pvt/orders/${resumo.orderId}`);
        if (!pedido?.orderId || !pedido.creationDate) throw new Error('pedido vazio na resposta da OMS');
        abertos.push(pedido);
      } catch (e) {
        contador.naoAbertos++;
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
  const site = canalDe(pedido, cfg) === 'Site';
  const vistoAntes = chave !== null && cache.has(chave) && cache.get(chave) < criado;
  if (site && chave !== null && pedido.status !== 'canceled' && !(cache.get(chave) <= criado)) cache.set(chave, criado);
  if (existente) return existente;
  if (!site) return null;
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
  const lista = await listarPedidos(vtex, de, de + DIA_MS, {}, dia);
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

// quando/ok/erro = última tentativa; ultimo_ok = última coleta boa, que uma falha não apaga
// (é dela que sai o "dados até").
export async function registrarColeta(d1, { fonte, quando, ok, registros, erro }) {
  await d1.consulta(
    'INSERT INTO coletas (fonte, quando, ok, registros, erro, ultimo_ok) VALUES (?, ?, ?, ?, ?, ?) '
      + 'ON CONFLICT(fonte) DO UPDATE SET quando=excluded.quando, ok=excluded.ok, registros=excluded.registros, '
      + 'erro=excluded.erro, ultimo_ok=COALESCE(excluded.ultimo_ok, coletas.ultimo_ok)',
    [fonte, quando, ok, registros, erro, ok ? quando : null],
  );
}

// deps = { vtex, d1, cfg, aplicar(sql), agora(), esperar?, log?, cache?, contador? }
function completar(deps) {
  const d = {
    esperar: dormir,
    log: console.log,
    cache: new Map(),
    ...deps,
  };
  // Contador compartilhado entre chamadas: completa os campos no próprio objeto.
  d.contador = Object.assign(deps.contador ?? {}, { erros: 0, naoAbertos: 0, parar: false, ...deps.contador });
  return d;
}

const descreverErros = (erros, naoAbertos) => (naoAbertos > 0 ? `${naoAbertos} pedidos não abertos` : `${erros} pedidos com erro`);

export async function coletarDias(dias, deps, { fonte = 'pedidos' } = {}) {
  const d = completar(deps);
  const errosAntes = d.contador.erros;
  const naoAbertosAntes = d.contador.naoAbertos;
  const total = { pedidos: 0, itens: 0 };
  for (const dia of dias) {
    const r = await coletarDia(dia, d);
    total.pedidos += r.pedidos;
    total.itens += r.itens;
  }
  // Valores da barra de filtros: só os dias recém-gravados (poucas leituras; grava só valor novo ou dia mais recente).
  if (total.pedidos > 0) {
    const ordem = [...dias].sort();
    await d.aplicar(sqlAtualizarOpcoes(ordem[0], ordem.at(-1)));
  }
  const erros = d.contador.erros - errosAntes;
  const naoAbertos = d.contador.naoAbertos - naoAbertosAntes;
  // Mês da carga só fica feito sem erro; senão a próxima execução refaz o mês.
  const falhou = fonte.startsWith('carga:') && erros > 0;
  const erro = falhou ? descreverErros(erros, naoAbertos) : null;
  await registrarColeta(d.d1, { fonte, quando: d.agora(), ok: falhou ? 0 : 1, registros: total.pedidos, erro });
  return { ...total, erros };
}

// ---------- carga histórica ----------
async function registrarSemFalhar(d1, linha, logErro, segredos) {
  try {
    await registrarColeta(d1, linha);
  } catch (e) {
    logErro(`Não foi possível registrar a coleta ${linha.fonte}: ${limparErro(e, segredos)}`);
  }
}

// Carga dia a dia até o `prazo` (ms do `relogio`), conferido antes de cada dia: ao passar, para entre dois
// dias e avisa quanto falta. Cada dia gravado sem erro deixa o marcador `carga:AAAA-MM-DD`; o mês fecha
// (`carga:AAAA-MM` com ok = 1, que as próximas cargas pulam) quando todos os dias ficaram sem erro, e aí
// os marcadores dos dias saem. Exceção (30 erros, wrangler) fica registrada em `carga:AAAA-MM` e é repassada.
// deps = os de coletarDias + segredos?, logErro?
export async function executarCarga(plano, deps, { prazo = Infinity, relogio = Date.now } = {}) {
  const d = completar(deps);
  const segredos = d.segredos ?? [];
  const logErro = d.logErro ?? console.error;
  const total = { dias: 0, pedidos: 0, itens: 0, erros: 0, completa: true };
  for (const [i, { mes, dias, fecha }] of plano.entries()) {
    const noMes = { erros: 0, naoAbertos: 0, pedidos: 0 };
    try {
      for (const [j, dia] of dias.entries()) {
        if (relogio() >= prazo) {
          const resto = plano.slice(i + 1).reduce((n, m) => n + m.dias.length, dias.length - j);
          const meses = [mes, ...plano.slice(i + 1).map((m) => m.mes)].join(', ');
          d.log(`Carga parou no limite de tempo antes de ${dia}; faltam ${resto} dias (${meses}). A próxima carga continua daqui.`);
          total.completa = false;
          return total;
        }
        const antes = { erros: d.contador.erros, naoAbertos: d.contador.naoAbertos };
        const r = await coletarDia(dia, d);
        total.dias++;
        total.pedidos += r.pedidos;
        total.itens += r.itens;
        noMes.pedidos += r.pedidos;
        const erros = d.contador.erros - antes.erros;
        if (erros) {
          noMes.erros += erros;
          noMes.naoAbertos += d.contador.naoAbertos - antes.naoAbertos;
        } else {
          await registrarColeta(d.d1, { fonte: `carga:${dia}`, quando: d.agora(), ok: 1, registros: r.pedidos, erro: null });
        }
      }
    } catch (e) {
      const erro = limparErro(e, segredos);
      await registrarSemFalhar(d.d1, { fonte: `carga:${mes}`, quando: d.agora(), ok: 0, registros: noMes.pedidos, erro }, logErro, segredos);
      throw e;
    }
    total.erros += noMes.erros;
    if (noMes.erros) {
      // Dias com erro ficaram sem marcador: a próxima carga refaz só eles.
      const erro = descreverErros(noMes.erros, noMes.naoAbertos);
      await registrarColeta(d.d1, { fonte: `carga:${mes}`, quando: d.agora(), ok: 0, registros: noMes.pedidos, erro });
    } else if (fecha) {
      await registrarColeta(d.d1, { fonte: `carga:${mes}`, quando: d.agora(), ok: 1, registros: noMes.pedidos, erro: null });
      await d.d1.consulta('DELETE FROM coletas WHERE fonte LIKE ?', [`carga:${mes}-%`]);
    }
  }
  return total;
}

// Uma execução: janela primeiro (dado fresco tem prioridade), depois a carga com o tempo que sobrar.
// Cada parte tem o próprio contador de erros, e a falha de uma não impede a outra: falha da janela
// fica em `pedidos` (sem apagar ultimo_ok), falha da carga em `carga:AAAA-MM`.
export async function rodar({ dias = 15, meses = 0, hoje, prazo = Infinity, relogio = Date.now, segredos = [] }, deps) {
  const base = { cache: new Map(), segredos, ...deps };
  const log = base.log ?? console.log;
  const logErro = base.logErro ?? console.error;
  const novoContador = () => ({ erros: 0, naoAbertos: 0, parar: false });
  const total = { dias: 0, pedidos: 0, itens: 0, erros: 0 };
  const somar = (n, r) => {
    total.dias += n;
    total.pedidos += r.pedidos;
    total.itens += r.itens;
    total.erros += r.erros;
  };
  let ok = true;

  const janela = diasDaJanela(hoje, dias);
  try {
    somar(janela.length, await coletarDias(janela, { ...base, contador: novoContador() }));
  } catch (e) {
    ok = false;
    const erro = limparErro(e, segredos);
    logErro(`Janela de ${dias} dias falhou: ${erro}`);
    await registrarSemFalhar(base.d1, { fonte: 'pedidos', quando: base.agora(), ok: 0, registros: 0, erro }, logErro, segredos);
  }

  if (meses) {
    try {
      const feitas = await base.d1.consulta("SELECT fonte FROM coletas WHERE fonte LIKE 'carga:%' AND ok = 1");
      const feitos = new Set(feitas.map((r) => r.fonte.slice('carga:'.length)));
      const plano = planoDaCarga(meses, hoje, janela[0], feitos);
      const r = await executarCarga(plano, { ...base, contador: novoContador() }, { prazo, relogio });
      somar(r.dias, r);
      if (r.completa) log('Carga histórica completa.');
    } catch (e) {
      ok = false;
      logErro(`Carga histórica falhou: ${limparErro(e, segredos)}`);
    }
  }
  log(`Fim. dias=${total.dias} pedidos=${total.pedidos} itens=${total.itens} erros=${total.erros}`);
  return { ok, ...total };
}

// ---------- CLI ----------
const USO = 'Uso: node coletores/coletar-pedidos.mjs --config <caminho> [--dias 15] [--meses 13] [--limite-minutos 300]';

export function lerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const nome = argv[i]?.replace(/^--/, '');
    if (!['config', 'dias', 'meses', 'limite-minutos'].includes(nome) || argv[i + 1] === undefined) {
      throw new Error(USO);
    }
    args[nome] = argv[i + 1];
  }
  if (!args.config) throw new Error('Falta --config <caminho>');
  for (const k of ['dias', 'meses', 'limite-minutos']) {
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
      await aplicarComRetentativa(caminho, banco);
    } finally {
      try { unlinkSync(caminho); } catch { /* arquivo já removido */ }
    }
  };
}

async function principal() {
  const inicio = Date.now();
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
    };
    const minutos = Number(args['limite-minutos'] ?? LIMITE_MINUTOS);
    const r = await rodar({
      dias: Number(args.dias ?? 15),
      meses: Number(args.meses ?? 0),
      hoje: hojeLocal(cfg.fusoHoras),
      prazo: inicio + minutos * 60_000,
      segredos,
    }, deps);
    if (!r.ok) process.exitCode = 1;
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
