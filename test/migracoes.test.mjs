import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarD1Falso } from './d1-falso.mjs';

const TABELAS = ['pedidos', 'itens', 'estoque_dia', 'estoque_lista', 'saude_dia', 'automacoes',
  'pedidos_alerta', 'avaliacoes', 'avaliacao_envio', 'outlet', 'coletas', 'perfis', 'usuarios', 'auditoria'];

test('cria todas as tabelas', async () => {
  const db = await criarD1Falso();
  const { results } = await db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  const nomes = results.map((r) => r.name);
  for (const t of TABELAS) assert.ok(nomes.includes(t), `falta a tabela ${t}`);
});

test('perfis padrão', async () => {
  const db = await criarD1Falso();
  const { results } = await db.prepare('SELECT id, abas, ver_valores FROM perfis ORDER BY id').all();
  const obtido = Object.fromEntries(results.map((r) => [r.id, [JSON.parse(r.abas), r.ver_valores]]));
  assert.deepEqual(obtido, {
    gestao: [['visao', 'vendas', 'clientes', 'estoque', 'pedidos', 'avaliacoes', 'precos', 'saude'], 1],
    marketing: [['visao', 'vendas', 'clientes', 'estoque', 'avaliacoes', 'precos', 'saude'], 1],
    compras: [['visao', 'estoque', 'avaliacoes', 'precos', 'saude'], 0],
    atendimento: [['visao', 'estoque', 'pedidos', 'avaliacoes', 'saude'], 0],
  });
});

test('upsert de pedido não duplica', async () => {
  const db = await criarD1Falso();
  const sql = `INSERT INTO pedidos (id,dia,criado,status,cancelado,valor,frete,desconto,canal,origem,pagamento,entrega,atualizado)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, valor=excluded.valor`;
  const base = ['p1', '2026-11-12', '2026-11-12T15:00:00Z'];
  const resto = [0, 100, 10, 0, 'site', 'Sem UTM', 'pix', 'entrega', '2026-11-13T00:00:00Z'];
  await db.prepare(sql).bind(...base, 'invoiced', ...resto).run();
  await db.prepare(sql).bind(...base, 'canceled', ...resto).run();
  const { results } = await db.prepare('SELECT status FROM pedidos').all();
  assert.equal(results.length, 1);
  assert.equal(results[0].status, 'canceled');
});

test('0003: coletas ganha ultimo_ok sem perder as linhas que já existem', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const ler = (f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8');
  const db = new DatabaseSync(':memory:');
  db.exec(ler('0001_inicial.sql'));
  db.exec(ler('0002_perfis_padrao.sql'));
  const ic = db.prepare('INSERT INTO coletas (fonte, quando, ok, registros, erro) VALUES (?, ?, ?, ?, ?)');
  ic.run('pedidos', '2026-11-15T15:40:00.000Z', 1, 120, null);
  ic.run('carga:2026-10', '2026-11-14T10:00:00.000Z', 1, 900, null);
  ic.run('carga:2026-09', '2026-11-14T11:00:00.000Z', 0, 0, '3 pedidos não abertos');
  db.exec(ler('0003_coletas_ultimo_ok.sql'));
  const linhas = db.prepare('SELECT fonte, quando, ok, ultimo_ok FROM coletas ORDER BY fonte').all();
  assert.deepEqual(linhas.map((l) => [l.fonte, l.ok, l.ultimo_ok]), [
    ['carga:2026-09', 0, null],
    ['carga:2026-10', 1, '2026-11-14T10:00:00.000Z'],
    ['pedidos', 1, '2026-11-15T15:40:00.000Z'],
  ]);
});
