# Marketplaces na origem e produtos por categoria — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar cada marketplace como origem própria (filtro e barras) e abrir, ao clicar numa categoria, uma gaveta com os 5 produtos que mais subiram e caíram nela.

**Architecture:** A origem efetiva vira uma expressão SQL única (`ORIGEM_SQL`) usada em filtro, quebra e opções — nada é gravado. No front, `abrirModal` sai de `usuarios.js` para `views/modal.js`, que ganha `gavetaLeitura`; a aba Vendas usa a gaveta no clique de "Por categoria", com os números da própria barra e duas chamadas a `/api/vendas/produtos` (modo subiram/caiu + `categoria`).

**Tech Stack:** Pages Functions + D1, JS puro, `node --test` com D1 falso.

**Spec:** `docs/superpowers/specs/2026-11-16-origem-canal-e-categoria-design.md`

## Global Constraints

- `ORIGEM_SQL` = `CASE WHEN p.canal = 'Site' THEN p.origem ELSE p.canal END` (usar a constante `CANAL_SITE` existente, valor por parâmetro ou literal seguro).
- Vale em: `wherePedidos` (filtro `origem`), `QUEBRAS.origem`, `opcoes().origens`. `clientes()` não muda.
- Coletor (`coletores/`) não muda; nenhuma migração.
- Gaveta só no clique de "Por categoria"; as outras quebras seguem `ctx.aplicarFiltro`.
- Gaveta: título = categoria; linha com Pedidos (e Faturamento se `ver_valores`) atuais e a variação contra a comparação, com os números da barra clicada; listas "Mais subiram" e "Mais caíram" com até **5** itens cada (nome + pílula `deltaPct` da `varQtd`); botão **"Filtrar a página por esta categoria"**; fechar por ×, Esc ou clique fora; fecha ao trocar de rota.
- Sem comparação na barra: sem listas, texto **"Escolha uma comparação na barra para ver o que subiu ou caiu."**
- Lista vazia: **"Nenhum produto com variação."**
- Celular (≤ 640 px): gaveta em largura total.
- Repo público: nenhum termo de loja real.

## Review Focus

- Pedido de marketplace com `origem` gravada diferente de "Marketplace" (dados antigos): a origem efetiva é sempre o canal — teste no Task 1 com um pedido de canal ≠ Site e origem "Google Ads".
- Filtro `origem=` com valor de site e de canal juntos: OR entre eles, sem duplicar — teste no Task 1.
- Categoria com nome com aspas/acentos: escapada no HTML e enviada certa na query — teste no Task 2 (`htmlDetalheCategoria` com `<b>"x"</b>`).
- Usuário sem R$: gaveta sem Faturamento — teste no Task 2.
- Trocar de rota com a gaveta aberta: fecha e não pinta depois — conferência manual no Task 2.

---

### Task 1: Origem efetiva por canal na API

**Files:**
- Modify: `functions/_lib/filtros.js` (`wherePedidos`, laço de `origem`), `functions/_lib/consultas.js` (`QUEBRAS.origem`, `opcoes`)
- Test: `test/api-leitura.test.mjs` (atualizar os testes que esperam "Marketplace"; fixture já grava canal `Canal 2` para origem `Marketplace`)

**Interfaces:**
- Produces: `export const ORIGEM_SQL` em `functions/_lib/filtros.js`.

- [ ] **Step 1: Testes que falham**

```js
test('origem efetiva: marketplace aparece pelo nome do canal', async () => {
  const db = await banco();
  const q = await pedir(db, `/api/vendas/quebra?${PERIODO}&por=origem`, quebra);
  const chaves = q.corpo.itens.map((i) => i.chave);
  assert.ok(chaves.includes('Canal 2'));
  assert.ok(!chaves.includes('Marketplace'));
  const op = await pedir(db, '/api/opcoes', opcoes);
  assert.ok(op.corpo.origens.includes('Canal 2'));
  assert.ok(!op.corpo.origens.includes('Marketplace'));
});
test('filtro origem=<canal> traz só aquele canal, e soma com origem do site', async () => {
  const db = await banco();
  const so = await pedir(db, `/api/vendas/resumo?${PERIODO}&origem=Canal%202`, resumo);
  const mk = MARCO_OK.filter((p) => p.canal === 'Canal 2');
  assert.equal(so.corpo.atual.pedidos, mk.length);
  const ambos = await pedir(db, `/api/vendas/resumo?${PERIODO}&origem=Canal%202&origem=Sem%20UTM`, resumo);
  assert.equal(ambos.corpo.atual.pedidos, mk.length + MARCO_OK.filter((p) => p.origem === 'Sem UTM').length);
});
test('pedido de canal com origem gravada de site conta pelo canal', async () => {
  const db = await banco();
  await inserirPedidos(db, [linha(['m99', '2026-03-04', 'Google Ads', 'pix', 'SP', 'Campinas', 'entrega', null, 0, [A1(1, 12345)]])].map((p) => ({ ...p, canal: 'Canal 3' })));
  const q = await pedir(db, `/api/vendas/quebra?${PERIODO}&por=origem`, quebra);
  assert.ok(q.corpo.itens.some((i) => i.chave === 'Canal 3'));
});
```
(Ajustar à forma real de `resumo`/`quebra` na resposta — mesmas chaves que os testes vizinhos usam.) Atualizar os testes existentes que filtram/esperam `Marketplace` para `Canal 2`.

- [ ] **Step 2: Rodar e ver falhar** — `npm test` → FAIL nos novos.
- [ ] **Step 3: Implementar** — `ORIGEM_SQL` exportada em `filtros.js`; `wherePedidos` usa `em(ORIGEM_SQL, f.origem)` para `origem` (os demais seguem `p.<coluna>`); `QUEBRAS.origem = ORIGEM_SQL`; `opcoes` usa `distintos(ORIGEM_SQL)` (conferir que `distintos` aceita expressão; senão, uma variante).
- [ ] **Step 4: Rodar e ver passar** — `npm test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "feat(api): marketplace como origem pelo nome do canal"`

### Task 2: Gaveta de categoria com produtos que subiram e caíram

**Files:**
- Create: `public/js/views/modal.js` (`abrirModal`, `pilhaModais`, `FOCAVEIS` movidos de `usuarios.js`, + `gavetaLeitura`)
- Modify: `public/js/views/usuarios.js` (importar de `modal.js`, sem mudar comportamento), `public/js/views/vendas.js` (`pintarQuebra`: `aoClicar` de `categoria` abre a gaveta), CSS só se precisar (`.gaveta` já existe; largura total ≤ 640 px)
- Test: `test/vendas-produtos.test.mjs`

**Interfaces:**
- Consumes: `/api/vendas/produtos?modo=subiram|caiu` (Task anterior da branch), `deltaPct`, `esc`.
- Produces: `gavetaLeitura({ titulo, html, gatilho, signal }) -> { corpo: HTMLElement, fechar(): void }` em `modal.js`; `htmlDetalheCategoria({ item, subiram, caiu, vv, temCmp, rotuloCmp }) -> string` exportada de `vendas.js` (`item` = linha da quebra: `chave, pedidos, valor?, cmpPedidos?, cmpValor?`; `subiram`/`caiu` = arrays da API ou `null` enquanto carrega).

- [ ] **Step 1: Testes que falham**

```js
const ITEM = { chave: '<b>"Cur"</b>', pedidos: 12, cmpPedidos: 10, valor: 50000, cmpValor: 40000 };
const P = (n, v) => ({ nome: `P${n}`, sku: String(n), varQtd: v });
test('htmlDetalheCategoria: top 5, escapa e mostra variação', () => {
  const h = htmlDetalheCategoria({ item: ITEM, subiram: [1, 2, 3, 4, 5, 6].map((n) => P(n, 10 * n)), caiu: [P(9, -50)], vv: true, temCmp: true, rotuloCmp: 'Período anterior' });
  assert.ok(!h.includes('<b>"Cur"</b>') && h.includes('&lt;b&gt;'));
  assert.ok(h.includes('P5') && !h.includes('P6'));
  assert.ok(h.includes('P9') && h.includes('Filtrar a página por esta categoria'));
  assert.ok(h.includes('R$'));
});
test('htmlDetalheCategoria: sem R$, sem comparação e lista vazia', () => {
  assert.ok(!htmlDetalheCategoria({ item: ITEM, subiram: [], caiu: [], vv: false, temCmp: true, rotuloCmp: 'x' }).includes('R$'));
  assert.ok(htmlDetalheCategoria({ item: ITEM, subiram: [], caiu: [], vv: true, temCmp: true, rotuloCmp: 'x' }).includes('Nenhum produto com variação.'));
  const sem = htmlDetalheCategoria({ item: ITEM, subiram: null, caiu: null, vv: true, temCmp: false, rotuloCmp: 'x' });
  assert.ok(sem.includes('Escolha uma comparação na barra para ver o que subiu ou caiu.'));
});
```

- [ ] **Step 2: Rodar e ver falhar** — `npm test` → FAIL (`htmlDetalheCategoria` não existe).
- [ ] **Step 3: Implementar** — mover `abrirModal`/`pilhaModais`/`FOCAVEIS` para `modal.js` e importar em `usuarios.js`; `gavetaLeitura` monta `.modal-fundo.gaveta-fundo > aside.gaveta[role=dialog]` com topo (título + ×) e corpo, fecha por ×/Esc/fundo e no `abort` do `signal`, devolve o foco ao `gatilho`. Em `vendas.js`, `aoClicar` de `categoria` (≠ `SEM_CHAVE`) abre a gaveta com `htmlDetalheCategoria(... subiram: null, caiu: null)` (estado "carregando"), busca `subiram` e `caiu` em paralelo com `{ ...ctx.filtros, categoria: [chave] }` e repinta o corpo; erro → texto de erro no corpo; o botão "Filtrar…" fecha e chama `ctx.aplicarFiltro('categoria', chave)`. Ignorar respostas se a gaveta já fechou.
- [ ] **Step 4: Rodar e ver passar** — `npm test` → PASS.
- [ ] **Step 5: Conferência local** — subir a prévia (`npx wrangler pages dev public --port 8796 --persist-to <Desktop>/vtex-painel/.wrangler/state`) e conferir: clique em categoria abre a gaveta com listas; Esc/×/fora fecham e o foco volta; "Filtrar…" filtra a página; outras barras filtram direto; origem mostra canais e o filtro Origem lista canais; tela de Usuários continua abrindo suas gavetas; 390 px sem rolagem lateral; 0 erros de console.
- [ ] **Step 6: Commit** — `git commit -m "feat(vendas): gaveta da categoria com produtos que subiram e caíram"`
