// Regras puras: pedido da OMS da VTEX -> linhas de `pedidos` e `itens`.
// Sem fs, sem rede. Só estes campos viram linha; nenhum dado pessoal do cliente é lido
// (exceto `chaveCliente`, que devolve uma chave só para uso em memória).

const HORA_MS = 3600 * 1000;

export function diaLocal(isoUtc, fusoHoras) {
  const t = new Date(isoUtc).getTime();
  if (Number.isNaN(t)) throw new Error(`Data inválida: ${isoUtc}`);
  return new Date(t + fusoHoras * HORA_MS).toISOString().slice(0, 10);
}

export function canalDe(o, cfg) {
  const id = o?.affiliateId ? String(o.affiliateId) : '';
  if (id) {
    const nome = cfg.afiliados?.[id] ?? id;
    return nome;
  }
  const canalSite = String(cfg.canalSite ?? '1');
  return String(o?.salesChannel) === canalSite ? 'Site' : `Canal ${o?.salesChannel}`;
}

export function origemDe(marketingData, canal, cfg) {
  if (canal !== 'Site') return 'Marketplace';
  const m = marketingData ?? {};
  if (!m.utmSource && !m.utmCampaign) return 'Sem UTM';
  const texto = [m.utmSource, m.utmMedium, m.utmCampaign].filter(Boolean).join(' ');
  const regra = (cfg.origens ?? []).find(([, re, flags]) => new RegExp(re, flags).test(texto));
  return regra ? regra[0] : 'Outros';
}

function primeiroPagamento(pedido) {
  for (const t of pedido?.paymentData?.transactions ?? []) {
    if (t?.payments?.[0]) return t.payments[0];
  }
  return null;
}

export function pagamentoDe(pedido) {
  const p = primeiroPagamento(pedido);
  if (!p) return 'outros';
  const texto = `${p.group ?? ''} ${p.paymentSystemName ?? ''}`.toLowerCase();
  if (/pix|instantpayment/.test(texto)) return 'pix';
  if (/creditcard|debitcard/.test(texto)) return 'cartao';
  if (/bankinvoice|boleto/.test(texto)) return 'boleto';
  return 'outros';
}

export function entregaDe(pedido) {
  const logistica = pedido?.shippingData?.logisticsInfo ?? [];
  return logistica.some((l) => l?.selectedDeliveryChannel === 'pickup-in-point') ? 'retirada' : 'entrega';
}

// Só em memória: nunca gravar o retorno em linha, log ou arquivo.
export function chaveCliente(pedido) {
  const c = pedido?.clientProfileData ?? {};
  const doc = String((c.isCorporate ? c.corporateDocument : c.document) ?? '').replace(/\D/g, '');
  if (doc.length >= 11) return doc;
  const email = String(c.email ?? '').trim().toLowerCase();
  return email.includes('@') ? email : null;
}

function totalDe(pedido, id) {
  const t = (pedido.totals ?? []).find((x) => x.id === id);
  return Number(t?.value) || 0;
}

function itensDoPedido(pedido) {
  const porSku = new Map();
  for (const it of pedido.items ?? []) {
    const sku = String(it.id);
    const qtd = Number(it.quantity) || 0;
    const valor = Math.round((Number(it.sellingPrice) || 0) * qtd);
    const atual = porSku.get(sku);
    if (atual) {
      atual.qtd += qtd;
      atual.valor += valor;
      continue;
    }
    const cats = it.additionalInfo?.categories ?? [];
    porSku.set(sku, {
      pedido_id: pedido.orderId,
      sku,
      produto_id: it.productId != null ? String(it.productId) : null,
      nome: it.name ?? null,
      marca: it.additionalInfo?.brandName ?? null,
      categoria: cats.length ? cats[cats.length - 1].name ?? null : null,
      departamento: cats.length ? cats[0].name ?? null : null,
      qtd,
      valor,
    });
  }
  return [...porSku.values()];
}

export function linhasDoPedido(pedido, cfg, clienteTipo, agoraIso) {
  const frete = totalDe(pedido, 'Shipping');
  const desconto = Math.abs(totalDe(pedido, 'Discounts'));
  const canal = canalDe(pedido, cfg);
  const m = pedido.marketingData ?? {};
  const comFrete = cfg.faturamento?.comFrete ?? true;
  const excluidos = cfg.faturamento?.statusExcluidos ?? [];
  const endereco = pedido.shippingData?.address ?? {};
  const parcelas = primeiroPagamento(pedido)?.installments;

  return {
    pedido: {
      id: pedido.orderId,
      dia: diaLocal(pedido.creationDate, cfg.fusoHoras),
      criado: new Date(pedido.creationDate).toISOString(),
      status: pedido.status,
      cancelado: excluidos.includes(pedido.status) ? 1 : 0,
      valor: comFrete ? pedido.value : pedido.value - frete,
      frete,
      desconto,
      canal,
      origem: origemDe(m, canal, cfg),
      utm_source: m.utmSource || null,
      utm_medium: m.utmMedium || null,
      utm_campaign: m.utmCampaign || null,
      pagamento: pagamentoDe(pedido),
      parcelas: parcelas ?? null,
      uf: endereco.state ?? null,
      cidade: endereco.city ?? null,
      entrega: entregaDe(pedido),
      cliente_tipo: clienteTipo ?? null,
      atualizado: agoraIso,
    },
    itens: itensDoPedido(pedido),
  };
}
