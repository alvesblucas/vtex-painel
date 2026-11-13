// Edição parcial de um usuário (o super admin nunca é editável; regras de admin/ativo abaixo).
// Admin comum: no próprio cadastro só o nome; cadastro de outro administrador, nada (só o super admin).
import {
  COLUNAS_USUARIO, buscarUsuarios, camposUsuario, comandoAtualizar, comandoAuditoria, ehSuperAdmin,
  invalido, lerCorpo, naoEncontrado, paraAuditoria, proibidoSuperAdmin, somenteChaves,
} from '../../../_lib/admin.js';
import { normalizarEmail } from '../../../_lib/acesso.js';
import { exigirAdmin, limparCacheUsuarios } from '../../../_lib/permissoes.js';
import { ErroHttp, json } from '../../../_lib/resposta.js';

const CAMPOS = ['email', 'nome', 'perfil', 'ajustes', 'admin', 'ativo'];
const EDITAVEIS = ['nome', 'perfil', 'ajustes', 'admin', 'ativo'];
// O Pages entrega o segmento da rota sem decodificar (ana%40exemplo.com).
function emailDaRota(v) {
  if (typeof v !== 'string') return '';
  try {
    return normalizarEmail(decodeURIComponent(v));
  } catch {
    return '';
  }
}
const somenteSuperAdmin = () => new ErroHttp(403, 'somente-super-admin', 'Só o administrador principal pode alterar.');

export async function onRequestPatch(context) {
  exigirAdmin(context);
  const { env } = context;
  const eu = context.data.eu;
  const db = env.DB;
  const param = context.params?.email;
  const alvo = emailDaRota(param);
  if (!alvo) throw naoEncontrado('Usuário');
  if (ehSuperAdmin(alvo, env)) throw proibidoSuperAdmin();

  const corpo = await lerCorpo(context.request);
  somenteChaves(corpo, CAMPOS);
  if ('email' in corpo && (typeof corpo.email !== 'string' || normalizarEmail(corpo.email) !== alvo)) {
    throw invalido('O e-mail não pode ser alterado.');
  }
  const campos = await camposUsuario(db, corpo);
  if (!Object.keys(campos).length) throw invalido('Nada para alterar.');

  const antes = await db.prepare(`SELECT ${COLUNAS_USUARIO} FROM usuarios WHERE email = ?`).bind(alvo).first();
  if (!antes) throw naoEncontrado('Usuário');
  const muda = (k) => k in campos && campos[k] !== antes[k];
  if (alvo === eu.email && (muda('ativo') || muda('admin'))) {
    throw new ErroHttp(400, 'proprio-usuario', 'Você não pode mudar seu próprio status nem seu acesso de administrador.');
  }
  // R15: admin comum só muda o próprio nome e não mexe em outros administradores.
  if (!eu.superAdmin && alvo !== eu.email && antes.admin) throw somenteSuperAdmin();
  if (!eu.superAdmin && alvo === eu.email && Object.keys(campos).some((k) => k !== 'nome' && muda(k))) {
    throw somenteSuperAdmin();
  }
  if (muda('admin') && !eu.superAdmin) {
    throw new ErroHttp(403, 'sem-permissao', 'Só o super admin pode mudar quem é administrador.');
  }

  const depois = { ...antes, ...campos };
  await db.batch([
    comandoAtualizar(db, 'usuarios', 'email', alvo, campos, EDITAVEIS),
    comandoAuditoria(db, { quem: eu.email, acao: 'usuario.editar', alvo, antes: paraAuditoria(antes), depois: paraAuditoria(depois) }),
  ]);
  limparCacheUsuarios();
  const [atual] = await buscarUsuarios(db, env, alvo);
  return json(atual);
}
