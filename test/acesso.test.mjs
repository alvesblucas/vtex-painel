import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizarEmail, verificarJwt, emailDaRequisicao } from '../functions/_lib/acesso.js';
import { ErroHttp } from '../functions/_lib/resposta.js';

const EQUIPE = 'minhaloja';
const AUD = 'aud-teste-123';
const ISS = `https://${EQUIPE}.cloudflareaccess.com`;
const AGORA = Date.UTC(2026, 10, 13, 12, 0, 0);
const SEG = Math.floor(AGORA / 1000);

const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
const b64json = (o) => b64url(Buffer.from(JSON.stringify(o)));

async function gerarPar(kid) {
  const par = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', par.publicKey);
  return { privada: par.privateKey, publica: { kid, kty: 'RSA', alg: 'RS256', n: jwk.n, e: jwk.e } };
}

async function assinar(privada, payload, cabecalho = {}) {
  const corpo = `${b64json({ alg: 'RS256', typ: 'JWT', kid: 'k1', ...cabecalho })}.${b64json(payload)}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privada, new TextEncoder().encode(corpo));
  return `${corpo}.${b64url(new Uint8Array(sig))}`;
}

const PAR = await gerarPar('k1');
const OUTRO = await gerarPar('k1');
const buscarChaves = async () => ({ keys: [PAR.publica] });
const opcoes = { equipe: EQUIPE, aud: AUD, agora: AGORA, buscarChaves };
const base = { email: ' Gabriela@Exemplo.COM ', aud: [AUD], iss: ISS, exp: SEG + 600, iat: SEG - 10, nbf: SEG - 10 };

async function rejeita(promessa) {
  await assert.rejects(promessa, (e) => e instanceof ErroHttp && e.status === 401 && e.codigo === 'sem-login');
}

test('normalizarEmail', () => {
  assert.equal(normalizarEmail(' Gabriela@Exemplo.COM '), 'gabriela@exemplo.com');
  assert.equal(normalizarEmail(null), '');
});

test('JWT válido é aceito e o e-mail sai normalizado', async () => {
  const token = await assinar(PAR.privada, base);
  assert.deepEqual(await verificarJwt(token, opcoes), { email: 'gabriela@exemplo.com' });
  const audTexto = await assinar(PAR.privada, { ...base, aud: AUD });
  assert.equal((await verificarJwt(audTexto, opcoes)).email, 'gabriela@exemplo.com');
});

test('JWT com aud errado, expirado, nbf futuro, iss errado ou sem e-mail é rejeitado', async () => {
  await rejeita(verificarJwt(await assinar(PAR.privada, { ...base, aud: ['outro'] }), opcoes));
  await rejeita(verificarJwt(await assinar(PAR.privada, { ...base, exp: SEG - 120 }), opcoes));
  await rejeita(verificarJwt(await assinar(PAR.privada, { ...base, nbf: SEG + 600 }), opcoes));
  await rejeita(verificarJwt(await assinar(PAR.privada, { ...base, iss: 'https://outra.cloudflareaccess.com' }), opcoes));
  await rejeita(verificarJwt(await assinar(PAR.privada, { ...base, email: undefined }), opcoes));
});

test('JWT com assinatura trocada, kid desconhecido, alg errado ou malformado é rejeitado', async () => {
  await rejeita(verificarJwt(await assinar(OUTRO.privada, base), opcoes));
  const bom = await assinar(PAR.privada, base);
  const [h, , s] = bom.split('.');
  await rejeita(verificarJwt(`${h}.${b64json({ ...base, email: 'intruso@exemplo.com' })}.${s}`, opcoes));
  await rejeita(verificarJwt(await assinar(PAR.privada, base, { kid: 'k9' }), opcoes));
  await rejeita(verificarJwt(await assinar(PAR.privada, base, { alg: 'HS256' }), opcoes));
  await rejeita(verificarJwt('abc.def', opcoes));
  await rejeita(verificarJwt('', opcoes));
});

const req = (url, headers = {}) => new Request(url, { headers });

test('emailDaRequisicao: DEV_EMAIL só vale em localhost', async () => {
  const env = { DEV_EMAIL: 'Dev@Exemplo.com' };
  await rejeita(emailDaRequisicao(req('https://meu-painel.pages.dev/api/eu'), env));
  assert.equal(await emailDaRequisicao(req('http://localhost:8788/api/eu'), env), 'dev@exemplo.com');
  assert.equal(await emailDaRequisicao(req('http://127.0.0.1:8788/api/eu'), env), 'dev@exemplo.com');
});

test('emailDaRequisicao: usa o JWT do header e falha fechado sem configuração', async () => {
  const token = await assinar(PAR.privada, base);
  const env = { ACCESS_TEAM: EQUIPE, ACCESS_AUD: AUD };
  const com = req('https://meu-painel.pages.dev/api/eu', { 'Cf-Access-Jwt-Assertion': token });
  assert.equal(await emailDaRequisicao(com, env, { agora: AGORA, buscarChaves }), 'gabriela@exemplo.com');
  await rejeita(emailDaRequisicao(req('https://meu-painel.pages.dev/api/eu'), env, { agora: AGORA, buscarChaves }));
  await rejeita(emailDaRequisicao(com, {}, { agora: AGORA, buscarChaves }));
});
