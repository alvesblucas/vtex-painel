// Shell do painel: quem sou eu → menu com as abas permitidas → rota pelo hash → view da aba.
import { api } from './api.js';
import { montarBarra } from './barra-filtros.js';
import { LISTAS, comLista, hojeLocal, lerHash, montarHash } from './estado.js';
import { avisoDados, carregando, erroCartao, esc, pronto } from './ui.js';

const ABAS = {
  visao: 'Visão geral',
  vendas: 'Vendas',
  clientes: 'Clientes',
  estoque: 'Estoque',
  pedidos: 'Pedidos',
  avaliacoes: 'Avaliações',
  precos: 'Preços e Outlet',
  saude: 'Saúde',
};
const ADMIN = { usuarios: 'Usuários e permissões' };
const IMPLEMENTADAS = new Set(['visao', 'vendas', 'clientes', 'usuarios']);
const ABAS_COM_FILTRO = ['visao', 'vendas', 'clientes'];
const LEGADO = '/legado/';

const raiz = document.getElementById('app');
let eu = null;
let opcoes = null;
let rota = null;
let aplicaveisAtuais = null;
let controle = null;
let el = {};

const fuso = () => (Number.isFinite(eu?.fusoHoras) ? eu.fusoHoras : -3);
const hoje = () => hojeLocal(fuso());
const rotuloDe = (aba) => ABAS[aba] ?? ADMIN[aba] ?? aba;

function permitidas() {
  const lista = Object.keys(ABAS).filter((a) => eu.abas.includes(a));
  if (eu.admin) lista.push('usuarios');
  return lista;
}

function irPara(aba, filtros) {
  const h = montarHash(aba, filtros);
  if (h !== window.location.hash) window.location.hash = h;
}

// ---------- telas fora do shell ----------

function telaSimples(html) {
  raiz.removeAttribute('aria-busy');
  raiz.className = 'app app-simples';
  raiz.innerHTML = `<main class="cartao-central" id="conteudo" tabindex="-1">${html}</main>`;
}

async function semAcesso() {
  try {
    const mod = await import('./views/sem-acesso.js');
    telaSimples('');
    mod.render(raiz.querySelector('main'), { eu, api });
  } catch {
    telaSimples(`<span class="selo selo-aviso">Sem acesso</span>
      <strong>Você ainda não tem acesso. Peça ao administrador.</strong>
      <span class="muted">Entrou como <span class="num">${esc(eu.email)}</span></span>`);
  }
}

function falhaInicial(e) {
  telaSimples(`<span class="selo selo-erro">Erro</span>
    <strong>Não foi possível abrir o painel</strong>
    <span class="muted">${esc(e?.mensagem || 'Falha inesperada.')}</span>
    <button type="button" class="btn" data-recarregar>Tentar de novo</button>`);
  raiz.querySelector('[data-recarregar]').addEventListener('click', () => window.location.reload());
}

// ---------- shell ----------

function montarShell() {
  const loja = eu.loja?.nome || 'Painel';
  const itens = permitidas();
  const link = (a) => `<li><a href="#${a}" data-aba="${a}">
      <span>${esc(rotuloDe(a))}</span>${IMPLEMENTADAS.has(a) ? '' : '<span class="selo">em breve</span>'}</a></li>`;
  raiz.removeAttribute('aria-busy');
  raiz.className = 'app';
  raiz.innerHTML = `
    <aside class="lateral" id="menu" aria-label="Menu">
      <div class="marca"><span class="marca-ponto" aria-hidden="true"></span><span>${esc(loja)}</span></div>
      <nav><ul class="menu">${itens.filter((a) => a !== 'usuarios').map(link).join('')}</ul>
        ${eu.admin ? `<div class="menu-sep">Administração</div><ul class="menu">${link('usuarios')}</ul>` : ''}
        <div class="menu-sep"></div>
        <ul class="menu"><li><a href="${LEGADO}"><span>Relatórios antigos</span><span aria-hidden="true">↗</span></a></li></ul>
      </nav>
      <div class="lateral-pe muted">${esc(eu.email)}</div>
    </aside>
    <button type="button" class="veu" aria-label="Fechar menu" tabindex="-1"></button>
    <div class="principal">
      <header class="topo">
        <button type="button" class="btn-menu" aria-label="Abrir menu" aria-expanded="false" aria-controls="menu">☰</button>
        <h1 class="topo-titulo" id="titulo"></h1>
        <div class="usuario">
          <span class="usuario-nome">${esc(eu.nome || eu.email)}</span>
          <span class="pill">${esc(eu.superAdmin ? 'super admin' : eu.perfil || '—')}${eu.admin && !eu.superAdmin ? ' · admin' : ''}</span>
        </div>
      </header>
      <div class="barra-filtros" id="filtros" hidden></div>
      <div class="avisos" id="avisos" hidden></div>
      <main class="conteudo" id="conteudo" tabindex="-1"></main>
    </div>`;
  el = {
    menu: raiz.querySelector('.lateral'),
    botaoMenu: raiz.querySelector('.btn-menu'),
    titulo: raiz.querySelector('#titulo'),
    filtros: raiz.querySelector('#filtros'),
    avisos: raiz.querySelector('#avisos'),
    conteudo: raiz.querySelector('#conteudo'),
  };
  const alternarMenu = (abrir) => {
    document.body.classList.toggle('menu-aberto', abrir);
    el.botaoMenu.setAttribute('aria-expanded', String(abrir));
    if (abrir) el.menu.querySelector('a')?.focus();
  };
  el.botaoMenu.addEventListener('click', () => alternarMenu(!document.body.classList.contains('menu-aberto')));
  raiz.querySelector('.veu').addEventListener('click', () => alternarMenu(false));
  el.menu.addEventListener('click', (ev) => {
    if (ev.target.closest('a')) alternarMenu(false);
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && document.body.classList.contains('menu-aberto')) {
      alternarMenu(false);
      el.botaoMenu.focus();
    }
  });
  avisoDados(el.avisos, eu.coletas ?? [], eu.agenda ?? {}, { fusoHoras: fuso() });
}

// Remontar a barra fecha um popover aberto: só remonta quando algo que ela mostra mudou.
let chaveBarra = null;

function desenharBarra() {
  if (!aplicaveisAtuais) {
    chaveBarra = null;
    el.filtros.hidden = true;
    el.filtros._desmontar?.();
    el.filtros.replaceChildren();
    return;
  }
  const chave = [montarHash('', rota.filtros), [...aplicaveisAtuais].sort().join(','), hoje(), opcoes ? 1 : 0].join('|');
  if (chave === chaveBarra) return;
  chaveBarra = chave;
  el.filtros.hidden = false;
  montarBarra(el.filtros, {
    filtros: rota.filtros,
    opcoes,
    aplicaveis: aplicaveisAtuais,
    hoje: hoje(),
    aoMudar: (f) => irPara(rota.aba, f),
  });
}

async function carregarView(aba) {
  if (!IMPLEMENTADAS.has(aba)) return import('./views/em-breve.js');
  try {
    return await import(`./views/${aba}.js`);
  } catch {
    return import('./views/em-breve.js');
  }
}

async function rotear() {
  const lido = lerHash(window.location.hash, hoje());
  const lista = permitidas();
  if (!lista.length) {
    el.titulo.textContent = 'Sem abas';
    el.conteudo.innerHTML = '<div class="estado-grande"><strong>Nenhuma aba liberada para você</strong><span class="muted">Peça ao administrador</span></div>';
    return;
  }
  if (!lista.includes(lido.aba)) {
    window.location.replace(montarHash(lista[0], lido.filtros));
    return;
  }
  const canonico = montarHash(lido.aba, lido.filtros);
  if (canonico !== window.location.hash) window.history.replaceState(null, '', canonico);

  const trocouAba = rota?.aba !== lido.aba;
  rota = lido;
  if (trocouAba) aplicaveisAtuais = null;

  controle?.abort();
  controle = new AbortController();
  const meu = controle;

  el.titulo.textContent = rotuloDe(rota.aba);
  document.title = `${rotuloDe(rota.aba)} · ${eu.loja?.nome || 'Painel'}`;
  raiz.querySelectorAll('.menu a[data-aba]').forEach((a) => {
    if (a.dataset.aba === rota.aba) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  desenharBarra();

  const ctx = {
    eu,
    aba: rota.aba,
    rotulo: rotuloDe(rota.aba),
    filtros: rota.filtros,
    opcoes,
    // Chamadas da view já levam o sinal da rota: resposta de rota antiga é abortada e nunca pinta.
    api: (caminho, filtros, opcoesApi) => api(caminho, filtros, { signal: meu.signal, ...opcoesApi }),
    signal: meu.signal,
    vivo: () => !meu.signal.aborted,
    aplicarFiltro(chave, valor) {
      if (!LISTAS.includes(chave) || rota.filtros[chave].includes(valor)) return;
      const novo = comLista(rota.filtros, chave, [...rota.filtros[chave], valor], opcoes?.cidades);
      if (novo) irPara(rota.aba, novo);
    },
    aplicaveis(conjunto) {
      if (meu !== controle) return;
      aplicaveisAtuais = new Set(conjunto);
      desenharBarra();
    },
  };

  if (trocouAba) {
    el.conteudo.replaceChildren();
    carregando(el.conteudo);
    window.scrollTo(0, 0);
  }
  try {
    const mod = await carregarView(rota.aba);
    if (meu !== controle) return;
    pronto(el.conteudo);
    if (trocouAba) el.conteudo.replaceChildren();
    await mod.render(el.conteudo, ctx);
  } catch (e) {
    if (e?.name === 'AbortError' || meu !== controle) return;
    erroCartao(el.conteudo, e?.mensagem || 'Não foi possível abrir esta aba.', () => rotear());
  }
}

async function carregarOpcoes() {
  if (!ABAS_COM_FILTRO.some((a) => eu.abas.includes(a))) return;
  try {
    opcoes = await api('/api/opcoes');
  } catch {
    opcoes = null; // a barra continua funcionando com os valores já escolhidos
  }
  if (aplicaveisAtuais) desenharBarra();
}

async function iniciar() {
  try {
    eu = await api('/api/eu');
  } catch (e) {
    falhaInicial(e);
    return;
  }
  if (!eu.ativo) {
    semAcesso();
    return;
  }
  montarShell();
  window.addEventListener('hashchange', rotear);
  carregarOpcoes();
  rotear();
}

// O link "pular para o conteúdo" não pode mexer no hash (o hash é a rota).
document.querySelector('.pular')?.addEventListener('click', (ev) => {
  ev.preventDefault();
  document.getElementById('conteudo')?.focus();
});

iniciar();
