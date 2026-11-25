-- Uso do servidor MCP por dia (UTC, mesmo reset da cota do D1) e pessoa: chamadas e linhas lidas (teto diário).
CREATE TABLE mcp_uso (
  dia TEXT NOT NULL,
  email TEXT NOT NULL,
  chamadas INTEGER NOT NULL DEFAULT 0,
  linhas INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, email)
);
