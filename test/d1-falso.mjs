import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const DIR_MIGRACOES = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

class Comando {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Comando(this.db, this.sql, params);
  }
  async all() {
    return { results: this.db.prepare(this.sql).all(...this.params) };
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.params) ?? null;
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(r.changes) } };
  }
}

// Imita D1Database: prepare().bind().all/first/run e batch() transacional.
export async function criarD1Falso() {
  const db = new DatabaseSync(':memory:');
  const arquivos = readdirSync(DIR_MIGRACOES).filter((f) => f.endsWith('.sql')).sort();
  for (const f of arquivos) db.exec(readFileSync(join(DIR_MIGRACOES, f), 'utf8'));
  return {
    prepare: (sql) => new Comando(db, sql),
    async batch(comandos) {
      db.exec('BEGIN');
      try {
        const saidas = [];
        for (const c of comandos) saidas.push(await (/^\s*select/i.test(c.sql) ? c.all() : c.run()));
        db.exec('COMMIT');
        return saidas;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
