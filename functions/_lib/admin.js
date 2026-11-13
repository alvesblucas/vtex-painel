// Utilitários da API de administração: corpo JSON, validação estrita e auditoria.
import { ABAS } from './abas.js';
import { normalizarEmail } from './acesso.js';
import { ErroHttp } from './resposta.js';
import { permissaoEfetiva } from './permissoes.js';

export const LIMITE_CORPO = 10240;
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_PERFIL = /^[a-z][a-z0-9-]{1,30}$/;

export const invalido = (msg) => new ErroHttp(400, 'invalido', msg);
const grande = () => new ErroHttp(413, 'grande', 'Corpo da requisição grande demais.');

async function lerTexto(request) {
  const declarado = Number(request.headers.get('content-length'));
  if (declarado > LIMITE_CORPO) throw grande();
  if (!request.body) return '';
  const leitor = request.body.getReader();
  const partes = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > LIMITE_CORPO) {
      await leitor.cancel().catch(() => {});
      throw grande();
    }
    partes.push(value);
  }
  const bytes = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    bytes.set(p, pos);
    pos += p.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// Só JSON (415), até 10 KB (413), objeto válido (400).
export async function lerCorpo(request) {
  const tipo = request.headers.get('content-type') ?? '';
  if (!tipo.toLowerCase().includes('application/json')) {
    throw new ErroHttp(415, 'tipo', 'Envie o corpo como application/json.');
  }
  const texto = await lerTexto(request);
  let corpo;
  try {
    corpo = JSON.parse(texto);
  } catch {
    throw invalido('JSON inválido.');
  }
  if (!corpo || typeof corpo !== 'object' || Array.isArray(corpo)) throw invalido('O corpo deve ser um objeto JSON.');
  return corpo;
}

const ehObjeto = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const tem = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export function somenteChaves(obj, permitidas, onde = 'corpo') {
  const sobra = Object.keys(obj).filter((k) => !permitidas.includes(k));
  if (sobra.length) throw invalido(`Campo não permitido em ${onde}: ${sobra.join(', ')}.`);
}

export function booleano(v, campo) {
  if (typeof v !== 'boolean') throw invalido(`"${campo}" deve ser true ou false.`);
  return v;
}

export function texto(v, campo, max) {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > max) {
    throw invalido(`"${campo}" deve ser um texto de 1 a ${max} caracteres.`);
  }
  return v.trim();
}

export function validarEmail(v, env) {
  if (typeof v !== 'string') throw invalido('E-mail inválido.');
  const email = normalizarEmail(v);
  if (email.length > 254 || !RE_EMAIL.test(email)) throw invalido('E-mail inválido.');
  const dominio = normalizarEmail(env?.DOMINIO_PERMITIDO);
  if (dominio && !email.endsWith(`@${dominio}`)) throw invalido(`O e-mail precisa ser do domínio ${dominio}.`);
  return email;
}

// ajustes = {abas?: {<aba>: boolean}, ver_valores?: boolean|null}; devolve só as chaves conhecidas.
export function validarAjustes(v) {
  if (!ehObjeto(v)) throw invalido('"ajustes" deve ser um objeto.');
  somenteChaves(v, ['abas', 'ver_valores'], 'ajustes');
  const saida = {};
  if (tem(v, 'abas')) {
    if (!ehObjeto(v.abas)) throw invalido('"ajustes.abas" deve ser um objeto.');
    for (const [aba, valor] of Object.entries(v.abas)) {
      if (!ABAS.includes(aba)) throw invalido(`Aba desconhecida: ${aba}.`);
      booleano(valor, `ajustes.abas.${aba}`);
    }
    saida.abas = { ...v.abas };
  }
  if (tem(v, 'ver_valores')) {
    if (v.ver_valores !== null) booleano(v.ver_valores, 'ajustes.ver_valores');
    saida.ver_valores = v.ver_valores;
  }
  return saida;
}

export function validarAbas(v) {
  if (!Array.isArray(v) || v.some((a) => !ABAS.includes(a)) || new Set(v).size !== v.length) {
    throw invalido(`"abas" deve ser uma lista sem repetição de: ${ABAS.join(', ')}.`);
  }
  return [...v];
}

export function validarIdPerfil(v) {
  if (typeof v !== 'string' || !RE_PERFIL.test(v)) {
    throw invalido('"id" deve ter 2 a 31 caracteres: letras minúsculas, números e hífen, começando por letra.');
  }
  return v;
}

export async function exigirPerfil(db, id) {
  if (typeof id !== 'string' || !(await db.prepare('SELECT id FROM perfis WHERE id = ?').bind(id).first())) {
    throw invalido('Perfil inexistente.');
  }
  return id;
}

export function ehSuperAdmin(email, env) {
  const s = normalizarEmail(env?.SUPER_ADMIN);
  return Boolean(s) && normalizarEmail(email) === s;
}

export const proibidoSuperAdmin = () => new ErroHttp(403, 'super-admin', 'O super admin não pode ser criado nem editado.');
export const naoEncontrado = (o) => new ErroHttp(404, 'nao-encontrado', `${o} não encontrado.`);
export const duplicado = (o) => new ErroHttp(409, 'duplicado', `${o} já existe.`);

export function ehDuplicidade(e) {
  return /UNIQUE|PRIMARY KEY|constraint/i.test(String(e?.message ?? ''));
}

export function comandoAuditoria(db, { quem, acao, alvo, antes, depois }) {
  return db
    .prepare('INSERT INTO auditoria (quando, quem, acao, alvo, antes, depois) VALUES (?,?,?,?,?,?)')
    .bind(new Date().toISOString(), quem, acao, alvo, antes ? JSON.stringify(antes) : null, depois ? JSON.stringify(depois) : null);
}

export function lerJson(v) {
  if (typeof v !== 'string' || !v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

// ---------- usuários ----------

export const COLUNAS_USUARIO = 'email, nome, perfil, ajustes, admin, ativo, criado';

// Campos editáveis (POST e PATCH); devolve valores prontos para gravar (booleanos 0/1, JSON em texto).
export async function camposUsuario(db, corpo) {
  const c = {};
  if (tem(corpo, 'nome')) c.nome = texto(corpo.nome, 'nome', 100);
  if (tem(corpo, 'perfil')) c.perfil = await exigirPerfil(db, corpo.perfil);
  if (tem(corpo, 'ajustes')) c.ajustes = JSON.stringify(validarAjustes(corpo.ajustes));
  if (tem(corpo, 'admin')) c.admin = booleano(corpo.admin, 'admin') ? 1 : 0;
  if (tem(corpo, 'ativo')) c.ativo = booleano(corpo.ativo, 'ativo') ? 1 : 0;
  return c;
}

export function usuarioParaApi(linha, efetiva, superAdmin = false) {
  return {
    email: linha.email,
    nome: linha.nome ?? null,
    perfil: linha.perfil ?? null,
    ajustes: lerJson(linha.ajustes),
    admin: superAdmin || Boolean(linha.admin),
    ativo: superAdmin || Boolean(linha.ativo),
    superAdmin,
    criado: linha.criado ?? null,
    ultimo_acesso: linha.ultimo_acesso ?? null,
    efetiva: { abas: efetiva.abas, verValores: efetiva.verValores },
  };
}

// ---------- perfis ----------

export const COLUNAS_PERFIL = 'id, nome, abas, ver_valores';

export function camposPerfil(corpo) {
  const c = {};
  if (tem(corpo, 'nome')) c.nome = texto(corpo.nome, 'nome', 60);
  if (tem(corpo, 'abas')) c.abas = JSON.stringify(validarAbas(corpo.abas));
  if (tem(corpo, 'ver_valores')) c.ver_valores = booleano(corpo.ver_valores, 'ver_valores') ? 1 : 0;
  return c;
}

export function perfilParaApi(linha) {
  const abas = lerJson(linha.abas);
  return {
    id: linha.id,
    nome: linha.nome,
    abas: Array.isArray(abas) ? abas : [],
    ver_valores: Boolean(linha.ver_valores),
    ...(linha.usuarios === undefined ? {} : { usuarios: Number(linha.usuarios) }),
  };
}

// UPDATE parametrizado só com colunas da lista fixa (nomes nunca vêm do usuário).
export function comandoAtualizar(db, tabela, chave, valorChave, campos, permitidas) {
  const cols = Object.keys(campos).filter((k) => permitidas.includes(k));
  const sets = cols.map((k) => `${k} = ?`).join(', ');
  return db.prepare(`UPDATE ${tabela} SET ${sets} WHERE ${chave} = ?`).bind(...cols.map((k) => campos[k]), valorChave);
}

// Linha legível na auditoria: colunas JSON viram objeto.
export function paraAuditoria(linha) {
  if (!linha) return null;
  const saida = { ...linha };
  for (const k of ['ajustes', 'abas']) if (typeof saida[k] === 'string') saida[k] = lerJson(saida[k]);
  return saida;
}

// Lista (ou um) usuário com permissão efetiva; o super admin aparece mesmo sem linha.
export async function buscarUsuarios(db, env, email = null) {
  const sql = `SELECT u.email, u.nome, u.perfil, u.ajustes, u.admin, u.ativo, u.criado, u.ultimo_acesso,
                      p.abas AS perfil_abas, p.ver_valores AS perfil_ver_valores
                 FROM usuarios u LEFT JOIN perfis p ON p.id = u.perfil
                ${email ? 'WHERE u.email = ?' : ''}
                ORDER BY u.email`;
  const cmd = db.prepare(sql);
  const { results } = await (email ? cmd.bind(email) : cmd).all();
  const lista = results.map((l) => {
    const superAdmin = ehSuperAdmin(l.email, env);
    const perfil = l.perfil_abas != null ? { abas: l.perfil_abas, ver_valores: l.perfil_ver_valores } : null;
    return usuarioParaApi(l, permissaoEfetiva(l, perfil, { superAdmin }), superAdmin);
  });
  const sup = normalizarEmail(env?.SUPER_ADMIN);
  if (!email && sup && !lista.some((u) => u.superAdmin)) {
    lista.unshift(usuarioParaApi({ email: sup }, permissaoEfetiva(null, null, { superAdmin: true }), true));
  }
  return lista;
}
