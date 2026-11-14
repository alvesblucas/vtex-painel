# Visual "Azul elétrico" com essência Porsche — design

Data: 2026-11-14 · Produto: `vtex-painel` · Evolui `2026-11-14-visual-escuro-design.md` (v0.2.0)

## Intenção

O dono achou a v0.2.0 "crua". Ele quer a estrutura de um dashboard SaaS profissional, a partir de uma imagem de referência:
- lateral com ícones e grupos;
- dados em blocos;
- pílulas;
- paleta "Azul elétrico".

Tudo isso sem perder a essência Porsche:
- tipografia grande e fina;
- sobrelinhas em caixa alta espaçada;
- linhas finas;
- movimento sóbrio.

A dose escolhida foi a **"B · Equilíbrio"**. A referência visual aprovada está em `docs/superpowers/specs/2026-11-14-visual-azul-mockup.html`: abrir no navegador, cartão B, com a classe `dB`.

## Objetivos

1. **Paleta "Azul elétrico".** Os tokens de `app.css` são trocados:

   | Token | Valor |
   |---|---|
   | fundo | `#08090d` |
   | lateral | `#0a0b10` |
   | bloco | `#0e1017` |
   | hover | `#141722` |
   | linhas | `#1c1f2b` / `#262a38` |
   | texto | `#f1f3f9` |
   | secundário | `#8a90a6` |
   | acento | `#4f7cff` → `#8b5cf6` (degradê) |
   | alta | `#34d399` |
   | queda | `#f87171` |
   | atenção | `#fbbf24` |

   - Há um brilho azul sutil no topo do conteúdo (`radial-gradient`, opacidade ≤ 0,13).
   - Ajustes só para cumprir AA, registrados no topo do `app.css`. Validar a paleta de dados com a skill `dataviz`.
2. **Lateral no estilo da referência:**
   - marca em caixa alta espaçada, com um ponto em degradê;
   - grupos `PRINCIPAL` (Visão geral, Vendas, Clientes), `OPERAÇÃO` (Estoque, Pedidos, Avaliações, Preços e Outlet, Saúde) e `ADMINISTRAÇÃO` (Usuários e permissões), mais "Relatórios antigos" no fim da navegação;
   - ícones de linha de 16 px por aba, em SVG inline, sem biblioteca;
   - item ativo com fundo em degradê azul suave e uma barra de 2 px em degradê à esquerda;
   - pílula "EM BREVE" contornada;
   - cartão do usuário no pé da lateral: avatar com as iniciais em degradê, nome e perfil, no lugar do e-mail solto.
3. **Blocos:**
   - KPIs, seções de gráfico e tabela viram blocos com fundo `#0e1017`, borda de 1 px e raio de 14 px;
   - botões, chips e campos têm raio de 8 px;
   - cada KPI tem rótulo em caixa alta espaçada, um ícone pequeno contornado (acento) à direita, número em Inter Tight 300 com cerca de 30 px e uma **pílula** de variação (alta, queda ou atenção, com fundo translúcido) seguida de "vs anterior";
   - hover no bloco: sobe 3 px e a borda ganha o acento, só com movimento permitido.
4. **Cabeçalho:**
   - sobrelinha `PAINEL · DADOS ATÉ dd/mm` (a data vem do mesmo dado do aviso de coleta), título de 38 px em peso 300 e subtítulo da aba;
   - filtros como chips com borda e raio de 8 px, mantendo o comportamento atual;
   - o botão principal da barra de filtros (se existir) usa o degradê.
5. **Gráficos:**
   - linha do período em degradê azul → violeta com 2 px e área azul suave;
   - período anterior tracejado em cinza `#3a3f52`;
   - barras na cor do acento, com a comparação como marcador;
   - novos × recorrentes (Clientes) em violeta `#8b5cf6` e azul `#4f7cff`, com rótulo, nunca só cor.
6. **Pílulas** passam a ser o padrão para variações e status já existentes: deltas, estados de coleta, ativo/inativo e perfil em Usuários.

## Mantém (da v0.2.0)

- Inter Tight auto-hospedada.
- O módulo `movimento.js` inteiro: troca de aba com morph dos KPIs, contagem, revelação de gráficos, entrada por rolagem e movimento reduzido.
- O rodapé `Designed & developed by Lucas Alves` com a versão.
- Os limites de movimento, AA, fallback e "nenhum recurso externo".

## Não-objetivos

- **Não há busca no topo, nem botões de ícone sem função**: a referência mostra, mas o produto não tem busca. Não se cria nada decorativo que pareça clicável.
- **Nada de conteúdo novo**:
  - sem rosca em Vendas;
  - sem coluna "sinal" na tabela de produtos;
  - pílulas só para estados que já existem;
  - se a aba Clientes já mostra novos × recorrentes como barras ou cartões, pode virar rosca só se for a mesma informação.
- Tema claro, bibliotecas, mudança de API ou de comportamento.

## Restrições

- Repo público: dados fictícios. Rodar a varredura de termos antes de cada commit.
- A versão sobe para `0.3.0` no fim.
- Contraste AA, `prefers-reduced-motion` e fallback continuam valendo como na v0.2.0. Todo o movimento novo (hover dos blocos) fica dentro de `no-preference`.

## Abordagens

- **A · "Mais Porsche"** (cantos de 4–6 px, blocos transparentes) e **B · "Equilíbrio"** (blocos sólidos, raio de 8–14 px): o dono escolheu B.
- Paletas avaliadas:
  - Cyber ciano
  - Aurora
  - Laranja sinal
  - **Azul elétrico (escolhida)**
  - Holográfico
  - Volt
- Implementação: CSS sobre a estrutura atual, mais pequenas mudanças de markup na lateral (ícones, grupos, cartão do usuário) e nos cartões (ícone, pílula). Sem reescrever views.

## A critério do builder

- Desenho exato de cada ícone (traço de 1,5 px, 24×24) e onde guardá-los, por exemplo em `public/js/icones.js`.
- Se a aba Clientes ganha rosca: só se for a mesma informação, e por decisão de quem implementa, com dataviz.
- Ajustes finos de espaçamento seguindo o mockup B.
