// api/shipping/rodonaves.js
// v2: gera-cotacao + savecustomer + fallback regional + HMAC Yampi

import crypto from 'crypto';

const CACHE = globalThis.__RODONAVES_CACHE__ || {
  // Tokens (cada API tem seu token)
  quotationToken: null,
  quotationTokenExpiresAt: 0,
  customerToken: null,
  customerTokenExpiresAt: 0,
  dneToken: null,
  dneTokenExpiresAt: 0,
  // Caches de dados
  cityByZipcode: new Map(),
  quoteByKey: new Map(),
  customerByDoc: new Map(), // CPF/CNPJ -> timestamp do cadastro
};

globalThis.__RODONAVES_CACHE__ = CACHE;

// =========================
// CONFIGURAÇÕES
// =========================
const TOKEN_TIMEOUT_MS = 1500;
const CITY_TIMEOUT_MS = 1500;
const CUSTOMER_TIMEOUT_MS = 2000;
const QUOTATION_TIMEOUT_MS = 4000;
const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;
const CUSTOMER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

const FALLBACK_PRICE_MULTIPLIER = 1.0;

// =========================
// FALLBACK REGIONAL - BRASIL
// (segurança contra timeout - mesma tabela RM Escadas)
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

function buildQuoteKey({ destinationZipCode, amount, totalWeight, totalPackages }) {
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
  CACHE.quoteByKey.set(key, { quote, expiresAt: Date.now() + QUOTE_CACHE_TTL_MS });
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
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
// TOKENS DAS APIs RODONAVES
// (cada API tem seu token, mas usam mesmas credenciais)
// =========================
async function getTokenGeneric(url, cacheKey, expiresAtKey) {
  const now = Date.now();
  if (CACHE[cacheKey] && CACHE[expiresAtKey] > now) {
    return CACHE[cacheKey];
  }

  const body = new URLSearchParams({
    grant_type: 'password',
    username: process.env.RODONAVES_USERNAME,
    password: process.env.RODONAVES_PASSWORD,
    companyId: process.env.RODONAVES_COMPANY_ID || '1',
    auth_type: process.env.RODONAVES_AUTH_TYPE || 'dev',
  });

  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  }, TOKEN_TIMEOUT_MS);

  const text = await response.text();
  if (!response.ok) throw new Error(`Erro token (${url}): ${text}`);

  const data = JSON.parse(text);
  if (!data.access_token) throw new Error(`Sem access_token em ${url}`);

  CACHE[cacheKey] = data.access_token;
  CACHE[expiresAtKey] = Date.now() + 7 * 60 * 60 * 1000;
  return CACHE[cacheKey];
}

async function getQuotationToken() {
  return getTokenGeneric(
    'https://quotation-apigateway.rte.com.br/token',
    'quotationToken',
    'quotationTokenExpiresAt'
  );
}

async function getCustomerToken() {
  return getTokenGeneric(
    'https://customer-apigateway.rte.com.br/token',
    'customerToken',
    'customerTokenExpiresAt'
  );
}

async function getDneToken() {
  return getTokenGeneric(
    'https://dne-api.rte.com.br/token',
    'dneToken',
    'dneTokenExpiresAt'
  );
}

// =========================
// CIDADE POR CEP (DNE API)
// =========================
async function getCityByZipcode(zipCode) {
  const cleanZipCode = onlyDigits(zipCode);

  if (CACHE.cityByZipcode.has(cleanZipCode)) {
    return CACHE.cityByZipcode.get(cleanZipCode);
  }

  const token = await getDneToken();
  const url = `https://dne-api.rte.com.br/api/cities/byzipcode?zipCode=${encodeURIComponent(cleanZipCode)}`;
  const response = await fetchWithTimeout(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
  }, CITY_TIMEOUT_MS);

  const text = await response.text();
  if (!response.ok) throw new Error(`Erro cidade: ${text}`);

  const data = JSON.parse(text);
  CACHE.cityByZipcode.set(cleanZipCode, data);
  return data;
}

function extractCityId(cityResponse) {
  if (!cityResponse) throw new Error('Cidade não retornada');
  if (typeof cityResponse.Id !== 'undefined') return Number(cityResponse.Id);
  if (typeof cityResponse.id !== 'undefined') return Number(cityResponse.id);
  if (typeof cityResponse.CityId !== 'undefined') return Number(cityResponse.CityId);
  if (typeof cityResponse.cityId !== 'undefined') return Number(cityResponse.cityId);
  if (Array.isArray(cityResponse) && cityResponse.length > 0) return extractCityId(cityResponse[0]);
  throw new Error(`CityId não encontrado: ${JSON.stringify(cityResponse)}`);
}

// =========================
// CADASTRO DESTINATÁRIO (CUSTOMER API)
// =========================
async function saveCustomerIfNeeded({ document, email, cityId, zipCode }) {
  const cleanDoc = onlyDigits(document);
  if (!cleanDoc) {
    console.log('SAVECUSTOMER SKIP: sem documento');
    return false;
  }

  // Cache: se já cadastrou nas últimas 7 dias, pula
  const lastSaved = CACHE.customerByDoc.get(cleanDoc);
  if (lastSaved && (Date.now() - lastSaved) < CUSTOMER_CACHE_TTL_MS) {
    console.log('SAVECUSTOMER CACHE OK:', cleanDoc);
    return true;
  }

  try {
    const token = await getCustomerToken();
    const isCnpj = cleanDoc.length === 14;

    const payload = {
      TaxIdRegistration: cleanDoc,
      Name: email || `Cliente ${cleanDoc}`,
      Email: email || '',
      ZipCode: onlyDigits(zipCode),
      CityId: cityId,
      PersonType: isCnpj ? 'J' : 'F',
    };

    const response = await fetchWithTimeout(
      'https://customer-apigateway.rte.com.br/api/v1/customer/savecustomer',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      },
      CUSTOMER_TIMEOUT_MS
    );

    const text = await response.text();
    if (!response.ok) {
      console.log('SAVECUSTOMER FAIL:', response.status, text);
      // Não falha o fluxo - tenta cotar mesmo assim
      return false;
    }

    CACHE.customerByDoc.set(cleanDoc, Date.now());
    console.log('SAVECUSTOMER OK:', cleanDoc);
    return true;
  } catch (err) {
    console.log('SAVECUSTOMER ERR:', err.message);
    return false;
  }
}

// =========================
// GERA COTAÇÃO (com tabela negociada)
// =========================
async function getRodonavesQuote(payload) {
  const token = await getQuotationToken();
  const response = await fetchWithTimeout(
    'https://quotation-apigateway.rte.com.br/api/v1/gera-cotacao',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    },
    QUOTATION_TIMEOUT_MS
  );

  const text = await response.text();
  if (!response.ok) throw new Error(`Erro gera-cotacao: ${text}`);

  return JSON.parse(text);
}

function buildQuoteFromGeraCotacao(simulation) {
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
// FLUXO COMPLETO AO VIVO
// =========================
async function tryLiveQuote({
  destinationZipCode,
  amount,
  totalWeight,
  totalPackages,
  originZipCode,
  originCityId,
  customerTaxIdRegistration,
  receiverDocument,
  receiverEmail,
  skus,
}) {
  try {
    // 1. Buscar cidade destino
    const city = await getCityByZipcode(destinationZipCode);
    const destinationCityId = extractCityId(city);
    console.log('DESTINATION CITY ID:', destinationCityId);

    // 2. (REMOVIDO) savecustomer - exige endereço completo que a Yampi não envia
    //    na cotação. O gera-cotacao funciona só com ReceiverCpfcnp no payload.

    // 3. Montar Packs (só com peso, dimensões zeradas)
    const packs = (skus || []).map((sku) => ({
      AmountPackages: Number(sku.quantity || 1),
      Weight: Number(sku.weight || 0),
      Length: 0,
      Height: 0,
      Width: 0,
    }));

    // 4. Payload gera-cotacao
    const payload = {
      OriginZipCode: originZipCode,
      OriginCityId: originCityId,
      DestinationZipCode: destinationZipCode,
      DestinationCityId: destinationCityId,
      TotalWeight: totalWeight,
      EletronicInvoiceValue: amount,
      CustomerTaxIdRegistration: customerTaxIdRegistration,
      ReceiverCpfcnp: onlyDigits(receiverDocument || ''),
      TotalPackages: totalPackages,
      Packs: packs.length > 0 ? packs : [{
        AmountPackages: totalPackages,
        Weight: totalWeight,
        Length: 0, Height: 0, Width: 0,
      }],
      ContactName: receiverEmail || 'cliente@escaseven.com.br',
      ContactPhoneNumber: '(11) 0000-0000',
    };

    console.log('GERA-COTACAO PAYLOAD OK');

    const result = await getRodonavesQuote(payload);
    console.log('GERA-COTACAO RESULT:', JSON.stringify({
      Value: result?.Value,
      DeliveryTime: result?.DeliveryTime,
      ProtocolNumber: result?.ProtocolNumber,
      Cubed: result?.Cubed,
      Message: result?.Message,
    }));

    return buildQuoteFromGeraCotacao(result);
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
    return sum + Number(sku?.weight || 0) * Number(sku?.quantity || 0);
  }, 0);

  const totalPackages = skus.reduce((sum, sku) => sum + Number(sku?.quantity || 0), 0);

  const receiverDocument = body?.cart?.customer?.document || '';
  const receiverEmail = body?.cart?.customer?.email || '';

  return {
    destinationZipCode,
    amount,
    totalWeight,
    totalPackages,
    receiverDocument,
    receiverEmail,
    skus,
  };
}

function validateBaseData(d) {
  if (!d.destinationZipCode || d.destinationZipCode.length !== 8) throw new Error('CEP inválido');
  if (!d.amount || d.amount <= 0) throw new Error('Valor inválido');
  if (!d.totalWeight || d.totalWeight <= 0) throw new Error('Peso inválido');
  if (!d.totalPackages || d.totalPackages <= 0) throw new Error('Volumes inválidos');
  if (!d.originZipCode || d.originZipCode.length !== 8) throw new Error('ESCASEVEN_ORIGIN_ZIP inválido');
  if (!d.originCityId || Number.isNaN(d.originCityId)) throw new Error('ESCASEVEN_ORIGIN_CITY_ID inválido');
  if (!d.customerTaxIdRegistration) throw new Error('RODONAVES_CUSTOMER_TAX_ID não configurado');
}

// =========================
// HANDLER PRINCIPAL
// =========================
export default async function handler(req, res) {
  const startedAt = Date.now();

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'API Rodonaves EscaSeven v2 (gera-cotacao)' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 0. HMAC Yampi
    const hmacOk = validateYampiHmac(req);
    if (!hmacOk) {
      console.error('HMAC INVÁLIDO');
      return res.status(401).json({ quotes: [] });
    }

    const cart = getCartDataFromYampi(req.body);
    const originZipCode = onlyDigits(process.env.ESCASEVEN_ORIGIN_ZIP);
    const originCityId = Number(process.env.ESCASEVEN_ORIGIN_CITY_ID);
    const customerTaxIdRegistration = onlyDigits(process.env.RODONAVES_CUSTOMER_TAX_ID);

    console.log('CEP:', cart.destinationZipCode);
    console.log('VALOR:', cart.amount);
    console.log('PESO:', cart.totalWeight);
    console.log('VOLUMES:', cart.totalPackages);
    console.log('CPF/CNPJ DEST:', cart.receiverDocument ? '***' + cart.receiverDocument.slice(-4) : '(vazio)');

    validateBaseData({ ...cart, originZipCode, originCityId, customerTaxIdRegistration });

    const quoteKey = buildQuoteKey(cart);

    // 1. Cache
    const cachedQuote = getCachedQuote(quoteKey);
    if (cachedQuote) {
      console.log('QUOTE CACHE OK');
      console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [cachedQuote] }));
      console.log('TOTAL MS:', elapsedMs(startedAt));
      return res.status(200).json({ quotes: [cachedQuote] });
    }

    // 2. AO VIVO PRIMEIRO (gera-cotacao com tabela negociada)
    const liveQuote = await tryLiveQuote({
      ...cart,
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

    // 3. FALLBACK REGIONAL (segurança contra timeout/erro)
    const fallbackQuote = findFallbackQuote(cart.destinationZipCode, cart.totalWeight);
    if (fallbackQuote) {
      // não cacheia o fallback - tenta ao vivo na próxima
      console.log('FALLBACK REGIONAL USADO');
      console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [fallbackQuote] }));
      console.log('TOTAL MS:', elapsedMs(startedAt));
      return res.status(200).json({ quotes: [fallbackQuote] });
    }

    // 4. EMERGÊNCIA (último recurso para Rodonaves nunca sumir)
    const emergencyQuote = findEmergencyQuote(cart.totalWeight);
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

    try {
      const totalWeight = (req.body?.skus || []).reduce(
        (s, x) => s + Number(x.weight || 0) * Number(x.quantity || 0), 0
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