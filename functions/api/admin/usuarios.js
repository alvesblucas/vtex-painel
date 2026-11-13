// Usuários do painel: listar (com permissão efetiva) e cadastrar. Toda escrita é auditada.
import {
  COLUNAS_USUARIO, buscarUsuarios, camposUsuario, comandoAuditoria, duplicado, ehDuplicidade, ehSuperAdmin,
  invalido, lerCorpo, paraAuditoria, proibidoSuperAdmin, somenteChaves, validarEmail,
} from '../../_lib/admin.js';
import { exigirAdmin, limparCacheUsuarios } from '../../_lib/permissoes.js';
import { ErroHttp, json } from '../../_lib/resposta.js';

const CAMPOS = ['email', 'nome', 'perfil', 'ajustes', 'admin', 'ativo'];

export async function onRequestGet(context) {
  exigirAdmin(context);
  return json(await buscarUsuarios(context.env.DB, context.env));
}

export async function onRequestPost(context) {
  exigirAdmin(context);
  const { env } = context;
  const eu = context.data.eu;
  const db = env.DB;
  const corpo = await lerCorpo(context.request);
  somenteChaves(corpo, CAMPOS);
  const email = validarEmail(corpo.email, env);
  if (ehSuperAdmin(email, env)) throw proibidoSuperAdmin();
  if (!('nome' in corpo) || !('perfil' in corpo)) throw invalido('Informe "nome" e "perfil".');
  const campos = await camposUsuario(db, corpo);
  if (campos.admin === 1 && !eu.superAdmin) {
    throw new ErroHttp(403, 'sem-permissao', 'Só o super admin pode tornar alguém administrador.');
  }
  if (await db.prepare('SELECT email FROM usuarios WHERE email = ?').bind(email).first()) throw duplicado('Usuário');

  const linha = {
    email, nome: campos.nome, perfil: campos.perfil, ajustes: campos.ajustes ?? null,
    admin: campos.admin ?? 0, ativo: campos.ativo ?? 1, criado: new Date().toISOString(),
  };
  try {
    await db.batch([
      db.prepare(`INSERT INTO usuarios (${COLUNAS_USUARIO}) VALUES (?,?,?,?,?,?,?)`)
        .bind(linha.email, linha.nome, linha.perfil, linha.ajustes, linha.admin, linha.ativo, linha.criado),
      comandoAuditoria(db, { quem: eu.email, acao: 'usuario.criar', alvo: email, antes: null, depois: paraAuditoria(linha) }),
    ]);
  } catch (e) {
    if (ehDuplicidade(e)) throw duplicado('Usuário');
    throw e;
  }
  limparCacheUsuarios();
  const [criado] = await buscarUsuarios(db, env, email);
  return json(criado, 201);
}
