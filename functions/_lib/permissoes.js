// Permissão efetiva = perfil + ajustes por pessoa; super admin sempre tudo.
import { ABAS } from './abas.js';
import { ErroHttp } from './resposta.js';
import { normalizarEmail } from './acesso.js';

export { ABAS };
export { CAMPOS_VALOR, semValores } from './valores.js';

const CACHE_MS = 60000;
const cache = new Map(); // email -> { registro, quando }

function lerObjeto(v) {
  if (v && typeof v === 'object') return v;
  if (typeof v !== 'string' || !v) return null;
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

const SEM_ACESSO = () => ({ ativo: false, abas: [], verValores: false, admin: false, superAdmin: false });

export function permissaoEfetiva(usuario, perfil, { superAdmin }) {
  if (superAdmin) return { ativo: true, abas: [...ABAS], verValores: true, admin: true, superAdmin: true };
  if (!usuario || !usuario.ativo) return SEM_ACESSO();

  const doPerfil = lerObjeto(perfil?.abas);
  const base = new Set(Array.isArray(doPerfil) ? doPerfil : []);
  const ajustes = lerObjeto(usuario.ajustes) ?? {};
  const porAba = ajustes.abas && typeof ajustes.abas === 'object' ? ajustes.abas : {};
  const abas = ABAS.filter((a) => (porAba[a] === true || porAba[a] === false ? porAba[a] : base.has(a)));
  const ajusteValores = ajustes.ver_valores;
  const verValores = ajusteValores === null || ajusteValores === undefined ? Boolean(perfil?.ver_valores) : Boolean(ajusteValores);
  return { ativo: true, abas, verValores, admin: Boolean(usuario.admin), superAdmin: false };
}

export function exigirAba(context, aba) {
  const abas = context?.data?.eu?.abas;
  if (!Array.isArray(abas) || !abas.includes(aba)) {
    throw new ErroHttp(403, 'sem-permissao', 'Você não tem acesso a esta aba.');
  }
}

// Uso interno do middleware: além do "eu", informa se há linha na tabela e o último acesso gravado.
export async function carregarRegistro(db, email, env, agora = Date.now()) {
  const e = normalizarEmail(email);
  const c = cache.get(e);
  if (c && agora - c.quando < CACHE_MS) return c.registro;

  const linha = await db
    .prepare(
      `SELECT u.email, u.nome, u.perfil, u.ajustes, u.admin, u.ativo, u.ultimo_acesso,
              p.abas AS perfil_abas, p.ver_valores AS perfil_ver_valores
         FROM usuarios u LEFT JOIN perfis p ON p.id = u.perfil
        WHERE u.email = ?`,
    )
    .bind(e)
    .first();
  const superAdmin = Boolean(e) && e === normalizarEmail(env?.SUPER_ADMIN);
  const perfil = linha?.perfil_abas != null ? { abas: linha.perfil_abas, ver_valores: linha.perfil_ver_valores } : null;
  const registro = {
    eu: { email: e, nome: linha?.nome ?? null, perfil: linha?.perfil ?? null, ...permissaoEfetiva(linha, perfil, { superAdmin }) },
    cadastrado: Boolean(linha),
    ultimoAcesso: linha?.ultimo_acesso ?? null,
  };
  cache.set(e, { registro, quando: agora });
  return registro;
}

export async function carregarEu(db, email, env) {
  const { eu } = await carregarRegistro(db, email, env);
  return { ...eu, abas: [...eu.abas] };
}

export function limparCacheUsuarios() {
  cache.clear();
}
