// api/shipping/calculadora.js
// Calculadora de frete da PAGINA DO PRODUTO (chamada pelo navegador).
//
// Diferente do api/shipping/rodonaves.js, que e server-to-server (Yampi):
//  - Aqui o navegador chama direto, entao precisa de CORS.
//  - Recebe o SKU e busca peso/medidas na base do Bling (_dimensoes.js),
//    para dar EXATAMENTE o mesmo peso taxado que o checkout usa.
//  - Nao valida HMAC (nao ha segredo envolvido; e so consulta de preco).
//
// Uso:
//   GET  /api/shipping/calculadora?cep=01310100&sku=8US5V7PPR&qtd=1
//   POST /api/shipping/calculadora  { "cep": "01310100", "sku": "...", "qtd": 1 }
//
// Resposta:
//   { ok: true, atende: true, gratis: true,  price: 0,      days: 5, ... }
//   { ok: true, atende: true, gratis: false, price: 176.38, days: 5, ... }
//   { ok: true, atende: false, motivo: 'regiao_nao_atendida' }

import { cotar, chargeableWeight, skuData, onlyDigits } from './_engine.js';

const ORIGENS_PERMITIDAS = [
  'https://escaseven.com.br',
  'https://www.escaseven.com.br',
  'https://escaseven.myshopify.com',
];

function aplicarCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ORIGENS_PERMITIDAS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function lerEntrada(req) {
  if (req.method === 'GET') {
    const u = new URL(req.url, `https://${req.headers.host}`);
    return {
      cep: u.searchParams.get('cep'),
      sku: u.searchParams.get('sku'),
      qtd: u.searchParams.get('qtd'),
      peso: u.searchParams.get('peso'),
    };
  }
  const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  return { cep: b.cep, sku: b.sku, qtd: b.qtd, peso: b.peso };
}

export default function handler(req, res) {
  aplicarCors(req, res);

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, erro: 'method_not_allowed' });
  }

  try {
    const { cep, sku, qtd, peso } = lerEntrada(req);
    const cepLimpo = onlyDigits(cep);
    const quantidade = Math.max(1, Number(qtd) || 1);

    if (!cepLimpo || cepLimpo.length !== 8) {
      return res.status(200).json({ ok: false, erro: 'cep_invalido' });
    }

    // 1) Tenta pelo SKU (mesma base de medidas que a Yampi usa no checkout).
    let dados = skuData(sku);
    let origem = 'bling';

    // 2) Sem SKU cadastrado, cai no peso informado pela pagina (sem cubagem).
    if (!dados && peso) {
      dados = { weight: Number(peso) || 0, height: 0, width: 0, length: 0 };
      origem = 'peso_informado';
    }

    if (!dados || !dados.weight) {
      return res.status(200).json({ ok: false, erro: 'produto_sem_medida', sku: sku || null });
    }

    const unitario = chargeableWeight(dados);
    const taxado = unitario * quantidade;
    const r = cotar(cepLimpo, taxado);

    console.log('CALC:', { cep: cepLimpo, sku, qtd: quantidade, taxado: Number(taxado.toFixed(3)), origem, r });

    return res.status(200).json({
      ok: true,
      cep: cepLimpo,
      sku: sku || null,
      quantidade,
      peso_real: Number((dados.weight * quantidade).toFixed(3)),
      peso_taxado: Number(taxado.toFixed(3)),
      origem_medida: origem,
      ...r,
    });
  } catch (e) {
    console.error('ERRO CALC:', e.message);
    return res.status(200).json({ ok: false, erro: 'falha_interna' });
  }
}
