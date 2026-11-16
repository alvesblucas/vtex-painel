# Marketplaces na origem e produtos por categoria (aba Vendas) — design curto

## Por quê
Quem vende em vários marketplaces quer medir a performance de cada um separadamente, e hoje todos aparecem juntos
como "Marketplace". E, ao ver uma categoria crescer ou cair, quer saber quais produtos dela puxaram o movimento,
sem montar o filtro na mão.

## 1. Cada canal de marketplace como origem
- Origem efetiva = `p.origem` quando `p.canal` é o canal do site; senão, o nome do canal (`p.canal`).
  Calculado na consulta (expressão SQL única, ex.: `ORIGEM_SQL`), **sem gravar nada no banco** e valendo para todo o histórico.
- Vale em todo lugar onde a origem aparece ou filtra: barras "Por origem", filtro "Origem" da barra (`/api/opcoes`),
  `wherePedidos` (filtro `origem=`), e qualquer agregação por origem na Visão geral.
- Clientes novos x recorrentes não muda (só canal do site).
- Clicar em um marketplace em "Por origem" continua filtrando a página inteira (comportamento atual), o que dá a
  visão individual: resumo, série, categorias, marcas e produtos subiram/caíram daquele canal.
- O coletor não muda. O valor "Marketplace" deixa de aparecer nas telas.

## 2. Categoria → produtos que subiram e caíram
- Em "Por categoria", clicar numa barra abre uma **gaveta lateral** (no celular, tela cheia) em vez de filtrar direto:
  - título: a categoria; linha com Qtd/pedidos (e faturamento com `ver_valores`) atual x comparação e a variação;
  - duas listas: **5 que mais subiram** e **5 que mais caíram** nessa categoria (mesmo cálculo e mínimo de 3 pedidos
    da seção Produtos, respeitando os demais filtros da barra);
  - botão **"Filtrar a página por esta categoria"** (o comportamento antigo do clique) e fechar (Esc / fora / ×).
- Sem comparação na barra: a gaveta mostra só os números atuais e o aviso para escolher uma comparação.
- As demais barras (origem, marca, pagamento, UF, entrega) seguem filtrando direto.
- Reaproveita `/api/vendas/produtos?modo=subiram|caiu&categoria=…` (pega os 5 primeiros); sem endpoint novo.
- A gaveta que hoje vive em `usuarios.js` vai para um módulo compartilhado e é usada pelos dois.

## Permissões
Sem `ver_valores`: gaveta sem R$ e sem Var. preço (a API já remove).

## Abordagens consideradas
- Marketplaces: **calcular na consulta (escolhida)** x regravar o histórico (gasta a cota diária de gravações do D1)
  x filtro "Canal" separado (dois conceitos parecidos na barra).
- Categoria: **gaveta ao clicar (escolhida)** x expandir a barra dentro do cartão (aperta no celular) x só rolar até
  Produtos já filtrado (pouco evidente, que é o problema de hoje).

## Fica com quem constrói
Nome da expressão/constante, layout fino da gaveta, textos de carregamento/erro, foco e acessibilidade da gaveta
(seguir a de usuários).
