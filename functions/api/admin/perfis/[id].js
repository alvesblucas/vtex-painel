// Edição parcial de um perfil; vale para todos os usuários dele (o cache deste isolate é limpo).
import {
  COLUNAS_PERFIL, camposPerfil, comandoAtualizar, comandoAuditoria, invalido, lerCorpo, naoEncontrado,
  paraAuditoria, perfilParaApi, somenteChaves,
} from '../../../_lib/admin.js';
import { exigirAdmin, limparCacheUsuarios } from '../../../_lib/permissoes.js';
import { ErroHttp, json } from '../../../_lib/resposta.js';

const CAMPOS = ['id', 'nome', 'abas', 'ver_valores'];
const EDITAVEIS = ['nome', 'abas', 'ver_valores'];

export async function onRequestPatch(context) {
  exigirAdmin(context);
  // R18: editar perfis é só do super admin.
  if (!context.data.eu.superAdmin) throw new ErroHttp(403, 'somente-super-admin', 'Só o administrador principal pode alterar.');
  const db = context.env.DB;
  const id = typeof context.params?.id === 'string' ? context.params.id : '';
  const corpo = await lerCorpo(context.request);
  somenteChaves(corpo, CAMPOS);
  if ('id' in corpo && corpo.id !== id) throw invalido('O id do perfil não pode ser alterado.');
  const campos = camposPerfil(corpo);
  if (!Object.keys(campos).length) throw invalido('Nada para alterar.');

  const antes = id ? await db.prepare(`SELECT ${COLUNAS_PERFIL} FROM perfis WHERE id = ?`).bind(id).first() : null;
  if (!antes) throw naoEncontrado('Perfil');
  const depois = { ...antes, ...campos };
  await db.batch([
    comandoAtualizar(db, 'perfis', 'id', id, campos, EDITAVEIS),
    comandoAuditoria(db, {
      quem: context.data.eu.email, acao: 'perfil.editar', alvo: id, antes: paraAuditoria(antes), depois: paraAuditoria(depois),
    }),
  ]);
  limparCacheUsuarios();
  const contagem = await db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE perfil = ?').bind(id).first();
  return json(perfilParaApi({ ...depois, usuarios: contagem?.n ?? 0 }));
}
