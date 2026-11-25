#!/usr/bin/env node
// Dados FICTÍCIOS para `wrangler pages dev`: 90 dias de pedidos (~40/dia), usuários de exemplo e uma coleta ok.
// Determinístico (semente fixa): mesma data de hoje = mesmo SQL.
//   node scripts/semear-local.mjs > .wrangler/seed.sql
//   npx wrangler d1 execute painel --local --file .wrangler/seed.sql
// Fuso: FUSO_HORAS do ambiente (padrão -3). O super admin vem de SUPER_ADMIN no .dev.vars (não precisa de linha).
import { upsertSql } from '../coletores/d1.mjs';

const DIAS = 90;
const POR_DIA = 40;
const HORA_MS = 3600000;
const DIA_MS = 24 * HORA_MS;
const fusoBruto = Number(process.env.FUSO_HORAS || -3);
const fuso = Number.isFinite(fusoBruto) ? fusoBruto : -3;

// mulberry32: pseudoaleatório com semente.
function gerador(semente) {
  let a = semente >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const aleatorio = gerador(20261113);
const entre = (min, max) => min + Math.floor(aleatorio() * (max - min + 1));
const sorteio = (pesos) => {
  const total = pesos.reduce((s, [, p]) => s + p, 0);
  let r = aleatorio() * total;
  for (const [v, p] of pesos) if ((r -= p) < 0) return v;
  return pesos[pesos.length - 1][0];
};

const ORIGENS = [['Google Ads', 34], ['Sem UTM', 24], ['E-mail', 9], ['Instagram', 7], ['Outros', 4], ['Marketplace', 22]];
// Campanhas fictícias por origem (null = pedido sem utm_campaign).
const CAMPANHAS = {
  'Google Ads': [['marca', 40], ['shopping-regiao-a', 22], ['shopping-recorrencia', 14], ['pesquisa-alta-intencao', 9], ['pmax-geral', 8], [null, 7]],
  'E-mail': [['newsletter-semanal', 60], ['carrinho-abandonado', 30], [null, 10]],
  Instagram: [['stories-promo', 55], [null, 45]],
};
const PAGAMENTOS = [['pix', 46], ['cartao', 38], ['boleto', 12], ['outros', 4]];
const TIPOS = [['recorrente', 58], ['novo', 35], ['indefinido', 4], [null, 3]];
const LUGARES = [
  ['SP', ['São Paulo', 'Campinas', 'Santos', 'Ribeirão Preto'], 34],
  ['RJ', ['Rio de Janeiro', 'Niterói', 'Petrópolis'], 22],
  ['MG', ['Belo Horizonte', 'Uberlândia', 'Juiz de Fora'], 14],
  ['PR', ['Curitiba', 'Londrina'], 7],
  ['RS', ['Porto Alegre', 'Caxias do Sul'], 6],
  ['BA', ['Salvador', 'Feira de Santana'], 5],
  ['SC', ['Florianópolis', 'Joinville'], 4],
  ['ES', ['Vitória'], 3],
  ['GO', ['Goiânia'], 3],
  ['PE', ['Recife'], 2],
];
const MARCAS = ['Alfa Med', 'Beta Saúde', 'Gama Hospitalar', 'Delta, Cuidados & Cia', 'Épsilon', 'Zeta Care', 'Eta Ortopedia', 'Teta Lab'];
const CATEGORIAS = [
  ['Curativos', ['Curativo adesivo', 'Gaze estéril', 'Atadura de crepe', 'Esparadrapo']],
  ['Luvas', ['Luva de procedimento', 'Luva nitrílica', 'Luva cirúrgica']],
  ['Seringas e agulhas', ['Seringa 5 ml', 'Seringa 10 ml', 'Agulha 25x7']],
  ['Aparelhos', ['Termômetro digital', 'Medidor de pressão', 'Oxímetro de dedo', 'Nebulizador']],
  ['Higiene', ['Fralda geriátrica', 'Lenço umedecido', 'Álcool 70%']],
  ['Ortopedia', ['Tipoia', 'Joelheira', 'Muleta axilar']],
  ['Diabetes', ['Tiras de glicemia', 'Lancetas', 'Glicosímetro']],
];

// Catálogo fictício: cada produto com marca, categoria e preço fixos.
const PRODUTOS = [];
for (const [categoria, nomes] of CATEGORIAS) {
  for (const nome of nomes) {
    for (let v = 0; v < 8; v++) {
      const marca = MARCAS[entre(0, MARCAS.length - 1)];
      const preco = categoria === 'Aparelhos' ? entre(4990, 32990) : entre(390, 8990);
      PRODUTOS.push({ sku: String(1000 + (PRODUTOS.length + 1) * 37), nome: `${nome} ${['P', 'M', 'G', 'cx', 'un'][entre(0, 4)]} ${marca.split(/[ ,]/)[0]}`, marca, categoria, preco, peso: entre(1, 10) });
    }
  }
}
const PESOS_PRODUTO = PRODUTOS.map((p) => [p, p.peso]);

const agora = Date.now();
const local = (ms) => new Date(ms + fuso * HORA_MS).toISOString();
const hoje = local(agora).slice(0, 10);
const inicioDoDiaUtc = (dia) => Date.parse(`${dia}T00:00:00Z`) - fuso * HORA_MS;
const somarDias = (dia, n) => new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);

const pedidos = [];
const itens = [];
for (let d = DIAS; d >= 0; d--) {
  const dia = somarDias(hoje, -d);
  const dow = new Date(`${dia}T12:00:00Z`).getUTCDay();
  const fator = (dow === 0 ? 0.6 : dow === 6 ? 0.75 : 1.05) * (1 + (DIAS - d) * 0.002);
  let n = Math.round(POR_DIA * fator * (0.8 + aleatorio() * 0.4));
  const ini = inicioDoDiaUtc(dia);
  if (d === 0) n = Math.round((n * Math.max(0, agora - ini)) / DIA_MS); // hoje: só até agora
  for (let k = 0; k < n; k++) {
    const id = `F${dia.replaceAll('-', '')}-${String(k + 1).padStart(3, '0')}`;
    const criadoMs = d === 0 ? ini + aleatorio() * Math.max(1, agora - ini) : ini + aleatorio() * DIA_MS;
    const origem = sorteio(ORIGENS);
    const canal = origem === 'Marketplace' ? 'Canal 2' : 'Site';
    const [uf, cidades] = sorteio(LUGARES.map(([u, c, p]) => [[u, c], p]));
    const cidade = cidades[entre(0, cidades.length - 1)];
    const entrega = uf === 'RJ' && aleatorio() < 0.18 ? 'retirada' : 'entrega';
    const cancelado = aleatorio() < 0.04 ? 1 : 0;
    const usados = new Set();
    let soma = 0;
    for (let q = entre(1, 4); q > 0; q--) {
      const p = sorteio(PESOS_PRODUTO);
      if (usados.has(p.sku)) continue;
      usados.add(p.sku);
      const qtd = sorteio([[1, 60], [2, 25], [3, 8], [5, 5], [10, 2]]);
      itens.push({ pedido_id: id, sku: p.sku, produto_id: p.sku.slice(3), nome: p.nome, marca: p.marca, categoria: p.categoria, departamento: 'Saúde', qtd, valor: qtd * p.preco });
      soma += qtd * p.preco;
    }
    const frete = entrega === 'retirada' ? 0 : entre(0, 1) ? entre(990, 3490) : 0;
    pedidos.push({
      id, dia, criado: new Date(criadoMs).toISOString(), status: cancelado ? 'canceled' : 'invoiced', cancelado,
      valor: soma + frete, frete, desconto: 0, canal, origem,
      utm_source: null, utm_medium: null, utm_campaign: CAMPANHAS[origem] ? sorteio(CAMPANHAS[origem]) : null,
      pagamento: sorteio(PAGAMENTOS), parcelas: 1, uf, cidade, entrega,
      cliente_tipo: canal === 'Site' ? sorteio(TIPOS) : null,
      atualizado: new Date(agora).toISOString(),
    });
  }
}

const usuarios = [
  { email: 'compras@exemplo.com', nome: 'Compras (exemplo)', perfil: 'compras', ajustes: null, admin: 0, ativo: 1, criado: new Date(agora).toISOString() },
  { email: 'mkt@exemplo.com', nome: 'Marketing (exemplo)', perfil: 'marketing', ajustes: JSON.stringify({ ver_valores: false }), admin: 0, ativo: 1, criado: new Date(agora).toISOString() },
  // Dois administradores comuns: testar o que um admin pode mudar no outro e em si mesmo.
  { email: 'gerente@exemplo.com', nome: 'Gerente (exemplo)', perfil: 'gestao', ajustes: null, admin: 1, ativo: 1, criado: new Date(agora).toISOString() },
  { email: 'coord@exemplo.com', nome: 'Coordenação (exemplo)', perfil: 'marketing', ajustes: null, admin: 1, ativo: 1, criado: new Date(agora).toISOString() },
];
const coletas = [{ fonte: 'pedidos', quando: new Date(agora).toISOString(), ok: 1, registros: pedidos.length, erro: null }];

const partes = [
  '-- Dados fictícios gerados por scripts/semear-local.mjs (só para desenvolvimento local)',
  "DELETE FROM itens WHERE pedido_id LIKE 'F%'",
  "DELETE FROM pedidos WHERE id LIKE 'F%'",
  upsertSql('pedidos', pedidos, ['id']),
  upsertSql('itens', itens, ['pedido_id', 'sku']),
  upsertSql('usuarios', usuarios, ['email']),
  upsertSql('coletas', coletas, ['fonte']),
];
process.stdout.write(`${partes.join(';\n')};\n`);
