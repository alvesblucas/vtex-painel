// Teto diário de linhas lidas pelo MCP (protege a cota do D1 Free, que zera às 00:00 UTC).
export const TETO_PADRAO = 2500000;

export class ErroCota extends Error {
  esperado = true;
}

export const diaUtc = (agora = Date.now()) => new Date(agora).toISOString().slice(0, 10);

// Proxy do D1 que soma as linhas lidas: meta.rows_read do all() (sem meta: nº de linhas devolvidas) e 1 por first().
export function contarLeituras(db) {
  let total = 0;
  const embrulhar = (cmd) => ({
    bind: (...p) => embrulhar(cmd.bind(...p)),
    async all() {
      const r = await cmd.all();
      total += Number(r?.meta?.rows_read ?? r?.results?.length ?? 0);
      return r;
    },
    async first(...a) {
      total += 1;
      return cmd.first(...a);
    },
    run: (...a) => cmd.run(...a),
  });
  return { db: { ...db, prepare: (sql) => embrulhar(db.prepare(sql)), batch: (c) => db.batch(c) }, linhas: () => total };
}

export async function usoDoDia(db, dia) {
  const r = await db.prepare('SELECT COALESCE(SUM(linhas), 0) AS total FROM mcp_uso WHERE dia = ?').bind(dia).first();
  return Number(r?.total ?? 0);
}

const tetoDe = (env) => {
  const n = Number(env?.MCP_LINHAS_DIA);
  return Number.isFinite(n) && n > 0 ? n : TETO_PADRAO;
};

const fmt = (n) => n.toLocaleString('pt-BR');

export async function exigirCota(db, env, agora = Date.now()) {
  const teto = tetoDe(env);
  const usadas = await usoDoDia(db, diaUtc(agora));
  if (usadas >= teto) {
    throw new ErroCota(`Limite diário de consultas do assistente atingido (${fmt(usadas)} de ${fmt(teto)} linhas). Volta às 00:00 UTC (21h em Brasília).`);
  }
  return { usadas, teto };
}

export async function registrarUso(db, email, linhas, agora = Date.now()) {
  await db
    .prepare(
      `INSERT INTO mcp_uso (dia, email, chamadas, linhas) VALUES (?, ?, 1, ?)
       ON CONFLICT (dia, email) DO UPDATE SET chamadas = chamadas + 1, linhas = linhas + excluded.linhas`,
    )
    .bind(diaUtc(agora), email, linhas)
    .run();
}
