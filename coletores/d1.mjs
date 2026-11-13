import { spawn as spawnReal } from 'node:child_process';

const IDENT = /^[a-z_]+$/;
const BLOCO = 200;
const TENTATIVAS = 5;

export function sqlValor(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Número não finito: ${v}`);
    return String(v);
  }
  if (typeof v === 'string') return `'${v.replaceAll('\0', '').replaceAll("'", "''")}'`;
  throw new Error(`Tipo não suportado: ${typeof v}`);
}

function ident(nome) {
  if (!IDENT.test(nome)) throw new Error(`Identificador inválido: ${nome}`);
  return nome;
}

export function upsertSql(tabela, linhas, chave) {
  if (!linhas.length) return '';
  ident(tabela);
  const colunas = Object.keys(linhas[0]).map(ident);
  chave.forEach(ident);
  for (const l of linhas) {
    const ks = Object.keys(l);
    if (ks.length !== colunas.length || ks.some((k, i) => k !== colunas[i])) {
      throw new Error('Todas as linhas devem ter as mesmas colunas, na mesma ordem');
    }
  }
  const atualizar = colunas.filter((c) => !chave.includes(c));
  const conflito = atualizar.length
    ? `DO UPDATE SET ${atualizar.map((c) => `${c}=excluded.${c}`).join(', ')}`
    : 'DO NOTHING';
  const instrucoes = [];
  for (let i = 0; i < linhas.length; i += BLOCO) {
    const valores = linhas
      .slice(i, i + BLOCO)
      .map((l) => `(${colunas.map((c) => sqlValor(l[c])).join(', ')})`)
      .join(',\n');
    instrucoes.push(
      `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES\n${valores}\nON CONFLICT(${chave.join(', ')}) ${conflito}`,
    );
  }
  return instrucoes.join(';\n');
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export function criarD1Rest({ accountId, databaseId, token, fetch: f = globalThis.fetch, esperar = dormir }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  return {
    async consulta(sql, params = []) {
      let ultimo;
      for (let i = 0; i < TENTATIVAS; i++) {
        const r = await f(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ sql, params }),
        });
        const corpo = await r.json().catch(() => ({}));
        const msgs = (corpo.errors ?? []).map((e) => e.message).join('; ');
        if (r.status === 429 || r.status >= 500) {
          ultimo = new Error(`D1 HTTP ${r.status}${msgs ? `: ${msgs}` : ''}`);
          if (i < TENTATIVAS - 1) await esperar(2000 * 2 ** i);
          continue;
        }
        if (!r.ok || corpo.success === false) {
          throw new Error(`D1 HTTP ${r.status}: ${msgs || 'erro desconhecido'}`);
        }
        return corpo.result?.[0]?.results ?? [];
      }
      throw ultimo;
    },
  };
}

export function aplicarArquivo(caminho, banco, { spawn = spawnReal } = {}) {
  return new Promise((resolve, reject) => {
    const filho = spawn(
      'npx',
      ['wrangler', 'd1', 'execute', banco, '--remote', `--file=${caminho}`, '--yes'],
      { shell: process.platform === 'win32', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stderr = '';
    filho.stderr.on('data', (d) => { stderr += d; });
    filho.stdout.on('data', () => {});
    filho.on('error', reject);
    filho.on('close', (codigo) => {
      if (codigo === 0) resolve();
      else reject(new Error(`wrangler saiu com código ${codigo}: ${stderr.trim()}`));
    });
  });
}
