import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VERSAO } from '../public/js/versao.js';

test('VERSAO do rodapé é a mesma do package.json', () => {
  const pacote = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSAO, pacote.version);
});
