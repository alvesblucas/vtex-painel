// Estado da tela na URL: `#<aba>?p=7d&cmp=ano&marca=A&marca=B`. Puro (sem DOM), testável no Node.

export const PERIODOS = {
  hoje: 'Hoje',
  ontem: 'Ontem',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  mes: 'Este mês',
  'mes-passado': 'Mês passado',
};
export const PERSONALIZADO = 'personalizado';
export const PERIODO_PADRAO = '30d';

export const CMPS = { anterior: 'Período anterior', ano: 'Ano anterior', nenhum: 'Sem comparação' };
export const CMP_PADRAO = 'anterior';

// Mesma ordem de functions/_lib/filtros.js (o teste confere).
export const LISTAS = ['origem', 'categoria', 'marca', 'pagamento', 'uf', 'cidade', 'entrega'];

const ABA_PADRAO = 'visao';
const DIA_MS = 86400000;

const paraMs = (dia) => Date.parse(`${dia}T00:00:00Z`);
const deMs = (ms) => new Date(ms).toISOString().slice(0, 10);
export const somarDias = (dia, n) => deMs(paraMs(dia) + n * DIA_MS);

export function diaValido(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = paraMs(s);
  return !Number.isNaN(ms) && deMs(ms) === s;
}

export function hojeLocal(fusoHoras = -3, agora = Date.now()) {
  return deMs(agora + fusoHoras * 3600000);
}

export function intervaloDe(chave, hoje) {
  const ontem = somarDias(hoje, -1);
  const inicioMes = `${hoje.slice(0, 7)}-01`;
  switch (chave) {
    case 'hoje': return { de: hoje, ate: hoje };
    case 'ontem': return { de: ontem, ate: ontem };
    case '7d': return { de: somarDias(hoje, -7), ate: ontem };
    case '30d': return { de: somarDias(hoje, -30), ate: ontem };
    case 'mes': return { de: inicioMes, ate: hoje };
    case 'mes-passado': {
      const fim = somarDias(inicioMes, -1);
      return { de: `${fim.slice(0, 7)}-01`, ate: fim };
    }
    default: return null;
  }
}

export function filtrosPadrao(hoje) {
  const f = { periodo: PERIODO_PADRAO, ...intervaloDe(PERIODO_PADRAO, hoje), cmp: CMP_PADRAO };
  for (const l of LISTAS) f[l] = [];
  return f;
}

const unicos = (valores) => [...new Set(valores.filter((v) => v !== ''))];

export function lerHash(hash, hoje = hojeLocal()) {
  const texto = String(hash ?? '').replace(/^#/, '');
  const i = texto.indexOf('?');
  const nome = (i < 0 ? texto : texto.slice(0, i)).replace(/^\/+|\/+$/g, '');
  const aba = /^[a-z][a-z-]*$/.test(nome) ? nome : ABA_PADRAO;
  const params = new URLSearchParams(i < 0 ? '' : texto.slice(i + 1));
  const filtros = filtrosPadrao(hoje);

  const p = params.get('p');
  const de = params.get('de');
  const ate = params.get('ate');
  if (p && Object.hasOwn(PERIODOS, p)) {
    Object.assign(filtros, { periodo: p, ...intervaloDe(p, hoje) });
  } else if (diaValido(de) && diaValido(ate) && de <= ate) {
    Object.assign(filtros, { periodo: PERSONALIZADO, de, ate });
  }
  const cmp = params.get('cmp');
  if (cmp && Object.hasOwn(CMPS, cmp)) filtros.cmp = cmp;
  for (const l of LISTAS) filtros[l] = unicos(params.getAll(l));
  return { aba, filtros };
}

export function montarHash(aba, filtros) {
  const params = new URLSearchParams();
  if (filtros.periodo === PERSONALIZADO) {
    params.append('de', filtros.de);
    params.append('ate', filtros.ate);
  } else if (filtros.periodo && filtros.periodo !== PERIODO_PADRAO) {
    params.append('p', filtros.periodo);
  }
  if (filtros.cmp && filtros.cmp !== CMP_PADRAO) params.append('cmp', filtros.cmp);
  for (const l of LISTAS) for (const v of filtros[l] ?? []) params.append(l, v);
  const q = params.toString();
  return `#${aba}${q ? `?${q}` : ''}`;
}

// Parâmetros para a API: sempre de/ate/cmp explícitos (a API não conhece presets) + listas repetidas.
export function paramsDosFiltros(filtros) {
  const params = new URLSearchParams();
  params.append('de', filtros.de);
  params.append('ate', filtros.ate);
  params.append('cmp', filtros.cmp ?? CMP_PADRAO);
  for (const l of LISTAS) for (const v of filtros[l] ?? []) params.append(l, v);
  return params;
}

export const dataBr = (dia) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

export function rotuloPeriodo(filtros) {
  if (Object.hasOwn(PERIODOS, filtros.periodo)) return PERIODOS[filtros.periodo];
  return `${dataBr(filtros.de)} – ${dataBr(filtros.ate)}`;
}

export const totalSelecionado = (filtros) => LISTAS.reduce((n, l) => n + (filtros[l]?.length ?? 0), 0);

// Mesmo teto da API (functions/_lib/filtros.js MAX_VALORES_TOTAL; o teste confere).
export const MAX_VALORES_TOTAL = 40;
export const MAX_DIAS = 731;

export const diasEntre = (de, ate) => Math.round((paraMs(ate) - paraMs(de)) / DIA_MS) + 1;

// Cidades só valem dentro das UFs escolhidas: ao tirar uma UF, saem as cidades dela.
export function limparCidades(filtros, cidadesPorUf = {}) {
  if (!filtros.cidade?.length) return filtros;
  const validas = new Set(filtros.uf.flatMap((uf) => cidadesPorUf[uf] ?? []));
  return { ...filtros, cidade: filtros.uf.length ? filtros.cidade.filter((c) => validas.has(c)) : [] };
}

// Troca a lista inteira de um filtro respeitando o teto total; devolve null se passar do teto.
export function comLista(filtros, lista, valores, cidadesPorUf) {
  const novo = { ...filtros, [lista]: [...new Set(valores)] };
  if (totalSelecionado(novo) > MAX_VALORES_TOTAL) return null;
  return lista === 'uf' ? limparCidades(novo, cidadesPorUf) : novo;
}
