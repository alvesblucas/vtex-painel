# Visual escuro + movimento nativo — plano de implementação

> **Para agentes:** SUB-SKILL OBRIGATÓRIA: superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans, tarefa por tarefa. Passos com checkbox (`- [ ]`).

**Objetivo:** reestilizar todo o `public/` no visual "Escuro preciso" (referência Porsche escura) e acrescentar movimento nativo do navegador, sem mudar dados nem comportamento.

**Arquitetura:**
- Os tokens novos ficam em `public/css/app.css`.
- Um módulo `public/js/movimento.js` concentra todo o movimento, testável em Node sem DOM: View Transition, contagem de números, revelação de gráficos e checagem de movimento reduzido.
- `ui.cartao`, `graficos.linha/barras` e `app.rotear` passam a chamar esse módulo.
- O rodapé e a versão vêm de `ui.rodapeHtml()` e `public/js/versao.js`.

**Stack:** HTML/CSS/JS sem build (ES modules), `node:test`, Inter Tight auto-hospedada (OFL).

**Spec:** `docs/superpowers/specs/2026-11-14-visual-escuro-design.md`. Ler inteira, inclusive "Decisões complementares", e abrir no navegador `docs/superpowers/specs/2026-11-14-visual-escuro-mockup.html`.

**Branch:** `feat/visual-escuro`, a partir de `main` (312e97c).

## Global Constraints

- Commits só com autor **alvesblucas**, sem linha `Co-Authored-By` e sem menção a IA.
- Repo público: nada de empresa real. Dados de exemplo usam `Minha Loja` e `@exemplo.com`. Antes de cada commit, rodar `TERMOS_PROIBIDOS="<termos da instância>" node scripts/varrer-termos.mjs` → "Sem achados".
- Nenhum recurso externo em tempo de execução: fonte em `public/fonts/`, sem CDN.
- Paleta de referência:

  | Uso | Cor |
  |---|---|
  | Fundo | `#0e0e12` |
  | Texto | `#fbfcff` |
  | Texto secundário | `#88898c` |
  | Rodapé | `#6b6d70` |
  | Linhas | `#2a2b2f` |
  | Queda/erro | `#fc4040` |

  Ajustar só para cumprir AA (texto ≥ 4,5:1, gráfico ≥ 3:1) e registrar os valores no topo do `app.css`.
- Raio ≤ 4 px. Sem sombras coloridas, sem brilho, sem caixas nos KPIs: os KPIs se separam por linhas verticais de 1 px.
- Rodapé, exato: `Designed & developed by Lucas Alves`, com link para `https://github.com/alvesblucas`. À esquerda, `vtex-painel · v<VERSAO>`.
- Movimento:
  - View Transition ≤ 350 ms;
  - nenhuma animação de entrada passa de 900 ms;
  - nada espera `fetch`;
  - com `prefers-reduced-motion: reduce`, nada anima.
- Fallback: sem `document.startViewTransition` e sem `animation-timeline` (regras CSS dentro de `@supports`), tudo funciona igual, sem efeito.
- Sem tema claro, sem bibliotecas, sem mudança de API ou de comportamento das views.
- UI e comentários em português. `npm test` precisa ficar verde em toda tarefa.

## Review Focus

1. **Filtro trocado no meio da contagem** → o número termina no valor mais novo, sem "voltar" ao antigo. Teste na Task 2 (`contar` chamado duas vezes).
2. **Movimento reduzido ligado** → os números aparecem prontos, a troca de aba é instantânea e os gráficos surgem desenhados. Teste na Task 2 (`contar` e `trocarTela` com `reduzido: true`).
3. **Navegador sem View Transitions (Firefox)** → `trocarTela` chama a função na hora, de forma síncrona. Teste na Task 2.
4. **KPI sem dado** (`valor` nulo ou `'—'`) → mostra `—` sem tentar contar. Teste na Task 2 (`cartao` sem `numero`).
5. **Celular a 360 px** → o rodapé quebra em duas linhas, sem rolagem horizontal da página. Conferido por print na Task 5.

---

### Task 1: Fundação (fonte, tokens, shell, rodapé e versão)

**Arquivos:**
- Criar: `public/fonts/inter-tight-{300,400,500,600}.woff2`, `public/fonts/OFL.txt`, `public/js/versao.js`, `test/versao.test.mjs`
- Modificar: `public/css/app.css` (tokens, `@font-face`, base, shell, barra de filtros), `public/js/ui.js` (+`rodapeHtml`), `public/js/app.js` (rodapé em `montarShell` e `telaSimples`; sobrelinha "Painel" acima do título), `public/js/barra-filtros.js` (só classes, se precisar), `test/ui.test.mjs`

**Interfaces:**
- Produz:
  - `export const VERSAO: string` em `versao.js`;
  - `rodapeHtml(): string` em `ui.js`;
  - tokens CSS que as outras tarefas usam:
    - cores: `--ground`, `--text`, `--muted`, `--rule`, `--bad`, `--warn`, `--serie`, `--serie-ref`, `--cat-novo`, `--cat-rec`;
    - fonte: `--sans: "Inter Tight", system-ui, …`;
    - movimento: `--ease-peso: linear(…)` (mola que freia sem passar do alvo) e `--dur-curta: 250ms`, `--dur-media: 600ms`, `--dur-longa: 900ms`.

- [ ] **Passo 1:** Baixar a Inter Tight latin (300/400/500/600, woff2) e a licença OFL do pacote `@fontsource/inter-tight` (npm ou jsDelivr) para `public/fonts/`. Conferir que cada arquivo tem menos de 40 KB.
- [ ] **Passo 2:** Escrever testes que falham:
  - `test/versao.test.mjs` — `VERSAO` é igual a `JSON.parse(package.json).version`.
  - `test/ui.test.mjs`, teste `rodapeHtml`:
    - contém `Designed &amp; developed by Lucas Alves`;
    - contém `href="https://github.com/alvesblucas"` com `rel="noopener"` e `target="_blank"`;
    - contém `vtex-painel · v${VERSAO}`.
- [ ] **Passo 3:** `npm test` → FALHA (módulo e função não existem).
- [ ] **Passo 4:** Implementar `versao.js`, `rodapeHtml()` e o novo `app.css`, seguindo a mockup:
  - lateral com marca em caixa alta espaçada e itens com sublinhado deslizante (`transform: scaleX`);
  - topo com sobrelinha pequena em caixa alta + título de 40 px, peso 400;
  - filtros como texto com valor em 500 e sublinhado.

  O rodapé `<footer class="rodape">` vai como último filho de `.principal` (depois de `#conteudo`) e dentro de `.cartao-central` nas telas simples.
- [ ] **Passo 5:** `npm test` → PASSA; varredura → sem achados.
- [ ] **Passo 6:** Commit `feat(visual): fonte, tokens, shell e rodapé`.

### Task 2: Módulo de movimento

**Arquivos:**
- Criar: `public/js/movimento.js`, `test/movimento.test.mjs`
- Modificar: `public/js/app.js` (`rotear`), `public/js/ui.js` (`cartao`), `public/js/graficos.js` (`linha`, `barras`), `public/css/app.css` (`::view-transition-*`, entrada pela rolagem em `@supports (animation-timeline: view())`)

**Interfaces:**
- Produz, em `movimento.js`. Nenhum acesso a `window`/`document` no topo do módulo: o ambiente vem por parâmetro, com padrão lido dentro da função.
  - `reduzido(): boolean` — `matchMedia('(prefers-reduced-motion: reduce)')`; `false` se não houver `window`.
  - `trocarTela(atualizar: () => void, { doc = globalThis.document, reduzido: r = reduzido() } = {}): void`
    - chama `doc.startViewTransition(atualizar)` só se existir e se `!r`;
    - senão, chama `atualizar()` na hora.
  - `progresso(t: number): number` — ease-out quartic `1 - (1 - t)^4`, com `t` limitado a [0, 1].
  - `contar(el, ate: number, formatar: (n) => string, { de = Number(el.dataset.valor) || 0, duracao = 900, reduzido: r = reduzido(), raf = globalThis.requestAnimationFrame, agora = () => performance.now() } = {}): void`
    - grava `el.dataset.valor = ate`, cancela a contagem anterior do mesmo `el` (token em `el._contagem`) e escreve `formatar(...)` em `el.textContent` a cada quadro;
    - com `r` ou sem `raf`, escreve `formatar(ate)` direto.
  - `revelarLinha(svg: SVGElement, { reduzido }): void` — `stroke-dasharray`/`dashoffset` via `Element.animate` (≤ 900 ms) no traço principal, e a área com fade depois.
  - `crescerBarras(el: Element, { reduzido }): void` — as barras animam `transform: scaleX(0 → 1)` com atraso escalonado de até 40 ms × índice, total ≤ 900 ms.
- Consome: `--ease-peso` e `--dur-*` da Task 1. Para ler a curva no JS: `getComputedStyle(document.documentElement).getPropertyValue('--ease-peso')`, com `'ease-out'` como fallback.
- Muda em `ui.js`: `cartao(el, { rotulo, valor, sub, delta, chave?, numero?, formatar? })`
  - com `chave`, aplica `el.style.viewTransitionName = 'kpi-' + chave`;
  - com `numero` finito e `formatar`, chama `contar(valorEl, numero, formatar)`;
  - senão, mostra `valor ?? '—'` como hoje.
- Muda em `app.js`, `rotear`: na troca de aba, o trecho que define o título, marca o menu, limpa `#conteudo` e mostra o carregando vai dentro de `trocarTela(() => { … })`. `#titulo` ganha `view-transition-name: titulo`. Nada de `await` dentro da callback.

- [ ] **Passo 1:** Escrever `test/movimento.test.mjs`. Ambientes falsos: `el = { textContent: '', dataset: {} }` e um `raf` manual que guarda os callbacks. Testes:
  - importar o módulo sem `document`/`window` não lança;
  - `progresso(0) === 0`, `progresso(1) === 1`, `progresso(2) === 1`, `progresso(0.5) > 0.5`;
  - `trocarTela(fn, { doc: {} })` chama `fn` uma vez, sincronamente;
  - `trocarTela(fn, { doc: { startViewTransition: spy } })` chama o `spy` com `fn`;
  - com `reduzido: true`, não chama o `spy` e chama `fn`;
  - `contar(el, 1258, String, { reduzido: true })` → `el.textContent === '1258'` na hora;
  - **Review Focus 1:**
    - `contar(el, 100, String, { raf, agora })`;
    - avançar meio quadro;
    - `contar(el, 50, String, { raf, agora })`;
    - esgotar todos os quadros → `el.textContent === '50'`.
  - `contar` sem `raf` → valor final na hora.
- [ ] **Passo 2:** Em `test/ui.test.mjs`, **Review Focus 4**: `cartao` com `valor: null` e sem `numero`, num elemento falso com `innerHTML`/`querySelector` mínimos, resulta em `—`. Se `cartao` exigir DOM real demais, extrair `cartaoHtml({…}): string` puro em `ui.js` e testar esse.
- [ ] **Passo 3:** `npm test` → FALHA.
- [ ] **Passo 4:** Implementar `movimento.js` e as integrações em `ui.js`, `graficos.js`, `app.js` e no CSS:
  - `::view-transition-old/new(root)` com cross-fade de `--dur-curta`;
  - `::view-transition-group(titulo)` e `::view-transition-group(kpi-*)` com `--ease-peso`, no máximo 350 ms;
  - `.secao` entra com `opacity 0 → 1` e `translateY 14px → 0` via `animation-timeline: view()` dentro de `@supports`;
  - tudo dentro de `@media (prefers-reduced-motion: no-preference)`.
- [ ] **Passo 5:** `npm test` → PASSA; varredura → sem achados.
- [ ] **Passo 6:** Commit `feat(visual): movimento nativo (troca de aba, contagem e gráficos)`.

### Task 3: Telas de dados (Visão geral, Vendas, Clientes, gráficos e tabela)

**Arquivos:**
- Modificar: `public/js/views/visao.js`, `vendas.js`, `clientes.js` (só passar `chave`/`numero`/`formatar` aos cartões e classes de seção), `public/js/graficos.js` (cores e traços), `public/css/app.css` (KPIs, seções, gráficos, legenda, tabela, avisos, estados carregando/vazio/erro)

**Interfaces:**
- Consome: `cartao({ chave, numero, formatar })` da Task 2.
- Chaves de morph, exatas, iguais em Visão geral e Vendas: `faturamento`, `pedidos`, `ticket`. As outras métricas não recebem `chave`.

- [ ] **Passo 1:** Carregar a skill `dataviz` e validar a paleta escura com o validador e a referência dela:
  - `--serie` ≈ `#fbfcff` (traço de 1,5 px);
  - `--serie-ref` cinza tracejado `3 5`;
  - `--cat-novo` / `--cat-rec`: duas tonalidades distinguíveis no fundo `#0e0e12` e com rótulo, nunca só cor;
  - `--bad` `#fc4040`; `--warn` âmbar discreto.

  Registrar o resultado no comentário do topo do `app.css`.
- [ ] **Passo 2:** Aplicar o visual da mockup:
  - KPIs em grade sem caixa, com rótulo em caixa alta 12 px, valor em Inter Tight 300, 34 px, `tabular-nums` e variação abaixo;
  - seções planas com linha superior de 1 px e cabeçalho em caixa alta;
  - tabela com linhas de 1 px, cabeçalho em caixa alta e hover discreto;
  - aviso amarelo como faixa fina com borda esquerda.
- [ ] **Passo 3:** Passar `chave`/`numero`/`formatar` nos cartões das três views. O `formatar` usa os formatadores que já existem (`brl`, `int`, porcentagem).
- [ ] **Passo 4:** `npm test` → PASSA; varredura → sem achados.
- [ ] **Passo 5:** Prints desktop (1440×900) das três abas com `npm run semear` + `npm run dev` e `DEV_EMAIL=admin@exemplo.com` em `.dev.vars`. Usar puppeteer-core 22.15.0 instalado fora do repo, o Chrome do sistema e `waitUntil: 'domcontentloaded'` + espera pelo conteúdo. Conferir: sem caixas nos KPIs, números legíveis, gráfico atual branco e anterior cinza tracejado. Encerrar o servidor.
- [ ] **Passo 6:** Commit `feat(visual): telas de vendas, clientes e visão geral`.

### Task 4: Administração e telas auxiliares

**Arquivos:**
- Modificar: `public/css/app.css` (gaveta, modais, `alertdialog`, campos, selects, checkboxes, botões, pílulas de abas, abas internas, paginação), `public/js/views/usuarios.js` / `em-breve.js` / `sem-acesso.js` (só classes, se precisar)

**Interfaces:**
- Consome: tokens da Task 1, `--ease-peso` e `reduzido` da Task 2.
- Princípios da spec, item 1 de "Decisões complementares":
  - superfícies planas e linhas de 1 px;
  - controles com borda fina ou sublinhado;
  - raio ≤ 4 px;
  - foco de teclado sempre visível: contorno de 2 px em `--text` com offset de 2 px;
  - gaveta entra pela direita (`translateX`) com `--ease-peso` em ≤ 350 ms; modal com fade e escala de 0,98 → 1.

- [ ] **Passo 1:** Aplicar o visual. Checkbox de 3 estados (herdado/liberado/bloqueado) com os três estados distinguíveis sem depender só de cor.
- [ ] **Passo 2:** `npm test` → PASSA (inclui `api-admin`, sem regressão); varredura → sem achados.
- [ ] **Passo 3:** Prints desktop de Usuários (Pessoas com a gaveta aberta, Perfis, Histórico), "em breve" e "sem acesso". Teclado: Tab percorre a gaveta, Esc fecha, o foco volta e o anel aparece em todos os controles. Encerrar o servidor.
- [ ] **Passo 4:** Commit `feat(visual): usuários, gaveta, modais e telas auxiliares`.

### Task 5: Verificação final, prints do README e versão 0.2.0

**Arquivos:**
- Modificar: `docs/prints/*.png`, `README.md` (seção de prints, se mudar algo), `package.json` e `public/js/versao.js` (`0.2.0`)

- [ ] **Passo 1:** Prints celular (360×780) de todas as telas → sem rolagem horizontal; rodapé em 2 linhas (**Review Focus 5**); menu lateral abre e fecha.
- [ ] **Passo 2:** Movimento, no Chrome:
  - trocar Visão geral → Vendas: o título e os 3 KPIs fazem morph;
  - trocar o filtro de período: os números contam até o valor novo;
  - capturar 3 quadros da troca (0, 150 e 350 ms) para o relatório.
- [ ] **Passo 3:** Com `page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }])`: troca instantânea e números finais na hora.
- [ ] **Passo 4:** Fallback: a mesma navegação com `document.startViewTransition` removido via `evaluateOnNewDocument` → sem erros no console e telas iguais.
- [ ] **Passo 5:** Substituir os prints do README (`visao-geral.png` com gráfico visível, `vendas.png`, `usuarios.png`). Só dados fictícios.
- [ ] **Passo 6:** Versão `0.2.0` em `package.json` e `versao.js`; `npm test` → PASSA (inclui `versao.test`); varredura → sem achados.
- [ ] **Passo 7:** Commit `chore: v0.2.0 com o visual escuro`. **Não** criar tag, não fazer push e não mexer em `PAINEL_VERSAO`: publicar e atualizar a instância dependem do OK do dono.
