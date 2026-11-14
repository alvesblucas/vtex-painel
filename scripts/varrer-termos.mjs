#!/usr/bin/env node
// Procura termos proibidos (env TERMOS_PROIBIDOS, separados por "|") nos arquivos versionados.
// Os termos ficam só no ambiente de quem publica, nunca no repositório.
//   TERMOS_PROIBIDOS="termo1|termo2" node scripts/varrer-termos.mjs [arquivo...]
// Sem argumentos, varre `git ls-files`. Sai com 1 e lista arquivo:linha se achar algo.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function termosDe(valor) {
  return String(valor ?? '').split('|').map((t) => t.trim()).filter(Boolean);
}

export function varrerTexto(texto, termos) {
  const achados = [];
  const baixos = termos.map((t) => t.toLowerCase());
  texto.split(/\r?\n/).forEach((linha, i) => {
    const l = linha.toLowerCase();
    for (let k = 0; k < baixos.length; k++) {
      if (l.includes(baixos[k])) achados.push({ linha: i + 1, termo: termos[k] });
    }
  });
  return achados;
}

function arquivosVersionados() {
  const saida = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return saida.split('\0').filter(Boolean);
}

function ehBinario(buf) {
  return buf.subarray(0, 8000).includes(0);
}

function principal() {
  const termos = termosDe(process.env.TERMOS_PROIBIDOS);
  if (!termos.length) {
    console.error('Defina TERMOS_PROIBIDOS="termo1|termo2".');
    process.exit(2);
  }
  const arquivos = process.argv.length > 2 ? process.argv.slice(2) : arquivosVersionados();
  let total = 0;
  for (const arq of arquivos) {
    let buf;
    try {
      buf = readFileSync(arq);
    } catch {
      continue;
    }
    if (ehBinario(buf)) continue;
    for (const a of varrerTexto(buf.toString('utf8'), termos)) {
      console.log(`${arq}:${a.linha}`);
      total++;
    }
  }
  if (total) {
    console.error(`${total} ocorrência(s) de termos proibidos.`);
    process.exit(1);
  }
  console.log(`Sem achados em ${arquivos.length} arquivo(s).`);
}

principal();
