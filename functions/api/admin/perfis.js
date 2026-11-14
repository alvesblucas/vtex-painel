// Perfis (modelos de permissão): listar com nº de usuários e criar. Toda escrita é auditada.
import {
  COLUNAS_PERFIL, camposPerfil, comandoAuditoria, duplicado, ehDuplicidade, invalido, lerCorpo,
  paraAuditoria, perfilParaApi, somenteChaves, validarIdPerfil,
} from '../../_lib/admin.js';
import { exigirAdmin, limparCacheUsuarios } from '../../_lib/permissoes.js';
import { ErroHttp, json } from '../../_lib/resposta.js';

const CAMPOS = ['id', 'nome', 'abas', 'ver_valores'];

export async function onRequestGet(context) {
  exigirAdmin(context);
  const { results } = await context.env.DB.prepare(
    `SELECT p.id, p.nome, p.abas, p.ver_valores, COUNT(u.email) AS usuarios
       FROM perfis p LEFT JOIN usuarios u ON u.perfil = p.id
      GROUP BY p.id, p.nome, p.abas, p.ver_valores
      ORDER BY p.nome`,
  ).all();
  return json(results.map(perfilParaApi));
}

export async function onRequestPost(context) {
  exigirAdmin(context);
  // R18: criar perfis é só do super admin.
  if (!context.data.eu.superAdmin) throw new ErroHttp(403, 'somente-super-admin', 'Só o administrador principal pode alterar.');
  const db = context.env.DB;
  const corpo = await lerCorpo(context.request);
  somenteChaves(corpo, CAMPOS);
  const id = validarIdPerfil(corpo.id);
  const campos = camposPerfil(corpo);
  if (!('nome' in campos) || !('abas' in campos) || !('ver_valores' in campos)) {
    throw invalido('Informe "nome", "abas" e "ver_valores".');
  }
  if (await db.prepare('SELECT id FROM perfis WHERE id = ?').bind(id).first()) throw duplicado('Perfil');

  const linha = { id, ...campos };
  try {
    await db.batch([
      db.prepare(`INSERT INTO perfis (${COLUNAS_PERFIL}) VALUES (?,?,?,?)`).bind(id, linha.nome, linha.abas, linha.ver_valores),
      comandoAuditoria(db, { quem: context.data.eu.email, acao: 'perfil.criar', alvo: id, antes: null, depois: paraAuditoria(linha) }),
    ]);
  } catch (e) {
    if (ehDuplicidade(e)) throw duplicado('Perfil');
    throw e;
  }
  limparCacheUsuarios();
  return json(perfilParaApi({ ...linha, usuarios: 0 }), 201);
}
