# Produtos que subiram e caíram (aba Vendas) — design curto

## Por quê
A tabela "Produtos" da aba Vendas mostra o que mais vendeu, mas não diz o que mudou. Quem acompanha a loja quer ver
rápido quais produtos ganharam ou perderam volume e se o preço médio pago mudou. Esse dado não vem pronto da
plataforma de e-commerce, e um painel anterior já o oferecia.

## O que muda
- A seção "Produtos" ganha 3 abas: **Mais vendidos** (a tabela atual, sem mudança), **Subiram** e **Caíram**.
- Subiram/Caíram comparam o período da barra com o período de comparação que a barra já define (`cmp`:
  período anterior ou ano anterior, via `periodoComparacao`). Nenhuma referência fixa de data.
- Colunas: Produto, SKU, Marca, Categoria, Qtd (atual), Antes (qtd na comparação), Var. % (quantidade),
  Var. preço % (preço médio pago por unidade, atual vs comparação), Faturamento (só com `ver_valores`).
- Volume mínimo: só entram produtos com **3+ pedidos no período de comparação** (evita ruído de quem vendia 1 unidade).
  Produtos sem venda na comparação não entram em "Subiram" (sem base não há variação); aparecem em Mais vendidos.
- Ordem: Subiram por Var. % desc; Caíram por Var. % asc (inclui quem foi a zero, -100%).
- Os filtros da barra (canal, origem, marca, categoria, pagamento, região, entrega) valem para os dois períodos.
- CSV e paginação no servidor, como a tabela atual.
- Sem coleta nova nem migração: usa `pedidos` + `itens` já gravados.

## Permissões
Perfis sem `ver_valores`: sem coluna Faturamento; Var. preço % também some (é derivada de R$). A varredura de
vazamento dos testes de API cobre o endpoint novo.

## Abordagens consideradas
1. **Comparação da barra (escolhida):** reaproveita o filtro existente, funciona para qualquer período e para qualquer loja.
2. Referência fixa ("antes de uma data de mudança"): servia a um caso pontual; não generaliza para o produto.
3. Média de N semanas anteriores: mais estável, mas cria um segundo conceito de comparação ao lado do da barra.

## Fica com quem constrói
Nome e forma do endpoint (sugestão: `/api/vendas/produtos?modo=subiram|caiu`), índices se a consulta pesar,
textos de ajuda e estado vazio.
