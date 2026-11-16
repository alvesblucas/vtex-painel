import { spawn as spawnReal } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const IDENT = /^[a-z_]+$/;
const BLOCO = 200;
const TENTATIVAS = 5;
const MAX_VALORES = 90_000;

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
  const fechar = (valores) =>
    instrucoes.push(
      `INSERT INTO ${tabela} (${colunas.join(', ')}) VALUES\n${valores.join(',\n')}\nON CONFLICT(${chave.join(', ')}) ${conflito}`,
    );
  let atual = [];
  let tamanho = 0;
  for (const l of linhas) {
    const v = `(${colunas.map((c) => sqlValor(l[c])).join(', ')})`;
    if (atual.length && (atual.length >= BLOCO || tamanho + v.length > MAX_VALORES)) {
      fechar(atual);
      atual = [];
      tamanho = 0;
    }
    atual.push(v);
    tamanho += v.length + 2;
  }
  if (atual.length) fechar(atual);
  return instrucoes.join(';\n');
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

export function criarD1Rest({ accountId, databaseId, token, fetch: f = globalThis.fetch, esperar = dormir }) {
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  return {
    async consulta(sql, params = []) {
      let ultimo;
      for (let i = 0; i < TENTATIVAS; i++) {
        let r;
        try {
          r = await f(url, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, params }),
          });
        } catch (e) {
          // Erro de rede (DNS, conexão caída): transitório, tenta de novo como um 5xx.
          ultimo = new Error(`D1 sem resposta: ${e?.message ?? e}`);
          if (i < TENTATIVAS - 1) await esperar(2000 * 2 ** i);
          continue;
        }
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
        if (!Array.isArray(corpo.result)) throw new Error(`D1 HTTP ${r.status}: resposta sem result`);
        return corpo.result[0]?.results ?? [];
      }
      throw ultimo;
    },
  };
}

// Wrangler fixado no package.json do produto, resolvido a partir desta pasta e não do diretório atual:
// o workflow roda na raiz da instância (sem node_modules) e o `npx` baixava a `latest` do registro.
export const WRANGLER_JS = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

// Erro que não adianta repetir (configuração errada, não falha transitória).
function definitivo(msg) {
  return Object.assign(new Error(msg), { definitivo: true });
}

// Roda o wrangler com o próprio node, sem shell: nada de aspas no Windows nem `npx`.
export function aplicarArquivo(caminho, banco, { spawn = spawnReal, wrangler = WRANGLER_JS } = {}) {
  return new Promise((resolve, reject) => {
    if (!/^[\w-]+$/.test(banco)) throw definitivo('Nome de banco inválido');
    if (/["&|<>^%\r\n]/.test(caminho)) throw definitivo('Caminho de arquivo inválido');
    if (!existsSync(wrangler)) throw definitivo(`wrangler não encontrado em ${wrangler}; rode "npm ci" na pasta do produto`);
    const filho = spawn(
      process.execPath,
      [wrangler, 'd1', 'execute', banco, '--remote', `--file=${caminho}`, '--yes'],
      { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
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

const ESPERAS_WRANGLER = [5000, 15000, 45000];

// Falhas transitórias (rede, API da Cloudflare) não derrubam a coleta: até 3 novas tentativas.
// Repetir é seguro porque o arquivo do dia é DELETE + upsert (idempotente).
export async function aplicarComRetentativa(caminho, banco, {
  aplicar = aplicarArquivo, esperar = dormir, log = console.error, esperas = ESPERAS_WRANGLER,
} = {}) {
  for (let i = 0; ; i++) {
    try {
      return await aplicar(caminho, banco);
    } catch (e) {
      if (e?.definitivo || i >= esperas.length) throw e;
      const motivo = String(e?.message ?? e).split('\n')[0].slice(0, 200);
      log(`[aviso] wrangler falhou (tentativa ${i + 1} de ${esperas.length + 1}); de novo em ${esperas[i] / 1000} s: ${motivo}`);
      await esperar(esperas[i]);
    }
  }
}
