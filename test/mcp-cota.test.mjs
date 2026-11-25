import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contarLeituras, diaUtc, usoDoDia, exigirCota, registrarUso, ErroCota } from '../functions/_lib/mcp/cota.js';
import { criarD1Falso } from './d1-falso.mjs';

const AGORA = Date.parse('2026-11-25T02:00:00Z'); // 23h de 24/11 em Brasília, mas 25/11 em UTC

test('diaUtc usa o dia UTC (reset da cota do D1), não o de Brasília', () => {
  assert.equal(diaUtc(AGORA), '2026-11-25');
});

test('contarLeituras soma rows_read de all() e 1 por first()', async () => {
  const db = await criarD1Falso();
  db.exec("INSERT INTO perfis (id, nome, abas, ver_valores) VALUES ('x1','X','[]',0),('x2','Y','[]',0)");
  const c = contarLeituras(db);
  const todos = (await c.db.prepare('SELECT * FROM perfis').all()).results.length;
  await c.db.prepare('SELECT * FROM perfis WHERE id = ?').bind('x1').all();
  await c.db.prepare('SELECT 1 AS um').first();
  assert.equal(c.linhas(), todos + 1 + 1);
});

test('contarLeituras usa meta.rows_read quando o D1 informa', async () => {
  const falso = { prepare: () => ({ bind() { return this; }, all: async () => ({ results: [1], meta: { rows_read: 500 } }), first: async () => null, run: async () => ({ meta: {} }) }) };
  const c = contarLeituras(falso);
  await c.db.prepare('x').bind(1).all();
  assert.equal(c.linhas(), 500);
});

test('registrarUso acumula por dia e e-mail; usoDoDia soma e-mails do dia', async () => {
  const db = await criarD1Falso();
  await registrarUso(db, 'a@x.com', 100, AGORA);
  await registrarUso(db, 'a@x.com', 50, AGORA);
  await registrarUso(db, 'b@x.com', 7, AGORA);
  await registrarUso(db, 'a@x.com', 1000, AGORA - 86400000);
  const linha = await db.prepare('SELECT chamadas, linhas FROM mcp_uso WHERE dia = ? AND email = ?').bind('2026-11-25', 'a@x.com').first();
  assert.deepEqual({ ...linha }, { chamadas: 2, linhas: 150 });
  assert.equal(await usoDoDia(db, '2026-11-25'), 157);
  assert.equal(await usoDoDia(db, '2026-01-01'), 0);
});

test('exigirCota: teto padrão 2.500.000 e configurável', async () => {
  const db = await criarD1Falso();
  await registrarUso(db, 'a@x.com', 2499999, AGORA);
  assert.deepEqual(await exigirCota(db, {}, AGORA), { usadas: 2499999, teto: 2500000 });
  await registrarUso(db, 'a@x.com', 1, AGORA);
  await assert.rejects(exigirCota(db, {}, AGORA), (e) => e instanceof ErroCota && /Limite diário/.test(e.message) && /21h/.test(e.message));
  const vazio = await criarD1Falso();
  await registrarUso(vazio, 'a@x.com', 10, AGORA);
  await assert.rejects(exigirCota(vazio, { MCP_LINHAS_DIA: '10' }, AGORA), ErroCota);
  assert.equal((await exigirCota(vazio, { MCP_LINHAS_DIA: '11' }, AGORA)).teto, 11);
});
