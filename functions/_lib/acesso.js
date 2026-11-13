// Login via Cloudflare Access: valida o JWT do header Cf-Access-Jwt-Assertion (RS256, WebCrypto).
import { ErroHttp } from './resposta.js';

const CACHE_CHAVES_MS = 3600000;
const RECARGA_MIN_MS = 300000;
const FOLGA_S = 60;
const HOSTS_DEV = ['localhost', '127.0.0.1'];

const chavesEmCache = new Map(); // equipe -> { jwks, quando }

export function normalizarEmail(s) {
  return String(s ?? '').trim().toLowerCase();
}

const semLogin = (msg = 'Login inválido ou ausente.') => new ErroHttp(401, 'sem-login', msg);

function deBase64Url(s) {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

function lerJson(parte) {
  try {
    const o = JSON.parse(new TextDecoder().decode(deBase64Url(parte)));
    return o && typeof o === 'object' ? o : null;
  } catch {
    return null;
  }
}

async function buscarChavesPadrao(equipe, { forcar = false } = {}) {
  const c = chavesEmCache.get(equipe);
  const idade = c ? Date.now() - c.quando : Infinity;
  if (c && (idade < CACHE_CHAVES_MS) && !(forcar && idade >= RECARGA_MIN_MS)) return c.jwks;
  const r = await fetch(`https://${equipe}.cloudflareaccess.com/cdn-cgi/access/certs`);
  if (!r.ok) throw semLogin('Não foi possível obter as chaves do Access.');
  const jwks = await r.json();
  chavesEmCache.set(equipe, { jwks, quando: Date.now() });
  return jwks;
}

async function acharChave(kid, equipe, buscarChaves) {
  const procurar = (jwks) => (Array.isArray(jwks?.keys) ? jwks.keys : []).find((k) => k && k.kid === kid && k.n && k.e);
  let chave = procurar(await buscarChaves(equipe));
  // chave nova (rotação): recarrega uma vez, respeitando intervalo mínimo
  if (!chave && buscarChaves === buscarChavesPadrao) chave = procurar(await buscarChavesPadrao(equipe, { forcar: true }));
  return chave;
}

export async function verificarJwt(token, { equipe, aud, agora = Date.now(), buscarChaves = buscarChavesPadrao }) {
  if (!equipe || !aud) throw semLogin('Access não configurado.');
  const partes = typeof token === 'string' ? token.split('.') : [];
  if (partes.length !== 3 || partes.some((p) => !/^[A-Za-z0-9_-]+$/.test(p))) throw semLogin();
  const [h, p, s] = partes;
  const cab = lerJson(h);
  const dados = lerJson(p);
  if (!cab || !dados || cab.alg !== 'RS256' || typeof cab.kid !== 'string') throw semLogin();

  const jwk = await acharChave(cab.kid, equipe, buscarChaves);
  if (!jwk) throw semLogin();
  let valido = false;
  try {
    const chave = await crypto.subtle.importKey(
      'jwk',
      { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    valido = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', chave, deBase64Url(s), new TextEncoder().encode(`${h}.${p}`));
  } catch {
    valido = false;
  }
  if (!valido) throw semLogin();

  const agoraS = Math.floor(agora / 1000);
  const auds = Array.isArray(dados.aud) ? dados.aud : [dados.aud];
  if (dados.iss !== `https://${equipe}.cloudflareaccess.com`) throw semLogin();
  if (!auds.includes(aud)) throw semLogin();
  if (typeof dados.exp !== 'number' || dados.exp + FOLGA_S <= agoraS) throw semLogin('Login expirado.');
  if (dados.nbf !== undefined && (typeof dados.nbf !== 'number' || dados.nbf - FOLGA_S > agoraS)) throw semLogin();
  const email = normalizarEmail(dados.email);
  if (!email) throw semLogin();
  return { email };
}

export async function emailDaRequisicao(request, env, opcoes = {}) {
  const { hostname } = new URL(request.url);
  if (env.DEV_EMAIL && HOSTS_DEV.includes(hostname)) {
    const dev = normalizarEmail(env.DEV_EMAIL);
    if (dev) return dev;
  }
  if (!env.ACCESS_TEAM || !env.ACCESS_AUD) throw semLogin('Access não configurado.');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw semLogin();
  const { email } = await verificarJwt(token, { equipe: env.ACCESS_TEAM, aud: env.ACCESS_AUD, ...opcoes });
  return email;
}
