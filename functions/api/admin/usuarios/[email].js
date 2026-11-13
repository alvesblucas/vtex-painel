// Edição parcial de um usuário (o super admin nunca é editável; regras de admin/ativo abaixo).
import {
  COLUNAS_USUARIO, buscarUsuarios, camposUsuario, comandoAtualizar, comandoAuditoria, ehSuperAdmin,
  invalido, lerCorpo, naoEncontrado, paraAuditoria, proibidoSuperAdmin, somenteChaves,
} from '../../../_lib/admin.js';
import { normalizarEmail } from '../../../_lib/acesso.js';
import { exigirAdmin, limparCacheUsuarios } from '../../../_lib/permissoes.js';
import { ErroHttp, json } from '../../../_lib/resposta.js';

const CAMPOS = ['email', 'nome', 'perfil', 'ajustes', 'admin', 'ativo'];
const EDITAVEIS = ['nome', 'perfil', 'ajustes', 'admin', 'ativo'];

export async function onRequestPatch(context) {
  exigirAdmin(context);
  const { env } = context;
  const eu = context.data.eu;
  const db = env.DB;
  const param = context.params?.email;
  const alvo = typeof param === 'string' ? normalizarEmail(param) : '';
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
