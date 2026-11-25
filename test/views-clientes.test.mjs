import { test } from 'node:test';
import assert from 'node:assert/strict';
import { linhasCampanhas } from '../public/js/views/clientes.js';

const c = (origem, campanha, novo) => ({ origem, campanha, novo, recorrente: 0 });

test('campanhas: agrupa por origem na ordem da API e respeita o limite', () => {
  const lista = [c('Google Ads', 'marca', 9), c('E-mail', 'news', 5), c('Google Ads', 'shopping', 3), c('E-mail', '(sem campanha)', 1)];
  assert.deepEqual(linhasCampanhas(lista, 3).map((g) => [g.origem, g.lista.map((x) => x.campanha)]), [
    ['Google Ads', ['marca', 'shopping']],
    ['E-mail', ['news']],
  ]);
  assert.equal(linhasCampanhas(lista, 10).flatMap((g) => g.lista).length, 4);
});
