import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { criarVtex } from '../coletores/vtex.mjs';
import {
  diasDaJanela, mesesPendentes, diasDoMes, hojeLocal, coletarDias, limparErro,
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
