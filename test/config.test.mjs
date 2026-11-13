import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { carregarConfig, validarConfig } from '../coletores/config.mjs';
import { ABAS } from '../functions/_lib/abas.js';

const exemplo = () => JSON.parse(readFileSync(new URL('../config.exemplo.json', import.meta.url), 'utf8'));

test('config.exemplo.json valida', () => {
  const c = carregarConfig(new URL('../config.exemplo.json', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'));
  assert.equal(c.loja.nome, 'Minha Loja');
  assert.equal(c.afiliados.GSM, 'Site');
});

test('falta fusoHoras -> erro menciona fusoHoras', () => {
  const o = exemplo(); delete o.fusoHoras;
  assert.throws(() => validarConfig(o), /fusoHoras/);
});

test('regex inválida -> erro com nome da origem', () => {
  const o = exemplo(); o.origens.push(['Quebrada', '(abc']);
  assert.throws(() => validarConfig(o), /Quebrada/);
});

test('aba fora de ABAS -> erro', () => {
  const o = exemplo(); o.abas = ['visao', 'inexistente'];
  assert.throws(() => validarConfig(o), /inexistente/);
});

test('padrões aplicados sem mutar a entrada', () => {
  const o = { loja: { nome: 'X' }, fusoHoras: -3, origens: [] };
  const c = validarConfig(o);
  assert.deepEqual(c.faturamento.statusExcluidos, ['canceled']);
  assert.equal(c.canalSite, '1');
  assert.deepEqual(c.afiliados, {});
  assert.deepEqual(c.abas, ABAS);
  assert.equal(o.canalSite, undefined);
});

test('lista todos os problemas de uma vez', () => {
  assert.throws(() => validarConfig({}), (e) => /loja\.nome/.test(e.message) && /fusoHoras/.test(e.message) && /origens/.test(e.message));
});

test('JSON inválido -> erro menciona o caminho', () => {
  assert.throws(() => carregarConfig('nao-existe.json'), /nao-existe\.json/);
});
