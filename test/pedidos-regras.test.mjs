import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  diaLocal, canalDe, origemDe, pagamentoDe, entregaDe, chaveCliente, linhasDoPedido,
} from '../coletores/pedidos-regras.mjs';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/pedido.json', import.meta.url), 'utf8'));
const clonar = () => structuredClone(fixture);
const cfg = {
  fusoHoras: -3,
  faturamento: { comFrete: true, statusExcluidos: ['canceled'] },
  canalSite: '1',
  afiliados: { GSM: 'Site', AMZ: 'Amazon' },
  origens: [['Google Ads', 'google|gclid|cpc', 'i'], ['E-mail', 'email|newsletter', 'i']],
};
const AGORA = '2026-11-13T10:00:00.000Z';

test('diaLocal: 23h30 de Brasília cai no dia local', () => {
  assert.equal(diaLocal('2026-11-13T02:30:00Z', -3), '2026-11-12');
  assert.equal(diaLocal('2026-11-13T12:00:00.0000000+00:00', -3), '2026-11-13');
});

test('canalDe', () => {
  assert.equal(canalDe({ affiliateId: 'GSM', salesChannel: '1' }, cfg), 'Site');
  assert.equal(canalDe({ affiliateId: 'XYZ', salesChannel: '1' }, cfg), 'XYZ');
  assert.equal(canalDe({ affiliateId: 'AMZ', salesChannel: '1' }, cfg), 'Amazon');
  assert.equal(canalDe({ salesChannel: '1' }, cfg), 'Site');
  assert.equal(canalDe({ affiliateId: '', salesChannel: '1' }, cfg), 'Site');
  assert.equal(canalDe({ salesChannel: '7' }, cfg), 'Canal 7');
});

test('origemDe', () => {
  assert.equal(origemDe({ utmSource: 'google', utmMedium: 'cpc' }, 'Site', cfg), 'Google Ads');
  assert.equal(origemDe({}, 'Site', cfg), 'Sem UTM');
  assert.equal(origemDe(null, 'Site', cfg), 'Sem UTM');
  assert.equal(origemDe({ utmSource: 'google' }, 'Amazon', cfg), 'Marketplace');
  assert.equal(origemDe({ utmSource: 'xyz' }, 'Site', cfg), 'Outros');
});

test('pagamentoDe e entregaDe', () => {
  assert.equal(pagamentoDe(fixture), 'pix');
  const p = clonar();
  p.paymentData.transactions[0].payments[0] = { paymentSystemName: 'Visa', group: 'creditCard' };
  assert.equal(pagamentoDe(p), 'cartao');
  p.paymentData.transactions[0].payments[0] = { paymentSystemName: 'Boleto', group: 'bankInvoice' };
  assert.equal(pagamentoDe(p), 'boleto');
  p.paymentData.transactions[0].payments[0] = { paymentSystemName: 'Vale', group: 'giftCard' };
  assert.equal(pagamentoDe(p), 'outros');
  assert.equal(pagamentoDe({}), 'outros');
  assert.equal(entregaDe(fixture), 'retirada');
  p.shippingData.logisticsInfo = [{ selectedDeliveryChannel: 'delivery' }];
  assert.equal(entregaDe(p), 'entrega');
});

test('chaveCliente (só memória)', () => {
  assert.equal(chaveCliente(fixture), '12345678909');
  const p = clonar();
  p.clientProfileData.document = '123';
  p.clientProfileData.email = ' Fulano@Exemplo.com ';
  assert.equal(chaveCliente(p), 'fulano@exemplo.com');
  p.clientProfileData.isCorporate = true;
  p.clientProfileData.corporateDocument = '12.345.678/0001-95';
  assert.equal(chaveCliente(p), '12345678000195');
  p.clientProfileData.email = 'semarroba';
  p.clientProfileData.corporateDocument = null;
  assert.equal(chaveCliente(p), null);
});

test('linhasDoPedido: colunas, valores e soma por SKU', () => {
  const { pedido, itens } = linhasDoPedido(fixture, cfg, 'novo', AGORA);
  assert.deepEqual(Object.keys(pedido), [
    'id', 'dia', 'criado', 'status', 'cancelado', 'valor', 'frete', 'desconto', 'canal', 'origem',
    'utm_source', 'utm_medium', 'utm_campaign', 'pagamento', 'parcelas', 'uf', 'cidade', 'entrega',
    'cliente_tipo', 'atualizado',
  ]);
  assert.equal(pedido.id, '1234567890123-01');
  assert.equal(pedido.dia, '2026-11-12');
  assert.equal(pedido.criado, '2026-11-13T02:30:00.000Z');
  assert.equal(pedido.cancelado, 0);
  assert.equal(pedido.valor, 25990);
  assert.equal(pedido.frete, 3490);
  assert.equal(pedido.desconto, 1500);
  assert.equal(pedido.canal, 'Site');
  assert.equal(pedido.origem, 'Google Ads');
  assert.equal(pedido.utm_campaign, 'campanha-teste');
  assert.equal(pedido.pagamento, 'pix');
  assert.equal(pedido.parcelas, 1);
  assert.equal(pedido.uf, 'RJ');
  assert.equal(pedido.cidade, 'Cidade Exemplo');
  assert.equal(pedido.entrega, 'retirada');
  assert.equal(pedido.cliente_tipo, 'novo');
  assert.equal(pedido.atualizado, AGORA);

  assert.equal(itens.length, 2);
  assert.deepEqual(Object.keys(itens[0]), ['pedido_id', 'sku', 'produto_id', 'nome', 'marca', 'categoria', 'departamento', 'qtd', 'valor']);
  const luva = itens.find((i) => i.sku === '501');
  assert.equal(luva.qtd, 3);
  assert.equal(luva.valor, 12000);
  assert.equal(luva.marca, 'MarcaUm');
  assert.equal(luva.categoria, 'Categoria Teste');
  assert.equal(luva.departamento, 'Departamento Teste');
  assert.equal(luva.produto_id, '50');
  assert.equal(luva.nome, 'Luva Nitrilica Caixa');
  assert.equal(luva.pedido_id, pedido.id);
});

test('linhasDoPedido: sem frete, cancelado e dados ausentes', () => {
  const semFrete = { ...cfg, faturamento: { comFrete: false, statusExcluidos: ['canceled'] } };
  assert.equal(linhasDoPedido(fixture, semFrete, null, AGORA).pedido.valor, 22500);
  assert.equal(linhasDoPedido(fixture, semFrete, null, AGORA).pedido.cliente_tipo, null);
  const p = clonar();
  p.status = 'canceled';
  delete p.totals;
  delete p.marketingData;
  delete p.shippingData.address;
  p.paymentData = {};
  const { pedido } = linhasDoPedido(p, cfg, 'indefinido', AGORA);
  assert.equal(pedido.cancelado, 1);
  assert.equal(pedido.frete, 0);
  assert.equal(pedido.desconto, 0);
  assert.equal(pedido.origem, 'Sem UTM');
  assert.equal(pedido.utm_source, null);
  assert.equal(pedido.parcelas, null);
  assert.equal(pedido.uf, null);
  assert.equal(pedido.pagamento, 'outros');
});

test('não vaza dado pessoal', () => {
  const json = JSON.stringify(linhasDoPedido(fixture, cfg, 'recorrente', AGORA));
  for (const segredo of [
    'fulano@exemplo.com', '12345678909', '+5521987654321', '987654321', 'Zeferino', 'Quintanilha',
    'Jacarandazal', '7391', '29999-888', '29999', 'Bloco Zeta', 'Inventado',
  ]) {
    assert.ok(!json.includes(segredo), `vazou: ${segredo}`);
  }
});
