// Ponte MCP → rotas /api/*: valida argumentos, monta a query, chama o handler da rota com um contexto sintético
// (mesmas permissões, filtros e semValores do painel) e converte centavos em reais.
import { hojeLocal } from '../consultas.js';
import { lerFiltros } from '../filtros.js';
import { CAMPOS_VALOR } from '../valores.js';
import { ErroHttp } from '../resposta.js';
import { ErroParametro } from './protocolo.js';

export const MAX_DIAS_MCP = 400;
// Consultas que leem item por item (produto, categoria, marca) custam ~4x mais linhas no D1 (medição 25/11).
export const MAX_DIAS_ITENS = 120;
const DIA_MS = 86400000;

const lista = (descricao) => ({ type: 'array', items: { type: 'string' }, maxItems: 20, description: descricao });

// Filtros da barra do painel, aceitos por todas as ferramentas de dados.
export const PROPRIEDADES_FILTRO = {
  de: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Início AAAA-MM-DD (padrão: 30 dias atrás).' },
  ate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'Fim AAAA-MM-DD (padrão: ontem).' },
  cmp: {
    type: 'string',
    enum: ['anterior', 'ano', 'nenhum'],
    description: 'Comparação: período anterior de mesmo tamanho (padrão), mesmo período do ano anterior, ou nenhuma.',
  },
  origem: lista('Origens (valores de opcoes_filtro).'),
  categoria: lista('Categorias.'),
  marca: lista('Marcas.'),
  pagamento: lista('Formas de pagamento.'),
  uf: lista('UFs.'),
  cidade: lista('Cidades.'),
  entrega: lista('Tipos de entrega.'),
};

export const esquema = (extras = {}, filtros = true) => ({
  type: 'object',
  properties: { ...(filtros ? PROPRIEDADES_FILTRO : {}), ...extras },
  additionalProperties: false,
});

function validar(nome, valor, regra) {
  if (regra.type === 'array') {
    if (!Array.isArray(valor) || valor.some((v) => typeof v !== 'string')) throw new ErroParametro(`"${nome}" deve ser uma lista de textos.`);
    return valor;
  }
  if (regra.type === 'integer') {
    const ok = Number.isInteger(valor) && valor >= (regra.minimum ?? -Infinity) && valor <= (regra.maximum ?? Infinity);
    if (!ok) throw new ErroParametro(`"${nome}" deve ser um número inteiro válido.`);
    return [String(valor)];
  }
  if (typeof valor !== 'string') throw new ErroParametro(`"${nome}" deve ser texto.`);
  if (regra.enum && !regra.enum.includes(valor)) throw new ErroParametro(`"${nome}" deve ser um de: ${regra.enum.join(', ')}.`);
  if (regra.maxLength && valor.length > regra.maxLength) throw new ErroParametro(`"${nome}" é longo demais.`);
  return [valor];
}

// Argumentos → URLSearchParams, conferindo tipos contra o inputSchema da ferramenta.
export function argsParaQuery(args, schema) {
  const params = new URLSearchParams();
  for (const [nome, valor] of Object.entries(args ?? {})) {
    const regra = schema.properties[nome];
    if (!regra) throw new ErroParametro(`Argumento desconhecido: "${nome}".`);
    if (valor === undefined || valor === null) continue;
    for (const v of validar(nome, valor, regra)) params.append(nome, v);
  }
  return params;
}

const ALTERNATIVA = 'Para períodos maiores (até 400 dias) use vendas_resumo, vendas_serie, clientes, campanhas ou vendas_quebra por '
  + 'origem, pagamento, UF ou entrega, sem filtro de categoria ou marca.';

// Mesma validação do painel + período máximo da ferramenta (filtro de categoria/marca baixa para 120 dias).
export function conferirPeriodo(params, env, maxDias = MAX_DIAS_MCP) {
  let f;
  try {
    f = lerFiltros(params, hojeLocal(env));
  } catch (e) {
    if (e instanceof ErroHttp) throw new ErroParametro(e.mensagem);
    throw e;
  }
  const dias = (Date.parse(`${f.ate}T00:00:00Z`) - Date.parse(`${f.de}T00:00:00Z`)) / DIA_MS + 1;
  const max = f.categoria.length || f.marca.length ? Math.min(maxDias, MAX_DIAS_ITENS) : maxDias;
  if (dias > max) {
    throw new ErroParametro(max >= MAX_DIAS_MCP
      ? `No assistente o período máximo é de ${max} dias.`
      : `No assistente o período máximo desta consulta é de ${max} dias. ${ALTERNATIVA}`);
  }
  return { ...f, dias };
}

export async function chamarRota(handler, caminho, params, ctx) {
  const contexto = {
    request: new Request(`https://mcp.local${caminho}?${params}`),
    env: { ...ctx.env, DB: ctx.db ?? ctx.env.DB },
    data: { eu: { ...ctx.eu, abas: [...ctx.eu.abas] } },
    params: {},
    waitUntil: () => {},
  };
  let r;
  try {
    r = await handler(contexto);
  } catch (e) {
    if (e instanceof ErroHttp) throw new ErroParametro(e.mensagem);
    throw e;
  }
  const corpo = await r.json();
  if (r.status !== 200) throw new ErroParametro(corpo?.mensagem ?? `Erro ${r.status}.`);
  return corpo;
}

const EM_REAIS = new Set(CAMPOS_VALOR.filter((c) => c !== 'varPreco')); // varPreco é %

export function emReais(v) {
  if (Array.isArray(v)) return v.map(emReais);
  if (v === null || typeof v !== 'object') return v;
  const saida = {};
  for (const [k, x] of Object.entries(v)) saida[k] = EM_REAIS.has(k) && typeof x === 'number' ? Math.round(x) / 100 : emReais(x);
  return saida;
}
