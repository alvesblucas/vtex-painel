CREATE TABLE pedidos (
  id TEXT PRIMARY KEY,
  dia TEXT NOT NULL,
  criado TEXT NOT NULL,
  status TEXT NOT NULL,
  cancelado INTEGER NOT NULL,
  valor INTEGER NOT NULL,
  frete INTEGER NOT NULL,
  desconto INTEGER NOT NULL,
  canal TEXT NOT NULL,
  origem TEXT NOT NULL,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
  pagamento TEXT NOT NULL,
  parcelas INTEGER,
  uf TEXT, cidade TEXT,
  entrega TEXT NOT NULL,
  cliente_tipo TEXT,
  atualizado TEXT NOT NULL
);

CREATE TABLE itens (
  pedido_id TEXT NOT NULL, sku TEXT NOT NULL, produto_id TEXT,
  nome TEXT, marca TEXT, categoria TEXT, departamento TEXT,
  qtd INTEGER NOT NULL, valor INTEGER NOT NULL,
  PRIMARY KEY (pedido_id, sku)
);

CREATE TABLE estoque_dia (dia TEXT PRIMARY KEY, total INTEGER, novos INTEGER);

CREATE TABLE estoque_lista (
  dia TEXT, lista TEXT, posicao INTEGER, sku TEXT, nome TEXT, marca TEXT, ref TEXT,
  preco INTEGER, extra TEXT,
  PRIMARY KEY (dia, lista, posicao)
);

CREATE TABLE saude_dia (dia TEXT PRIMARY KEY, status TEXT, json TEXT);

CREATE TABLE automacoes (nome TEXT PRIMARY KEY, status TEXT, resumo TEXT, quando TEXT, url TEXT);

CREATE TABLE pedidos_alerta (id TEXT PRIMARY KEY, tipo TEXT, desde TEXT, status TEXT, dia TEXT, resolvido INTEGER);

CREATE TABLE avaliacoes (id TEXT PRIMARY KEY, dia TEXT, nota INTEGER, produto TEXT, aprovada INTEGER);

CREATE TABLE avaliacao_envio (dia TEXT PRIMARY KEY, enviados INTEGER, falhas INTEGER);

CREATE TABLE outlet (
  dia TEXT, sku TEXT, nome TEXT, marca TEXT, preco INTEGER, de INTEGER, desconto REAL,
  PRIMARY KEY (dia, sku)
);

CREATE TABLE coletas (fonte TEXT PRIMARY KEY, quando TEXT, ok INTEGER, registros INTEGER, erro TEXT);

CREATE TABLE perfis (id TEXT PRIMARY KEY, nome TEXT NOT NULL, abas TEXT NOT NULL, ver_valores INTEGER NOT NULL);

CREATE TABLE usuarios (
  email TEXT PRIMARY KEY, -- sempre minúsculo e sem espaços
  nome TEXT,
  perfil TEXT REFERENCES perfis(id),
  ajustes TEXT,
  admin INTEGER NOT NULL DEFAULT 0,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado TEXT,
  ultimo_acesso TEXT
);

CREATE TABLE auditoria (
  id INTEGER PRIMARY KEY, quando TEXT NOT NULL, quem TEXT NOT NULL, acao TEXT NOT NULL,
  alvo TEXT NOT NULL, antes TEXT, depois TEXT
);

CREATE INDEX idx_pedidos_dia ON pedidos(dia);
CREATE INDEX idx_pedidos_origem_dia ON pedidos(origem, dia);
CREATE INDEX idx_itens_marca ON itens(marca);
CREATE INDEX idx_itens_categoria ON itens(categoria);
CREATE INDEX idx_auditoria_quando ON auditoria(quando);
