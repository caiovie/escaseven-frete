// api/shipping/rodonaves.js
// v4: fallback regional no checkout + PESO CUBADO (fator 200 kg/m³)
//
// O QUE MUDOU EM RELAÇÃO À v3:
//  - Agora o frete é calculado pelo PESO TAXADO = max(peso real, peso cubado),
//    onde peso cubado = (C x L x A em m³) x 200 kg/m³.
//    Motivo: em ~279 de 280 SKUs de escada o peso cubado é MAIOR que o real,
//    ou seja, é a CUBAGEM que define o frete. A v3 usava só o peso real e
//    subestimava itens grandes (ex.: plataforma 6,8 m = 97 kg reais, mas 353 kg cubados).
//  - As faixas (weightPrices / maxWeight) passam a ser interpretadas em PESO TAXADO.
//  - Itens acima de 100 kg deixam de "estourar" a tabela: usam perKgOver100 (R$/kg da
//    tabela RM Escadas para a distância do estado).
//
// A cotação REAL continua sendo feita pós-pedido no n8n (gera-cotacao). Aqui é só a
// estimativa rápida exibida no checkout da Yampi.

import crypto from 'crypto';

const CACHE = globalThis.__RODONAVES_CACHE__ || {
  quoteByKey: new Map(),
};

globalThis.__RODONAVES_CACHE__ = CACHE;

// =========================
// CONFIGURAÇÕES
// =========================
const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;

// Fator de cubagem do contrato RM Escadas (Rodonaves): 200 kg por m³.
// (DF/UN 094 usa 300 kg/m³ na tabela; aqui mantemos 200 como regra geral —
//  ajustar pontualmente se quiser tratar DF à parte.)
const CUBAGE_FACTOR_KG_M3 = 200;

// Multiplicador para aproximar a tabela base do valor real cobrado pela Rodonaves.
// A tabela RM Escadas é apenas o "frete peso" - sem generalidades (ICMS, GRIS,
// Ad Valorem, SECCAT, pedágio). Baseado em CT-e real (SP→Garça 20kg):
//   Tabela base: R$ 88,19  |  Real cobrado: R$ 189,42  |  Fator: ~2,15x
// Usamos 2.0x como aproximação conservadora.
// IMPORTANTE: ajustar este valor conforme dados reais coletados via n8n.
const FALLBACK_PRICE_MULTIPLIER = 2.0;

// Buffer adicionado ao prazo de transporte da Rodonaves para refletir o ciclo
// completo de entrega ao cliente (separação, emissão NF, coleta, fins de semana).
const DELIVERY_DAYS_BUFFER = 3;

// =========================
// FALLBACK REGIONAL - BRASIL
// Tabela RM Escadas (Rodonaves) - apenas frete peso (sem generalidades).
// weightPrices = faixas de PESO TAXADO (cubado). perKgOver100 = R$/kg p/ acima de 100 kg.
// =========================
const FALLBACK_RULES = [
  // SP
  { name: 'Rodonaves', service: 'Normal', startZip: '01000000', endZip: '19999999', days: 2,
    weightPrices: [
      { maxWeight: 10, price: 54.15 }, { maxWeight: 20, price: 71.16 },
      { maxWeight: 40, price: 88.19 }, { maxWeight: 60, price: 113.74 },
      { maxWeight: 100, price: 139.28 },
    ], perKgOver100: 1.8684 },
  // MG
  { name: 'Rodonaves', service: 'Normal', startZip: '30000001', endZip: '39997999', days: 2,
    weightPrices: [
      { maxWeight: 10, price: 74.57 }, { maxWeight: 20, price: 105.22 },
      { maxWeight: 40, price: 122.25 }, { maxWeight: 60, price: 147.79 },
      { maxWeight: 100, price: 190.35 },
    ], perKgOver100: 2.2947 },
  // RJ
  { name: 'Rodonaves', service: 'Normal', startZip: '20000001', endZip: '28999999', days: 4,
    weightPrices: [
      { maxWeight: 10, price: 74.57 }, { maxWeight: 20, price: 105.22 },
      { maxWeight: 40, price: 122.25 }, { maxWeight: 60, price: 147.79 },
      { maxWeight: 100, price: 190.35 },
    ], perKgOver100: 2.2947 },
  // ES
  { name: 'Rodonaves', service: 'Normal', startZip: '29000001', endZip: '29999999', days: 5,
    weightPrices: [
      { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 },
      { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ], perKgOver100: 2.6709 },
  // PR
  { name: 'Rodonaves', service: 'Normal', startZip: '80000001', endZip: '87999999', days: 2,
    weightPrices: [
      { maxWeight: 10, price: 74.57 }, { maxWeight: 20, price: 105.22 },
      { maxWeight: 40, price: 122.25 }, { maxWeight: 60, price: 147.79 },
      { maxWeight: 100, price: 190.35 },
    ], perKgOver100: 2.2947 },
  // SC
  { name: 'Rodonaves', service: 'Normal', startZip: '88000001', endZip: '89999999', days: 3,
    weightPrices: [
      { maxWeight: 10, price: 74.57 }, { maxWeight: 20, price: 105.22 },
      { maxWeight: 40, price: 122.25 }, { maxWeight: 60, price: 147.79 },
      { maxWeight: 100, price: 190.35 },
    ], perKgOver100: 2.2947 },
  // RS
  { name: 'Rodonaves', service: 'Normal', startZip: '90000001', endZip: '99999999', days: 3,
    weightPrices: [
      { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 },
      { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ], perKgOver100: 2.6709 },
  // DF
  { name: 'Rodonaves', service: 'Normal', startZip: '70000001', endZip: '72799999', days: 4,
    weightPrices: [
      { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 },
      { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ], perKgOver100: 2.6709 },
  // GO
  { name: 'Rodonaves', service: 'Normal', startZip: '72800001', endZip: '76759999', days: 3,
    weightPrices: [
      { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 },
      { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ], perKgOver100: 2.6709 },
  // MS
  { name: 'Rodonaves', service: 'Normal', startZip: '79000001', endZip: '79999999', days: 3,
    weightPrices: [
      { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 },
      { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ], perKgOver100: 2.6709 },
  // MT
  { name: 'Rodonaves', service: 'Normal', startZip: '78000001', endZip: '78899999', days: 4,
    weightPrices: [
      { maxWeight: 10, price: 147.79 }, { maxWeight: 20, price: 156.30 },
      { maxWeight: 40, price: 190.36 }, { maxWeight: 60, price: 275.49 },
      { maxWeight: 100, price: 284.00 },
    ], perKgOver100: 3.5737 },
  // TO
  { name: 'Rodonaves', service: 'Normal', startZip: '77000000', endZip: '77999999', days: 6,
    weightPrices: [
      { maxWeight: 10, price: 147.79 }, { maxWeight: 20, price: 156.30 },
      { maxWeight: 40, price: 190.36 }, { maxWeight: 60, price: 275.49 },
      { maxWeight: 100, price: 284.00 },
    ], perKgOver100: 3.5737 },
  // RO
  { name: 'Rodonaves', service: 'Normal', startZip: '76800001', endZip: '76999999', days: 8,
    weightPrices: [
      { maxWeight: 10, price: 164.82 }, { maxWeight: 20, price: 181.85 },
      { maxWeight: 40, price: 224.40 }, { maxWeight: 60, price: 309.55 },
      { maxWeight: 100, price: 343.59 },
    ], perKgOver100: 3.9123 },
  // PA
  { name: 'Rodonaves', service: 'Normal', startZip: '66000001', endZip: '68899999', days: 9,
    weightPrices: [
      { maxWeight: 10, price: 164.82 }, { maxWeight: 20, price: 181.85 },
      { maxWeight: 40, price: 224.40 }, { maxWeight: 60, price: 309.55 },
      { maxWeight: 100, price: 343.59 },
    ], perKgOver100: 3.9123 },
  // AP
  { name: 'Rodonaves', service: 'Normal', startZip: '68900001', endZip: '68999999', days: 13,
    weightPrices: [
      { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 },
      { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 },
      { maxWeight: 100, price: 377.65 },
    ], perKgOver100: 4.2509 },
  // AC
  { name: 'Rodonaves', service: 'Normal', startZip: '69900001', endZip: '69999999', days: 11,
    weightPrices: [
      { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 },
      { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 },
      { maxWeight: 100, price: 377.65 },
    ], perKgOver100: 4.2509 },
  // RR
  { name: 'Rodonaves', service: 'Normal', startZip: '69300001', endZip: '69399999', days: 22,
    weightPrices: [
      { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 },
      { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 },
      { maxWeight: 100, price: 377.65 },
    ], perKgOver100: 4.2509 },
  // AM
  { name: 'Rodonaves', service: 'Normal', startZip: '69000001', endZip: '69899999', days: 11,
    weightPrices: [
      { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 },
      { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 },
      { maxWeight: 100, price: 377.65 },
    ], perKgOver100: 4.2509 },
];

const EMERGENCY_FALLBACK = {
  name: 'Rodonaves', service: 'Normal', days: 15,
  weightPrices: [
    { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 },
    { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 },
    { maxWeight: 100, price: 377.65 },
  ],
  perKgOver100: 4.2509,
};

// =========================
// HELPERS
// =========================
function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function elapsedMs(startedAt) {
  return Date.now() - startedAt;
}

function zipToNumber(zip) {
  return Number(onlyDigits(zip));
}

function isZipInRange(zip, startZip, endZip) {
  const value = zipToNumber(zip);
  return value >= zipToNumber(startZip) && value <= zipToNumber(endZip);
}

// Lê a dimensão do SKU em cm, tolerando diferentes nomes de campo da Yampi.
function dimCm(sku, ...keys) {
  for (const k of keys) {
    const v = Number(sku?.[k]);
    if (v && v > 0) return v;
  }
  return 0;
}

// Peso taxado de UMA unidade do SKU = max(peso real, peso cubado @200).
function chargeableWeightForSku(sku) {
  const real = Number(sku?.weight || 0);
  const length = dimCm(sku, 'length', 'comprimento', 'depth', 'profundidade');
  const width = dimCm(sku, 'width', 'largura');
  const height = dimCm(sku, 'height', 'altura');
  const cubicMeters = (length * width * height) / 1_000_000; // cm³ -> m³
  const cubedWeight = cubicMeters * CUBAGE_FACTOR_KG_M3;
  return Math.max(real, cubedWeight);
}

// Seleciona o preço base pela faixa de peso taxado; acima de 100 kg usa R$/kg.
function priceForWeight(rule, chargeableWeight) {
  const bracket = rule.weightPrices.find((item) => chargeableWeight <= item.maxWeight);
  if (bracket) return bracket.price;
  if (rule.perKgOver100) return rule.perKgOver100 * chargeableWeight;
  return null;
}

function buildYampiQuote({ name, service, price, days, source }) {
  const numericPrice = Number(price || 0);
  const numericDays = Number(days || 0);
  if (!numericPrice || numericPrice <= 0 || !numericDays || numericDays <= 0) return null;
  return {
    name,
    service,
    price: Number(numericPrice.toFixed(2)),
    days: numericDays,
    quote_id: `${source || 'rodonaves'}-${Date.now()}`,
    free_shipment: false,
  };
}

function findFallbackQuote(destinationZipCode, totalWeight) {
  const rule = FALLBACK_RULES.find((item) =>
    isZipInRange(destinationZipCode, item.startZip, item.endZip)
  );
  if (!rule) return null;
  const basePrice = priceForWeight(rule, totalWeight);
  if (basePrice == null) return null;
  return buildYampiQuote({
    name: rule.name,
    service: rule.service,
    price: basePrice * FALLBACK_PRICE_MULTIPLIER,
    days: rule.days + DELIVERY_DAYS_BUFFER,
    source: 'rodonaves-fallback',
  });
}

function findEmergencyQuote(totalWeight) {
  const basePrice = priceForWeight(EMERGENCY_FALLBACK, totalWeight);
  if (basePrice == null) return null;
  return buildYampiQuote({
    name: EMERGENCY_FALLBACK.name,
    service: EMERGENCY_FALLBACK.service,
    price: basePrice * FALLBACK_PRICE_MULTIPLIER,
    days: EMERGENCY_FALLBACK.days + DELIVERY_DAYS_BUFFER,
    source: 'rodonaves-emergency',
  });
}

function buildQuoteKey({ destinationZipCode, totalWeight }) {
  return [
    destinationZipCode,
    Number(totalWeight).toFixed(3),
  ].join('|');
}

function getCachedQuote(key) {
  const cached = CACHE.quoteByKey.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    CACHE.quoteByKey.delete(key);
    return null;
  }
  return cached.quote;
}

function setCachedQuote(key, quote) {
  CACHE.quoteByKey.set(key, { quote, expiresAt: Date.now() + QUOTE_CACHE_TTL_MS });
}

// =========================
// HMAC YAMPI
// =========================
function getRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return '';
}

function validateYampiHmac(req) {
  const secret = process.env.YAMPI_HMAC_SECRET;
  if (!secret) {
    console.log('HMAC SKIP: secret não configurada');
    return true;
  }
  const receivedHmac = req.headers['x-yampi-hmac-sha256'] || req.headers['X-Yampi-Hmac-Sha256'];
  if (!receivedHmac) {
    console.log('HMAC SKIP: header não veio');
    return true;
  }
  const rawBody = getRawBody(req);
  const calculated = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  const ok = calculated === receivedHmac;
  console.log('HMAC:', ok ? 'OK' : 'FAIL');
  return ok;
}

// =========================
// DADOS DA YAMPI
// =========================
function getCartDataFromYampi(body) {
  const destinationZipCode = onlyDigits(body?.zipcode);
  const skus = Array.isArray(body?.skus) ? body.skus : [];

  // Peso TAXADO total = soma do max(real, cubado) de cada SKU x quantidade.
  let totalRealWeight = 0;
  let totalWeight = 0; // peso taxado (o que vai para a tabela)
  for (const sku of skus) {
    const qty = Number(sku?.quantity || 0);
    totalRealWeight += Number(sku?.weight || 0) * qty;
    totalWeight += chargeableWeightForSku(sku) * qty;
  }

  const totalPackages = skus.reduce((sum, sku) => sum + Number(sku?.quantity || 0), 0);

  return {
    destinationZipCode,
    totalWeight,        // peso taxado (cubado quando maior)
    totalRealWeight,    // peso real (apenas para log/debug)
    totalPackages,
  };
}

// =========================
// HANDLER PRINCIPAL
// =========================
export default async function handler(req, res) {
  const startedAt = Date.now();

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'API Rodonaves EscaSeven v4 (fallback + cubagem 200)' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const hmacOk = validateYampiHmac(req);
    if (!hmacOk) {
      console.error('HMAC INVÁLIDO');
      return res.status(401).json({ quotes: [] });
    }

    const { destinationZipCode, totalWeight, totalRealWeight, totalPackages } = getCartDataFromYampi(req.body);

    console.log('CEP:', destinationZipCode);
    console.log('PESO REAL:', totalRealWeight);
    console.log('PESO TAXADO (cubado):', totalWeight);
    console.log('VOLUMES:', totalPackages);

    if (!destinationZipCode || destinationZipCode.length !== 8) {
      console.log('CEP inválido');
      return res.status(200).json({ quotes: [] });
    }

    if (!totalWeight || totalWeight <= 0) {
      console.log('Peso inválido');
      return res.status(200).json({ quotes: [] });
    }

    const quoteKey = buildQuoteKey({ destinationZipCode, totalWeight });

    // 1. Cache
    const cachedQuote = getCachedQuote(quoteKey);
    if (cachedQuote) {
      console.log('CACHE OK');
      console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [cachedQuote] }));
      console.log('TOTAL MS:', elapsedMs(startedAt));
      return res.status(200).json({ quotes: [cachedQuote] });
    }

    // 2. Fallback regional (resposta <50ms)
    const fallbackQuote = findFallbackQuote(destinationZipCode, totalWeight);
    if (fallbackQuote) {
      setCachedQuote(quoteKey, fallbackQuote);
      console.log('FALLBACK REGIONAL OK:', { price: fallbackQuote.price, days: fallbackQuote.days });
      console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [fallbackQuote] }));
      console.log('TOTAL MS:', elapsedMs(startedAt));
      return res.status(200).json({ quotes: [fallbackQuote] });
    }

    // 3. Emergência (último recurso para Rodonaves nunca sumir)
    const emergencyQuote = findEmergencyQuote(totalWeight);
    if (emergencyQuote) {
      console.log('EMERGENCY FALLBACK USADO');
      console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [emergencyQuote] }));
      console.log('TOTAL MS:', elapsedMs(startedAt));
      return res.status(200).json({ quotes: [emergencyQuote] });
    }

    console.log('SEM COTAÇÃO POSSÍVEL');
    console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [] }));
    console.log('TOTAL MS:', elapsedMs(startedAt));
    return res.status(200).json({ quotes: [] });
  } catch (error) {
    console.error('ERRO:', error.message);
    console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [] }));
    console.log('TOTAL MS ERROR:', elapsedMs(startedAt));
    return res.status(200).json({ quotes: [] });
  }
}
