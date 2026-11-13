import { readFileSync } from 'node:fs';
import { ABAS } from '../functions/_lib/abas.js';

const ehObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function validarOrigens(origens, erros) {
  if (!Array.isArray(origens)) {
    erros.push('origens: deve ser uma lista de [nome, regex, flags?]');
    return;
  }
  origens.forEach((o, i) => {
    if (!Array.isArray(o) || typeof o[0] !== 'string' || typeof o[1] !== 'string') {
      erros.push(`origens[${i}]: esperado [nome, regex, flags?]`);
      return;
    }
    try {
      new RegExp(o[1], o[2]);
    } catch (e) {
      erros.push(`origens["${o[0]}"]: regex inválida (${e.message})`);
    }
  });
}

function validarAbas(abas, erros) {
  if (!Array.isArray(abas)) {
    erros.push('abas: deve ser uma lista');
    return;
  }
  for (const a of abas) {
    if (!ABAS.includes(a)) erros.push(`abas: "${a}" não existe (válidas: ${ABAS.join(', ')})`);
  }
}

function validarAgenda(agenda, erros) {
  if (!ehObjeto(agenda)) {
    erros.push('agenda: deve ser um objeto { fonte: { horasMax } }');
    return;
  }
  for (const [fonte, v] of Object.entries(agenda)) {
    if (!ehObjeto(v) || typeof v.horasMax !== 'number') erros.push(`agenda.${fonte}.horasMax: deve ser número`);
  }
}

export function validarConfig(obj) {
  const erros = [];
  const o = ehObjeto(obj) ? obj : {};
  if (!ehObjeto(obj)) erros.push('config: deve ser um objeto');

  if (!ehObjeto(o.loja) || typeof o.loja.nome !== 'string' || !o.loja.nome) erros.push('loja.nome: obrigatório (texto)');
  if (typeof o.fusoHoras !== 'number' || Number.isNaN(o.fusoHoras)) erros.push('fusoHoras: obrigatório (número, ex.: -3)');
  if (o.origens === undefined) erros.push('origens: obrigatório (lista)');
  else validarOrigens(o.origens, erros);

  const faturamento = { comFrete: true, statusExcluidos: ['canceled'], ...(ehObjeto(o.faturamento) ? o.faturamento : {}) };
  if (typeof faturamento.comFrete !== 'boolean') erros.push('faturamento.comFrete: deve ser booleano');
  if (!Array.isArray(faturamento.statusExcluidos)) erros.push('faturamento.statusExcluidos: deve ser lista');

  const afiliados = o.afiliados ?? {};
  if (!ehObjeto(afiliados)) erros.push('afiliados: deve ser um objeto { id: nome }');

  const abas = o.abas ?? [...ABAS];
  validarAbas(abas, erros);
  if (o.agenda !== undefined) validarAgenda(o.agenda, erros);
  if (o.dominioPermitido !== undefined && typeof o.dominioPermitido !== 'string') erros.push('dominioPermitido: deve ser texto');

  if (erros.length) throw new Error(`Configuração inválida:\n- ${erros.join('\n- ')}`);

  const config = {
    loja: { ...o.loja },
    fusoHoras: o.fusoHoras,
    faturamento,
    canalSite: o.canalSite ?? '1',
    afiliados: { ...afiliados },
    origens: o.origens.map((x) => [...x]),
    abas: [...abas],
  };
  if (o.agenda !== undefined) config.agenda = structuredClone(o.agenda);
  if (o.dominioPermitido !== undefined) config.dominioPermitido = o.dominioPermitido;
  return config;
}

export function carregarConfig(caminho) {
  let texto;
  try {
    texto = readFileSync(caminho, 'utf8');
  } catch (e) {
    throw new Error(`Não foi possível ler ${caminho}: ${e.message}`);
  }
  let obj;
  try {
    obj = JSON.parse(texto);
  } catch (e) {
    throw new Error(`JSON inválido em ${caminho}: ${e.message}`);
  }
  return validarConfig(obj);
}
