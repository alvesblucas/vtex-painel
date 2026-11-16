import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlValor, upsertSql, criarD1Rest, aplicarArquivo, aplicarComRetentativa, WRANGLER_JS } from '../coletores/d1.mjs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { criarD1Falso } from './d1-falso.mjs';

test('sqlValor escapa e converte tipos', () => {
  assert.equal(sqlValor("O'Neil"), "'O''Neil'");
  assert.equal(sqlValor(null), 'NULL');
  assert.equal(sqlValor(true), '1');
  assert.equal(sqlValor(false), '0');
  assert.equal(sqlValor(12.5), '12.5');
  assert.equal(sqlValor('a\0b'), "'ab'");
  assert.throws(() => sqlValor(NaN));
  assert.throws(() => sqlValor(Infinity));
});

test('sqlValor neutraliza injeção', async () => {
  const d1 = await criarD1Falso();
  const mal = "x'); DROP TABLE pedidos;--";
  const r = await d1.prepare(`SELECT ${sqlValor(mal)} AS v`).first();
  assert.equal(r.v, mal);
  await d1.prepare('SELECT 1 FROM pedidos').all();
});

test('upsertSql: 450 linhas = 3 instruções, idempotente', async () => {
  const d1 = await criarD1Falso();
  d1.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, nome TEXT, n INTEGER)');
  const linhas = Array.from({ length: 450 }, (_, i) => ({ id: i, nome: `n${i}`, n: i }));
  const sql = upsertSql('t', linhas, ['id']);
  assert.equal(sql.split(';\n').length, 3);
  d1.exec(sql);
  d1.exec(upsertSql('t', linhas.map((l) => ({ ...l, nome: 'novo' })), ['id']));
  assert.equal((await d1.prepare('SELECT COUNT(*) c FROM t').first()).c, 450);
  assert.equal((await d1.prepare("SELECT COUNT(*) c FROM t WHERE nome='novo'").first()).c, 450);
});

test('upsertSql: validações e casos de borda', async () => {
  assert.equal(upsertSql('t', [], ['id']), '');
  assert.throws(() => upsertSql('t', [{ 'a-b': 1 }], ['a-b']));
  assert.throws(() => upsertSql('t-x', [{ a: 1 }], ['a']));
  assert.throws(() => upsertSql('t', [{ a: 1, b: 2 }, { a: 1 }], ['a']));
  assert.match(upsertSql('t', [{ a: 1 }], ['a']), /DO NOTHING/);
  const d1 = await criarD1Falso();
  d1.exec('CREATE TABLE k (a INTEGER, b INTEGER, PRIMARY KEY (a, b))');
  d1.exec(upsertSql('k', [{ a: 1, b: 2 }], ['a', 'b']));
  d1.exec(upsertSql('k', [{ a: 1, b: 2 }], ['a', 'b']));
  assert.equal((await d1.prepare('SELECT COUNT(*) c FROM k').first()).c, 1);
});

const resp = (status, corpo) => ({ status, ok: status < 400, json: async () => corpo });
const opcoes = { accountId: 'a1', databaseId: 'd1', token: 'SEGREDO123' };

test('criarD1Rest: retry em 429 e retorna results', async () => {
  const respostas = [resp(429, {}), resp(200, { success: true, errors: [], result: [{ results: [{ x: 1 }] }] })];
  const chamadas = [];
  const esperas = [];
  const d1 = criarD1Rest({
    ...opcoes,
    fetch: async (url, init) => { chamadas.push({ url, init }); return respostas.shift(); },
    esperar: async (ms) => { esperas.push(ms); },
  });
  assert.deepEqual(await d1.consulta('SELECT ?', [1]), [{ x: 1 }]);
  assert.equal(chamadas.length, 2);
  assert.equal(chamadas[0].url, 'https://api.cloudflare.com/client/v4/accounts/a1/d1/database/d1/query');
  assert.equal(chamadas[0].init.headers.Authorization, 'Bearer SEGREDO123');
  assert.deepEqual(JSON.parse(chamadas[0].init.body), { sql: 'SELECT ?', params: [1] });
  assert.deepEqual(esperas, [2000]);
});

test('criarD1Rest: 403 não vaza o token; success:false vira erro', async () => {
  const d1 = criarD1Rest({
    ...opcoes,
    fetch: async () => resp(403, { success: false, errors: [{ message: 'Forbidden' }] }),
    esperar: async () => {},
  });
  await assert.rejects(d1.consulta('SELECT 1'), (e) => {
    assert.match(e.message, /403/);
    assert.match(e.message, /Forbidden/);
    assert.ok(!e.message.includes('SEGREDO123'));
    return true;
  });
  const d2 = criarD1Rest({
    ...opcoes,
    fetch: async () => resp(200, { success: false, errors: [{ message: 'syntax' }] }),
    esperar: async () => {},
  });
  await assert.rejects(d2.consulta('x'), /syntax/);
});

test('criarD1Rest: desiste após 5 tentativas em 500', async () => {
  let n = 0;
  const d1 = criarD1Rest({ ...opcoes, fetch: async () => { n++; return resp(500, {}); }, esperar: async () => {} });
  await assert.rejects(d1.consulta('x'), /500/);
  assert.equal(n, 5);
});

function filhoFalso(codigo, stderr) {
  const ev = {};
  setImmediate(() => {
    if (stderr) ev.err(Buffer.from(stderr));
    ev.close(codigo);
  });
  return {
    stderr: { on: (e, f) => { ev.err = f; } },
    stdout: { on: () => {} },
    on: (e, f) => { ev[e] = f; },
  };
}

test('aplicarArquivo: usa o wrangler do produto via node, sem npx nem shell', async () => {
  let chamada;
  const falso = (cmd, a, o) => { chamada = { cmd, a, o }; return filhoFalso(1, 'boom'); };
  await assert.rejects(aplicarArquivo('x.sql', 'painel', { spawn: falso }), /boom/);
  assert.equal(chamada.cmd, process.execPath);
  assert.equal(chamada.a[0], WRANGLER_JS);
  assert.deepEqual(chamada.a.slice(1), ['d1', 'execute', 'painel', '--remote', '--file=x.sql', '--yes']);
  assert.ok(!chamada.o.shell);
  await aplicarArquivo('x.sql', 'painel', { spawn: () => filhoFalso(0) });
});

test('WRANGLER_JS: aponta para o node_modules do produto (não depende do diretório atual)', () => {
  const raiz = fileURLToPath(new URL('..', import.meta.url));
  assert.ok(WRANGLER_JS.startsWith(raiz), WRANGLER_JS);
  assert.match(WRANGLER_JS.replaceAll('\\', '/'), /node_modules\/wrangler\/bin\/wrangler\.js$/);
  assert.ok(existsSync(WRANGLER_JS), 'rode npm ci');
});

test('aplicarArquivo: valida banco, caminho e wrangler instalado; caminho com espaço sem aspas', async () => {
  const sp = () => filhoFalso(0);
  await assert.rejects(aplicarArquivo('x.sql', 'a;b', { spawn: sp }), /banco/);
  await assert.rejects(aplicarArquivo('x&y.sql', 'painel', { spawn: sp }), /Caminho/);
  await assert.rejects(aplicarArquivo('x.sql', 'painel', { spawn: sp, wrangler: '/nao/existe/wrangler.js' }), /npm ci/);
  let args;
  await aplicarArquivo('C:/minha pasta/x.sql', 'painel', { spawn: (c, a) => { args = a; return filhoFalso(0); } });
  assert.ok(args.includes('--file=C:/minha pasta/x.sql'));
});

test('aplicarComRetentativa: 3 novas tentativas com 5 s, 15 s e 45 s', async () => {
  const esperas = [];
  let n = 0;
  const aplicar = async () => { n++; if (n < 4) throw new Error(`falha ${n}`); };
  await aplicarComRetentativa('x.sql', 'painel', { aplicar, esperar: async (ms) => { esperas.push(ms); }, log: () => {} });
  assert.equal(n, 4);
  assert.deepEqual(esperas, [5000, 15000, 45000]);

  n = 0;
  const sempre = async () => { n++; throw new Error('ETARGET'); };
  await assert.rejects(aplicarComRetentativa('x.sql', 'painel', { aplicar: sempre, esperar: async () => {}, log: () => {} }), /ETARGET/);
  assert.equal(n, 4);
});

test('aplicarComRetentativa: erro de validação não repete', async () => {
  let n = 0;
  const esperas = [];
  await assert.rejects(
    aplicarComRetentativa('x.sql', 'a;b', {
      aplicar: (c, b) => { n++; return aplicarArquivo(c, b, { spawn: () => filhoFalso(0) }); },
      esperar: async (ms) => { esperas.push(ms); },
      log: () => {},
    }),
    /banco/,
  );
  assert.equal(n, 1);
  assert.deepEqual(esperas, []);
});

test('criarD1Rest: erro de rede (fetch lança) também tenta de novo', async () => {
  let n = 0;
  const d1 = criarD1Rest({
    ...opcoes,
    fetch: async () => {
      n++;
      if (n < 3) throw new Error('getaddrinfo ENOTFOUND');
      return resp(200, { success: true, result: [{ results: [{ ok: 1 }] }] });
    },
    esperar: async () => {},
  });
  assert.deepEqual(await d1.consulta('SELECT 1'), [{ ok: 1 }]);
  assert.equal(n, 3);
  let m = 0;
  const sempre = criarD1Rest({ ...opcoes, fetch: async () => { m++; throw new Error('ECONNRESET'); }, esperar: async () => {} });
  await assert.rejects(sempre.consulta('x'), (e) => {
    assert.match(e.message, /ECONNRESET/);
    assert.ok(!e.message.includes('SEGREDO123'));
    return true;
  });
  assert.equal(m, 5);
});

test('upsertSql: limita o tamanho de cada instrucao', () => {
  const linhas = Array.from({ length: 50 }, (_, i) => ({ id: i, txt: 'x'.repeat(5000) }));
  const partes = upsertSql('t', linhas, ['id']).split(';\n');
  assert.ok(partes.length > 1);
  for (const p of partes) assert.ok(p.length < 100_000);
});

test('criarD1Rest: 2xx sem JSON/result lanca', async () => {
  const mk = (corpo) => criarD1Rest({ ...opcoes, fetch: async () => ({ status: 200, ok: true, json: corpo }), esperar: async () => {} });
  await assert.rejects(mk(async () => { throw new Error('x'); }).consulta('x'), /sem result/);
  await assert.rejects(mk(async () => ({ success: true })).consulta('x'), /sem result/);
});
