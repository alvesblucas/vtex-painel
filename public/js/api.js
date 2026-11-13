// Chamadas à API do painel (mesma origem). Erros viram ErroApi {status, codigo, mensagem}.
import { paramsDosFiltros } from './estado.js';

export class ErroApi extends Error {
  constructor(status, codigo, mensagem) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
    this.codigo = codigo;
    this.mensagem = mensagem;
  }
}

// O Access renova a sessão ao recarregar a página.
function avisarSessaoExpirada() {
  if (document.getElementById('aviso-sessao')) return;
  const faixa = document.createElement('div');
  faixa.id = 'aviso-sessao';
  faixa.className = 'aviso-sessao';
  faixa.setAttribute('role', 'alert');
  faixa.innerHTML = '<span>Sessão expirada</span><button type="button" class="btn">Recarregar</button>';
  faixa.querySelector('button').addEventListener('click', () => window.location.reload());
  document.body.prepend(faixa);
}

const sessaoExpirada = () => {
  avisarSessaoExpirada();
  return new ErroApi(401, 'sessao', 'Sessão expirada — recarregue a página.');
};

/**
 * @param {string} caminho ex.: '/api/vendas/quebra?por=marca'
 * @param {object} [filtros] filtros da barra (viram de/ate/cmp + listas repetidas)
 * @param {{metodo?: string, corpo?: any, signal?: AbortSignal}} [opcoes]
 */
export async function api(caminho, filtros, { metodo = 'GET', corpo, signal } = {}) {
  const url = new URL(caminho, window.location.origin);
  if (filtros) for (const [k, v] of paramsDosFiltros(filtros)) url.searchParams.append(k, v);
  const headers = { Accept: 'application/json' };
  const init = { method: metodo, credentials: 'same-origin', headers, signal };
  if (corpo !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(corpo);
  }

  let r;
  try {
    r = await fetch(url, init);
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    // Redirecionamento do Access para outro domínio aparece como falha de rede.
    throw new ErroApi(0, 'rede', 'Sem conexão com o painel — verifique a rede ou recarregue a página.');
  }
  if (r.status === 401) throw sessaoExpirada();

  const tipo = r.headers.get('Content-Type') || '';
  if (!tipo.includes('application/json')) {
    // Página de login do Access no lugar do JSON = sessão vencida.
    if (r.ok || r.redirected) throw sessaoExpirada();
    throw new ErroApi(r.status, 'http', `Erro ${r.status} ao consultar o painel.`);
  }
  let dados;
  try {
    dados = await r.json();
  } catch {
    throw new ErroApi(r.status, 'json', 'Resposta inválida do painel.');
  }
  if (!r.ok) throw new ErroApi(r.status, dados?.erro || 'http', dados?.mensagem || `Erro ${r.status} ao consultar o painel.`);
  return dados;
}
