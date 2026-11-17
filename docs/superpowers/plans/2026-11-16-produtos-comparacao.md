# Produtos que subiram e caíram — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na seção "Produtos" da aba Vendas, além de "Mais vendidos", mostrar os produtos que subiram e caíram em quantidade contra o período de comparação da barra, com a variação do preço médio pago.

**Architecture:** O endpoint existente `/api/vendas/produtos` ganha `modo=mais|subiram|caiu`. Os modos novos agregam `itens` por SKU no período atual e no de comparação (`periodoComparacao(f)`), juntam os dois e filtram/ordenam no SQL, paginado no servidor. A tela troca o conteúdo da tabela por segmentos no cabeçalho do cartão, no mesmo padrão do seletor "Faturamento/Pedidos".

**Tech Stack:** Cloudflare Pages Functions + D1 (SQLite), JS puro no front, `node --test` com D1 falso (`test/d1-falso.mjs`).

**Spec:** `docs/superpowers/specs/2026-11-16-produtos-comparacao-design.md`

## Global Constraints

- Modos: `mais` (padrão, comportamento atual inalterado), `subiram`, `caiu`. Outro valor → 400 `filtro-invalido`.
- Comparação: sempre `periodoComparacao(f)` da barra. Com `cmp=nenhum` e modo ≠ `mais` → 200 com `{ itens: [], total: 0, pagina, porPagina, semComparacao: true }`.
- Volume mínimo: só SKUs com **3+ pedidos distintos no período de comparação**.
- SKU sem venda na comparação nunca aparece em `subiram`/`caiu`.
- `subiram`: `qtd > qtdAntes`, ordem `varQtd DESC, sku`. `caiu`: `qtd < qtdAntes` (inclui qtd 0 → -100%), ordem `varQtd ASC, sku`.
- `varQtd` = `round((qtd - qtdAntes) / qtdAntes * 100, 1)`. `varPreco` = variação % do preço médio por unidade (`valor/qtd` atual vs `valorAntes/qtdAntes`), 1 casa; `null` quando `qtd = 0`.
- Campos de cada linha nos modos novos: `sku, nome, marca, categoria, qtd, qtdAntes, pedidos, varQtd, varPreco, valor`.
- Sem `ver_valores`: somem `valor` e `varPreco` (incluir `varPreco` em `CAMPOS_VALOR`).
- Filtros da barra (origem, pagamento, uf, cidade, entrega, marca, categoria) e `busca` valem para os dois períodos; cancelados fora.
- Paginação: `POR_PAGINA = 50`, mesma validação de `pagina`/`busca` atual. `ordem` é ignorada nos modos novos.
- Repo público: nenhum termo de loja real em código, testes ou textos.
- Textos da tela: abas "Mais vendidos", "Subiram", "Caíram"; vazio "Nenhum produto com variação no período."; sem comparação "Escolha uma comparação na barra para ver o que subiu ou caiu."; legenda "Só entram produtos com 3+ pedidos no período de comparação."

## Review Focus

- Filtro de marca/categoria + modo novo: o filtro vale nos dois lados (senão a comparação mistura universos) — teste com `marca=` no Task 1.
- Usuário sem R$: nem `valor` nem `varPreco` na resposta, e a tela não mostra as colunas — rota no teste R10 e teste de colunas no Task 2.
- Produto que zerou (qtd 0 no atual) aparece em "Caíram" com -100% e `varPreco` null, sem divisão por zero — teste no Task 1.
- Troca rápida de aba/página: só a resposta mais nova pinta (reaproveitar o `seq` existente) — coberto pela reutilização do `ir()`; conferir no Task 2.
- `cmp=nenhum`: a tela mostra o aviso em vez de tabela vazia ou erro — teste no Task 1 (API) e checagem manual no Task 2.

---

### Task 1: API dos modos subiram/caiu

**Files:**
- Modify: `functions/_lib/consultas.js` (nova função após `produtos`, ~l.125)
- Modify: `functions/api/vendas/produtos.js`
- Modify: `functions/_lib/valores.js` (`CAMPOS_VALOR` + `'varPreco'`)
- Test: `test/api-leitura.test.mjs`

**Interfaces:**
- Produces: `produtosVariacao(db, f, atual, antes, { modo, pagina, porPagina, busca }) -> Promise<{ itens, total }>` em `consultas.js` (`modo` ∈ `'subiram'|'caiu'`; `atual`/`antes` = `{ de, ate }`).
- Produces: `GET /api/vendas/produtos?modo=subiram|caiu|mais&…` → `{ itens, total, pagina, porPagina, semComparacao? }`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `bancoVariacao()` (como `banco()`, mesmos usuários e coleta) com pedidos de site, origem/pagamento/uf iguais, atual `2026-05-08..14`, comparação anterior `2026-05-01..07`, um item por pedido:

| SKU | marca | comparação | atual |
|---|---|---|---|
| S1 | A | 3 pedidos × (qtd 1, 1000) | 4 pedidos, total qtd 6, valor 6600 |
| S2 | A | 4 pedidos × (qtd 1, 1000) | 1 pedido (qtd 1, 1000) |
| S3 | B | 3 pedidos × (qtd 1, 1000) | nenhum |
| S4 | A | 2 pedidos × (qtd 1, 1000) | 5 pedidos × (qtd 1, 1000) |
| S5 | A | nenhum | 5 pedidos × (qtd 1, 1000) |
| S6 | B | 3 pedidos × (qtd 1, 1000) | 3 pedidos × (qtd 1, 1000) |

Mais um pedido cancelado de S2 no atual (qtd 10) que não pode contar.

```js
const PV = 'de=2026-05-08&ate=2026-05-14&cmp=anterior';
test('produtos modo=subiram: só quem subiu com 3+ pedidos antes', async () => {
  const { corpo } = await pedir(await bancoVariacao(), `/api/vendas/produtos?${PV}&modo=subiram`, produtos);
  assert.deepEqual(corpo.itens.map((i) => i.sku), ['S1']);
  assert.equal(corpo.total, 1);
  assert.deepEqual(
    pick(corpo.itens[0], ['qtd', 'qtdAntes', 'pedidos', 'varQtd', 'varPreco', 'valor']),
    { qtd: 6, qtdAntes: 3, pedidos: 4, varQtd: 100, varPreco: 10, valor: 6600 },
  );
});
test('produtos modo=caiu: ordem por queda, inclui quem zerou', async () => {
  const { corpo } = await pedir(await bancoVariacao(), `/api/vendas/produtos?${PV}&modo=caiu`, produtos);
  assert.deepEqual(corpo.itens.map((i) => [i.sku, i.varQtd, i.varPreco]), [['S3', -100, null], ['S2', -75, 0]]);
  assert.equal(corpo.itens[0].qtd, 0);
});
test('produtos modo novo respeita filtro de marca nos dois períodos', async () => {
  const { corpo } = await pedir(await bancoVariacao(), `/api/vendas/produtos?${PV}&modo=caiu&marca=B`, produtos);
  assert.deepEqual(corpo.itens.map((i) => i.sku), ['S3']);
});
test('produtos modo novo com busca, cmp=nenhum e modo inválido', async () => {
  const db = await bancoVariacao();
  assert.deepEqual((await pedir(db, `/api/vendas/produtos?${PV}&modo=caiu&busca=S2`, produtos)).corpo.itens.map((i) => i.sku), ['S2']);
  const sem = await pedir(db, '/api/vendas/produtos?de=2026-05-08&ate=2026-05-14&cmp=nenhum&modo=subiram', produtos);
  assert.equal(sem.status, 200);
  assert.equal(sem.corpo.semComparacao, true);
  assert.deepEqual(sem.corpo.itens, []);
  assert.equal((await pedir(db, `/api/vendas/produtos?${PV}&modo=outro`, produtos)).status, 400);
});
test('produtos modo novo sem R$ não traz valor nem varPreco', async () => {
  const { corpo } = await pedir(await bancoVariacao(), `/api/vendas/produtos?${PV}&modo=subiram`, produtos, { email: 'mkt@exemplo.com' });
  assert.equal('valor' in corpo.itens[0], false);
  assert.equal('varPreco' in corpo.itens[0], false);
  assert.equal(corpo.itens[0].varQtd, 100);
});
```
(`pick` = helper local que copia só as chaves pedidas.) Acrescentar a `ROTAS_VAZAMENTO`: `['produtos subiram', \`/api/vendas/produtos?${PERIODO}&modo=subiram\`, produtos]` e `['produtos caiu', …&modo=caiu, produtos]`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL nos testes novos (modo ignorado / campos ausentes).

- [ ] **Step 3: Implementar**

`produtosVariacao`: dois agregados por SKU com `base(f, periodo, { itens: true, extra })` (o mesmo `extra` de busca de `produtos`), um para `atual` e outro para `antes` (`HAVING COUNT(DISTINCT p.id) >= 3` no de antes), e `LEFT JOIN` do antes com o atual (o antes manda, assim zerados aparecem e novos ficam fora). Nome/marca/categoria vêm do atual quando houver, senão do antes. Calcular `varQtd`/`varPreco` no SQL ou em JS após a consulta, mas filtro, ordem e paginação no SQL (`LIMIT/OFFSET`) e `total` pelo mesmo agregado. Arredondamento: 1 casa, `-75`, não `-75.0`.
No handler: `lerModo(params)` (`'mais'` padrão; inválido → `invalido('Modo inválido.')`); modo `mais` segue o caminho atual sem mudança; nos outros, `const antes = periodoComparacao(f)`; `null` → resposta `semComparacao`. Resposta passa por `semValores`.

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: tudo PASS (antes eram 208; os testes de `mais` continuam iguais).

- [ ] **Step 5: Commit**

```bash
git add functions test
git commit -m "feat(api): produtos que subiram e caíram contra a comparação da barra"
```

### Task 2: Tela — abas Mais vendidos / Subiram / Caíram

**Files:**
- Modify: `public/js/views/vendas.js` (cartão "Produtos" ~l.45-47 e `produtos()` ~l.202-270)
- Test: `test/views-comum.test.mjs` (ou novo `test/vendas-produtos.test.mjs` se a função ficar em módulo próprio)

**Interfaces:**
- Consumes: `GET /api/vendas/produtos?modo=…` do Task 1.
- Produces: `colunasProdutos(modo: 'mais'|'subiram'|'caiu', vv: boolean) -> Array<coluna>` exportada (pura, testável); `pref.modo` persiste como `pref.ordem`.

- [ ] **Step 1: Teste que falha**

```js
test('colunasProdutos: modos novos e sem R$', () => {
  const chaves = (m, vv) => colunasProdutos(m, vv).map((c) => c.chave);
  assert.deepEqual(chaves('mais', true), ['nome', 'sku', 'marca', 'categoria', 'qtd', 'pedidos', 'valor']);
  assert.deepEqual(chaves('subiram', true), ['nome', 'sku', 'marca', 'categoria', 'qtd', 'qtdAntes', 'varQtd', 'varPreco', 'valor']);
  assert.deepEqual(chaves('caiu', false), ['nome', 'sku', 'marca', 'categoria', 'qtd', 'qtdAntes', 'varQtd']);
  assert.ok(colunasProdutos('caiu', true).filter((c) => ['varQtd', 'varPreco'].includes(c.chave)).every((c) => c.formato === 'pct' && c.ordenavel === false));
});
```
Títulos: Qtd, Antes, Var., Var. preço, Faturamento.

- [ ] **Step 2: Rodar e ver falhar** — `npm test` → FAIL (`colunasProdutos` não existe).

- [ ] **Step 3: Implementar**

Cabeçalho do cartão: `<div class="segmentos" role="group" aria-label="Lista de produtos">` com 3 `button.segmento[data-modo]` e `aria-pressed`, igual ao `data-medida`. Abaixo da tabela nos modos novos, a legenda da Global Constraints. Trocar de modo: `pref.modo = …`, `ir(1)` (reaproveita o `seq`), repinta colunas, vazio e `csv` (`produtos`, `produtos-subiram`, `produtos-caiu`). `buscar()` envia `modo`; `ordem` só no modo `mais`. Resposta com `semComparacao` → mensagem da Global Constraints no lugar da tabela. Valores de `varQtd`/`varPreco` com sinal (`+100%`, `-75%`), usando o formato `pct` (ajustar para mostrar `+` em positivo só nessas colunas, sem mudar `pct` dos outros usos).

- [ ] **Step 4: Rodar e ver passar** — `npm test` → PASS.

- [ ] **Step 5: Conferência visual local**

Run: `npm run db:migrar && npm run semear && npm run dev` e abrir `http://localhost:8788` (DEV_EMAIL em `.dev.vars`). Conferir na aba Vendas: as 3 abas, troca rápida, `cmp=nenhum` mostrando o aviso, usuário sem R$ sem as colunas, e largura de celular (390 px) sem rolagem horizontal da página. Prints desktop e celular por puppeteer em `docs/superpowers/specs/` não são necessários; salvar no scratchpad.

- [ ] **Step 6: Commit**

```bash
git add public test
git commit -m "feat(vendas): abas Mais vendidos, Subiram e Caíram em Produtos"
```
