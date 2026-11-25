// Fixture fictícia de pedidos compartilhada pelos testes de leitura e do MCP.
import { criarD1Falso } from './d1-falso.mjs';
import { sqlAtualizarOpcoes } from '../functions/_lib/opcoes-sql.js';

// ---------- fixture fictícia (centavos distintos, impossíveis de confundir com contagens) ----------

export const it = (sku, nome, marca, categoria, qtd, valor) => ({ sku, nome, marca, categoria, qtd, valor });
export const A1 = (q, v) => it('A1', 'Curativo adesivo', 'A', 'Curativos', q, v);
export const A2 = (q, v) => it('A2', 'Luva de procedimento', 'A', 'Luvas', q, v);
export const B1 = (q, v) => it('B1', 'Seringa 10 ml', 'B', 'Seringas', q, v);
export const B2 = (q, v) => it('B2', 'Seringa 5 ml', 'B', 'Seringas', q, v);

// [id, dia, origem, pagamento, uf, cidade, entrega, cliente_tipo, frete, itens, extra]
export const PEDIDOS = [
  ['p01', '2026-03-01', 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1501, [A1(2, 123457)], { campanha: 'marca' }],
  ['p02', '2026-03-01', 'Sem UTM', 'cartao', 'RJ', 'Niterói', 'entrega', 'recorrente', 2203, [B1(1, 98765)]],
  ['p03', '2026-03-01', 'Marketplace', 'boleto', 'SP', 'São Paulo', 'entrega', null, 3307, [A2(3, 45671), B1(1, 98713)]],
  ['p04', '2026-03-02', 'Google Ads', 'pix', 'MG', 'Belo Horizonte', 'entrega', 'novo', 1109, [A1(1, 61237)], { campanha: ' marca ' }],
  ['p05', '2026-03-02', 'Google Ads', 'cartao', 'SP', 'Campinas', 'entrega', 'recorrente', 1999, [B2(4, 77731)], { campanha: 'marca' }],
  ['p06', '2026-03-02', 'Sem UTM', 'pix', 'SP', 'Santos', 'entrega', 'novo', 2711, [A2(2, 33397)]],
  ['p07', '2026-03-03', 'Marketplace', 'cartao', 'RJ', 'Rio de Janeiro', 'entrega', null, 1871, [B2(1, 54329)]],
  ['p08', '2026-03-03', 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1433, [it('A3', 'Gaze 50% algodão', 'A', 'Curativos', 1, 27191)], { campanha: 'shopping-a' }],
  ['p09', '2026-03-03', 'Sem UTM', 'boleto', 'SP', 'Santos', 'entrega', 'recorrente', 2557, [it('A4', 'Gaze 500 unidades', 'A', 'Curativos', 1, 39163)]],
  ['p10', '2026-03-05', 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1667, [B1(2, 187319)]],
  ['p11', '2026-03-05', 'Sem UTM', 'pix', 'RJ', 'Niterói', 'entrega', 'indefinido', 1201, [A1(1, 58943)]],
  ['p12', '2026-03-05', 'Marketplace', 'pix', 'SP', 'São Paulo', 'entrega', null, 2099, [A2(1, 71129)]],
  ['p13', '2026-03-05', 'Google Ads', 'cartao', 'SP', 'Campinas', 'entrega', 'recorrente', 10231, [A1(5, 903347)], { cancelado: 1, campanha: 'marca' }],
  ['p14', '2026-03-06', 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1381, [A1(1, 66851)]],
  ['p15', '2026-03-06', 'Sem UTM', 'pix', 'RJ', 'Rio de Janeiro', 'retirada', 'recorrente', 0, [B2(2, 84463)]],
  ['p16', '2026-03-06', 'Marketplace', 'cartao', 'MG', 'Belo Horizonte', 'entrega', null, 2441, [B1(1, 92347)]],
  ['p17', '2026-03-07', 'Google Ads', 'pix', 'SP', 'Santos', 'entrega', 'novo', 1777, [A2(2, 49157), B2(1, 36541)]],
  ['p18', '2026-03-07', 'Sem UTM', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1553, [A1(1, 52783)]],
  ['p19', '2026-03-07', 'Google Ads', 'boleto', 'RJ', 'Rio de Janeiro', 'entrega', 'recorrente', 2963, [B1(3, 112589)]],
  ['p20', '2026-03-07', 'Marketplace', 'pix', 'SP', 'São Paulo', 'entrega', null, 1123, [A1(1, 43577)]],
  // período de comparação "anterior" (22–28/02)
  ['c01', '2026-02-22', 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1299, [A1(1, 57193)], { campanha: 'marca' }],
  ['c02', '2026-02-24', 'Sem UTM', 'pix', 'SP', 'Campinas', 'entrega', 'recorrente', 1847, [B1(1, 81239)]],
  ['c03', '2026-02-28', 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1361, [A2(1, 63541)]],
];

// abril: 12 origens para testar top 10 + outros
export const ABRIL = Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return [`q${n}`, '2026-04-01', `Origem ${n}`, 'pix', 'SP', 'Campinas', 'entrega', 'novo', 1000 + i, [A1(1, 100003 + i * 11113)]];
});

export const linha = (p) => {
  const [id, dia, origem, pagamento, uf, cidade, entrega, tipo, frete, itens, extra = {}] = p;
  const valor = frete + itens.reduce((s, i) => s + i.valor, 0);
  const canal = origem === 'Marketplace' ? 'Canal 2' : 'Site';
  return { id, dia, origem, pagamento, uf, cidade, entrega, tipo, frete, itens, valor, canal, cancelado: extra.cancelado ?? 0, campanha: extra.campanha ?? null };
};
export const TODOS = [...PEDIDOS, ...ABRIL].map(linha);
export const CENTAVOS = new Set(TODOS.flatMap((p) => [p.valor, p.frete, ...p.itens.map((i) => i.valor)]).filter((v) => v >= 1000));

export async function inserirPedidos(db, lista) {
  const ip = `INSERT INTO pedidos (id, dia, criado, status, cancelado, valor, frete, desconto, canal, origem, pagamento,
    uf, cidade, entrega, cliente_tipo, atualizado, utm_campaign) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`;
  const ii = 'INSERT INTO itens (pedido_id, sku, nome, marca, categoria, qtd, valor) VALUES (?,?,?,?,?,?,?)';
  for (const p of lista) {
    await db.prepare(ip).bind(p.id, p.dia, `${p.dia}T15:00:00.000Z`, p.cancelado ? 'canceled' : 'invoiced', p.cancelado,
      p.valor, p.frete, 0, p.canal, p.origem, p.pagamento, p.uf, p.cidade, p.entrega, p.tipo, '2026-03-08T00:00:00Z', p.campanha).run();
    for (const i of p.itens) await db.prepare(ii).bind(p.id, i.sku, i.nome, i.marca, i.categoria, i.qtd, i.valor).run();
  }
  // como o coletor: atualiza as opções da barra só nos dias gravados
  const dias = lista.map((p) => p.dia).sort();
  if (dias.length) db.exec(sqlAtualizarOpcoes(dias[0], dias.at(-1)));
}

export async function banco() {
  const db = await criarD1Falso();
  await inserirPedidos(db, TODOS);
  const iu = 'INSERT INTO usuarios (email, nome, perfil, ajustes, admin, ativo) VALUES (?,?,?,?,?,1)';
  await db.prepare(iu).bind('gestao@exemplo.com', 'Gê', 'gestao', null, 0).run();
  await db.prepare(iu).bind('compras@exemplo.com', 'Cris', 'compras', null, 0).run();
  await db.prepare(iu).bind('mkt@exemplo.com', 'Mari', 'marketing', JSON.stringify({ ver_valores: false }), 0).run();
  await db.prepare(iu).bind('nada@exemplo.com', 'Nadia', 'compras', JSON.stringify({ abas: { visao: false } }), 0).run();
  const ic = 'INSERT INTO coletas (fonte, quando, ok, registros, erro) VALUES (?,?,?,?,?)';
  await db.prepare(ic).bind('pedidos', '2026-03-08T03:00:00.000Z', 1, 23, null).run();
  await db.prepare(ic).bind('carga:2026-01', '2026-03-01T03:00:00.000Z', 1, 10, null).run();
  return db;
}
