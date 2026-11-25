# Campanhas na aba Clientes (v0.6.0) e servidor MCP do painel (v0.7.0) — design

## Por quê
- **Campanhas:** quem roda Google Ads (e outros canais com UTM) quer saber **quantos clientes novos cada campanha
  trouxe**, para o relatório de mídia e para decidir verba. O painel estático anterior tinha essa visão (por
  `utm_source / utm_campaign`); a v2 não migrou. Os dados já estão no D1 (`pedidos.utm_*` e `cliente_tipo`).
- **MCP:** o dono do painel quer pedir análises a um assistente de IA (Claude / Cowork) **sem exportar nada**:
  "compare esta semana com a anterior por categoria", "quais campanhas trouxeram mais clientes novos", leituras
  gerais para tomada de decisão. O assistente consulta o painel direto, com as mesmas permissões da pessoa logada.

Ordem decidida: **painel primeiro (v0.6.0), MCP depois (v0.7.0)**. A visão de campanhas existe nos dois.

## Objetivos
1. Bloco **Campanhas** na aba Clientes: novos x recorrentes (e receita, com `ver_valores`) por origem → campanha.
2. Endpoint **`/mcp`** (MCP, transporte Streamable HTTP) no mesmo projeto Pages, só leitura, com ferramentas que
   cobrem o que as abas Vendas e Clientes mostram + campanhas + um resumo geral.
3. Login do MCP pelo **Cloudflare Access** (mesma política de e-mails do painel) e mesmas regras de perfil:
   abas permitidas e R$ só para quem tem `ver_valores`.

## Não objetivos
- Escrever qualquer coisa pelo MCP (usuários, perfis, ajustes, coletas). Só leitura.
- SQL livre pelo MCP.
- Estoque, saúde, avaliações, outlet, pedidos: entram no MCP quando a fase 2/3 povoar essas tabelas (mesmo padrão).
- Dados de custo/cliques do Google Ads (exigem credencial da API do Ads) — fora deste escopo.
- Clientes de marketplace (não têm `cliente_tipo`; classificação só vale para o canal do site).

## Anti-objetivos (falharia mesmo funcionando)
- O MCP estourar a cota diária de leituras do D1 Free (5 mi linhas) e derrubar o painel do navegador.
- O MCP mostrar R$ a um perfil sem `ver_valores`, ou dados de uma aba que o perfil não tem.
- Um link/token que funcione sem login de uma pessoa identificada.

## Restrições
- Cloudflare Free: D1 com 5 mi leituras e 100 mil gravações/dia; Pages Functions (Workers Free, 100 mil req/dia).
- Repositório público MIT: nada específico de uma loja no código nem nos testes (nomes de campanha nos testes são
  fictícios).
- Sem dependências novas pesadas; o projeto não tem bundler além do das Pages Functions.

## Parte 1 — Bloco "Campanhas" (aba Clientes, v0.6.0)

### Dados
- Universo: igual ao de clientes hoje — canal do site, não cancelados, `cliente_tipo` em (novo, recorrente),
  respeitando todos os filtros da barra (período, origem, categoria/marca, pagamento, UF, entrega).
- Agrupamento: **origem efetiva** (`ORIGEM_SQL`, já classificada pelas regras `origens` do config, ex.: "Google
  Ads") → **campanha** = `utm_campaign`; vazio vira "(sem campanha)".
- Por linha: `novo`, `recorrente` (pedidos distintos), `valor` (receita, removida por `semValores`), e na
  comparação o `novo` do período de comparação (para mostrar a variação de novos).
- Consulta nova `campanhas(db, f, periodo)` em `consultas.js`, um único `GROUP BY origem, utm_campaign, cliente_tipo`
  (mesma `base()` de `clientes`), devolvendo no máximo 50 linhas ordenadas por novos desc. Leitura ≈ pedidos do
  site no período (usa o índice por data existente).
- Rota: `GET /api/clientes/campanhas` (exige aba `clientes`) **ou** campo novo em `/api/clientes` — decisão do
  construtor; preferência por rota própria para o bloco carregar sem atrasar o resto da aba.

### Tela
```
Campanhas                                Novos  Recorrentes  Receita*   Novos vs comp.
Google Ads
  ● marca                                 214       352      R$ …        ▲ 12%
  ● shopping-regiao-a                      22         9      R$ …        ▼ 4%
WhatsApp
  ● (sem campanha)                        230       173      R$ …          —
▸ ver todas (até 50)
                             * Receita só para quem vê valores
```
- Mesmo estilo dos blocos existentes da aba (v0.5.1: números, ponto na cor da origem, colunas alinhadas).
- Mostra as 10 primeiras; "ver todas" expande até 50. Celular: só nome + novos + recorrentes.
- Clicar numa origem filtra a página por ela (comportamento padrão dos blocos por origem).
- Sem comparação na barra: coluna de variação some.

## Parte 2 — Servidor MCP (v0.7.0)

### Abordagens consideradas
- **A. `/mcp` dentro do próprio projeto Pages, login pelo Access com "Managed OAuth" (escolhida).** O Access vira
  o servidor OAuth que o cliente MCP exige; o pedido chega à Function com o mesmo `Cf-Access-Jwt-Assertion` que o
  painel já valida. Reaproveita `acesso.js`, `permissoes.js`, `consultas.js`, `valores.js`; um deploy só.
- **B. Worker separado com `workers-oauth-provider` + Access como provedor de identidade (plano B).** Modelo
  oficial da Cloudflare, funciona com certeza, mas é mais uma peça (deploy, segredos, KV/DO) e as regras de perfil
  precisam ser compartilhadas. Usado só se o passo 0 reprovar a A.
- **C. Token fixo no conector — descartada:** não identifica a pessoa nem respeita perfil.

### Passo 0 — teste de login (antes de qualquer código do MCP)
Riscos conhecidos: o Managed OAuth é opcional em apps self-hosted, exige cliente com RFC 8707 e há relato de
conector personalizado do claude.ai que não abre a tela de login quando o 401 não traz
`WWW-Authenticate: Bearer resource_metadata=…`.
1. Criar uma aplicação Access **separada** só para o caminho `<projeto>.pages.dev/mcp` (e `*.<projeto>.pages.dev/mcp`),
   com a mesma política de e-mails e **Managed OAuth ligado** — a aplicação do painel não muda.
2. Publicar uma Function mínima em `/mcp` (preview/branch de teste) que responde `initialize` e uma ferramenta
   `quem_sou_eu` (e-mail + perfil lidos do JWT).
3. Adicionar como conector personalizado no Claude (web/Cowork) e no Claude Code; conferir: tela de login do Access
   aparece, `quem_sou_eu` responde o e-mail certo, sem login o `/mcp` devolve 401.
4. Critério: **o conector precisa funcionar no Claude web/Cowork** (é onde o dono vai usar). Funcionar só no Claude
   Code não basta. Aprovado → segue A. Reprovado → B, com o mesmo conjunto de ferramentas.
5. Conferir também que o painel no navegador segue com 302 para o login (nada mudou nele).

### Protocolo
- MCP JSON-RPC sobre **Streamable HTTP sem estado** (sem sessão, sem SSE de longa duração): `POST /mcp` com
  `initialize`, `tools/list`, `tools/call`; `GET /mcp` → 405. Implementação própria e enxuta (o projeto não usa
  bundler/SDK); se o construtor preferir `@modelcontextprotocol/sdk`, só se rodar nas Pages Functions sem Durable
  Objects e sem aumentar o deploy de forma relevante.
- O `/mcp` passa pelo mesmo `autorizar()` (e-mail do Access → registro → `eu`): não cadastrado ou inativo → erro
  MCP "sem acesso"; o check de `Origin` para métodos não-GET **não** se aplica ao `/mcp` (cliente não é navegador)
  — a proteção ali é o token do Access.
- Cada `tools/call` exige a aba correspondente (`exigirAba`) e passa a resposta por `semValores`.
- Respostas: JSON compacto em `content[0].text` + `structuredContent`; valores em reais (não centavos) e datas
  `AAAA-MM-DD`, com `dadosAte` em toda resposta.

### Ferramentas (só leitura)
Todas aceitam os filtros da barra: `de`, `ate`, `cmp` (`anterior` | `ano` | `nenhum`), `origem`, `categoria`,
`marca`, `pagamento`, `uf`, `cidade`, `entrega` — validados por `lerFiltros` (mesmos limites do painel).

| Ferramenta | Aba exigida | Reaproveita |
|---|---|---|
| `resumo_geral` — KPIs do período x comparação + top 5 origens/categorias + campanhas com mais novos; cada parte só se o perfil tiver a aba dela (vendas → KPIs/quebras, clientes → campanhas), como `visao.js` faz hoje | `visao` | `resumo`, `quebra`, `campanhas` |
| `vendas_resumo` — pedidos, faturamento, ticket, frete, desconto, cancelados, variação | `vendas` | `resumo` |
| `vendas_serie` — série diária (ou semanal se > 92 dias) | `vendas` | `serie` |
| `vendas_quebra` — por origem/categoria/marca/pagamento/uf/entrega | `vendas` | `quebra` |
| `produtos` — mais vendidos, subiram, caíram (paginado, máx. 50) | `vendas` | `produtos`, `produtosVariacao` |
| `clientes` — novos x recorrentes, por origem e semana | `clientes` | `clientes` |
| `campanhas` — novos x recorrentes por origem → campanha | `clientes` | `campanhas` (Parte 1) |
| `opcoes_filtro` — valores válidos de origem, categoria, marca… | qualquer ativa | `opcoes` |
| `quem_sou_eu` — e-mail, perfil, abas, se vê valores, `dadosAte` | — | `eu` |

Descrições das ferramentas em português, dizendo o que cada uma responde e os limites (para o modelo escolher bem).

### Proteção da cota do D1
- Período máximo por chamada no MCP: **400 dias** (o painel aceita 731; o MCP é mais restrito porque o modelo pode
  encadear muitas chamadas). Validação por `lerFiltros` + checagem extra do MCP.
- Listas com teto (produtos 50, campanhas 50, quebras 30).
- **Teto diário global do MCP: 2.500.000 linhas lidas** (50% da cota Free; decidido pelo dono), configurável pela
  variável `MCP_LINHAS_DIA`. Guardado no D1 (contador em memória não serve: cada pedido pode cair num isolate
  diferente):
  - tabela nova `mcp_uso (dia TEXT, email TEXT, chamadas INTEGER, linhas INTEGER, PRIMARY KEY (dia, email))`,
    `dia` no fuso de reset da cota (UTC);
  - antes de cada `tools/call`: `SELECT SUM(linhas)` do dia; se ≥ teto → erro MCP claro ("limite diário de
    consultas do assistente atingido; volta às 00:00 UTC / 21h BRT"), sem executar a consulta;
  - depois: soma `meta.rows_read` de todas as consultas da chamada e faz um upsert em `mcp_uso` (1 gravação por
    chamada — irrelevante perto das 100 mil/dia). O teto pode ser ultrapassado por uma única chamada em andamento;
    aceitável.
  - O painel do navegador não consulta nem respeita esse teto.
- `quem_sou_eu` informa o quanto do teto do dia já foi usado.
- Medir, no passo final, as `rows_read` de cada ferramenta com o período máximo e registrar no PR; ferramenta que
  passar de 300 mil linhas numa chamada precisa de corte (período menor para ela ou consulta mais barata).

### Configuração e acesso
- Feature desligável pela variável de ambiente `MCP_ATIVO` (`[vars]` do `wrangler.exemplo.toml`, padrão `"0"`) — as
  Functions não leem o `config.json`. Desligado → `/mcp` 404. A aplicação Access do `/mcp` tem AUD próprio
  (variável `ACCESS_AUD_MCP`), validado junto com o do painel.
- Quem pode usar: qualquer usuário ativo do painel; o administrador libera no Access como já faz.
- README: seção "Usar com Claude" (criar aplicação Access do `/mcp` com Managed OAuth, adicionar conector).

## Testes
- Unidade (node:test, padrão do projeto): `campanhas()` com dados semeados (agrupamento, "(sem campanha)",
  teto 50, comparação, filtros); rota com e sem `ver_valores` e sem a aba.
- MCP: `initialize`, `tools/list`, cada `tools/call` feliz; aba ausente → erro; sem `ver_valores` → sem R$;
  filtros inválidos → erro de parâmetro; teto diário (bloqueia antes, soma depois); `/mcp` desligado → 404; GET → 405.
- Manual: passo 0 e, no fim, uma conversa real no Cowork usando `resumo_geral` e `campanhas`.

## Entregas
1. **v0.6.0** — Parte 1 (consulta, rota, bloco, testes, print de conferência). Publicar com OK do dono.
2. **Passo 0** — teste de login (aplicação Access do `/mcp` feita pelo dono com orientação).
3. **v0.7.0** — Parte 2 conforme o resultado do passo 0. Publicar com OK do dono.

## Fica com quem constrói
Nomes internos, rota própria x campo em `/api/clientes`, implementação do JSON-RPC (própria x SDK, dentro das
condições acima), formato exato do texto das respostas, ícone/estilo fino do bloco, textos de erro.
