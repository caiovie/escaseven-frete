// api/shipping/rodonaves.js
// v3: SIMPLIFICADO - apenas fallback regional no checkout
// gera-cotacao foi movida para o n8n (pós-pedido) por causa de instabilidade
// e bloqueios de IP detectados na infraestrutura da Rodonaves.

import crypto from 'crypto';

const CACHE = globalThis.__RODONAVES_CACHE__ || {
  quoteByKey: new Map(),
};

globalThis.__RODONAVES_CACHE__ = CACHE;

// =========================
// CONFIGURAÇÕES
// =========================
const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;
const FALLBACK_PRICE_MULTIPLIER = 1.0;

// =========================
// FALLBACK REGIONAL - BRASIL
// Tabela RM Escadas (Rodonaves) - apenas frete peso (sem generalidades)
// O n8n calcula o valor real depois do pedido pago via gera-cotacao.
// =========================
const FALLBACK_RULES = [
  // SP
  { name: 'Rodonaves', service: 'Normal', startZip: '01000000', endZip: '19999999', days: 2,
    weightPrices: [
      { maxWeight: 10, price: 54.15 }, { maxWeight: 20, price: 71.16 },
      { maxWeight: 40, price: 88.19 }, { maxWeight: 60, price: 113.74 },
      { maxWeight: 100, price: 139.28 },
    ]},
  // MG
  { name: 'Rodonaves', service: 'Normal', startZip: '30000001', endZip: '39997999', days: 2,
    weightPrices: [
      { maxWeight: 10, price: 74.57 }, { maxWeight: 20, price: 105.22 },
      { maxWeight: 40, price: 122.25 }, { maxWeight: 60, price: 147.79 },
      { maxWeight: 100, price: 190.35 },
    ]},
  // RJ
  { name: 'Rodonaves', service: 'Normal', startZip: '20000001', endZip: '28999999', days: 4,
    weightPrices: [
      { maxWeight: 10, price: 74.57 }, { maxWeight: 20, price: 105.22 },
      { maxWeight: 40, price: 122.25 }, { maxWeight: 60, price: 147.79 },
      { maxWeight: 100, price: 190.35 },
    ]},
  // ES
  { name: 'Rodonaves', service: 'Normal', startZip: '29000001', endZip: '29999999', days: 5,
    weightPrices: [
      { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 },
      { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ]},
  // PR
  { name: 'Rodonaves', service: 'Normal', startZip: '80000001', endZip: '87999999', days: 2,
    weightPrices: [
      { maxWeight: 10, price: 74.57 }, { maxWeight: 20, price: 105.22 },
      { maxWeight: 40, price: 122.25 }, { maxWeight: 60, price: 147.79 },
      { maxWeight: 100, price: 190.35 },
    ]},
  // SC
  { name: 'Rodonaves', service: 'Normal', startZip: '88000001', endZip: '89999999', days: 3,
    weightPrices: [
      { maxWeight: 10, price: 74.57 }, { maxWeight: 20, price: 105.22 },
      { maxWeight: 40, price: 122.25 }, { maxWeight: 60, price: 147.79 },
      { maxWeight: 100, price: 190.35 },
    ]},
  // RS
  { name: 'Rodonaves', service: 'Normal', startZip: '90000001', endZip: '99999999', days: 3,
    weightPrices: [
      { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 },
      { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ]},
  // DF
  { name: 'Rodonaves', service: 'Normal', startZip: '70000001', endZip: '72799999', days: 4,
    weightPrices: [
      { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 },
      { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ]},
  // GO
  { name: 'Rodonaves', service: 'Normal', startZip: '72800001', endZip: '76759999', days: 3,
    weightPrices: [
      { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 },
      { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ]},
  // MS
  { name: 'Rodonaves', service: 'Normal', startZip: '79000001', endZip: '79999999', days: 3,
    weightPrices: [
      { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 },
      { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ]},
  // MT
  { name: 'Rodonaves', service: 'Normal', startZip: '78000001', endZip: '78899999', days: 4,
    weightPrices: [
      { maxWeight: 10, price: 147.79 }, { maxWeight: 20, price: 156.30 },
      { maxWeight: 40, price: 190.36 }, { maxWeight: 60, price: 275.49 },
      { maxWeight: 100, price: 284.00 },
    ]},
  // TO
  { name: 'Rodonaves', service: 'Normal', startZip: '77000000', endZip: '77999999', days: 6,
    weightPrices: [
      { maxWeight: 10, price: 147.79 }, { maxWeight: 20, price: 156.30 },
      { maxWeight: 40, price: 190.36 }, { maxWeight: 60, price: 275.49 },
      { maxWeight: 100, price: 284.00 },
    ]},
  // RO
  { name: 'Rodonaves', service: 'Normal', startZip: '76800001', endZip: '76999999', days: 8,
    weightPrices: [
      { maxWeight: 10, price: 164.82 }, { maxWeight: 20, price: 181.85 },
      { maxWeight: 40, price: 224.40 }, { maxWeight: 60, price: 309.55 },
      { maxWeight: 100, price: 343.59 },
    ]},
  // PA
  { name: 'Rodonaves', service: 'Normal', startZip: '66000001', endZip: '68899999', days: 9,
    weightPrices: [
      { maxWeight: 10, price: 164.82 }, { maxWeight: 20, price: 181.85 },
      { maxWeight: 40, price: 224.40 }, { maxWeight: 60, price: 309.55 },
      { maxWeight: 100, price: 343.59 },
    ]},
  // AP
  { name: 'Rodonaves', service: 'Normal', startZip: '68900001', endZip: '68999999', days: 13,
    weightPrices: [
      { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 },
      { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 },
      { maxWeight: 100, price: 377.65 },
    ]},
  // AC
  { name: 'Rodonaves', service: 'Normal', startZip: '69900001', endZip: '69999999', days: 11,
    weightPrices: [
      { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 },
      { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 },
      { maxWeight: 100, price: 377.65 },
    ]},
  // RR
  { name: 'Rodonaves', service: 'Normal', startZip: '69300001', endZip: '69399999', days: 22,
    weightPrices: [
      { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 },
      { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 },
      { maxWeight: 100, price: 377.65 },
    ]},
  // AM
  { name: 'Rodonaves', service: 'Normal', startZip: '69000001', endZip: '69899999', days: 11,
    weightPrices: [
      { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 },
      { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 },
      { maxWeight: 100, price: 377.65 },
    ]},
];

const EMERGENCY_FALLBACK = {
  name: 'Rodonaves', service: 'Normal', days: 15,
  weightPrices: [
    { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 },
    { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 },
    { maxWeight: 100, price: 377.65 }, { maxWeight: 200, price: 750.00 },
  ],
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
  const priceRule = rule.weightPrices.find((item) => totalWeight <= item.maxWeight);
  if (!priceRule) return null;
  return buildYampiQuote({
    name: rule.name,
    service: rule.service,
    price: priceRule.price * FALLBACK_PRICE_MULTIPLIER,
    days: rule.days,
    source: 'rodonaves-fallback',
  });
}

function findEmergencyQuote(totalWeight) {
  const priceRule = EMERGENCY_FALLBACK.weightPrices.find((item) => totalWeight <= item.maxWeight);
  if (!priceRule) return null;
  return buildYampiQuote({
    name: EMERGENCY_FALLBACK.name,
    service: EMERGENCY_FALLBACK.service,
    price: priceRule.price * FALLBACK_PRICE_MULTIPLIER,
    days: EMERGENCY_FALLBACK.days,
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

  const totalWeight = skus.reduce((sum, sku) => {
    return sum + Number(sku?.weight || 0) * Number(sku?.quantity || 0);
  }, 0);

  const totalPackages = skus.reduce((sum, sku) => sum + Number(sku?.quantity || 0), 0);

  return {
    destinationZipCode,
    totalWeight,
    totalPackages,
  };
}

// =========================
// HANDLER PRINCIPAL
// =========================
export default async function handler(req, res) {
  const startedAt = Date.now();

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'API Rodonaves EscaSeven v3 (fallback only)' });
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

    const { destinationZipCode, totalWeight, totalPackages } = getCartDataFromYampi(req.body);

    console.log('CEP:', destinationZipCode);
    console.log('PESO:', totalWeight);
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