// Ícones da lateral e grupos do menu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRUPOS_ABAS, gruposVisiveis, icone } from '../public/js/icones.js';
import { ROTULOS_ABAS } from '../public/js/estado.js';

test('icone devolve SVG inline escondido do leitor de tela', () => {
  const svg = icone('vendas');
  assert.match(svg, /<svg/);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /focusable="false"/);
});

test('icone de nome desconhecido devolve string vazia', () => {
  assert.equal(icone('inexistente'), '');
  assert.equal(icone(undefined), '');
});

test('toda aba do menu tem ícone e está em exatamente um grupo', () => {
  const todas = [...Object.keys(ROTULOS_ABAS), 'usuarios'];
  const nosGrupos = Object.values(GRUPOS_ABAS).flat();
  assert.deepEqual([...nosGrupos].sort(), [...todas].sort());
  for (const a of todas) assert.match(icone(a), /<svg/, a);
  assert.deepEqual(GRUPOS_ABAS.admin, ['usuarios']);
});

test('gruposVisiveis mantém a ordem e some com grupo sem item', () => {
  assert.deepEqual(gruposVisiveis(['visao', 'saude', 'usuarios']), [
    { id: 'principal', titulo: 'Principal', abas: ['visao'] },
    { id: 'operacao', titulo: 'Operação', abas: ['saude'] },
    { id: 'admin', titulo: 'Administração', abas: ['usuarios'] },
  ]);
  assert.deepEqual(gruposVisiveis(['vendas', 'clientes']).map((g) => g.id), ['principal']);
  assert.deepEqual(gruposVisiveis(['estoque']).map((g) => g.id), ['operacao']);
  assert.deepEqual(gruposVisiveis([]), []);
  // a ordem do grupo vale, não a da lista recebida
  assert.deepEqual(gruposVisiveis(['clientes', 'visao'])[0].abas, ['visao', 'clientes']);
});
