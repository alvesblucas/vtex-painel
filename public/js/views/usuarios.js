// Usuários e permissões (só admin): Pessoas, Perfis e Histórico. Toda escrita passa pela API, que audita.
// Admin comum: no próprio cadastro só o nome; cadastro de outro administrador, nada (R15, mesma regra da API).
import { ROTULOS_ABAS } from '../estado.js';
import { erroCartao, esc, quando, tabela } from '../ui.js';
import { estrutura } from './comum.js';

const ABAS = Object.keys(ROTULOS_ABAS);
const SO_SUPER = 'Só o administrador principal pode alterar';
const ACOES = {
  'usuario.criar': 'Criou pessoa',
  'usuario.editar': 'Editou pessoa',
  'perfil.criar': 'Criou perfil',
  'perfil.editar': 'Editou perfil',
};
const INTERNAS = [
  ['pessoas', 'Pessoas'],
  ['perfis', 'Perfis'],
  ['historico', 'Histórico'],
];
const ESQUELETO = '<div class="esqueleto" aria-label="Carregando"><span></span><span></span><span></span></div>';
const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

let abaInterna = 'pessoas';
const pilhaModais = []; // o Esc e o Tab valem só para o modal de cima

const simNao = (v) => (v ? 'sim' : 'não');
const rotuloAba = (a) => ROTULOS_ABAS[a] ?? a;

export async function render(el, ctx) {
  ctx.aplicaveis([]);
  const { raiz } = estrutura(el, 'usuarios', `
    <div class="segmentos abas-internas" role="tablist" aria-label="Seções">
      ${INTERNAS.map(([k, t]) => `<button type="button" class="segmento" role="tab" id="aba-${k}" data-interna="${k}"
        aria-controls="painel-${k}">${t}</button>`).join('')}
    </div>
    <p class="aviso-salvo" role="status" aria-live="polite"></p>
    ${INTERNAS.map(([k]) => `<section class="card" role="tabpanel" id="painel-${k}" aria-labelledby="aba-${k}" hidden></section>`).join('')}`, 'admin');
  const st = { ctx, raiz, usuarios: [], perfis: [], seq: { pessoas: 0, perfis: 0, historico: 0 } };
  const abas = [...raiz.querySelectorAll('[role=tab]')];
  const mostrar = (k, focar = false) => {
    abaInterna = k;
    abas.forEach((b) => {
      const sel = b.dataset.interna === k;
      b.setAttribute('aria-selected', String(sel));
      b.tabIndex = sel ? 0 : -1;
      if (sel && focar) b.focus();
    });
    raiz.querySelectorAll('[role=tabpanel]').forEach((p) => {
      p.hidden = p.id !== `painel-${k}`;
    });
    if (k === 'pessoas') carregarPessoas(st);
    else if (k === 'perfis') carregarPerfis(st);
    else carregarHistorico(st);
  };
  abas.forEach((b, i) => {
    b.addEventListener('click', () => mostrar(b.dataset.interna));
    b.addEventListener('keydown', (ev) => {
      const passo = { ArrowRight: 1, ArrowLeft: -1 }[ev.key];
      if (!passo) return;
      ev.preventDefault();
      mostrar(abas[(i + passo + abas.length) % abas.length].dataset.interna, true);
    });
  });
  mostrar(abaInterna);
}

function avisar(st, texto) {
  const el = st.raiz.querySelector('.aviso-salvo');
  el.textContent = texto;
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.textContent = '';
  }, 5000);
}

// Lê a lista e devolve null se outra recarga (ou outra rota) passou na frente.
async function buscar(st, chave, carregar) {
  const meu = ++st.seq[chave];
  const dados = await carregar();
  return meu === st.seq[chave] && st.ctx.vivo() ? dados : null;
}

async function protegido(st, painel, chave, fn) {
  if (!painel.dataset.pintado) painel.innerHTML = ESQUELETO;
  else painel.classList.add('recarregando');
  try {
    await fn();
  } catch (e) {
    if (e?.name === 'AbortError' || !st.ctx.vivo()) return;
    delete painel.dataset.pintado;
    erroCartao(painel, e?.mensagem || 'Não foi possível carregar.', () => {
      if (chave === 'pessoas') carregarPessoas(st);
      else if (chave === 'perfis') carregarPerfis(st);
      else carregarHistorico(st);
    });
  } finally {
    painel.classList.remove('recarregando');
  }
}

// ---------- permissões herdadas e regras de edição ----------

const perfilDe = (st, id) => st.perfis.find((p) => p.id === id) ?? null;
const herdaAba = (perfil, aba) => Boolean(perfil?.abas.includes(aba));

// O que o admin logado pode fazer neste cadastro.
function regras(eu, alvo) {
  if (!alvo) return { editar: true, soNome: false, motivo: '' };
  if (alvo.superAdmin) return { editar: false, soNome: false, motivo: 'Administrador principal: não editável' };
  if (eu.superAdmin) return { editar: true, soNome: false, motivo: '' };
  if (alvo.email === eu.email) return { editar: true, soNome: true, motivo: SO_SUPER };
  if (alvo.admin) return { editar: false, soNome: false, motivo: SO_SUPER };
  return { editar: true, soNome: false, motivo: '' };
}

// ---------- Pessoas ----------

async function carregarPessoas(st) {
  const painel = st.raiz.querySelector('#painel-pessoas');
  await protegido(st, painel, 'pessoas', async () => {
    const r = await buscar(st, 'pessoas', () => Promise.all([
      st.ctx.api('/api/admin/usuarios'),
      st.ctx.api('/api/admin/perfis'),
    ]));
    if (!r) return;
    [st.usuarios, st.perfis] = r;
    pintarPessoas(st, painel);
  });
}

function linhaPessoa(st, u) {
  const abas = u.efetiva?.abas ?? [];
  return {
    ...u,
    nomeTxt: u.nome || '—',
    perfilTxt: u.superAdmin ? 'tudo' : perfilDe(st, u.perfil)?.nome ?? u.perfil ?? '—',
    abasTxt: abas.length === ABAS.length ? 'Todas' : abas.map(rotuloAba).join(', ') || 'Nenhuma',
    rsTxt: simNao(u.efetiva?.verValores),
    ativoTxt: u.ativo ? 'ativo' : 'inativo',
  };
}

function pintarPessoas(st, painel) {
  const { eu } = st.ctx;
  const filtroAntes = {
    perfil: painel.querySelector('[data-f=perfil]')?.value ?? '',
    status: painel.querySelector('[data-f=status]')?.value ?? '',
  };
  painel.dataset.pintado = '1';
  painel.innerHTML = `<div class="card-head">
      <h2>Pessoas</h2>
      <div class="ferramentas">
        <label class="filtro-select"><span class="filtro-rotulo">Perfil</span>
          <select data-f="perfil"><option value="">Todos</option>
            ${st.perfis.map((p) => `<option value="${esc(p.id)}">${esc(p.nome)}</option>`).join('')}</select></label>
        <label class="filtro-select"><span class="filtro-rotulo">Status</span>
          <select data-f="status"><option value="">Todos</option><option value="1">Ativos</option><option value="0">Inativos</option></select></label>
        <button type="button" class="btn primario" data-adicionar>Adicionar pessoa</button>
      </div>
    </div>
    <div data-tabela></div>`;
  const selPerfil = painel.querySelector('[data-f=perfil]');
  const selStatus = painel.querySelector('[data-f=status]');
  if ([...selPerfil.options].some((o) => o.value === filtroAntes.perfil)) selPerfil.value = filtroAntes.perfil;
  selStatus.value = filtroAntes.status;

  const todas = st.usuarios.map((u) => linhaPessoa(st, u));
  const filtradas = () => todas.filter((u) => (!selPerfil.value || u.perfil === selPerfil.value)
    && (!selStatus.value || String(Number(u.ativo)) === selStatus.value));
  const fuso = Number.isFinite(eu.fusoHoras) ? eu.fusoHoras : -3;
  const t = tabela(painel.querySelector('[data-tabela]'), {
    busca: true,
    porPagina: 25,
    vazioTexto: 'Nenhuma pessoa com esses filtros.',
    linhas: filtradas(),
    colunas: [
      { chave: 'nomeTxt', titulo: 'Nome', celula: (u, td) => celulaNome(u, td) },
      { chave: 'email', titulo: 'E-mail', celula: (u, td) => {
        td.className = 'num quebra';
        td.textContent = u.email;
      } },
      { chave: 'perfilTxt', titulo: 'Perfil' },
      { chave: 'abasTxt', titulo: 'Abas', ordenavel: false, celula: (u, td) => celulaAbas(u, td) },
      { chave: 'rsTxt', titulo: 'R$' },
      { chave: 'ultimo_acesso', titulo: 'Último acesso', formato: (v) => (v ? quando(v, fuso) : '—') },
      { chave: 'ativoTxt', titulo: 'Status', celula: (u, td) => {
        td.innerHTML = `<span class="pill ${u.ativo ? 'st-ok' : 'st-fora'}"><i aria-hidden="true"></i>${u.ativo ? 'ativo' : 'inativo'}</span>`;
      } },
      { chave: 'acao', titulo: 'Ações', ordenavel: false, celula: (u, td) => celulaAcao(st, u, td) },
    ],
  });
  const refiltrar = () => t.atualizar({ linhas: filtradas(), pagina: 1 });
  selPerfil.addEventListener('change', refiltrar);
  selStatus.addEventListener('change', refiltrar);
  painel.querySelector('[data-adicionar]').addEventListener('click', (ev) => editarPessoa(st, null, ev.currentTarget));
}

function celulaNome(u, td) {
  td.append(document.createTextNode(u.nome || '—'));
  const selo = u.superAdmin ? 'administrador principal' : u.admin ? 'admin' : '';
  if (selo) {
    const s = document.createElement('span');
    s.className = `selo ${u.superAdmin ? 'selo-principal' : ''}`;
    s.textContent = selo;
    td.append(' ', s);
  }
}

function celulaAbas(u, td) {
  const abas = u.efetiva?.abas ?? [];
  let html = abas.map((a) => `<span class="selo">${esc(rotuloAba(a))}</span>`).join('');
  if (!abas.length) html = '<span class="muted">nenhuma</span>';
  else if (abas.length === ABAS.length) html = '<span class="selo">todas</span>';
  td.innerHTML = `<div class="chips">${html}</div>`;
}

function celulaAcao(st, u, td) {
  const r = regras(st.ctx.eu, u);
  if (u.superAdmin) {
    td.innerHTML = '<span class="muted">sem edição</span>';
    return;
  }
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn';
  b.dataset.editar = u.email;
  b.textContent = 'Editar';
  b.setAttribute('aria-label', `Editar ${u.nome || u.email}`);
  if (!r.editar) {
    b.disabled = true;
    const w = document.createElement('span');
    w.title = r.motivo;
    w.className = 'dica-bloqueio';
    w.append(b);
    td.append(w);
    return;
  }
  b.addEventListener('click', () => editarPessoa(st, u, b));
  td.append(b);
}

// ---------- modais (painel lateral e confirmação) ----------

function abrirModal(caixa, { aoEsc, voltar = null }) {
  const anterior = voltar ?? document.activeElement;
  const inertes = [...document.body.children].filter((c) => c !== caixa && !c.inert);
  inertes.forEach((c) => {
    c.inert = true;
  });
  document.body.append(caixa);
  pilhaModais.push(caixa);
  const tecla = (ev) => {
    if (pilhaModais[pilhaModais.length - 1] !== caixa) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      aoEsc();
      return;
    }
    if (ev.key !== 'Tab') return;
    const f = [...caixa.querySelectorAll(FOCAVEIS)].filter((e) => e.getClientRects().length);
    if (!f.length) return;
    const [primeiro, ultimo] = [f[0], f[f.length - 1]];
    if (!caixa.contains(document.activeElement)) {
      ev.preventDefault();
      primeiro.focus();
    } else if (ev.shiftKey && document.activeElement === primeiro) {
      ev.preventDefault();
      ultimo.focus();
    } else if (!ev.shiftKey && document.activeElement === ultimo) {
      ev.preventDefault();
      primeiro.focus();
    }
  };
  // No documento: mesmo com o foco perdido (ex.: botão desabilitado durante o envio), Esc e Tab continuam presos aqui.
  document.addEventListener('keydown', tecla);
  return function fechar(devolverFoco = true) {
    document.removeEventListener('keydown', tecla);
    pilhaModais.splice(pilhaModais.indexOf(caixa), 1);
    caixa.remove();
    inertes.forEach((c) => {
      c.inert = false;
    });
    if (devolverFoco && anterior?.isConnected) anterior.focus();
  };
}

/** Diálogo de confirmação dentro do app. Resolve true (confirmou) ou false. */
export function confirmar({ titulo, texto, botao = 'Confirmar', perigo = false }) {
  return new Promise((resolver) => {
    const caixa = document.createElement('div');
    caixa.className = 'modal-fundo';
    caixa.innerHTML = `<div class="dialogo" role="alertdialog" aria-modal="true" aria-labelledby="dlg-t" aria-describedby="dlg-d">
        <h2 id="dlg-t">${esc(titulo)}</h2>
        <p id="dlg-d" class="muted">${esc(texto)}</p>
        <div class="dialogo-pe">
          <button type="button" class="btn" data-nao>Cancelar</button>
          <button type="button" class="btn ${perigo ? 'perigo' : 'primario'}" data-sim>${esc(botao)}</button>
        </div>
      </div>`;
    let fechar = null;
    const fim = (v) => {
      fechar();
      resolver(v);
    };
    fechar = abrirModal(caixa, { aoEsc: () => fim(false) });
    caixa.querySelector('[data-nao]').addEventListener('click', () => fim(false));
    caixa.querySelector('[data-sim]').addEventListener('click', () => fim(true));
    caixa.addEventListener('click', (ev) => {
      if (ev.target === caixa) fim(false);
    });
    caixa.querySelector('[data-nao]').focus();
  });
}

/**
 * Painel lateral com formulário. `montar(form)` liga os campos e devolve `estado()` (serializa o formulário,
 * para saber se há alterações). `salvar(form, mudou)` lança erro para mostrar a mensagem sem fechar,
 * devolve false para continuar aberto, ou true / uma função a rodar depois de fechar (recarregar e focar).
 */
function gaveta(st, { titulo, html, gatilho, montar, salvar }) {
  const caixa = document.createElement('div');
  caixa.className = 'modal-fundo gaveta-fundo';
  caixa.innerHTML = `<aside class="gaveta" role="dialog" aria-modal="true" aria-labelledby="gaveta-t">
      <header class="gaveta-topo"><h2 id="gaveta-t">${esc(titulo)}</h2>
        <button type="button" class="btn-fechar" data-fechar aria-label="Fechar">×</button></header>
      <form class="gaveta-corpo" novalidate>${html}</form>
      <div class="gaveta-erro" role="alert"></div>
      <footer class="gaveta-pe">
        <button type="button" class="btn" data-fechar>Cancelar</button>
        <button type="button" class="btn primario" data-salvar>Salvar</button>
      </footer>
    </aside>`;
  const form = caixa.querySelector('form');
  const erro = caixa.querySelector('.gaveta-erro');
  const botaoSalvar = caixa.querySelector('[data-salvar]');
  const estado = montar(form);
  const inicial = estado();
  let ocupado = false;
  let fechada = false;

  const fecharAgora = (devolverFoco = true) => {
    if (fechada) return;
    fechada = true;
    st.ctx.signal.removeEventListener('abort', aoTrocarRota);
    fecharModal(devolverFoco);
  };
  const aoTrocarRota = () => fecharAgora(false);
  const tentarFechar = async () => {
    if (ocupado) return;
    if (estado() !== inicial) {
      const ok = await confirmar({ titulo: 'Descartar alterações?', texto: 'O que foi mudado aqui não será salvo.', botao: 'Descartar', perigo: true });
      if (!ok) return;
    }
    fecharAgora();
  };
  const fecharModal = abrirModal(caixa, { aoEsc: tentarFechar, voltar: gatilho });
  st.ctx.signal.addEventListener('abort', aoTrocarRota);

  caixa.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', tentarFechar));
  caixa.addEventListener('mousedown', (ev) => {
    if (ev.target === caixa) tentarFechar();
  });
  form.addEventListener('submit', (ev) => ev.preventDefault());
  botaoSalvar.addEventListener('click', async () => {
    if (ocupado) return;
    ocupado = true;
    botaoSalvar.disabled = true;
    botaoSalvar.textContent = 'Salvando…';
    erro.textContent = '';
    try {
      const fim = await salvar(form, estado() !== inicial);
      if (fim) {
        fecharAgora();
        if (typeof fim === 'function') await fim();
      }
    } catch (e) {
      if (e?.name === 'AbortError') return;
      erro.textContent = e?.mensagem || e?.message || 'Não foi possível salvar.';
    } finally {
      ocupado = false;
      botaoSalvar.disabled = false;
      botaoSalvar.textContent = 'Salvar';
      if (!fechada && !caixa.contains(document.activeElement)) botaoSalvar.focus();
    }
  });
  (form.querySelector('input:not([disabled]), select:not([disabled])') ?? caixa.querySelector('[data-fechar]')).focus();
}

// ---------- editar / adicionar pessoa ----------

function triAba(aba, valor, herdado, bloqueado) {
  const opcoes = [['h', `Herdado (${simNao(herdado)})`], ['l', 'Liberado'], ['b', 'Bloqueado']];
  return `<fieldset class="tri-linha" ${bloqueado ? 'disabled' : ''}>
      <legend>${esc(aba.rotulo)}</legend>
      <div class="tri" data-tri="${esc(aba.chave)}">${opcoes.map(([v, t]) => `<label class="tri-op" data-v="${v}">
        <input class="sr" type="radio" name="tri-${esc(aba.chave)}" value="${v}" ${valor === v ? 'checked' : ''}>
        <span data-texto>${esc(t)}</span></label>`).join('')}</div>
    </fieldset>`;
}

const triDe = (v) => (v === true ? 'l' : v === false ? 'b' : 'h');
const deTri = (v) => (v === 'l' ? true : v === 'b' ? false : undefined);

function editarPessoa(st, alvo, gatilho) {
  const { eu } = st.ctx;
  const r = regras(eu, alvo);
  if (!r.editar) return;
  const novo = !alvo;
  const ajustes = alvo?.ajustes ?? {};
  const perfilInicial = alvo?.perfil ?? st.perfis[0]?.id ?? '';
  const so = r.soNome;
  const nota = (texto) => `<span class="campo-nota" title="${esc(SO_SUPER)}">${esc(texto)}</span>`;
  const bloqueioAdmin = !eu.superAdmin;
  const bloqueioAtivo = so;
  const html = `
    ${so ? `<div class="aviso-info"><span aria-hidden="true">i</span>No seu próprio cadastro você só muda o nome. ${esc(SO_SUPER)}.</div>` : ''}
    <label class="campo"><span>E-mail</span>
      ${novo ? '<input class="input" name="email" type="email" autocomplete="off" required placeholder="nome@exemplo.com">'
    : `<span class="num campo-fixo">${esc(alvo.email)}</span>`}</label>
    <label class="campo"><span>Nome</span><input class="input" name="nome" maxlength="100" required value="${esc(alvo?.nome ?? '')}"></label>
    <label class="campo" ${so ? `title="${esc(SO_SUPER)}"` : ''}><span>Perfil</span>
      <select class="input" name="perfil" ${so ? 'disabled' : ''}>${st.perfis.map((p) => `<option value="${esc(p.id)}" ${p.id === perfilInicial ? 'selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></label>
    <div class="campo-grupo" ${so ? `title="${esc(SO_SUPER)}"` : ''}>
      <div class="campo-titulo">Abas <span class="muted">ajuste desta pessoa sobre o perfil</span></div>
      ${ABAS.map((a) => triAba({ chave: a, rotulo: rotuloAba(a) }, triDe(ajustes.abas?.[a]), herdaAba(perfilDe(st, perfilInicial), a), so)).join('')}
      ${triAba({ chave: '_rs', rotulo: 'Ver valores em R$' }, triDe(ajustes.ver_valores), Boolean(perfilDe(st, perfilInicial)?.ver_valores), so)}
    </div>
    <label class="campo-check" ${bloqueioAdmin ? `title="${esc(SO_SUPER)}"` : ''}>
      <input type="checkbox" name="admin" ${alvo?.admin ? 'checked' : ''} ${bloqueioAdmin ? 'disabled' : ''}>
      <span>Administrador <span class="muted">gerencia pessoas e perfis</span></span></label>
    ${bloqueioAdmin ? nota(SO_SUPER) : ''}
    <label class="campo-check" ${bloqueioAtivo ? `title="${esc(SO_SUPER)}"` : ''}>
      <input type="checkbox" name="ativo" ${!alvo || alvo.ativo ? 'checked' : ''} ${bloqueioAtivo ? 'disabled' : ''}>
      <span>Ativo <span class="muted">pode entrar no painel</span></span></label>`;

  const ler = (form) => {
    const tri = (k) => form.querySelector(`input[name="tri-${k}"]:checked`)?.value ?? 'h';
    const abas = {};
    for (const a of ABAS) {
      const v = deTri(tri(a));
      if (v !== undefined) abas[a] = v;
    }
    const rs = deTri(tri('_rs'));
    return {
      email: form.elements.email?.value.trim() ?? alvo?.email,
      nome: form.elements.nome.value.trim(),
      perfil: form.elements.perfil.value,
      ajustes: { abas, ver_valores: rs === undefined ? null : rs },
      admin: form.elements.admin.checked,
      ativo: form.elements.ativo.checked,
    };
  };

  gaveta(st, {
    titulo: novo ? 'Adicionar pessoa' : 'Editar pessoa',
    html,
    gatilho,
    montar(form) {
      // Trocar o perfil atualiza o "Herdado (sim/não)" de cada linha.
      form.elements.perfil.addEventListener('change', () => {
        const p = perfilDe(st, form.elements.perfil.value);
        for (const a of [...ABAS, '_rs']) {
          const h = a === '_rs' ? Boolean(p?.ver_valores) : herdaAba(p, a);
          const span = form.querySelector(`[data-tri="${a}"] [data-v="h"] [data-texto]`);
          if (span) span.textContent = `Herdado (${simNao(h)})`;
        }
      });
      return () => JSON.stringify(ler(form));
    },
    async salvar(form, mudou) {
      if (!mudou && !novo) return true;
      const v = ler(form);
      if (novo && !v.email) throw new Error('Informe o e-mail.');
      if (!v.nome) throw new Error('Informe o nome.');
      let corpo;
      if (novo) {
        corpo = { email: v.email, nome: v.nome, perfil: v.perfil, ajustes: v.ajustes, ativo: v.ativo };
        if (eu.superAdmin) corpo.admin = v.admin;
      } else {
        const antes = JSON.parse(estadoInicialPessoa(alvo, perfilInicial));
        corpo = {};
        if (v.nome !== antes.nome) corpo.nome = v.nome;
        if (!so) {
          if (v.perfil !== antes.perfil) corpo.perfil = v.perfil;
          if (JSON.stringify(v.ajustes) !== JSON.stringify(antes.ajustes)) corpo.ajustes = v.ajustes;
          if (!bloqueioAtivo && v.ativo !== antes.ativo) corpo.ativo = v.ativo;
          if (eu.superAdmin && v.admin !== antes.admin) corpo.admin = v.admin;
        }
        if (!Object.keys(corpo).length) return true;
        if (corpo.ativo === false) {
          const ok = await confirmar({
            titulo: `Desativar ${alvo.nome || alvo.email}?`,
            texto: 'A pessoa perde o acesso ao painel. Dá para reativar depois.',
            botao: 'Desativar',
            perigo: true,
          });
          if (!ok) return false;
        }
      }
      const salvo = novo
        ? await st.ctx.api('/api/admin/usuarios', null, { metodo: 'POST', corpo })
        : await st.ctx.api(`/api/admin/usuarios/${encodeURIComponent(alvo.email)}`, null, { metodo: 'PATCH', corpo });
      avisar(st, novo ? `${salvo.nome || salvo.email} adicionada` : `${salvo.nome || salvo.email}: alterações salvas`);
      return async () => {
        await carregarPessoas(st);
        const foco = st.raiz.querySelector(`[data-editar="${CSS.escape(salvo.email)}"]`) ?? st.raiz.querySelector('[data-adicionar]');
        foco?.focus();
      };
    },
  });
}

// Estado do cadastro como o formulário o leria (para mandar só o que mudou).
function estadoInicialPessoa(alvo, perfil) {
  const aj = alvo.ajustes ?? {};
  const abas = {};
  for (const a of ABAS) if (aj.abas?.[a] === true || aj.abas?.[a] === false) abas[a] = aj.abas[a];
  const rs = aj.ver_valores === true || aj.ver_valores === false ? aj.ver_valores : null;
  return JSON.stringify({ nome: alvo.nome ?? '', perfil, ajustes: { abas, ver_valores: rs }, admin: alvo.admin, ativo: alvo.ativo });
}

// ---------- Perfis ----------

async function carregarPerfis(st) {
  const painel = st.raiz.querySelector('#painel-perfis');
  await protegido(st, painel, 'perfis', async () => {
    const perfis = await buscar(st, 'perfis', () => st.ctx.api('/api/admin/perfis'));
    if (!perfis) return;
    st.perfis = perfis;
    pintarPerfis(st, painel);
  });
}

function pintarPerfis(st, painel) {
  painel.dataset.pintado = '1';
  const somenteLeitura = !st.ctx.eu.superAdmin; // R18: perfis só o super admin edita
  const trava = somenteLeitura ? ` disabled title="${esc(SO_SUPER)}"` : '';
  painel.innerHTML = `<div class="card-head"><h2>Perfis</h2>
      <div class="ferramentas"><span class="sub">marque o que cada perfil vê; ajustes por pessoa ficam em Pessoas</span>
        <button type="button" class="btn primario" data-criar-perfil${trava}>Criar perfil</button></div></div>
    <div class="matriz-erro" role="alert"></div>
    <div class="tabela-wrap"><table class="matriz">
      <thead><tr><th scope="col"><span class="th-fixo">Perfil</span></th>
        ${ABAS.map((a) => `<th scope="col" class="c"><span class="th-fixo">${esc(rotuloAba(a))}</span></th>`).join('')}
        <th scope="col" class="c"><span class="th-fixo">Ver R$</span></th>
        <th scope="col" class="r"><span class="th-fixo">Pessoas</span></th>
        <th scope="col"><span class="sr">Ações</span></th></tr></thead>
      <tbody>${st.perfis.map((p) => `<tr data-perfil="${esc(p.id)}">
        <th scope="row" class="matriz-nome">${esc(p.nome)} <span class="muted num">${esc(p.id)}</span></th>
        ${ABAS.map((a) => `<td class="c"><input type="checkbox" data-aba="${a}" ${p.abas.includes(a) ? 'checked' : ''}
          aria-label="${esc(p.nome)}: ${esc(rotuloAba(a))}"${trava}></td>`).join('')}
        <td class="c"><input type="checkbox" data-rs ${p.ver_valores ? 'checked' : ''} aria-label="${esc(p.nome)}: ver valores em R$"${trava}></td>
        <td class="r num">${esc(p.usuarios ?? 0)}</td>
        <td><button type="button" class="btn" data-salvar-perfil disabled${somenteLeitura ? ` title="${esc(SO_SUPER)}"` : ''}>Salvar</button></td>
      </tr>`).join('')}</tbody></table></div>`;
  const erro = painel.querySelector('.matriz-erro');
  painel.querySelectorAll('tr[data-perfil]').forEach((tr) => {
    const p = st.perfis.find((x) => x.id === tr.dataset.perfil);
    const ler = () => ({
      abas: ABAS.filter((a) => tr.querySelector(`[data-aba="${a}"]`).checked),
      ver_valores: tr.querySelector('[data-rs]').checked,
    });
    const botao = tr.querySelector('[data-salvar-perfil]');
    const mudou = () => JSON.stringify(ler()) !== JSON.stringify({ abas: ABAS.filter((a) => p.abas.includes(a)), ver_valores: p.ver_valores });
    tr.addEventListener('change', () => {
      botao.disabled = !mudou();
      tr.classList.toggle('sujo', mudou());
    });
    botao.addEventListener('click', async () => {
      erro.textContent = '';
      const n = Number(p.usuarios ?? 0);
      if (n > 1) {
        const ok = await confirmar({
          titulo: `Alterar o perfil ${p.nome}?`,
          texto: `Afeta ${n} pessoas que usam este perfil.`,
          botao: 'Salvar perfil',
        });
        if (!ok) return;
      }
      botao.disabled = true;
      botao.textContent = 'Salvando…';
      try {
        await st.ctx.api(`/api/admin/perfis/${encodeURIComponent(p.id)}`, null, { metodo: 'PATCH', corpo: ler() });
        avisar(st, `Perfil ${p.nome} salvo`);
        await carregarPerfis(st);
        painel.querySelector(`tr[data-perfil="${CSS.escape(p.id)}"] input`)?.focus();
      } catch (e) {
        if (e?.name === 'AbortError') return;
        erro.textContent = `${p.nome}: ${e?.mensagem || 'não foi possível salvar.'}`;
        botao.disabled = false;
        botao.textContent = 'Salvar';
      }
    });
  });
  if (!somenteLeitura) painel.querySelector('[data-criar-perfil]').addEventListener('click', (ev) => criarPerfil(st, ev.currentTarget));
}

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
  .replace(/^[^a-z]+/, '').replace(/-+$/, '').slice(0, 31);

function criarPerfil(st, gatilho) {
  const html = `
    <label class="campo"><span>Nome</span><input class="input" name="nome" maxlength="60" required placeholder="Financeiro"></label>
    <label class="campo"><span>Identificador <span class="muted">minúsculas, números e hífen</span></span>
      <input class="input num" name="id" maxlength="31" required placeholder="financeiro"></label>
    <fieldset class="campo-grupo"><legend class="campo-titulo">Abas</legend>
      ${ABAS.map((a) => `<label class="campo-check"><input type="checkbox" name="aba" value="${a}"><span>${esc(rotuloAba(a))}</span></label>`).join('')}
    </fieldset>
    <label class="campo-check"><input type="checkbox" name="ver_valores"><span>Ver valores em R$</span></label>`;
  const ler = (form) => ({
    id: form.elements.id.value.trim(),
    nome: form.elements.nome.value.trim(),
    abas: [...form.querySelectorAll('input[name=aba]:checked')].map((i) => i.value),
    ver_valores: form.elements.ver_valores.checked,
  });
  gaveta(st, {
    titulo: 'Criar perfil',
    html,
    gatilho,
    montar(form) {
      let idManual = false;
      form.elements.id.addEventListener('input', () => {
        idManual = true;
      });
      form.elements.nome.addEventListener('input', () => {
        if (!idManual) form.elements.id.value = slug(form.elements.nome.value);
      });
      return () => JSON.stringify(ler(form));
    },
    async salvar(form) {
      const v = ler(form);
      if (!v.nome) throw new Error('Informe o nome.');
      const criado = await st.ctx.api('/api/admin/perfis', null, { metodo: 'POST', corpo: v });
      avisar(st, `Perfil ${criado.nome} criado`);
      return async () => {
        await carregarPerfis(st);
        st.raiz.querySelector('[data-criar-perfil]')?.focus();
      };
    },
  });
}

// ---------- Histórico ----------

const filtrosHist = { quem: '', alvo: '', de: '', ate: '', pagina: 1 };

function valorLegivel(k, v) {
  if (v == null) return '—';
  if (['admin', 'ativo', 'ver_valores'].includes(k)) return simNao(Boolean(v));
  if (k === 'abas' && Array.isArray(v)) return v.map(rotuloAba).join(', ') || 'nenhuma';
  if (k === 'ajustes' && typeof v === 'object') {
    const partes = Object.entries(v.abas ?? {}).map(([a, s]) => `${rotuloAba(a)} ${s ? 'liberada' : 'bloqueada'}`);
    if (v.ver_valores === true || v.ver_valores === false) partes.push(`R$ ${simNao(v.ver_valores)}`);
    return partes.join(', ') || 'nenhum';
  }
  return String(v);
}

const ROTULOS_CAMPO = { nome: 'nome', perfil: 'perfil', ajustes: 'ajustes', admin: 'admin', ativo: 'ativo', abas: 'abas', ver_valores: 'R$' };

// "antes → depois" só dos campos que mudaram (na criação, o estado inicial).
export function resumoMudanca(antes, depois) {
  const campos = Object.keys(ROTULOS_CAMPO).filter((k) => (depois && k in depois) || (antes && k in antes));
  if (!antes) return campos.map((k) => `${ROTULOS_CAMPO[k]}: ${valorLegivel(k, depois[k])}`).join(' · ');
  const mudou = campos.filter((k) => JSON.stringify(antes[k] ?? null) !== JSON.stringify(depois?.[k] ?? null));
  if (!mudou.length) return 'sem mudança';
  return mudou.map((k) => {
    if (k === 'abas' && Array.isArray(antes.abas) && Array.isArray(depois?.abas)) {
      const mais = depois.abas.filter((a) => !antes.abas.includes(a)).map((a) => `+${rotuloAba(a)}`);
      const menos = antes.abas.filter((a) => !depois.abas.includes(a)).map((a) => `−${rotuloAba(a)}`);
      return `abas: ${[...mais, ...menos].join(' ')}`;
    }
    return `${ROTULOS_CAMPO[k]}: ${valorLegivel(k, antes[k])} → ${valorLegivel(k, depois?.[k])}`;
  }).join(' · ');
}

async function carregarHistorico(st) {
  const painel = st.raiz.querySelector('#painel-historico');
  if (!painel.querySelector('[data-hist-tabela]')) montarHistorico(st, painel);
  const alvoTabela = painel.querySelector('[data-hist-tabela]');
  await protegido(st, alvoTabela, 'historico', async () => {
    const params = new URLSearchParams();
    for (const k of ['quem', 'alvo', 'de', 'ate']) if (filtrosHist[k]) params.set(k, filtrosHist[k]);
    params.set('pagina', String(filtrosHist.pagina));
    const r = await buscar(st, 'historico', () => Promise.all([
      st.ctx.api(`/api/admin/auditoria?${params}`),
      st.usuarios.length ? st.usuarios : st.ctx.api('/api/admin/usuarios'),
    ]));
    if (!r) return;
    const [dados, usuarios] = r;
    st.usuarios = usuarios;
    preencherPessoasHist(st, painel);
    pintarHistorico(st, alvoTabela, dados);
  });
}

function montarHistorico(st, painel) {
  painel.innerHTML = `<div class="card-head"><h2>Histórico</h2><span class="sub">somente leitura · mais recentes primeiro</span></div>
    <div class="ferramentas hist-filtros">
      <label class="filtro-select"><span class="filtro-rotulo">Feito por</span><select data-h="quem"><option value="">Todos</option></select></label>
      <label class="filtro-select"><span class="filtro-rotulo">Alvo</span><select data-h="alvo"><option value="">Todos</option></select></label>
      <label class="campo-data"><span class="filtro-rotulo">De</span><input class="input" type="date" data-h="de"></label>
      <label class="campo-data"><span class="filtro-rotulo">Até</span><input class="input" type="date" data-h="ate"></label>
    </div>
    <div data-hist-tabela></div>`;
  for (const k of ['quem', 'alvo', 'de', 'ate']) {
    const campo = painel.querySelector(`[data-h="${k}"]`);
    campo.value = filtrosHist[k];
    campo.addEventListener('change', () => {
      filtrosHist[k] = campo.value;
      filtrosHist.pagina = 1;
      delete painel.querySelector('[data-hist-tabela]').dataset.pintado;
      carregarHistorico(st);
    });
  }
}

function preencherPessoasHist(st, painel) {
  const pessoas = st.usuarios.map((u) => [u.email, u.nome ? `${u.nome} (${u.email})` : u.email]);
  const alvos = [...pessoas, ...st.perfis.map((p) => [p.id, `Perfil ${p.nome}`])];
  for (const [k, lista] of [['quem', pessoas], ['alvo', alvos]]) {
    const sel = painel.querySelector(`[data-h="${k}"]`);
    if (sel.options.length > 1) continue;
    for (const [v, t] of lista) sel.append(new Option(t, v));
    sel.value = filtrosHist[k];
  }
}

function pintarHistorico(st, el, dados) {
  const fuso = Number.isFinite(st.ctx.eu.fusoHoras) ? st.ctx.eu.fusoHoras : -3;
  const linhas = (dados.itens ?? []).map((i) => ({
    ...i,
    acaoTxt: ACOES[i.acao] ?? i.acao,
    resumo: resumoMudanca(i.antes, i.depois),
  }));
  el.dataset.pintado = '1';
  tabela(el, {
    linhas,
    vazioTexto: 'Nenhuma mudança registrada com esses filtros.',
    servidor: {
      total: dados.total ?? linhas.length,
      pagina: dados.pagina ?? 1,
      porPagina: dados.porPagina ?? 50,
      aoPagina(n) {
        filtrosHist.pagina = n;
        carregarHistorico(st);
      },
    },
    colunas: [
      { chave: 'quando', titulo: 'Quando', ordenavel: false, formato: (v) => quando(v, fuso) },
      { chave: 'quem', titulo: 'Quem', ordenavel: false },
      { chave: 'acaoTxt', titulo: 'Ação', ordenavel: false },
      { chave: 'alvo', titulo: 'Alvo', ordenavel: false },
      { chave: 'resumo', titulo: 'Antes → depois', ordenavel: false, celula: (l, td) => {
        td.className = 'resumo';
        td.textContent = l.resumo;
      } },
    ],
  });
}
