// Cartões das abas permitidas + alertas (coleta atrasada, queda de vendas de ontem). Alertas nunca trazem R$.
import { clientes, dadosAte, filtrosDaRequisicao, hojeLocal, lerAgenda, pct, resumo } from '../_lib/consultas.js';
import { LISTAS, somarDias } from '../_lib/filtros.js';
import { exigirAba, semValores } from '../_lib/permissoes.js';
import { json } from '../_lib/resposta.js';

const HORA_MS = 3600000;
const QUEDA_ALERTA = -15;

const numero = (n) => String(n).replace('.', ',');

async function alertasDeColeta(db, env, agora) {
  const alertas = [];
  for (const [fonte, regra] of Object.entries(lerAgenda(env))) {
    const horasMax = Number(regra?.horasMax);
    if (!Number.isFinite(horasMax) || horasMax <= 0) continue;
    const c = await db.prepare('SELECT quando FROM coletas WHERE fonte = ? AND ok = 1').bind(fonte).first();
    const quando = c?.quando ? Date.parse(c.quando) : NaN;
    if (Number.isNaN(quando)) {
      alertas.push({ nivel: 'aviso', texto: `Coleta de ${fonte}: nenhuma coleta concluída`, aba: 'visao' });
    } else if (agora - quando > horasMax * HORA_MS) {
      const horas = Math.floor((agora - quando) / HORA_MS);
      alertas.push({ nivel: 'aviso', texto: `Coleta de ${fonte} atrasada: última há ${horas} h (limite ${horasMax} h)`, aba: 'visao' });
    }
  }
  return alertas;
}

// Loja toda (ignora filtros da tela): ontem x mesmo dia da semana anterior; sem R$ compara pedidos.
// Só quando ontem já foi coletado por inteiro (última coleta ok a partir da meia-noite local de hoje).
const LOJA_TODA = Object.fromEntries(LISTAS.map((l) => [l, []]));

async function alertaDeQueda(db, env, campo) {
  const hoje = hojeLocal(env);
  const ate = await dadosAte(db, 'pedidos');
  const ateMs = ate ? Date.parse(ate) : NaN;
  if (Number.isNaN(ateMs) || hojeLocal(env, ateMs) < hoje) return [];
  const ontem = somarDias(hoje, -1);
  const a = await resumo(db, LOJA_TODA, { de: ontem, ate: ontem });
  const semanaAntes = somarDias(ontem, -7);
  const b = await resumo(db, LOJA_TODA, { de: semanaAntes, ate: semanaAntes });
  const delta = pct(a[campo], b[campo]);
  if (delta === null || delta > QUEDA_ALERTA) return [];
  const nome = campo === 'valor' ? 'Vendas' : 'Pedidos';
  return [{ nivel: 'aviso', texto: `${nome} de ontem ${numero(Math.abs(delta))}% abaixo do mesmo dia da semana passada`, aba: 'vendas' }];
}

export async function onRequestGet(context) {
  exigirAba(context, 'visao');
  const { env } = context;
  const db = env.DB;
  const eu = context.data.eu;
  const { f, cmp } = filtrosDaRequisicao(context);
  const campo = eu.verValores ? 'valor' : 'pedidos';
  const cartoes = {};
  const alertas = await alertasDeColeta(db, env, Date.now());

  if (eu.abas.includes('vendas')) {
    const atual = await resumo(db, f, f);
    const antes = cmp ? await resumo(db, f, cmp) : null;
    cartoes.vendas = { valor: atual.valor, pedidos: atual.pedidos, ticket: atual.ticket, delta: antes ? pct(atual[campo], antes[campo]) : null };
    alertas.push(...(await alertaDeQueda(db, env, campo)));
  }
  if (eu.abas.includes('clientes')) {
    const c = await clientes(db, f, f);
    cartoes.clientes = { pctNovos: c.pctNovos, novos: c.novo.pedidos };
  }
  return json(semValores({ cartoes, alertas }, eu.verValores));
}
