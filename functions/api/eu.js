// Quem sou eu: permissão efetiva, loja e última coleta de cada fonte (inativo recebe só o básico).
import { coletas } from '../_lib/consultas.js';
import { semValores } from '../_lib/permissoes.js';
import { json } from '../_lib/resposta.js';

export async function onRequestGet(context) {
  const eu = context.data.eu;
  const dados = {
    email: eu.email,
    nome: eu.nome,
    perfil: eu.perfil,
    ativo: eu.ativo,
    abas: eu.abas,
    verValores: eu.verValores,
    admin: eu.admin,
    superAdmin: eu.superAdmin,
    loja: { nome: context.env.LOJA_NOME || 'Painel' },
    coletas: eu.ativo ? await coletas(context.env.DB) : [],
  };
  return json(semValores(dados, eu.verValores));
}
