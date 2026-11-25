# Campanhas (v0.6.0) e servidor MCP (v0.7.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bloco "Campanhas" (novos x recorrentes por origem → `utm_campaign`) na aba Clientes e um endpoint MCP
só leitura em `/mcp`, protegido pelo Cloudflare Access, para assistentes de IA consultarem o painel.

**Architecture:** Parte 1 = consulta `campanhas()` + rota `/api/clientes/campanhas` + bloco no front. Parte 2 =
Pages Function `functions/mcp.js` (JSON-RPC sobre Streamable HTTP sem estado). Cada ferramenta MCP **chama o
handler da rota `/api/*` correspondente com um contexto sintético** — assim permissões (`exigirAba`), `semValores`
e validação de filtros são exatamente as do painel. Um proxy do D1 soma `rows_read` para o teto diário
(`mcp_uso`).

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite), JS ESM sem bundler, `node:test` + `node:sqlite`
(D1 falso), Cloudflare Access (Managed OAuth).

**Spec:** `docs/superpowers/specs/2026-11-25-campanhas-e-mcp-design.md`

## Global Constraints
- Repositório público MIT: nada de uma loja real em código, testes, README ou mensagens de commit (fixtures fictícias).
- Commits só com o autor do repositório; **sem** linha `Co-Authored-By` de IA.
- Node ≥ 22.5; sem dependências novas de runtime (o MCP é implementação própria, sem SDK).
- D1 Free: 5 mi leituras e 100 mil gravações/dia. Teto do MCP: **2.500.000 linhas/dia** (`MCP_LINHAS_DIA`), dia em UTC.
- MCP só leitura; sem SQL livre; período máximo por chamada no MCP: **400 dias**.
- Valores em R$ só para quem tem `ver_valores` (via `semValores`); abas via `exigirAba`.
- MCP desligado por padrão: `MCP_ATIVO` ≠ `"1"` → `/mcp` responde 404.
- Publicar (merge, tag, `PAINEL_VERSAO`, deploy) **só com OK do dono**; deploy fora de 03:45 e 15:40 UTC (coletas).
- Textos de interface e descrições das ferramentas em português do Brasil.

## Review Focus
1. Mesma campanha com espaços nas pontas (`" marca "` x `"marca"`) → um grupo só (trim); maiúsculas ficam como gravadas. Teste na Task 1.
2. Argumento MCP com tipo errado (número em `de`, string única em `origem`, chave desconhecida) → erro de parâmetro com `isError`, nunca HTTP 500. Teste na Task 6.
3. Chamada que falha na validação (filtro inválido, aba sem permissão) **não** grava em `mcp_uso`; chamada que estoura o teto bloqueia a seguinte, não a atual. Teste na Task 7.
4. Perfil sem `ver_valores` não recebe nenhum campo de R$ — nem convertido para reais — em nenhuma ferramenta, inclusive `resumo_geral`. Teste na Task 6.
5. Token do Access da aplicação do painel (AUD do painel) **não** abre `/mcp`, e o da aplicação do MCP não abre `/api/*`. Teste na Task 4.

---

## Parte 1 — v0.6.0

### Task 1: Consulta e rota de campanhas

**Files:**
- Modify: `functions/_lib/consultas.js` (nova `campanhas`, perto de `clientes`, ~linha 222)
- Create: `functions/api/clientes/campanhas.js`
- Modify: `test/api-leitura.test.mjs` (fixture ganha `campanha`; testes novos na seção `/api/clientes`)

**Interfaces:**
- Produces: `campanhas(db, f, periodo, { limite = 50 } = {}) -> Promise<Array<{ origem: string, campanha: string, novo: number, recorrente: number, valor: number }>>`
  ordenado por `novo` desc, `recorrente` desc, `origem` asc, `campanha` asc; só canal do site, não cancelados,
  `cliente_tipo IN ('novo','recorrente')`; `campanha = COALESCE(NULLIF(TRIM(p.utm_campaign), ''), '(sem campanha)')`;
  origem = `ORIGEM_SQL`. Usa `base(f, periodo, { extra: canal do site })` como `clientes()`.
- Produces: `GET /api/clientes/campanhas` (aba `clientes`) → `{ campanhas: [{ origem, campanha, novo, recorrente, valor, novoCmp: number|null }], dadosAte }`.
  `novoCmp` = novos da mesma (origem, campanha) no período de comparação (0 se ausente), `null` sem comparação.
  Comparação usa `campanhas(db, f, cmp, { limite: 1000 })`.

- [ ] **Step 1: Fixture.** Em `linha()` ler `extra.campanha` (padrão `null`) e incluir `utm_campaign` no INSERT de
  `inserirPedidos`. Marcar: `p01` `'marca'`, `p04` `' marca '`, `p05` `'marca'`, `p08` `'shopping-a'`,
  `p13` (cancelado) `'marca'`, `c01` `'marca'`; demais sem campanha.
- [ ] **Step 2: Testes que falham**

```js
test('campanhas: origem → campanha, trim, sem cancelados, comparação', async () => {
  const db = await banco();
  const { status, corpo } = await pedir(db, `/api/clientes/campanhas?${PERIODO}`, campanhasRota);
  assert.equal(status, 200);
  const g = corpo.campanhas.find((c) => c.origem === 'Google Ads' && c.campanha === 'marca');
  assert.deepEqual([g.novo, g.recorrente, g.novoCmp], [2, 1, 1]); // p01+p04 novos, p05 recorrente; p13 cancelado fora; c01
  assert.ok(corpo.campanhas.some((c) => c.origem === 'Google Ads' && c.campanha === 'shopping-a' && c.novo === 1));
  assert.ok(corpo.campanhas.some((c) => c.campanha === '(sem campanha)'));
  assert.ok(!corpo.campanhas.some((c) => c.origem === 'Canal 2')); // marketplace fora
  assert.equal(typeof g.valor, 'number');
});
test('campanhas: sem comparação → novoCmp null; sem ver_valores → sem valor; sem aba → 403', async () => {
  const db = await banco();
  const sem = await pedir(db, `/api/clientes/campanhas?${PERIODO}&cmp=nenhum`, campanhasRota);
  assert.ok(sem.corpo.campanhas.every((c) => c.novoCmp === null));
  const mkt = await pedir(db, `/api/clientes/campanhas?${PERIODO}`, campanhasRota, { email: 'mkt@exemplo.com' });
  assert.ok(mkt.corpo.campanhas.every((c) => !('valor' in c)));
  assert.equal((await pedir(db, '/api/clientes/campanhas', campanhasRota, { email: 'compras@exemplo.com' })).status, 403);
});
test('campanhas: limite', async () => { /* campanhas(db, f, periodo, { limite: 2 }).length === 2 */ });
```
  Adicione também a rota na lista de checagem de centavos/permissões do fim do arquivo (linha ~708).

- [ ] **Step 3:** `npm test` → FAIL (módulo `functions/api/clientes/campanhas.js` inexistente).
- [ ] **Step 4:** Implementar `campanhas()` e a rota (padrão de `functions/api/clientes.js`: `exigirAba`, `filtrosDaRequisicao`, `semValores`, `dadosAte`).
- [ ] **Step 5:** `npm test` → todos PASS (a contagem anterior + os novos).
- [ ] **Step 6: Commit** `feat(clientes): consulta e rota de campanhas (novos x recorrentes por utm_campaign)`

### Task 2: Bloco "Campanhas" na aba Clientes

**Files:**
- Modify: `public/js/views/clientes.js` (nova seção abaixo da grade atual; `pintarCampanhas`)
- Modify: `public/css/*.css` (só se as classes existentes de tabela/legenda não bastarem)

**Interfaces:**
- Consumes: `GET /api/clientes/campanhas` da Task 1 (consulta própria, com seu `bloco()` — não espera `/api/clientes`).

- [ ] **Step 1:** Seção `card s12` "Campanhas" com legenda Novos/Recorrentes, agrupada por origem (cabeçalho da
  origem = botão que chama `ctx.aplicarFiltro('origem', origem)`), linhas com ponto na cor da origem como no bloco
  por origem da v0.5.1. Colunas: Campanha · Novos · Recorrentes · Receita (só `ctx.eu.verValores`, `brlK`) ·
  Novos vs comp. (pílula `classeVariacao` com `pct(novo, novoCmp)`; some quando `novoCmp === null`).
- [ ] **Step 2:** Mostrar as 10 primeiras (na ordem da API) e botão "ver todas" que revela até 50. Celular
  (mesma media query dos outros blocos): só Campanha, Novos, Recorrentes. Vazio → `semDados(el)`.
- [ ] **Step 3:** `npm test` PASS (nada de servidor muda) e conferência visual local:
  `npx wrangler pages dev public --port 8796 --persist-to .wrangler/state` (D1 local semeado com `npm run semear`;
  se o seed não tiver `utm_campaign`, acrescentar algumas campanhas fictícias em `scripts/semear-local.mjs`).
  Print desktop e celular (390 px) com e sem comparação e com usuário sem `ver_valores`.
- [ ] **Step 4: Commit** `feat(clientes): bloco Campanhas`

### Task 3: Versão 0.6.0 e publicação (com OK do dono)

**Files:** `package.json`, `package-lock.json`, `public/js/versao.js`

- [ ] **Step 1:** Bump para `0.6.0` nos três; `npm test` PASS (o `versao.test.mjs` confere).
- [ ] **Step 2: Commit** `chore: versão 0.6.0`; push da branch; PR; CI verde.
- [ ] **Step 3 (OK do dono):** merge, `git tag v0.6.0 && git push --tags`; no repositório da instância:
  `gh variable set PAINEL_VERSAO --body v0.6.0` e `gh workflow run painel-deploy.yml` (fora de 03:45/15:40 UTC).
- [ ] **Step 4:** Conferir no site publicado: bloco aparece, números de uma campanha batem com
  `SELECT … GROUP BY utm_campaign` direto no D1 para o mesmo período.

---

## Parte 2 — Passo 0 (teste de login) e v0.7.0

### Task 4: Esqueleto MCP `/mcp` + login por AUD próprio (vira o passo 0)

**Files:**
- Modify: `functions/_lib/acesso.js` — `emailDaRequisicao(request, env, opcoes)` aceita `opcoes.aud` (string) que substitui `env.ACCESS_AUD`
- Create: `functions/_lib/mcp/protocolo.js` — JSON-RPC
- Create: `functions/mcp.js` — `onRequest` (POST/GET/outros)
- Create: `test/mcp.test.mjs`
- Modify: `wrangler.exemplo.toml` — `MCP_ATIVO = "0"`, `ACCESS_AUD_MCP = "aud-da-aplicacao-do-mcp"`, `MCP_LINHAS_DIA = "2500000"` (comentados)

**Interfaces:**
- Produces: `responder(mensagem, { eu, ferramentas, versao }) -> Promise<{ status: number, corpo: object|null }>` em `protocolo.js`.
  Métodos: `initialize` → `{ protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'painel', version } }`
  (`protocolVersion` = a pedida se estiver em `['2025-11-25','2025-06-18','2025-03-26']`, senão `'2025-11-25'`);
  `notifications/*` → status 202, corpo null; `ping` → `{}`; `tools/list` → `{ tools: [{ name, description, inputSchema }] }`;
  `tools/call` → `ferramentas[name].executar(args, contexto)`; erro de execução → `result: { isError: true, content: [{type:'text', text}] }`.
  Erros JSON-RPC: corpo não-JSON → -32700; lote (array) ou sem `jsonrpc:'2.0'` → -32600; método desconhecido → -32601; ferramenta desconhecida → -32602.
- Produces: `ferramentas` = `{ [nome]: { description: string, inputSchema: object, executar(args, ctx) -> Promise<object> } }` — formato usado pelas Tasks 6–7.
  Nesta task só `quem_sou_eu` → `{ email, perfil, abas, verValores, dadosAte }` (`dadosAte(db, 'pedidos')`).
- `functions/mcp.js`: `MCP_ATIVO !== '1'` → 404; GET → 405; POST: `emailDaRequisicao(request, env, { aud: env.ACCESS_AUD_MCP })`
  + `carregarRegistro`; falha de login → HTTP 401 com `WWW-Authenticate: Bearer`; usuário inativo → 403. **Sem** checagem de `Origin`.
  Resposta `Content-Type: application/json`.

- [ ] **Step 1: Testes que falham** (`test/mcp.test.mjs`, D1 falso e `DEV_EMAIL` como em `api-leitura`):
  `initialize` devolve `serverInfo.name === 'painel'` e `capabilities.tools`; `tools/list` contém `quem_sou_eu`;
  `tools/call quem_sou_eu` com `gestao@exemplo.com` → `perfil === 'gestao'`; `MCP_ATIVO` ausente → 404; GET → 405;
  JSON inválido → `error.code === -32700`; array → -32600; `foo/bar` → -32601; usuário inativo/inexistente → 403;
  `notifications/initialized` → 202 sem corpo.
  Em `test/acesso.test.mjs`: JWT com AUD do MCP é aceito por `emailDaRequisicao(req, env, { aud: AUD_MCP })` e
  recusado sem a opção (AUD do painel); e vice-versa (Review Focus 5).
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implementar `protocolo.js`, `mcp.js` e a opção `aud` em `acesso.js`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(mcp): endpoint /mcp com initialize, tools/list e quem_sou_eu`
- [ ] **Step 6 — PASSO 0 (com o dono, manual):**
  1. Dono cria no Zero Trust uma aplicação Access self-hosted "painel - MCP" para `<projeto>.pages.dev/mcp` e
     `*.<projeto>.pages.dev/mcp`, mesma política de e-mails, **Managed OAuth ligado** (Advanced settings);
     passa o AUD dela.
  2. Deploy de preview local (sem mexer na main): guardar o `wrangler.toml` local (não versionado), escrever no
     lugar um igual ao gerado pelo workflow `painel-deploy.yml` (ID real do D1 via `npx wrangler@4 d1 list`) +
     `MCP_ATIVO="1"` e `ACCESS_AUD_MCP`; na raiz do repo `npx wrangler pages deploy public --project-name
     <projeto> --branch mcp-teste`; restaurar o `wrangler.toml` original. **Não** aplicar migrações.
  3. Conferir: `curl -i https://mcp-teste.<projeto>.pages.dev/mcp` (sem login) → 401 do Access com
     `WWW-Authenticate` contendo `resource_metadata`; `curl -i https://mcp-teste.<projeto>.pages.dev/` → 302 (painel inalterado).
  4. Dono adiciona o conector `https://mcp-teste.<projeto>.pages.dev/mcp` no Claude (web) e chama
     `quem_sou_eu` pelo Cowork.
  5. **Critério:** funcionou no Cowork → seguir Tasks 5–9 como estão. Não funcionou → **parar** e reescrever
     as Tasks 4 (hospedagem/login) e 9 para a abordagem B do spec (Worker com `workers-oauth-provider`, mesmo
     `protocolo.js` e ferramentas); Tasks 5–7 não mudam. Registrar o resultado no PR.

### Task 5: Contagem de leituras e teto diário (`mcp_uso`)

**Files:**
- Create: `migrations/0005_mcp_uso.sql` — `CREATE TABLE mcp_uso (dia TEXT NOT NULL, email TEXT NOT NULL, chamadas INTEGER NOT NULL DEFAULT 0, linhas INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (dia, email));`
- Create: `functions/_lib/mcp/cota.js`
- Modify: `test/d1-falso.mjs` — `all()` devolve `meta: { rows_read: results.length }` (aproximação documentada no arquivo)
- Create: `test/mcp-cota.test.mjs`; Modify: `test/migracoes.test.mjs` (tabela nova)

**Interfaces:**
- Produces: `contarLeituras(db) -> { db: D1Like, linhas(): number }` — proxy de `prepare().bind().all()/first()/run()`
  que soma `meta.rows_read` do `all()` (ausente → `results.length`) e conta 1 por `first()`.
- Produces: `diaUtc(agora = Date.now()) -> 'AAAA-MM-DD'`.
- Produces: `usoDoDia(db, dia) -> Promise<number>` (`SUM(linhas)`, 0 se vazio).
- Produces: `exigirCota(db, env, agora) -> Promise<{ usadas: number, teto: number }>`; lança `ErroCota` (mensagem:
  `"Limite diário de consultas do assistente atingido (X de Y linhas). Volta às 00:00 UTC (21h em Brasília)."`) se `usadas >= teto`.
  `teto = Number(env.MCP_LINHAS_DIA) || 2500000`.
- Produces: `registrarUso(db, email, linhas, agora) -> Promise<void>` — upsert `chamadas+1, linhas+linhas`.

- [ ] **Step 1: Testes que falham:** proxy soma `rows_read` de duas consultas; `usoDoDia` soma vários e-mails do
  mesmo dia e ignora outro dia; `exigirCota` passa com 2.499.999 e lança com 2.500.000 (teto padrão) e com
  `MCP_LINHAS_DIA='10'`; `registrarUso` duas vezes → `chamadas=2`, `linhas` somadas; `diaUtc` em 2026-11-25T02:00Z
  → `'2026-11-25'` (não o dia de Brasília).
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** implementar. **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(mcp): contagem de leituras e teto diário em mcp_uso`

### Task 6: Ferramentas do MCP

**Files:**
- Create: `functions/_lib/mcp/ferramentas.js`
- Create: `functions/_lib/mcp/adaptar.js` — args → query string, contexto sintético, centavos → reais, série semanal
- Create: `test/mcp-ferramentas.test.mjs`

**Interfaces:**
- Consumes: handlers `onRequestGet` de `functions/api/visao.js`, `vendas/resumo.js`, `vendas/serie.js`,
  `vendas/quebra.js`, `vendas/produtos.js`, `clientes.js`, `clientes/campanhas.js` (Task 1), `opcoes.js`; formato de `ferramentas` da Task 4.
- Produces: `chamarRota(handler, caminho, args, ctx) -> Promise<object>` — monta `Request` `https://mcp.local${caminho}?…`,
  contexto `{ request, env: ctx.env (com DB = proxy da Task 5), data: { eu: ctx.eu }, params: {} }`, chama o handler,
  lê o JSON; status ≠ 200 → lança `Error(corpo.mensagem)` (vira `isError`).
- Produces: `argsParaQuery(args, extras) -> URLSearchParams` — aceita só `de`, `ate` (`AAAA-MM-DD`), `cmp`
  (`anterior|ano|nenhum`), listas `origem, categoria, marca, pagamento, uf, cidade, entrega` (array de strings) e os
  `extras` da ferramenta; tipo errado ou chave desconhecida → `Error` de parâmetro. Período > 400 dias → erro
  `"No assistente o período máximo é de 400 dias."` (antes de chamar a rota).
- Produces: `emReais(obj)` — divide por 100 os campos de `CAMPOS_VALOR` **exceto `varPreco`** (é %), recursivo.
- Produces: `ferramentas` com: `quem_sou_eu`; `resumo_geral` (→ `visao` + `campanhas` top 5 se tiver aba `clientes`;
  partes conforme as abas, como `visao.js`); `vendas_resumo` (→ `resumo`); `vendas_serie` (→ `serie`; > 92 dias
  agrupa por semana iniciando na segunda, somando `valor`, `pedidos`, `cmpValor`, `cmpPedidos`); `vendas_quebra`
  (extra `por` ∈ chaves de `QUEBRAS`); `produtos` (extras `modo` `mais|subiram|caiu`, `ordem`, `pagina`, `busca`);
  `clientes`; `campanhas`; `opcoes_filtro`. Descrições em PT-BR dizendo o que respondem, limites (400 dias, listas
  com teto) e que valores vêm em reais. `inputSchema` JSON Schema com `additionalProperties: false`.

- [ ] **Step 1: Testes que falham** (D1 falso + fixture fictícia — reutilize `banco()`; se preciso exporte-a de um
  módulo `test/fixture-pedidos.mjs` em vez de duplicar):
  - `vendas_resumo` com gestão: valor = soma de centavos ÷ 100 (número com 2 casas);
  - `produtos` `modo: 'subiram'` devolve `varPreco` igual ao da rota (sem ÷100);
  - `mkt@exemplo.com` (sem `ver_valores`): nenhuma ferramenta devolve chave de `CAMPOS_VALOR` (varrer recursivamente) — Review Focus 4;
  - `compras@exemplo.com`: `resumo_geral` sem KPIs de vendas nem campanhas; `vendas_resumo` → `isError` com "não tem acesso";
  - `vendas_serie` com 100 dias → pontos semanais, soma de pedidos igual à série diária;
  - `de: 20260301` (número), `origem: 'Google Ads'` (string), `{ foo: 1 }`, 401 dias → `isError` de parâmetro, sem lançar exceção não tratada — Review Focus 2;
  - `tools/list` tem as 9 ferramentas e todo `inputSchema` tem `additionalProperties: false`.
- [ ] **Step 2:** `npm test` → FAIL. **Step 3:** implementar. **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(mcp): ferramentas de vendas, clientes, campanhas e resumo geral`

### Task 7: Ligar ferramentas + teto em `/mcp`

**Files:**
- Modify: `functions/mcp.js`, `functions/_lib/mcp/protocolo.js` (se preciso), `functions/_lib/mcp/ferramentas.js` (`quem_sou_eu` ganha `usoHoje: { linhas, teto }`)
- Modify: `test/mcp.test.mjs`
- Modify: `README.md` — seção "Usar com Claude (MCP)": aplicação Access só do `/mcp` com Managed OAuth, variáveis, adicionar conector, teto diário.

**Interfaces:**
- Consumes: Task 5 (`contarLeituras`, `exigirCota`, `registrarUso`), Task 6 (`ferramentas`).
- Fluxo de `tools/call`: `exigirCota` (lança → `isError` com a mensagem, sem executar) → executar com `DB = contarLeituras(env.DB).db`
  → **só se a execução não deu erro de parâmetro/permissão** → `registrarUso(env.DB, eu.email, linhas())` via `waitUntil`.
  `initialize`, `tools/list`, `ping` e `quem_sou_eu` não consultam a cota além da leitura de `usoDoDia` do próprio `quem_sou_eu`.

- [ ] **Step 1: Testes que falham:** `tools/call vendas_resumo` grava `mcp_uso` (chamadas 1, linhas > 0); filtro
  inválido não grava; com `MCP_LINHAS_DIA='1'` a 1ª chamada executa e grava, a 2ª volta `isError` com
  "Limite diário" — Review Focus 3; `quem_sou_eu` mostra `usoHoje.teto === 2500000` por padrão.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** `npm test` → PASS.
- [ ] **Step 5: Commit** `feat(mcp): teto diário aplicado nas chamadas e guia no README`

### Task 8: Medição real e cortes

- [ ] **Step 1:** Aplicar a migração 0005 no D1 remoto **só com OK do dono** (`npx wrangler@4 d1 migrations apply painel --remote`
  a partir do pacote com `wrangler.toml` temporário) e publicar preview `mcp-teste` como no Step 6 da Task 4.
- [ ] **Step 2:** Pelo conector, chamar cada ferramenta com 400 dias e `cmp: 'anterior'` (e `produtos` com
  `modo: 'subiram'` e com filtro de categoria); ler `linhas` por chamada em `mcp_uso` (diferença entre chamadas).
- [ ] **Step 3:** Ferramenta > 300.000 linhas numa chamada → reduzir o período máximo **dela** (constante por
  ferramenta em `ferramentas.js`) até ficar abaixo, com teste do novo limite; registrar a tabela de medições no PR.
- [ ] **Step 4: Commit** (se houve corte) `fix(mcp): período máximo menor para <ferramenta>`

### Task 9: Versão 0.7.0, deploy e conversa real (com OK do dono)

**Files:** `package.json`, `package-lock.json`, `public/js/versao.js`; no repositório da instância:
`.github/workflows/painel-deploy.yml` (vars `MCP_ATIVO`, `ACCESS_AUD_MCP` do secret `ACCESS_AUD_MCP`, `MCP_LINHAS_DIA = "2500000"` no `wrangler.toml` gerado).

- [ ] **Step 1:** Bump `0.7.0`; `npm test` PASS; commit `chore: versão 0.7.0`; PR; CI verde.
- [ ] **Step 2 (OK do dono):** merge + tag `v0.7.0`; PR na instância com o workflow e `gh secret set ACCESS_AUD_MCP`;
  `PAINEL_VERSAO=v0.7.0`; deploy fora de 03:45/15:40 UTC; conferir que a migração 0005 está aplicada.
- [ ] **Step 3:** Trocar o conector do Claude para `https://<projeto>.pages.dev/mcp`; conversa real no Cowork usando
  `resumo_geral` e `campanhas`; `curl` sem login em `/` → 302 e em `/mcp` → 401.
- [ ] **Step 4:** Remover o deploy de preview `mcp-teste` (ou deixá-lo sem `MCP_ATIVO`) e anotar no PR.
