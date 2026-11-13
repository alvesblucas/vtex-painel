// Autenticação (Access) + permissão efetiva para todas as rotas /api/*.
import { emailDaRequisicao } from '../_lib/acesso.js';
import { carregarRegistro } from '../_lib/permissoes.js';
import { ErroHttp, erro } from '../_lib/resposta.js';

const HORA_MS = 3600000;
const LEITURA = ['GET', 'HEAD'];

function registrarAcesso(context, registro, agora) {
  if (!registro.cadastrado || typeof context.waitUntil !== 'function') return;
  const ultimo = registro.ultimoAcesso ? Date.parse(registro.ultimoAcesso) : NaN;
  if (!Number.isNaN(ultimo) && agora - ultimo < HORA_MS) return;
  const quando = new Date(agora).toISOString();
  registro.ultimoAcesso = quando; // evita regravar enquanto o cache valer
  const gravacao = context.env.DB.prepare('UPDATE usuarios SET ultimo_acesso = ? WHERE email = ?')
    .bind(quando, registro.eu.email)
    .run()
    .catch(() => {});
  context.waitUntil(gravacao);
}

async function autorizar(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const caminho = url.pathname;
  const email = await emailDaRequisicao(request, env);
  const registro = await carregarRegistro(env.DB, email, env);
  const eu = { ...registro.eu, abas: [...registro.eu.abas] };
  context.data = context.data ?? {};
  context.data.eu = eu;

  if (!eu.ativo && caminho !== '/api/eu') {
    throw new ErroHttp(403, 'sem-acesso', 'Você ainda não tem acesso. Peça ao administrador.');
  }
  if ((caminho === '/api/admin' || caminho.startsWith('/api/admin/')) && !eu.admin) {
    throw new ErroHttp(403, 'sem-permissao', 'Somente administradores.');
  }
  if (!LEITURA.includes(request.method) && request.headers.get('Origin') !== url.origin) {
    throw new ErroHttp(403, 'origem', 'Origem da requisição não permitida.');
  }
  if (eu.ativo) registrarAcesso(context, registro, Date.now());
}

export async function onRequest(context) {
  try {
    await autorizar(context);
    return await context.next();
  } catch (e) {
    if (e instanceof ErroHttp) return erro(e.status, e.codigo, e.mensagem);
    console.error('erro interno:', e?.name ?? 'Error');
    return erro(500, 'interno', 'Erro interno.');
  }
}
