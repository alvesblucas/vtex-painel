// Cliente mínimo da OMS da VTEX (só GET), com retry para 429 e 5xx.
const TENTATIVAS = 6;
const CHAVE_OK = /^[\x21-\x7E]+$/;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

function validar(nome, valor) {
  if (!CHAVE_OK.test(String(valor ?? ''))) {
    throw new Error(`${nome} vazio, com espaço, quebra de linha ou caractere inválido. Cole de novo.`);
  }
}

// A query pode conter a chave do cliente (busca `q`): nunca entra em mensagem de erro.
const semQuery = (caminho) => caminho.split('?')[0];

export function criarVtex({ conta, appKey, appToken, fetch: f = globalThis.fetch, esperar = dormir }) {
  if (!/^[a-z0-9-]+$/i.test(String(conta ?? ''))) throw new Error('VTEX_CONTA inválida');
  validar('VTEX_APP_KEY', appKey);
  validar('VTEX_APP_TOKEN', appToken);
  const base = `https://${conta}.vtexcommercestable.com.br`;
  const headers = { Accept: 'application/json', 'X-VTEX-API-AppKey': appKey, 'X-VTEX-API-AppToken': appToken };

  return {
    async get(caminho) {
      for (let i = 0; i < TENTATIVAS; i++) {
        const r = await f(base + caminho, { headers });
        if (r.ok) return r.json().catch(() => null);
        if ((r.status === 429 || r.status >= 500) && i < TENTATIVAS - 1) {
          const depois = Number(r.headers.get('retry-after'));
          await esperar(depois > 0 ? depois * 1000 : 2000 * 2 ** i);
          continue;
        }
        throw new Error(`GET ${semQuery(caminho)} -> ${r.status}`);
      }
      throw new Error(`GET ${semQuery(caminho)} -> sem resposta`);
    },
  };
}
