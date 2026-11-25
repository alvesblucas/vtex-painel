// Endpoint MCP (/mcp): fora de /api, então faz o próprio login (Access com AUD da aplicação do MCP) e a própria permissão.
import { emailDaRequisicao } from './_lib/acesso.js';
import { ferramentas } from './_lib/mcp/ferramentas.js';
import { contarLeituras, exigirCota, registrarUso } from './_lib/mcp/cota.js';
import { ErroParametro, lerMensagem, responder } from './_lib/mcp/protocolo.js';
import { carregarRegistro } from './_lib/permissoes.js';
import { ErroHttp } from './_lib/resposta.js';
import { VERSAO } from '../public/js/versao.js';

const CABECALHOS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
const resposta = (corpo, status, extras = {}) => new Response(corpo === null ? null : JSON.stringify(corpo), { status, headers: { ...CABECALHOS, ...extras } });
const falha = (status, mensagem, extras) => resposta({ jsonrpc: '2.0', id: null, error: { code: -32001, message: mensagem } }, status, extras);

export async function onRequest(context) {
  const { request, env } = context;
  if (env.MCP_ATIVO !== '1') return new Response(null, { status: 404 });
  if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
  let eu;
  try {
    const email = await emailDaRequisicao(request, env, { aud: env.ACCESS_AUD_MCP });
    eu = (await carregarRegistro(env.DB, email, env)).eu;
  } catch (e) {
    if (e instanceof ErroHttp && e.status === 401) return falha(401, e.mensagem, { 'WWW-Authenticate': 'Bearer realm="painel"' });
    console.error('mcp: erro no login', e?.name ?? 'Error');
    return falha(500, 'Erro interno.');
  }
  if (!eu.ativo) return falha(403, 'Você ainda não tem acesso ao painel. Peça ao administrador.');

  const contexto = { eu, env, db: env.DB };
  // Cada chamada de ferramenta (menos quem_sou_eu) respeita o teto diário e soma as linhas lidas em mcp_uso.
  // Erro de parâmetro ou permissão não grava uso; erro interno grava (as leituras já aconteceram).
  async function aoChamar(nome, executar) {
    if (nome === 'quem_sou_eu') return executar();
    await exigirCota(env.DB, env);
    const contador = contarLeituras(env.DB);
    contexto.db = contador.db;
    const gravar = () => context.waitUntil?.(registrarUso(env.DB, eu.email, contador.linhas()).catch(() => {}));
    try {
      const saida = await executar();
      gravar();
      return saida;
    } catch (e) {
      if (!(e instanceof ErroParametro || e?.esperado)) gravar();
      throw e;
    } finally {
      contexto.db = env.DB;
    }
  }
  const { mensagem, erro } = lerMensagem(await request.text());
  const { status, corpo } = erro ?? (await responder(mensagem, { ferramentas, versao: VERSAO, contexto, aoChamar }));
  return resposta(corpo, status);
}
