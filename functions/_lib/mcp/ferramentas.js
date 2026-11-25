// Ferramentas do MCP (só leitura). Cada uma chama a rota /api/* equivalente do painel (mesmas permissões e R$ por perfil).
// Contexto: { eu, env, db } — `db` é o D1 a usar (o proxy que conta leituras, na chamada real).
import { dadosAte, QUEBRAS, segundaFeira } from '../consultas.js';
import * as campanhasRota from '../../api/clientes/campanhas.js';
import * as clientesRota from '../../api/clientes.js';
import * as opcoesRota from '../../api/opcoes.js';
import * as visaoRota from '../../api/visao.js';
import * as produtosRota from '../../api/vendas/produtos.js';
import * as quebraRota from '../../api/vendas/quebra.js';
import * as resumoRota from '../../api/vendas/resumo.js';
import * as serieRota from '../../api/vendas/serie.js';
import { argsParaQuery, chamarRota, conferirPeriodo, emReais, esquema } from './adaptar.js';

const SEMANAL_ACIMA_DE = 92;
const TOP_RESUMO = 5;
const NOTA = ' Valores em reais (só para perfis que veem valores). Período máximo de 400 dias por consulta.';

const temAba = (eu, aba) => eu.abas.includes(aba);

// Ferramenta que repassa os filtros a uma rota do painel; `depois(dados, filtros)` ajusta a resposta.
function deRota(rota, caminho, description, extras = {}, depois = (d) => d) {
  const inputSchema = esquema(extras);
  return {
    description: description + NOTA,
    inputSchema,
    async executar(args, ctx) {
      const params = argsParaQuery(args, inputSchema);
      const f = conferirPeriodo(params, ctx.env);
      return emReais(depois(await chamarRota(rota.onRequestGet, caminho, params, ctx), f));
    },
  };
}

const SOMAVEIS = ['valor', 'pedidos', 'cmpValor', 'cmpPedidos'];

// Série diária → semanal (semana começa na segunda) quando o período passa de 92 dias.
function agruparSerie(d, f) {
  if (f.dias <= SEMANAL_ACIMA_DE) return { ...d, agrupamento: 'dia' };
  const semanas = new Map();
  for (const p of d.pontos) {
    const s = segundaFeira(p.dia);
    if (!semanas.has(s)) semanas.set(s, { dia: s });
    const alvo = semanas.get(s);
    for (const k of SOMAVEIS) if (typeof p[k] === 'number') alvo[k] = (alvo[k] ?? 0) + p[k];
  }
  return { ...d, pontos: [...semanas.values()], agrupamento: 'semana' };
}

const SEM_FILTROS = esquema({}, false);

export const ferramentas = {
  quem_sou_eu: {
    description: 'Mostra quem está conectado: e-mail, perfil, abas que pode consultar, se vê valores em R$ e até quando há dados.',
    inputSchema: SEM_FILTROS,
    async executar(args, { eu, env, db }) {
      argsParaQuery(args, SEM_FILTROS);
      return { email: eu.email, perfil: eu.perfil, abas: eu.abas, verValores: eu.verValores, dadosAte: await dadosAte(db ?? env.DB, 'pedidos') };
    },
  },

  resumo_geral: {
    description:
      'Ponto de partida para análises: cartões da visão geral (vendas, clientes, alertas) do período x comparação, '
      + 'top 5 origens e categorias e as 5 campanhas que mais trouxeram clientes novos. Cada parte só aparece se o perfil tiver a aba dela.'
      + NOTA,
    inputSchema: esquema(),
    async executar(args, ctx) {
      const params = argsParaQuery(args, this.inputSchema);
      conferirPeriodo(params, ctx.env);
      const saida = { visao: await chamarRota(visaoRota.onRequestGet, '/api/visao', params, ctx) };
      if (temAba(ctx.eu, 'vendas')) {
        for (const [chave, por] of [['porOrigem', 'origem'], ['porCategoria', 'categoria']]) {
          const q = new URLSearchParams(params);
          q.set('por', por);
          saida[chave] = (await chamarRota(quebraRota.onRequestGet, '/api/vendas/quebra', q, ctx)).itens.slice(0, TOP_RESUMO);
        }
      }
      if (temAba(ctx.eu, 'clientes')) {
        const c = await chamarRota(campanhasRota.onRequestGet, '/api/clientes/campanhas', params, ctx);
        saida.campanhas = c.campanhas.slice(0, TOP_RESUMO);
      }
      return emReais(saida);
    },
  },

  vendas_resumo: deRota(resumoRota, '/api/vendas/resumo',
    'Faturamento, pedidos, ticket médio, frete, desconto e cancelados do período e da comparação.'),

  vendas_serie: deRota(serieRota, '/api/vendas/serie',
    'Vendas ao longo do tempo (faturamento e pedidos) com a comparação alinhada. Até 92 dias vem por dia; acima, por semana (início na segunda).',
    {}, agruparSerie),

  vendas_quebra: deRota(quebraRota, '/api/vendas/quebra',
    'Top 10 de um recorte (origem, categoria, marca, pagamento, UF ou entrega) com a comparação e a soma do resto em "outros".',
    { por: { type: 'string', enum: Object.keys(QUEBRAS), description: 'Recorte da quebra.' } }),

  produtos: deRota(produtosRota, '/api/vendas/produtos',
    'Produtos: mais vendidos (modo "mais") ou os que mais subiram ou caíram contra a comparação ("subiram" / "caiu", mínimo de 3 pedidos antes). 50 por página.',
    {
      modo: { type: 'string', enum: ['mais', 'subiram', 'caiu'], description: 'Padrão: mais.' },
      ordem: { type: 'string', enum: ['valor', 'qtd', 'pedidos'], description: 'Ordem do modo "mais" (padrão: valor).' },
      pagina: { type: 'integer', minimum: 1, maximum: 10000, description: 'Página (padrão 1).' },
      busca: { type: 'string', maxLength: 120, description: 'Trecho do nome ou SKU.' },
    }),

  clientes: deRota(clientesRota, '/api/clientes',
    'Clientes do site: pedidos de clientes novos x recorrentes, % de novos, por origem e por semana, e o % de novos da comparação.'),

  campanhas: deRota(campanhasRota, '/api/clientes/campanhas',
    'Clientes novos x recorrentes por origem e campanha (utm_campaign), até 50, mais novos primeiro, com os novos da comparação (novoCmp).'),

  opcoes_filtro: {
    description: 'Valores válidos para os filtros (origens, categorias, marcas, pagamentos, UFs, cidades, entregas) dos últimos 400 dias.',
    inputSchema: SEM_FILTROS,
    async executar(args, ctx) {
      argsParaQuery(args, SEM_FILTROS);
      return emReais(await chamarRota(opcoesRota.onRequestGet, '/api/opcoes', new URLSearchParams(), ctx));
    },
  },
};
