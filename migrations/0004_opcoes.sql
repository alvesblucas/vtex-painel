-- Valores da barra de filtros guardados prontos (antes: 7 consultas DISTINCT sobre ~400 dias a cada abertura,
-- ~1 milhão de linhas lidas). O coletor mantém a tabela; esta carga inicial é gerada por
-- sqlAtualizarOpcoes('0000-01-01', '9999-12-31') (functions/_lib/opcoes-sql.js) e o teste confere que batem.
CREATE TABLE opcoes (
  lista TEXT NOT NULL,
  uf TEXT NOT NULL DEFAULT '',
  valor TEXT NOT NULL,
  ultimo_dia TEXT NOT NULL,
  PRIMARY KEY (lista, uf, valor)
);
INSERT INTO opcoes (lista, uf, valor, ultimo_dia)
  SELECT 'origem', '', (CASE WHEN p.canal = 'Site' THEN p.origem ELSE p.canal END), MAX(p.dia) FROM pedidos p WHERE p.dia BETWEEN '0000-01-01' AND '9999-12-31' AND (CASE WHEN p.canal = 'Site' THEN p.origem ELSE p.canal END) IS NOT NULL AND (CASE WHEN p.canal = 'Site' THEN p.origem ELSE p.canal END) <> '' GROUP BY 2, 3
  ON CONFLICT(lista, uf, valor) DO UPDATE SET ultimo_dia = excluded.ultimo_dia WHERE excluded.ultimo_dia > opcoes.ultimo_dia;
INSERT INTO opcoes (lista, uf, valor, ultimo_dia)
  SELECT 'pagamento', '', p.pagamento, MAX(p.dia) FROM pedidos p WHERE p.dia BETWEEN '0000-01-01' AND '9999-12-31' AND p.pagamento IS NOT NULL AND p.pagamento <> '' GROUP BY 2, 3
  ON CONFLICT(lista, uf, valor) DO UPDATE SET ultimo_dia = excluded.ultimo_dia WHERE excluded.ultimo_dia > opcoes.ultimo_dia;
INSERT INTO opcoes (lista, uf, valor, ultimo_dia)
  SELECT 'entrega', '', p.entrega, MAX(p.dia) FROM pedidos p WHERE p.dia BETWEEN '0000-01-01' AND '9999-12-31' AND p.entrega IS NOT NULL AND p.entrega <> '' GROUP BY 2, 3
  ON CONFLICT(lista, uf, valor) DO UPDATE SET ultimo_dia = excluded.ultimo_dia WHERE excluded.ultimo_dia > opcoes.ultimo_dia;
INSERT INTO opcoes (lista, uf, valor, ultimo_dia)
  SELECT 'uf', '', p.uf, MAX(p.dia) FROM pedidos p WHERE p.dia BETWEEN '0000-01-01' AND '9999-12-31' AND p.uf IS NOT NULL AND p.uf <> '' GROUP BY 2, 3
  ON CONFLICT(lista, uf, valor) DO UPDATE SET ultimo_dia = excluded.ultimo_dia WHERE excluded.ultimo_dia > opcoes.ultimo_dia;
INSERT INTO opcoes (lista, uf, valor, ultimo_dia)
  SELECT 'cidade', p.uf, p.cidade, MAX(p.dia) FROM pedidos p WHERE p.dia BETWEEN '0000-01-01' AND '9999-12-31' AND p.cidade IS NOT NULL AND p.cidade <> '' AND p.uf IS NOT NULL AND p.uf <> '' GROUP BY 2, 3
  ON CONFLICT(lista, uf, valor) DO UPDATE SET ultimo_dia = excluded.ultimo_dia WHERE excluded.ultimo_dia > opcoes.ultimo_dia;
INSERT INTO opcoes (lista, uf, valor, ultimo_dia)
  SELECT 'marca', '', i.marca, MAX(p.dia) FROM pedidos p JOIN itens i ON i.pedido_id = p.id WHERE p.dia BETWEEN '0000-01-01' AND '9999-12-31' AND i.marca IS NOT NULL AND i.marca <> '' GROUP BY 2, 3
  ON CONFLICT(lista, uf, valor) DO UPDATE SET ultimo_dia = excluded.ultimo_dia WHERE excluded.ultimo_dia > opcoes.ultimo_dia;
INSERT INTO opcoes (lista, uf, valor, ultimo_dia)
  SELECT 'categoria', '', i.categoria, MAX(p.dia) FROM pedidos p JOIN itens i ON i.pedido_id = p.id WHERE p.dia BETWEEN '0000-01-01' AND '9999-12-31' AND i.categoria IS NOT NULL AND i.categoria <> '' GROUP BY 2, 3
  ON CONFLICT(lista, uf, valor) DO UPDATE SET ultimo_dia = excluded.ultimo_dia WHERE excluded.ultimo_dia > opcoes.ultimo_dia;
