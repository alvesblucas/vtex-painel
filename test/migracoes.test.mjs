import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarD1Falso } from './d1-falso.mjs';

const TABELAS = ['mcp_uso', 'pedidos', 'itens', 'estoque_dia', 'estoque_lista', 'saude_dia', 'automacoes',
  'pedidos_alerta', 'avaliacoes', 'avaliacao_envio', 'outlet', 'coletas', 'perfis', 'usuarios', 'auditoria', 'opcoes'];

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

test('0004: carga inicial das opções = sqlAtualizarOpcoes do histórico inteiro', async () => {
  const { DatabaseSync } = await import('node:sqlite');
  const { readFileSync } = await import('node:fs');
  const { sqlAtualizarOpcoes } = await import('../functions/_lib/opcoes-sql.js');
  const ler = (f) => readFileSync(new URL(`../migrations/${f}`, import.meta.url), 'utf8');
  const db = new DatabaseSync(':memory:');
  for (const f of ['0001_inicial.sql', '0002_perfis_padrao.sql', '0003_coletas_ultimo_ok.sql']) db.exec(ler(f));
  const ip = db.prepare(`INSERT INTO pedidos (id, dia, criado, status, cancelado, valor, frete, desconto, canal, origem,
    pagamento, uf, cidade, entrega, atualizado) VALUES (?, ?, 'x', 'invoiced', ?, 1, 0, 0, ?, ?, ?, ?, ?, ?, 'x')`);
  ip.run('a', '2025-01-10', 0, 'Site', 'Google', 'pix', 'SP', 'Santos', 'entrega');
  ip.run('b', '2025-06-01', 1, 'Site', 'Google', 'cartao', 'RJ', '', 'retirada');
  ip.run('c', '2026-02-03', 0, 'Canal 2', 'Marketplace', 'pix', '', 'Sem UF', 'entrega');
  const ii = db.prepare('INSERT INTO itens (pedido_id, sku, marca, categoria, qtd, valor) VALUES (?, ?, ?, ?, 1, 1)');
  ii.run('a', 's1', 'M1', 'C1');
  ii.run('c', 's2', 'M2', null);
  ii.run('b', 's3', '', 'C2');
  db.exec(ler('0004_opcoes.sql'));
  const tabela = () => db.prepare('SELECT lista, uf, valor, ultimo_dia FROM opcoes ORDER BY 1, 2, 3').all().map((r) => ({ ...r }));
  const migrado = tabela();
  db.exec('DELETE FROM opcoes');
  db.exec(sqlAtualizarOpcoes('0000-01-01', '9999-12-31'));
  assert.deepEqual(tabela(), migrado);
  assert.deepEqual(migrado.filter((r) => r.lista === 'cidade').map((r) => [r.uf, r.valor]), [['SP', 'Santos']]);
  assert.deepEqual(migrado.filter((r) => r.lista === 'origem').map((r) => [r.valor, r.ultimo_dia]),
    [['Canal 2', '2026-02-03'], ['Google', '2025-06-01']]);
  assert.deepEqual(migrado.filter((r) => r.lista === 'marca').map((r) => r.valor), ['M1', 'M2']);
});
