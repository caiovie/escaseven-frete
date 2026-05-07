// api/shipping/rodonaves.js

import crypto from 'crypto';

const CACHE = globalThis.__RODONAVES_CACHE__ || {
  token: null,
  tokenExpiresAt: 0,
  cityByZipcode: new Map(),
  quoteByKey: new Map(),
};

globalThis.__RODONAVES_CACHE__ = CACHE;

// =========================
// CONFIGURAÇÕES FIXAS
// =========================
const TOKEN_TIMEOUT_MS = 1500;
const CITY_TIMEOUT_MS = 1500;
const SIMULATION_TIMEOUT_MS = 2500;
const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;

// Margem de segurança aplicada a cotações vindas do fallback
// (a tabela é base; o ao vivo pode trazer adicionais como GRIS, despacho, etc)
// 1.0 = sem margem, 1.10 = +10%
const FALLBACK_PRICE_MULTIPLIER = 1.0;

// =========================
// TABELA DE FALLBACK - BRASIL INTEIRO
// Gerado a partir da Tabela Promocional RM ESCADAS (Rodonaves)
// Faixas de peso: <=10kg, <=20kg, <=40kg, <=60kg, <=100kg
// Acima de 100kg cai na cotação ao vivo.
// =========================
const FALLBACK_RULES = [
  // SP - SUDESTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '01000000',
    endZip: '19999999',
    days: 2,
    weightPrices: [
      { maxWeight: 10,  price: 54.15 },
      { maxWeight: 20,  price: 71.16 },
      { maxWeight: 40,  price: 88.19 },
      { maxWeight: 60,  price: 113.74 },
      { maxWeight: 100, price: 139.28 },
    ],
  },
  // MG - SUDESTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '30000001',
    endZip: '39997999',
    days: 2,
    weightPrices: [
      { maxWeight: 10,  price: 74.57 },
      { maxWeight: 20,  price: 105.22 },
      { maxWeight: 40,  price: 122.25 },
      { maxWeight: 60,  price: 147.79 },
      { maxWeight: 100, price: 190.35 },
    ],
  },
  // RJ - SUDESTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '20000001',
    endZip: '28999999',
    days: 4,
    weightPrices: [
      { maxWeight: 10,  price: 74.57 },
      { maxWeight: 20,  price: 105.22 },
      { maxWeight: 40,  price: 122.25 },
      { maxWeight: 60,  price: 147.79 },
      { maxWeight: 100, price: 190.35 },
    ],
  },
  // ES - SUDESTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '29000001',
    endZip: '29999999',
    days: 5,
    weightPrices: [
      { maxWeight: 10,  price: 130.76 },
      { maxWeight: 20,  price: 132.47 },
      { maxWeight: 40,  price: 156.30 },
      { maxWeight: 60,  price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ],
  },
  // PR - SUL
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '80000001',
    endZip: '87999999',
    days: 2,
    weightPrices: [
      { maxWeight: 10,  price: 74.57 },
      { maxWeight: 20,  price: 105.22 },
      { maxWeight: 40,  price: 122.25 },
      { maxWeight: 60,  price: 147.79 },
      { maxWeight: 100, price: 190.35 },
    ],
  },
  // SC - SUL
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '88000001',
    endZip: '89999999',
    days: 3,
    weightPrices: [
      { maxWeight: 10,  price: 74.57 },
      { maxWeight: 20,  price: 105.22 },
      { maxWeight: 40,  price: 122.25 },
      { maxWeight: 60,  price: 147.79 },
      { maxWeight: 100, price: 190.35 },
    ],
  },
  // RS - SUL
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '90000001',
    endZip: '99999999',
    days: 3,
    weightPrices: [
      { maxWeight: 10,  price: 130.76 },
      { maxWeight: 20,  price: 132.47 },
      { maxWeight: 40,  price: 156.30 },
      { maxWeight: 60,  price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ],
  },
  // DF - CENTRO-OESTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '70000001',
    endZip: '72799999',
    days: 4,
    weightPrices: [
      { maxWeight: 10,  price: 130.76 },
      { maxWeight: 20,  price: 132.47 },
      { maxWeight: 40,  price: 156.30 },
      { maxWeight: 60,  price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ],
  },
  // GO - CENTRO-OESTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '72800001',
    endZip: '76759999',
    days: 3,
    weightPrices: [
      { maxWeight: 10,  price: 130.76 },
      { maxWeight: 20,  price: 132.47 },
      { maxWeight: 40,  price: 156.30 },
      { maxWeight: 60,  price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ],
  },
  // MS - CENTRO-OESTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '79000001',
    endZip: '79999999',
    days: 3,
    weightPrices: [
      { maxWeight: 10,  price: 130.76 },
      { maxWeight: 20,  price: 132.47 },
      { maxWeight: 40,  price: 156.30 },
      { maxWeight: 60,  price: 190.36 },
      { maxWeight: 100, price: 224.40 },
    ],
  },
  // MT - CENTRO-OESTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '78000001',
    endZip: '78899999',
    days: 4,
    weightPrices: [
      { maxWeight: 10,  price: 147.79 },
      { maxWeight: 20,  price: 156.30 },
      { maxWeight: 40,  price: 190.36 },
      { maxWeight: 60,  price: 275.49 },
      { maxWeight: 100, price: 284.00 },
    ],
  },
  // TO - NORTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '77000000',
    endZip: '77999999',
    days: 6,
    weightPrices: [
      { maxWeight: 10,  price: 147.79 },
      { maxWeight: 20,  price: 156.30 },
      { maxWeight: 40,  price: 190.36 },
      { maxWeight: 60,  price: 275.49 },
      { maxWeight: 100, price: 284.00 },
    ],
  },
  // RO - NORTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '76800001',
    endZip: '76999999',
    days: 8,
    weightPrices: [
      { maxWeight: 10,  price: 164.82 },
      { maxWeight: 20,  price: 181.85 },
      { maxWeight: 40,  price: 224.40 },
      { maxWeight: 60,  price: 309.55 },
      { maxWeight: 100, price: 343.59 },
    ],
  },
  // PA - NORTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '66000001',
    endZip: '68899999',
    days: 9,
    weightPrices: [
      { maxWeight: 10,  price: 164.82 },
      { maxWeight: 20,  price: 181.85 },
      { maxWeight: 40,  price: 224.40 },
      { maxWeight: 60,  price: 309.55 },
      { maxWeight: 100, price: 343.59 },
    ],
  },
  // AP - NORTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '68900001',
    endZip: '68999999',
    days: 13,
    weightPrices: [
      { maxWeight: 10,  price: 173.33 },
      { maxWeight: 20,  price: 190.36 },
      { maxWeight: 40,  price: 241.43 },
      { maxWeight: 60,  price: 326.56 },
      { maxWeight: 100, price: 377.65 },
    ],
  },
  // AC - NORTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '69900001',
    endZip: '69999999',
    days: 11,
    weightPrices: [
      { maxWeight: 10,  price: 173.33 },
      { maxWeight: 20,  price: 190.36 },
      { maxWeight: 40,  price: 241.43 },
      { maxWeight: 60,  price: 326.56 },
      { maxWeight: 100, price: 377.65 },
    ],
  },
  // RR - NORTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '69300001',
    endZip: '69399999',
    days: 22,
    weightPrices: [
      { maxWeight: 10,  price: 173.33 },
      { maxWeight: 20,  price: 190.36 },
      { maxWeight: 40,  price: 241.43 },
      { maxWeight: 60,  price: 326.56 },
      { maxWeight: 100, price: 377.65 },
    ],
  },
  // AM - NORTE
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '69000001',
    endZip: '69899999',
    days: 11,
    weightPrices: [
      { maxWeight: 10,  price: 173.33 },
      { maxWeight: 20,  price: 190.36 },
      { maxWeight: 40,  price: 241.43 },
      { maxWeight: 60,  price: 326.56 },
      { maxWeight: 100, price: 377.65 },
    ],
  },
];

// =========================
// FALLBACK DE EMERGÊNCIA
// Usado quando:
//  - CEP não bate com nenhuma regra E
//  - API ao vivo falhou ou deu timeout
// Usa a faixa mais cara (Acima 3.400 km) como base conservadora
// para nunca deixar a Rodonaves fora do checkout.
// =========================
const EMERGENCY_FALLBACK = {
  name: 'Rodonaves',
  service: 'Normal',
  days: 15,
  weightPrices: [
    { maxWeight: 10,  price: 173.33 },
    { maxWeight: 20,  price: 190.36 },
    { maxWeight: 40,  price: 241.43 },
    { maxWeight: 60,  price: 326.56 },
    { maxWeight: 100, price: 377.65 },
    { maxWeight: 200, price: 750.00 },
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

  if (!numericPrice || numericPrice <= 0 || !numericDays || numericDays <= 0) {
    return null;
  }

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
  const priceRule = EMERGENCY_FALLBACK.weightPrices.find(
    (item) => totalWeight <= item.maxWeight
  );

  if (!priceRule) return null;

  return buildYampiQuote({
    name: EMERGENCY_FALLBACK.name,
    service: EMERGENCY_FALLBACK.service,
    price: priceRule.price * FALLBACK_PRICE_MULTIPLIER,
    days: EMERGENCY_FALLBACK.days,
    source: 'rodonaves-emergency',
  });
}

function buildQuoteKey({
  destinationZipCode,
  amount,
  totalWeight,
  totalPackages,
}) {
  return [
    destinationZipCode,
    Number(amount).toFixed(2),
    Number(totalWeight).toFixed(3),
    totalPackages,
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
  CACHE.quoteByKey.set(key, {
    quote,
    expiresAt: Date.now() + QUOTE_CACHE_TTL_MS,
  });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

// =========================
// VALIDAÇÃO HMAC YAMPI
// =========================
// A Yampi envia um header `x-yampi-hmac-sha256` (base64) com o HMAC-SHA256
// do corpo da requisição usando a chave secreta do frete por API.
// =========================
function getRawBody(req) {
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  if (req.body && typeof req.body === 'object') return JSON.stringify(req.body);
  return '';
}

function validateYampiHmac(req) {
  const secret = process.env.YAMPI_HMAC_SECRET;

  // Se não tem secret configurado, pula a validação (modo permissivo)
  if (!secret) {
    console.log('HMAC SKIP: secret não configurada');
    return true;
  }

  const receivedHmac =
    req.headers['x-yampi-hmac-sha256'] ||
    req.headers['X-Yampi-Hmac-Sha256'] ||
    req.headers['x-shopify-hmac-sha256'];

  if (!receivedHmac) {
    console.log('HMAC SKIP: header não veio (Yampi pode não ter enviado)');
    return true; // não bloquear se a Yampi não mandar o header
  }

  const rawBody = getRawBody(req);
  const calculated = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('base64');

  const ok = calculated === receivedHmac;
  console.log('HMAC:', ok ? 'OK' : 'FAIL');
  return ok;
}

// =========================
// RODONAVES TOKEN
// =========================
async function getRodonavesToken() {
  const now = Date.now();

  if (CACHE.token && CACHE.tokenExpiresAt > now) {
    console.log('TOKEN CACHE OK');
    return CACHE.token;
  }

  const body = new URLSearchParams({
    grant_type: 'password',
    username: process.env.RODONAVES_USERNAME,
    password: process.env.RODONAVES_PASSWORD,
    companyId: process.env.RODONAVES_COMPANY_ID || '1',
    auth_type: process.env.RODONAVES_AUTH_TYPE || 'dev',
  });

  const response = await fetchWithTimeout(
    'https://quotation-apigateway.rte.com.br/token',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    },
    TOKEN_TIMEOUT_MS
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Erro token Rodonaves: ${text}`);
  }

  const data = JSON.parse(text);

  if (!data.access_token) {
    throw new Error('Rodonaves não retornou access_token');
  }

  CACHE.token = data.access_token;
  CACHE.tokenExpiresAt = Date.now() + 7 * 60 * 60 * 1000;

  console.log('TOKEN NOVO OK');

  return CACHE.token;
}

// =========================
// CIDADE POR CEP
// =========================
async function getCityByZipcode(token, zipCode) {
  const cleanZipCode = onlyDigits(zipCode);

  if (CACHE.cityByZipcode.has(cleanZipCode)) {
    const cachedCity = CACHE.cityByZipcode.get(cleanZipCode);
    console.log('CITY CACHE OK:', cleanZipCode, cachedCity?.Id || cachedCity?.id);
    return cachedCity;
  }

  const url = `https://dne-api.rte.com.br/api/cities/byzipcode?zipCode=${encodeURIComponent(cleanZipCode)}`;

  const response = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
    CITY_TIMEOUT_MS
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Erro cidade Rodonaves: ${text}`);
  }

  const data = JSON.parse(text);

  CACHE.cityByZipcode.set(cleanZipCode, data);

  console.log('CITY NOVA OK:', cleanZipCode, data?.Id || data?.id);

  return data;
}

function extractCityId(cityResponse) {
  if (!cityResponse) {
    throw new Error('Cidade não retornada');
  }

  if (typeof cityResponse.Id !== 'undefined') return Number(cityResponse.Id);
  if (typeof cityResponse.id !== 'undefined') return Number(cityResponse.id);
  if (typeof cityResponse.CityId !== 'undefined') return Number(cityResponse.CityId);
  if (typeof cityResponse.cityId !== 'undefined') return Number(cityResponse.cityId);

  if (Array.isArray(cityResponse) && cityResponse.length > 0) {
    return extractCityId(cityResponse[0]);
  }

  throw new Error(`CityId não encontrado: ${JSON.stringify(cityResponse)}`);
}

// =========================
// SIMULAÇÃO RODONAVES AO VIVO
// =========================
async function getRodonavesSimulation(token, payload) {
  const response = await fetchWithTimeout(
    'https://quotation-apigateway.rte.com.br/api/v1/simula-cotacao',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    },
    SIMULATION_TIMEOUT_MS
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Erro simulação Rodonaves: ${text}`);
  }

  return JSON.parse(text);
}

function buildQuoteFromSimulation(simulation) {
  if (!simulation || simulation.Message) return null;

  return buildYampiQuote({
    name: 'Rodonaves',
    service: 'Normal',
    price: Number(simulation.Value || 0),
    days: Number(simulation.DeliveryTime || 0),
    source: 'rodonaves-live',
  });
}

// =========================
// COTAÇÃO AO VIVO COM TIMEOUT GLOBAL
// =========================
async function tryLiveQuote({
  destinationZipCode,
  amount,
  totalWeight,
  totalPackages,
  originZipCode,
  originCityId,
  customerTaxIdRegistration,
}) {
  try {
    const token = await getRodonavesToken();
    const city = await getCityByZipcode(token, destinationZipCode);
    const destinationCityId = extractCityId(city);

    console.log('DESTINATION CITY ID:', destinationCityId);

    const payload = {
      OriginZipCode: originZipCode,
      OriginCityId: originCityId,
      DestinationZipCode: destinationZipCode,
      DestinationCityId: destinationCityId,
      TotalWeight: totalWeight,
      EletronicInvoiceValue: amount,
      CustomerTaxIdRegistration: customerTaxIdRegistration,
      TotalPackages: totalPackages,
      Packs: [],
    };

    console.log('PAYLOAD OK');

    const simulation = await getRodonavesSimulation(token, payload);

    console.log(
      'SIMULATION RESULT:',
      JSON.stringify({
        Value: simulation?.Value,
        DeliveryTime: simulation?.DeliveryTime,
        Message: simulation?.Message,
      })
    );

    return buildQuoteFromSimulation(simulation);
  } catch (err) {
    console.error('LIVE QUOTE FAIL:', err.message);
    return null;
  }
}

// =========================
// DADOS DA YAMPI
// =========================
function getCartDataFromYampi(body) {
  const destinationZipCode = onlyDigits(body?.zipcode);
  const amount = Number(body?.amount || 0);
  const skus = Array.isArray(body?.skus) ? body.skus : [];

  const totalWeight = skus.reduce((sum, sku) => {
    const weight = Number(sku?.weight || 0);
    const quantity = Number(sku?.quantity || 0);
    return sum + weight * quantity;
  }, 0);

  const totalPackages = skus.reduce((sum, sku) => {
    return sum + Number(sku?.quantity || 0);
  }, 0);

  return {
    destinationZipCode,
    amount,
    totalWeight,
    totalPackages,
  };
}

function validateBaseData({
  destinationZipCode,
  amount,
  totalWeight,
  totalPackages,
  originZipCode,
  originCityId,
  customerTaxIdRegistration,
}) {
  if (!destinationZipCode || destinationZipCode.length !== 8) {
    throw new Error('CEP de destino inválido');
  }
  if (!amount || amount <= 0) {
    throw new Error('Valor inválido');
  }
  if (!totalWeight || totalWeight <= 0) {
    throw new Error('Peso inválido');
  }
  if (!totalPackages || totalPackages <= 0) {
    throw new Error('Volumes inválidos');
  }
  if (!originZipCode || originZipCode.length !== 8) {
    throw new Error('ESCASEVEN_ORIGIN_ZIP inválido');
  }
  if (!originCityId || Number.isNaN(originCityId)) {
    throw new Error('ESCASEVEN_ORIGIN_CITY_ID inválido');
  }
  if (!customerTaxIdRegistration) {
    throw new Error('RODONAVES_CUSTOMER_TAX_ID não configurado');
  }
}

// =========================
// HANDLER PRINCIPAL
// =========================
export default async function handler(req, res) {
  const startedAt = Date.now();

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      message: 'API Rodonaves EscaSeven no ar',
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  console.log('YAMPI BODY COMPLETO:', JSON.stringify(req.body, null, 2));
  console.log('YAMPI HEADERS:', JSON.stringify(req.headers, null, 2));

  try {
    // 0) HMAC Yampi (não bloqueia se header não vier)
    const hmacOk = validateYampiHmac(req);
    if (!hmacOk) {
      console.error('HMAC INVÁLIDO - rejeitando');
      return res.status(401).json({ quotes: [] });
    }

    const {
      destinationZipCode,
      amount,
      totalWeight,
      totalPackages,
    } = getCartDataFromYampi(req.body);

    const originZipCode = onlyDigits(process.env.ESCASEVEN_ORIGIN_ZIP);
    const originCityId = Number(process.env.ESCASEVEN_ORIGIN_CITY_ID);
    const customerTaxIdRegistration = onlyDigits(process.env.RODONAVES_CUSTOMER_TAX_ID);

    console.log('CEP:', destinationZipCode);
    console.log('VALOR:', amount);
    console.log('PESO:', totalWeight);
    console.log('VOLUMES:', totalPackages);

    validateBaseData({
      destinationZipCode,
      amount,
      totalWeight,
      totalPackages,
      originZipCode,
      originCityId,
      customerTaxIdRegistration,
    });

    const quoteKey = buildQuoteKey({
      destinationZipCode,
      amount,
      totalWeight,
      totalPackages,
    });

    // 1) CACHE
    const cachedQuote = getCachedQuote(quoteKey);
    if (cachedQuote) {
      console.log('QUOTE CACHE OK');
      console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [cachedQuote] }));
      console.log('TOTAL MS:', elapsedMs(startedAt));
      return res.status(200).json({ quotes: [cachedQuote] });
    }

    // 2) FALLBACK REGIONAL (resposta < 50ms)
    const fallbackQuote = findFallbackQuote(destinationZipCode, totalWeight);
    if (fallbackQuote) {
      setCachedQuote(quoteKey, fallbackQuote);
      console.log('FALLBACK REGIONAL OK:', {
        price: fallbackQuote.price,
        days: fallbackQuote.days,
      });
      console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [fallbackQuote] }));
      console.log('TOTAL MS:', elapsedMs(startedAt));
      return res.status(200).json({ quotes: [fallbackQuote] });
    }

    // 3) RODONAVES AO VIVO (CEPs fora do mapa, ex: NE)
    const liveQuote = await tryLiveQuote({
      destinationZipCode,
      amount,
      totalWeight,
      totalPackages,
      originZipCode,
      originCityId,
      customerTaxIdRegistration,
    });

    if (liveQuote) {
      setCachedQuote(quoteKey, liveQuote);
      console.log('LIVE QUOTE OK');
      console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [liveQuote] }));
      console.log('TOTAL MS:', elapsedMs(startedAt));
      return res.status(200).json({ quotes: [liveQuote] });
    }

    // 4) FALLBACK DE EMERGÊNCIA (último recurso)
    const emergencyQuote = findEmergencyQuote(totalWeight);
    if (emergencyQuote) {
      // não cacheia o de emergência - permite tentar ao vivo na próxima
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

    // Mesmo em erro inesperado, tenta retornar emergência baseada no peso
    try {
      const totalWeight = (req.body?.skus || []).reduce(
        (s, x) => s + Number(x.weight || 0) * Number(x.quantity || 0),
        0
      );
      const emergencyQuote = findEmergencyQuote(totalWeight);
      if (emergencyQuote) {
        console.log('EMERGENCY POR EXCEÇÃO');
        console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [emergencyQuote] }));
        console.log('TOTAL MS ERROR:', elapsedMs(startedAt));
        return res.status(200).json({ quotes: [emergencyQuote] });
      }
    } catch (_) {}

    console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [] }));
    console.log('TOTAL MS ERROR:', elapsedMs(startedAt));
    return res.status(200).json({ quotes: [] });
  }
}