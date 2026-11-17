import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { criarVtex } from '../coletores/vtex.mjs';
import {
  diasDaJanela, mesesPendentes, diasDoMes, hojeLocal, coletarDias, limparErro, registrarColeta,
  planoDaCarga, executarCarga, rodar, lerArgs,
} from '../coletores/coletar-pedidos.mjs';
import { criarD1Falso } from './d1-falso.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/pedido.json', import.meta.url), 'utf8'));
const cfg = {
  fusoHoras: -3,
  faturamento: { comFrete: true, statusExcluidos: ['canceled'] },
  canalSite: '1',
  afiliados: {},
  origens: [['Google Ads', 'google|cpc', 'i']],
};
const AGORA = '2026-11-13T10:00:00.000Z';
const SEGREDOS = [
  'fulano@exemplo.com', '12345678909', 'outra@exemplo.com', '98765432100', '+5521987654321',
  'Zeferino', 'Quintanilha', 'Jacarandazal', '29999-888', 'Bloco Zeta',
];

function pedido(id, criado, extra = {}) {
  const p = structuredClone(fixture);
  p.orderId = id;
  p.creationDate = criado;
  Object.assign(p, extra);
  return p;
}

// OMS falsa: listagem por f_creationDate, busca `q` e abertura de pedido.
function vtexFalso(pedidos, { anteriores = [] } = {}) {
  const chamadas = [];
  return {
    chamadas,
    buscas: () => chamadas.filter((c) => c.includes('q=')).length,
    async get(caminho) {
      chamadas.push(caminho);
      const u = new URL(caminho, 'http://falso');
      if (u.pathname === '/api/oms/pvt/orders') {
        const [, de, ate] = /\[(.+) TO (.+)\]/.exec(u.searchParams.get('f_creationDate'));
        const base = u.searchParams.has('q') ? anteriores : pedidos;
        const list = base
          .filter((p) => Date.parse(p.creationDate) >= Date.parse(de) && Date.parse(p.creationDate) <= Date.parse(ate))
          .map((p) => ({ orderId: p.orderId, creationDate: p.creationDate, status: p.status }));
        return { list, paging: { pages: 1 } };
      }
      const id = u.pathname.split('/').pop();
      const achado = [...pedidos, ...anteriores].find((p) => p.orderId === id);
      if (!achado) throw new Error(`GET ${u.pathname} -> 404`);
      return structuredClone(achado);
    },
  };
}

async function montar(vtex) {
  const db = await criarD1Falso();
  const sqls = [];
  const deps = {
    vtex,
    cfg,
    d1: { consulta: (s, p = []) => db.prepare(s).bind(...p).all().then((r) => r.results) },
    aplicar: async (sql) => { sqls.push(sql); db.exec(sql); },
    agora: () => AGORA,
    esperar: async () => {},
    log: () => {},
  };
  return { db, deps, sqls };
}

const contar = async (db, tabela) => (await db.prepare(`SELECT COUNT(*) AS n FROM ${tabela}`).first()).n;

test('diasDaJanela', () => {
  assert.deepEqual(diasDaJanela('2026-11-13', 3), ['2026-11-11', '2026-11-12', '2026-11-13']);
  assert.deepEqual(diasDaJanela('2026-03-01', 2), ['2026-02-28', '2026-03-01']);
});

test('mesesPendentes', () => {
  assert.deepEqual(mesesPendentes(3, '2026-11-13', new Set(['2026-09'])), ['2026-08', '2026-10']);
  assert.deepEqual(mesesPendentes(2, '2026-01-05', new Set()), ['2025-11', '2025-12']);
});

test('diasDoMes e hojeLocal', () => {
  assert.equal(diasDoMes('2028-02').length, 29);
  assert.equal(diasDoMes('2026-11')[0], '2026-11-01');
  assert.equal(diasDoMes('2026-11').at(-1), '2026-11-30');
  assert.equal(hojeLocal(-3, Date.parse('2026-11-14T02:30:00Z')), '2026-11-13');
});

test('limparErro tira segredos e corta em 300', () => {
  const m = limparErro(new Error(`falhou tok123 ${'x'.repeat(400)}`), ['tok123', '']);
  assert.ok(!m.includes('tok123'));
  assert.ok(m.length <= 300);
});

test('coletarDias: 2 pedidos (1 cancelado), idempotente, sem dado pessoal', async () => {
  const a = pedido('1000000000001-01', '2026-11-12T13:00:00.000Z');
  const b = pedido('1000000000002-01', '2026-11-12T15:00:00.000Z', { status: 'canceled' });
  b.clientProfileData = { ...b.clientProfileData, email: 'outra@exemplo.com', document: '98765432100' };
  const fora = pedido('1000000000003-01', '2026-11-13T04:00:00.000Z'); // dia 13 local
  const vtex = vtexFalso([a, b, fora]);
  const { db, deps, sqls } = await montar(vtex);

  const r1 = await coletarDias(['2026-11-12'], deps);
  assert.equal(r1.pedidos, 2);
  assert.equal(r1.itens, 4);
  assert.equal(await contar(db, 'pedidos'), 2);
  assert.equal(await contar(db, 'itens'), 4);
  const linhas = (await db.prepare('SELECT id, cancelado, cliente_tipo FROM pedidos ORDER BY id').all()).results;
  assert.deepEqual(linhas.map((l) => [l.cancelado, l.cliente_tipo]), [[0, 'novo'], [1, 'novo']]);

  const c = await db.prepare("SELECT * FROM coletas WHERE fonte = 'pedidos'").first();
  assert.equal(c.ok, 1);
  assert.equal(c.registros, 2);
  assert.equal(c.quando, AGORA);
  assert.equal(c.erro, null);

  await coletarDias(['2026-11-12'], deps);
  assert.equal(await contar(db, 'pedidos'), 2);
  assert.equal(await contar(db, 'itens'), 4);

  const tudo = sqls.join('\n');
  for (const s of SEGREDOS) assert.ok(!tudo.includes(s), `vazou: ${s}`);
});

test('coletarDias: pedido que já tem cliente_tipo não busca compra anterior', async () => {
  const a = pedido('1000000000001-01', '2026-11-12T13:00:00.000Z');
  const vtex = vtexFalso([a]);
  const { db, deps } = await montar(vtex);
  await coletarDias(['2026-11-12'], deps);
  assert.equal(vtex.buscas(), 1);
  await db.prepare("UPDATE pedidos SET cliente_tipo = 'recorrente'").run();

  const vtex2 = vtexFalso([a]);
  await coletarDias(['2026-11-12'], { ...deps, vtex: vtex2 });
  assert.equal(vtex2.buscas(), 0);
  assert.equal((await db.prepare('SELECT cliente_tipo FROM pedidos').first()).cliente_tipo, 'recorrente');
});

test('coletarDias: segundo pedido do mesmo cliente vira recorrente sem chamar a OMS', async () => {
  const a = pedido('1000000000001-01', '2026-11-11T13:00:00.000Z');
  const b = pedido('1000000000002-01', '2026-11-12T13:00:00.000Z');
  const vtex = vtexFalso([b, a]);
  const { db, deps } = await montar(vtex);
  const r = await coletarDias(['2026-11-11', '2026-11-12'], deps);
  assert.equal(r.pedidos, 2);
  assert.equal(vtex.buscas(), 1);
  const tipos = (await db.prepare('SELECT id, cliente_tipo FROM pedidos ORDER BY id').all()).results;
  assert.deepEqual(tipos.map((t) => t.cliente_tipo), ['novo', 'recorrente']);
});

test('coletarDias: compra anterior confirmada vira recorrente; marketplace e sem chave', async () => {
  const anterior = pedido('0900000000001-01', '2025-05-01T13:00:00.000Z');
  const a = pedido('1000000000001-01', '2026-11-12T13:00:00.000Z');
  const mkt = pedido('1000000000002-01', '2026-11-12T14:00:00.000Z', { affiliateId: 'AMZ' });
  const anon = pedido('1000000000003-01', '2026-11-12T15:00:00.000Z');
  anon.clientProfileData = { email: 'semarroba', document: '' };
  const vtex = vtexFalso([a, mkt, anon], { anteriores: [anterior] });
  const { db, deps } = await montar(vtex);
  await coletarDias(['2026-11-12'], deps);
  const tipos = Object.fromEntries(
    (await db.prepare('SELECT id, cliente_tipo FROM pedidos').all()).results.map((t) => [t.id, t.cliente_tipo]),
  );
  assert.equal(tipos[a.orderId], 'recorrente');
  assert.equal(tipos[mkt.orderId], null);
  assert.equal(tipos[anon.orderId], 'indefinido');
  assert.equal(vtex.buscas(), 1);
});

test('coletarDias: fonte de carga e erro ao abrir pedido', async () => {
  const a = pedido('1000000000001-01', '2026-11-12T13:00:00.000Z');
  const vtex = vtexFalso([a]);
  const original = vtex.get;
  vtex.get = (c) => (c.endsWith('/1000000000001-01') ? Promise.reject(new Error('falhou')) : original(c));
  const { db, deps } = await montar(vtex);
  const r = await coletarDias(['2026-11-12'], deps, { fonte: 'carga:2026-11' });
  assert.equal(r.pedidos, 0);
  assert.equal(r.erros, 1);
  const falha = await db.prepare("SELECT ok, erro FROM coletas WHERE fonte = 'carga:2026-11'").first();
  assert.equal(falha.ok, 0);
  assert.equal(falha.erro, '1 pedidos não abertos');

  const contador = { erros: 29 };
  await assert.rejects(coletarDias(['2026-11-12'], { ...deps, contador }), /30 pedidos com erro/);

  vtex.get = original;
  await coletarDias(['2026-11-12'], deps, { fonte: 'carga:2026-11' });
  const certo = await db.prepare("SELECT ok, erro FROM coletas WHERE fonte = 'carga:2026-11'").first();
  assert.equal(certo.ok, 1);
  assert.equal(certo.erro, null);
});

test('coletarDias: pedido nulo conta como erro; 30 erros param os trabalhadores', async () => {
  const lista = Array.from({ length: 40 }, (_, i) =>
    pedido(`20000000000${String(i).padStart(2, '0')}-01`, `2026-11-12T13:${String(i).padStart(2, '0')}:00.000Z`));
  const vtex = vtexFalso(lista);
  const original = vtex.get;
  let aberturas = 0;
  vtex.get = (c) => {
    if (c.startsWith('/api/oms/pvt/orders/')) { aberturas++; return Promise.resolve(null); }
    return original(c);
  };
  const { deps } = await montar(vtex);
  const contador = { erros: 0 };
  await assert.rejects(coletarDias(['2026-11-12'], { ...deps, contador }), /30 pedidos com erro/);
  assert.equal(contador.erros, 30);
  assert.equal(contador.parar, true);
  assert.ok(aberturas < 40, `abriu ${aberturas}`);
});

test('coletarDias: listagem com mais de 30 páginas falha', async () => {
  const vtex = { async get() { return { list: [], paging: { pages: 31 } }; } };
  const { deps } = await montar(vtex);
  await assert.rejects(coletarDias(['2026-11-12'], deps), /mais de 3\.000 pedidos em 2026-11-12; listagem incompleta/);
});

test('coletarDias: pedido de marketplace não torna o cliente recorrente', async () => {
  const mkt = pedido('1000000000001-01', '2026-11-12T13:00:00.000Z', { affiliateId: 'AMZ' });
  const site = pedido('1000000000002-01', '2026-11-12T14:00:00.000Z');
  const vtex = vtexFalso([mkt, site]);
  const { db, deps } = await montar(vtex);
  await coletarDias(['2026-11-12'], deps);
  assert.equal(vtex.buscas(), 1);
  const linha = await db.prepare('SELECT cliente_tipo FROM pedidos WHERE id = ?').bind(site.orderId).first();
  assert.equal(linha.cliente_tipo, 'novo');
});

function resposta(status, corpo, cabecalhos = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => cabecalhos[k.toLowerCase()] ?? null },
    json: async () => corpo,
    text: async () => JSON.stringify(corpo),
  };
}

test('criarVtex: cabeçalhos, retry com Retry-After e backoff', async () => {
  const esperas = [];
  const pedidos = [];
  const fila = [resposta(429, {}, { 'retry-after': '3' }), resposta(503, {}), resposta(200, { ok: true })];
  const vtex = criarVtex({
    conta: 'minhaloja', appKey: 'chave', appToken: 'token',
    fetch: async (url, opts) => { pedidos.push([url, opts]); return fila.shift(); },
    esperar: async (ms) => { esperas.push(ms); },
  });
  assert.deepEqual(await vtex.get('/api/oms/pvt/orders?q=x'), { ok: true });
  assert.equal(pedidos[0][0], 'https://minhaloja.vtexcommercestable.com.br/api/oms/pvt/orders?q=x');
  assert.equal(pedidos[0][1].headers['X-VTEX-API-AppKey'], 'chave');
  assert.equal(pedidos[0][1].headers['X-VTEX-API-AppToken'], 'token');
  assert.deepEqual(esperas, [3000, 4000]);
});

test('criarVtex: desiste após 6 tentativas e não expõe a busca', async () => {
  let n = 0;
  const vtex = criarVtex({
    conta: 'minhaloja', appKey: 'chave', appToken: 'token',
    fetch: async () => { n++; return resposta(500, {}); },
    esperar: async () => {},
  });
  await assert.rejects(vtex.get('/api/oms/pvt/orders?q=fulano@exemplo.com'), (e) => {
    assert.ok(!e.message.includes('fulano'));
    return true;
  });
  assert.equal(n, 6);

  const v404 = criarVtex({ conta: 'minhaloja', appKey: 'c', appToken: 't', fetch: async () => { n++; return resposta(404, {}); } });
  await assert.rejects(v404.get('/x'), /404/);
});

test('criarVtex: valida chaves', () => {
  assert.throws(() => criarVtex({ conta: 'minhaloja', appKey: 'com espaço', appToken: 't' }), /VTEX_APP_KEY/);
  assert.throws(() => criarVtex({ conta: 'minhaloja', appKey: 'k', appToken: '' }), /VTEX_APP_TOKEN/);
  assert.throws(() => criarVtex({ conta: 'minha loja', appKey: 'k', appToken: 't' }), /VTEX_CONTA/);
});

test('registrarColeta: falha guarda a tentativa e mantém a última coleta boa (ultimo_ok)', async () => {
  const { db, deps } = await montar(vtexFalso([]));
  const linha = () => db.prepare("SELECT quando, ok, erro, ultimo_ok FROM coletas WHERE fonte = 'pedidos'").first();
  await registrarColeta(deps.d1, { fonte: 'pedidos', quando: '2026-11-15T15:40:00.000Z', ok: 1, registros: 10, erro: null });
  assert.equal((await linha()).ultimo_ok, '2026-11-15T15:40:00.000Z');
  await registrarColeta(deps.d1, { fonte: 'pedidos', quando: '2026-11-16T03:45:00.000Z', ok: 0, registros: 0, erro: 'ETARGET' });
  assert.deepEqual({ ...(await linha()) }, {
    quando: '2026-11-16T03:45:00.000Z', ok: 0, erro: 'ETARGET', ultimo_ok: '2026-11-15T15:40:00.000Z',
  });
  await registrarColeta(deps.d1, { fonte: 'pedidos', quando: '2026-11-16T15:40:00.000Z', ok: 1, registros: 12, erro: null });
  assert.deepEqual({ ...(await linha()) }, {
    quando: '2026-11-16T15:40:00.000Z', ok: 1, erro: null, ultimo_ok: '2026-11-16T15:40:00.000Z',
  });
  // primeira coleta da fonte já falhando: sem ultimo_ok
  await registrarColeta(deps.d1, { fonte: 'estoque', quando: '2026-11-16T03:45:00.000Z', ok: 0, registros: 0, erro: 'x' });
  assert.equal((await db.prepare("SELECT ultimo_ok FROM coletas WHERE fonte = 'estoque'").first()).ultimo_ok, null);
});

// ---------- carga x janela (I1, I3, I4) ----------

// Dias listados (sem busca q), na ordem em que a OMS foi chamada.
const diasListados = (vtex) => vtex.chamadas
  .filter((c) => c.startsWith('/api/oms/pvt/orders?') && !c.includes('q='))
  .map((c) => /creationDate:\[(\d{4}-\d{2}-\d{2})/.exec(new URL(c, 'http://x').searchParams.get('f_creationDate'))[1]);
const fontes = async (db) => (await db.prepare('SELECT fonte, ok, erro, ultimo_ok FROM coletas ORDER BY fonte').all()).results;
const porFonte = async (db) => Object.fromEntries((await fontes(db)).map((c) => [c.fonte, c]));
const feitosDe = async (db) => new Set(
  (await db.prepare("SELECT fonte FROM coletas WHERE fonte LIKE 'carga:%' AND ok = 1").all()).results.map((r) => r.fonte.slice(6)),
);

test('planoDaCarga: meses pendentes, dias já gravados e o começo do mês corrente (I4)', () => {
  const feitos = new Set(['2026-10', '2026-09-01', '2026-09-02']);
  const plano = planoDaCarga(3, '2026-11-28', '2026-11-14', feitos);
  assert.deepEqual(plano.map((p) => [p.mes, p.fecha, p.dias[0], p.dias.at(-1), p.dias.length]), [
    ['2026-08', true, '2026-08-01', '2026-08-31', 31],
    ['2026-09', true, '2026-09-03', '2026-09-30', 28],
    ['2026-11', false, '2026-11-01', '2026-11-13', 13],
  ]);
  // janela já cobre o mês corrente desde o dia 1: nada do mês corrente na carga
  assert.deepEqual(planoDaCarga(1, '2026-11-10', '2026-10-27', new Set()).map((p) => p.mes), ['2026-10']);
  // dia do mês corrente já gravado fica de fora
  assert.deepEqual(planoDaCarga(1, '2026-11-20', '2026-11-06', new Set(['2026-10', '2026-11-01'])),
    [{ mes: '2026-11', fecha: false, dias: ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05'] }]);
  // todos os dias gravados mas sem o marcador do mês: entra vazio só para fechar o mês
  const todos = new Set(diasDoMes('2026-10'));
  assert.deepEqual(planoDaCarga(1, '2026-11-10', '2026-10-27', todos), [{ mes: '2026-10', fecha: true, dias: [] }]);
});

test('lerArgs: --dias e --meses continuam valendo; --limite-minutos novo', () => {
  assert.deepEqual(lerArgs(['--config', 'c.json', '--dias', '15']), { config: 'c.json', dias: '15' });
  assert.deepEqual(lerArgs(['--config', 'c.json', '--meses', '13']), { config: 'c.json', meses: '13' });
  assert.deepEqual(lerArgs(['--config', 'c.json', '--dias', '15', '--meses', '13', '--limite-minutos', '300']),
    { config: 'c.json', dias: '15', meses: '13', 'limite-minutos': '300' });
  assert.throws(() => lerArgs(['--config', 'c.json', '--limite-minutos', '0']), /inteiro positivo/);
  assert.throws(() => lerArgs(['--config', 'c.json', '--minutos', '5']), /Uso/);
});

test('rodar: janela antes da carga; carga cobre o começo do mês corrente (hoje = 28/11)', async () => {
  const vtex = vtexFalso([]);
  const { db, deps } = await montar(vtex);
  const r = await rodar({ dias: 15, meses: 1, hoje: '2026-11-28' }, deps);
  assert.equal(r.ok, true);
  const dias = diasListados(vtex);
  assert.deepEqual(dias.slice(0, 15), diasDaJanela('2026-11-28', 15));
  assert.equal(dias.length, 15 + 31 + 13);
  assert.ok(dias.includes('2026-11-01') && dias.includes('2026-11-13'));
  const f = await porFonte(db);
  assert.equal(f['carga:2026-10'].ok, 1);
  assert.ok(!Object.keys(f).some((k) => k.startsWith('carga:2026-10-')), 'marcadores por dia do mês fechado são apagados');
  assert.ok(!f['carga:2026-11'], 'mês corrente não fecha');
  assert.equal(f['carga:2026-11-13'].ok, 1);
  assert.equal(f.pedidos.ok, 1);

  // segunda execução: mês fechado e dias do mês corrente já gravados são pulados
  const vtex2 = vtexFalso([]);
  await rodar({ dias: 15, meses: 1, hoje: '2026-11-28' }, { ...deps, vtex: vtex2 });
  assert.equal(diasListados(vtex2).length, 15);
});

test('rodar: marcador de mês já existente (produção) continua pulado', async () => {
  const vtex = vtexFalso([]);
  const { db, deps } = await montar(vtex);
  await db.prepare("INSERT INTO coletas (fonte, quando, ok, registros, erro) VALUES ('carga:2026-10', ?, 1, 900, NULL)").bind(AGORA).run();
  await rodar({ dias: 15, meses: 1, hoje: '2026-11-10' }, deps);
  assert.deepEqual(diasListados(vtex), diasDaJanela('2026-11-10', 15));
});

test('rodar: falha na carga fica em carga:AAAA-MM e não apaga a coleta da janela (I1)', async () => {
  const a = pedido('1000000000001-01', '2026-10-05T13:00:00.000Z');
  const vtex = vtexFalso([a]);
  const { db, deps } = await montar(vtex);
  const erros = [];
  const aplicar = async () => { throw new Error('wrangler saiu com código 1: ETARGET'); };
  const r = await rodar({ dias: 15, meses: 1, hoje: '2026-11-10' }, { ...deps, aplicar, logErro: (m) => erros.push(m) });
  assert.equal(r.ok, false);
  const f = await porFonte(db);
  assert.equal(f.pedidos.ok, 1);
  assert.equal(f.pedidos.ultimo_ok, AGORA);
  assert.equal(f['carga:2026-10'].ok, 0);
  assert.match(f['carga:2026-10'].erro, /ETARGET/);
  assert.equal(f['carga:2026-10-04'].ok, 1, 'dias anteriores à falha ficam gravados');
  assert.ok(!f['carga:2026-10-05']);
  assert.ok(erros.some((m) => /Carga histórica falhou/.test(m)), erros.join('\n'));
});

test('rodar: falha na janela não impede a carga e mantém o ultimo_ok de pedidos (I1)', async () => {
  const vtex = vtexFalso([]);
  const original = vtex.get;
  const janela = new Set(diasDaJanela('2026-11-10', 15));
  vtex.get = (c) => {
    const f = new URL(c, 'http://x').searchParams.get('f_creationDate') ?? '';
    const dia = /\[(\d{4}-\d{2}-\d{2})/.exec(f)?.[1];
    return janela.has(dia) ? Promise.reject(new Error('GET /api/oms/pvt/orders -> 503')) : original(c);
  };
  const { db, deps } = await montar(vtex);
  await registrarColeta(deps.d1, { fonte: 'pedidos', quando: '2026-11-09T15:40:00.000Z', ok: 1, registros: 5, erro: null });
  const r = await rodar({ dias: 15, meses: 1, hoje: '2026-11-10' }, { ...deps, logErro: () => {} });
  assert.equal(r.ok, false);
  const f = await porFonte(db);
  assert.equal(f.pedidos.ok, 0);
  assert.match(f.pedidos.erro, /503/);
  assert.equal(f.pedidos.ultimo_ok, '2026-11-09T15:40:00.000Z');
  // a carga rodou: os dias de outubro antes da janela foram gravados; os da janela (27 a 31/10) falharam
  assert.equal(f['carga:2026-10-26'].ok, 1);
  assert.equal(f['carga:2026-10'].ok, 0);
});

test('executarCarga: para no limite de tempo entre dias e retoma do próximo dia que falta (I3)', async () => {
  const { db, deps } = await montar(vtexFalso([]));
  const logs = [];
  let agora = 0;
  // cada consulta do relógio avança 1 min; prazo de 10 min → para no meio do mês
  const relogio = () => (agora += 60_000);
  const plano1 = planoDaCarga(1, '2026-11-10', '2026-10-27', await feitosDe(db));
  const r1 = await executarCarga(plano1, { ...deps, log: (m) => logs.push(m) }, { prazo: 10 * 60_000, relogio });
  assert.equal(r1.completa, false);
  assert.equal(r1.dias, 9);
  assert.ok(logs.some((m) => /limite de tempo/.test(m) && /faltam 22 dias/.test(m)), logs.join('\n'));
  let f = await porFonte(db);
  assert.ok(!f['carga:2026-10']);
  assert.equal(Object.keys(f).filter((k) => k.startsWith('carga:2026-10-')).length, 9);

  const vtex2 = vtexFalso([]);
  const plano2 = planoDaCarga(1, '2026-11-10', '2026-10-27', await feitosDe(db));
  assert.equal(plano2[0].dias[0], '2026-10-10');
  const r2 = await executarCarga(plano2, { ...deps, vtex: vtex2 });
  assert.equal(r2.completa, true);
  assert.equal(diasListados(vtex2).length, 22);
  f = await porFonte(db);
  assert.equal(f['carga:2026-10'].ok, 1);
  assert.ok(!Object.keys(f).some((k) => k.startsWith('carga:2026-10-')));
});

test('executarCarga: dia com erro fica sem marcador e o mês não fecha', async () => {
  const a = pedido('1000000000001-01', '2026-10-05T13:00:00.000Z');
  const vtex = vtexFalso([a]);
  const original = vtex.get;
  vtex.get = (c) => (c.endsWith('/1000000000001-01') ? Promise.reject(new Error('falhou')) : original(c));
  const { db, deps } = await montar(vtex);
  const r = await executarCarga(planoDaCarga(1, '2026-11-10', '2026-10-27', new Set()), deps);
  assert.equal(r.erros, 1);
  const f = await porFonte(db);
  assert.equal(f['carga:2026-10'].ok, 0);
  assert.equal(f['carga:2026-10'].erro, '1 pedidos não abertos');
  assert.ok(!f['carga:2026-10-05']);
  assert.equal(f['carga:2026-10-06'].ok, 1);
  // próxima carga refaz só o dia que faltou e fecha o mês
  const plano = planoDaCarga(1, '2026-11-10', '2026-10-27', await feitosDe(db));
  assert.deepEqual(plano[0].dias, ['2026-10-05']);
  await executarCarga(plano, { ...deps, vtex: vtexFalso([a]) });
  assert.equal((await db.prepare("SELECT ok FROM coletas WHERE fonte = 'carga:2026-10'").first()).ok, 1);
});

test('busca de compra anterior lê só a primeira página', async () => {
  const a = pedido('1000000000001-01', '2026-11-12T13:00:00.000Z');
  const vtex = vtexFalso([a]);
  const original = vtex.get;
  vtex.get = async (c) => {
    const r = await original(c);
    return c.includes('q=') ? { ...r, paging: { pages: 30 } } : r;
  };
  const { deps } = await montar(vtex);
  await coletarDias(['2026-11-12'], deps);
  assert.equal(vtex.buscas(), 1);
});

test('coletarDias: atualiza as opções da barra só com os dias coletados', async () => {
  const { db, deps } = await montar(vtexFalso([pedido('1000000000001-01', '2026-11-12T13:00:00.000Z')]));
  await coletarDias(['2026-11-12'], deps);
  const linhas = (await db.prepare('SELECT lista, valor, ultimo_dia FROM opcoes').all()).results;
  assert.ok(linhas.length > 0);
  assert.ok(linhas.every((l) => l.ultimo_dia === '2026-11-12'));
  for (const lista of ['origem', 'pagamento', 'entrega', 'marca']) assert.ok(linhas.some((l) => l.lista === lista), lista);
});
