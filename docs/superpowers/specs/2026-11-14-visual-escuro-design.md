# Visual "Escuro preciso" + movimento nativo — design

Data: 2026-11-14 · Produto: `vtex-painel` (app estático em `public/`, sem build)

## Intenção

O dono do produto quer o painel **mais profissional, elegante, futurista e fluido**. Referência escolhida: a linguagem visual das páginas de carro da Porsche, em versão escura. A referência é de estilo; não se usa marca, logo nem fonte da Porsche.

- O tom é de engenharia e sobriedade. Quase não há cor, a tipografia é grande e fina, as linhas são finas e há muito respiro.
- O movimento deve parecer "peso e precisão": suave, freando no fim, nunca brilho ou enfeite.
- O dono escolheu a mockup "A · Escuro". Ela é a referência visual deste documento: `docs/superpowers/specs/2026-11-14-visual-escuro-mockup.html` (abrir no navegador; tem dados fictícios).

## Objetivos

1. **Reestilizar o app inteiro** com a nova linguagem:
   - telas: shell, barra de filtros, Visão geral, Vendas, Clientes, Usuários e permissões, "em breve", "sem acesso", estados de carregando/vazio/erro, gaveta e modais;
   - componentes: tabelas, gráficos e avisos.
2. **Movimento nativo** (abordagem 1, escolhida pelo dono):
   - **View Transitions API**: troca de aba no menu, com o título e a área de conteúdo em transição contínua. Os cartões de KPI que existem nas duas telas fazem "morph" usando `view-transition-name`.
   - **Curvas com `linear()`**: easing tipo mola com peso, definido em tokens CSS.
   - **Web Animations API**:
     - números dos KPIs contam do valor anterior até o novo, ao abrir e quando um filtro muda;
     - a linha do gráfico se desenha ao entrar e a área preenche depois;
     - as barras crescem a partir do zero.
   - **Animações guiadas pela rolagem** (`animation-timeline: view()`): seções abaixo da dobra entram com fade e leve subida.
   - **Microinterações**: o sublinhado deslizante no menu e nos filtros e o leve deslocamento no hover dos KPIs seguem a mockup.
3. **Rodapé fixo do produto**, em inglês: `Designed & developed by Lucas Alves`, com link para `https://github.com/alvesblucas`.
   - À esquerda vai `vtex-painel · v<versão>`, lida de um único lugar, sem duplicar a versão do `package.json` à mão em vários arquivos.
   - É crédito do autor do produto open source, então vale em toda instância.

## Não-objetivos

- Tema claro ou alternância claro/escuro.
- Mudanças de API, dados, permissões, filtros ou comportamento das views. O trabalho é só apresentação.
- Bibliotecas de animação (GSAP etc.), WebGL/3D, partículas e brilhos.
- Novas abas ou conteúdos.

## Antiobjetivos (falha mesmo que "funcione")

- **Movimento que atrasa a leitura**:
  - nenhuma animação de entrada passa de ~900 ms;
  - nenhuma bloqueia clique ou rolagem;
  - a troca de aba não fica mais lenta que hoje.
- **Movimento sem opção de desligar**: com `prefers-reduced-motion: reduce`, o app não anima. A troca de aba é instantânea, os números aparecem prontos e os gráficos surgem já desenhados.
- **Números ilegíveis**: contraste abaixo de AA, cor como único portador de significado, valores que "pulam" de largura (manter `tabular-nums`).
- **Regressão funcional**: qualquer teste existente falhando, foco de teclado invisível, acessibilidade dos modais e da gaveta piorada.
- **Recurso externo em tempo de execução**, como uma fonte de CDN. O app hoje não carrega nada de fora e deve continuar assim.
- **Navegador sem suporte quebrando**: sem View Transitions ou `animation-timeline`, tudo funciona sem efeito.

## Restrições

- Sem build: o HTML, CSS e JS de `public/` continuam servidos como estão (ES modules).
- **Fonte**: Inter Tight (licença OFL), pesos 300, 400, 500 e 600, auto-hospedada em `public/fonts/` como `woff2` com `font-display: swap`.
  - O arquivo de licença OFL vai junto.
  - Os números grandes usam Inter Tight 300 com `tabular-nums`. A monoespaçada atual sai dos KPIs e pode ficar em tabelas, se o builder achar melhor.
- **Gráficos** seguem a skill `dataviz`:
  - série atual em branco quase puro, período anterior em cinza tracejado;
  - categorias (ex.: novos × recorrentes) com duas tonalidades distinguíveis, validadas com o `validate_palette.js` da skill, mais rótulo ou padrão, nunca só cor;
  - vermelho reservado para queda ou erro, e um âmbar discreto para aviso.
- **Paleta de referência** (da mockup):

  | Uso | Cor |
  |---|---|
  | Fundo | `#0e0e12` |
  | Texto | `#fbfcff` |
  | Texto secundário | `#88898c` |
  | Rodapé | `#6b6d70` |
  | Linhas | `#2a2b2f` |
  | Queda | `#fc4040` |

  O builder ajusta para AA, onde for preciso, e registra no topo do `app.css`.
- Repositório público: nada da instância de nenhuma empresa no código, nos prints ou na doc. A varredura `scripts/varrer-termos.mjs` precisa passar.
- `.superpowers/` vai para o `.gitignore`.
- Celular: o layout atual já responde. A nova linguagem precisa funcionar a partir de 360 px, sem rolagem horizontal da página.

## Abordagens consideradas

1. **Recursos nativos do navegador** (escolhida): View Transitions, `linear()`, Web Animations API e scroll-driven animations. Não acrescenta peso nem build e combina com um produto open source e sem dependências. A desvantagem é o suporte desigual entre navegadores, coberto pelo fallback sem efeito.
2. **GSAP via CDN**: dá mais controle cinematográfico (SplitText, Flip). Custa ~70 KB, uma dependência externa e uma licença a acompanhar. Fica como reforço futuro se faltar algo.
3. **WebGL/Three.js**: descartada. É pesada, distrai de números e foge do tom sóbrio.

## Decidido com o dono

- Estilo: escuro inspirado na Porsche (mockup A).
- Movimento: abordagem 1, nativa.
- Rodapé em inglês com o texto acima.

## Fica a critério do builder

- A organização do CSS: manter um `app.css` ou dividir em `tokens.css`, `base.css` e `componentes.css`, sem build.
- O nome e o formato de um pequeno módulo de movimento, por exemplo `public/js/movimento.js`. Ele deve conter:
  - `trocarTela(fn)` com View Transition e fallback;
  - `contar(el, de, ate, formatar)`;
  - `revelarGrafico(svg)`;
  - checagem central de `prefers-reduced-motion`.
- As durações exatas e as curvas `linear()`, dentro dos limites acima.
- Como ler a versão para o rodapé (ex.: constante gerada pelo teste, ou `package.json` lido no deploy); um teste deve garantir que ela bate com o `package.json`.
- Ajustes de espaçamento por tela, mantendo a hierarquia da mockup:
  - título grande e fino com sobrelinha pequena em caixa alta;
  - filtros como texto com sublinhado;
  - KPIs separados por linhas verticais finas, sem caixas.
- **Verificação**: prints desktop e celular de todas as telas com `scripts/semear-local.mjs` + `wrangler pages dev`, mais um vídeo curto ou uma sequência de prints da troca de aba. Conferir também com movimento reduzido.

## Decisões complementares (revisão do builder, chamadas do autor do design)

1. **Mockup**: a versão da opção A, sem dados reais, está versionada (ver Intenção). O builder extrapola para telas que ela não mostra (gaveta, modais, formulários, selects, checkboxes, tabelas, avisos) com o mesmo rigor. Princípios:
   - superfícies planas;
   - linhas de 1 px em `#2a2b2f`;
   - controles com sublinhado ou borda fina;
   - nada de sombras coloridas;
   - raio pequeno (≤ 4 px).

   O dono aprova pelos prints.
2. **Morph entre abas**: o par real é Visão geral ↔ Vendas, que compartilham Faturamento, Pedidos e Ticket médio. A correspondência é **por métrica**, com `view-transition-name: kpi-faturamento` e similares, e o título usa `view-transition-name: titulo`. Nas demais trocas de aba há só o cross-fade do conteúdo, com o menu e a lateral parados.
3. **Transição × dados**: a transição **não espera a API**. Ela captura a nova tela já no estado de carregando, então a troca é instantânea. Quando os dados chegam, os números contam e os gráficos se desenham. Para "não ficar mais lenta que hoje", a View Transition dura no máximo 350 ms e a mudança de rota nunca aguarda `fetch`.
4. **Versão e rodapé**:
   - `public/js/versao.js` (`export const VERSAO = '0.1.0'`) é versionado, e um teste em Node garante que ele é igual ao `package.json`.
   - O rodapé fica **no fim da área de conteúdo**, não fixo no viewport.
   - Ele aparece em todas as telas do app, inclusive "sem acesso", erro e "em breve".
5. **Navegadores**: o alvo de verificação é Chrome/Edge atuais, que suportam todos os efeitos. O fallback é conferido uma vez no Firefox: tudo funciona sem View Transition e sem `animation-timeline`. Essas regras ficam dentro de `@supports`, e o JS testa `document.startViewTransition` antes de usar.
6. **Séries dos gráficos** (`public/js/graficos.js`):
   - Hoje existem só a `serie` (período), a `ref` (comparação) e o par novos × recorrentes de Clientes.
   - Nas barras (origem, categoria, marca), todas as barras usam a cor da série e a comparação é um marcador.
   - Não há paleta categórica maior.
7. **Validação de cor**: carregar a skill `dataviz` e usar o validador e a referência de paleta dela. Se não estiverem disponíveis, conferir o contraste WCAG por conta própria (texto ≥ 4,5:1, elementos gráficos ≥ 3:1) e registrar os valores no topo do `app.css`.
8. **Testes**:
   - Os testes atuais são `node:test` de lógica pura, com `test/ui.test.mjs` cobrindo partes de `ui.js`.
   - `movimento.js` não pode tocar em `document`/`window` no topo do módulo: só dentro das funções, e com guarda.
   - Se algum teste afirmar markup ou classes que mudarem, ajustar o teste junto, sem perder o que ele verifica.
