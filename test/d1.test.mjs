import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sqlValor, upsertSql, criarD1Rest, aplicarArquivo } from '../coletores/d1.mjs';
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

test('aplicarArquivo: saída ≠ 0 rejeita com stderr', async () => {
  let args;
  const falso = (cmd, a) => { args = a; return filhoFalso(1, 'boom'); };
  await assert.rejects(aplicarArquivo('x.sql', 'painel', { spawn: falso }), /boom/);
  assert.ok(args.includes('--file=x.sql'));
  await aplicarArquivo('x.sql', 'painel', { spawn: () => filhoFalso(0) });
});
