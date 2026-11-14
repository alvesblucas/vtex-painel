# Visual "Azul elétrico" — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: superpowers:subagent-driven-development. Passos com checkbox.

**Objetivo:** aplicar o visual "Azul elétrico" com essência Porsche, na dose "B · Equilíbrio", sobre a v0.2.0 sem mudar comportamento.

**Spec:** `docs/superpowers/specs/2026-11-14-visual-azul-design.md`. Ler inteira e abrir no navegador `docs/superpowers/specs/2026-11-14-visual-azul-mockup.html` (cartão B).

**Branch:** `feat/visual-azul`, a partir de `main` (v0.2.0).

## Global Constraints

- Commits só com autor **alvesblucas**, sem `Co-Authored-By` e sem menção a IA. Antes de cada commit, rodar `TERMOS_PROIBIDOS="<termos da instância>" node scripts/varrer-termos.mjs`; os termos vêm do controlador e nunca vão para arquivo.
- Repo público: dados fictícios (`Minha Loja`, `@exemplo.com`). Nenhum recurso externo em tempo de execução.
- Paleta e raios exatamente como em "Objetivos" da spec. Ajustes só para cumprir AA (texto ≥ 4,5:1, gráfico ≥ 3:1), registrados no topo do `app.css`.
- Sem busca, sem botões decorativos e sem conteúdo novo (ver "Não-objetivos").
- `movimento.js` e o rodapé ficam como estão. Todo movimento novo fica dentro de `@media (prefers-reduced-motion: no-preference)`. `npm test` verde.

## Review Focus

1. **Usuário sem R$, ou com poucas abas:** a lateral mostra só os grupos que têm itens, sem um grupo vazio com título.
2. **Morph dos KPIs:** continua funcionando. O ícone e a pílula novos não podem quebrar o reaproveitamento de `.card` (`pintarFileira`) nem duplicar `view-transition-name`.
3. **Sem `eu.nome`:** o cartão do usuário usa as iniciais do e-mail, e um e-mail longo quebra ou trunca sem rolagem horizontal.
4. **Celular a 360 px:** a lateral continua um menu que abre e fecha; os blocos ficam em 2 colunas (KPI) ou em 1; não há rolagem horizontal.
5. **Pílula de variação com `delta` nulo:** não aparece pílula vazia.

---

### Task 1: Tokens, lateral e cabeçalho

**Arquivos:**
- Criar: `public/js/icones.js`
- Modificar: `public/css/app.css`, `public/js/app.js` (`montarShell`: grupos, ícones, cartão do usuário; sobrelinha com a data), `test/ui.test.mjs` ou um teste novo

**Interfaces:**
- Produz: `icone(nome: string): string` (SVG inline, `aria-hidden="true"`) e `GRUPOS_ABAS = { principal: [...], operacao: [...], admin: ['usuarios'] }` em `icones.js` (ou em `estado.js`); `iniciais(nome?: string, email: string): string` em `ui.js`.

- [ ] **Passo 1:** Testes:
  - `iniciais('Maria Souza', 'm@x.com') === 'MS'`
  - `iniciais('', 'admin@exemplo.com') === 'AD'`
  - `icone('vendas')` contém `<svg` e `aria-hidden="true"`
  - `icone('inexistente') === ''`
- [ ] **Passo 2:** Implementar os tokens, a lateral com grupos (sem grupo vazio), o cartão do usuário e o cabeçalho (sobrelinha `PAINEL · DADOS ATÉ dd/mm` quando houver dado, título em peso 300, chips com raio de 8 px).
- [ ] **Passo 3:** `npm test` e varredura. Prints desktop e celular de Visão geral. Commit `feat(visual-azul): paleta, lateral com ícones e cabeçalho`.

### Task 2: Blocos, pílulas e gráficos

**Arquivos:**
- Modificar: `public/css/app.css`, `public/js/ui.js` (`cartaoHtml`: ícone opcional + delta como pílula), `public/js/graficos.js` (degradê na linha, área azul, cores de série), views (passar `icone` aos cartões)

**Interfaces:**
- Consome: `icone()` da Task 1.
- Muda: `cartao(el, {..., icone?: string})`. O delta vira `<span class="pill up|dn|wn">`, e com `delta` nulo não há pílula.

- [ ] **Passo 1:** Testes em `ui.test.mjs`:
  - `cartaoHtml` com `delta` positivo gera `class="pill up"`;
  - com `delta` nulo não gera `pill`;
  - com `icone: 'pedidos'` contém `<svg`.

  Os testes de `pintarFileira` existentes continuam passando.
- [ ] **Passo 2:** Implementar:
  - blocos com raio de 14 px;
  - hover dentro de `no-preference`;
  - gráficos com o degradê `#4f7cff` → `#8b5cf6` (gradient id único por gráfico) e a área;
  - o anterior em `#3a3f52` tracejado `3 5`;
  - novos × recorrentes em `#8b5cf6` / `#4f7cff`, validados com a skill `dataviz`;
  - pílulas também nos estados de Usuários e nos avisos de coleta.
- [ ] **Passo 3:** `npm test` e varredura. Prints desktop de Visão geral, Vendas, Clientes e Usuários (com a gaveta aberta), e celular de Vendas. Medir o morph Visão geral → Vendas com o script `vt.mjs` do scratchpad (≥ 300 ms, sem skip). Commit `feat(visual-azul): blocos, pílulas e gráficos`.

### Task 3: Fechamento

- [ ] **Passo 1:** Celular a 360 px em todas as telas, sem rolagem horizontal. Conferir com movimento reduzido e sem `startViewTransition`.
- [ ] **Passo 2:** Prints do README (`docs/prints/visao-geral.png`, `vendas.png`, `usuarios.png`, 1440×900, ≤ 400 KB).
- [ ] **Passo 3:** Versão `0.3.0` em `package.json` e `versao.js`. `npm test` e varredura. Commit `chore: v0.3.0 com o visual azul elétrico`. Sem tag e sem push.
