// api/shipping/rodonaves.js

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
const TOKEN_TIMEOUT_MS = 1800;
const CITY_TIMEOUT_MS = 1800;
const SIMULATION_TIMEOUT_MS = 3000;
const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;

// =========================
// TABELA RÁPIDA DE FALLBACK
// =========================
// Ajuste esses valores depois com a EscaSeven/Rodonaves.
// Eles servem para garantir que a opção Rodonaves apareça no checkout
// sem depender da simula-cotacao ao vivo em todos os casos.
const FALLBACK_RULES = [
  // Osasco/SP e região próxima: CEPs 06000-001 até 06299-999
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '06000001',
    endZip: '06299999',
    cityId: 9432,
    days: 1,
    weightPrices: [
      { maxWeight: 6, price: 159.32 },
      { maxWeight: 13, price: 176.89 },
      { maxWeight: 25, price: 195.98 },
      { maxWeight: 45, price: 213.5 },
    ],
  },

  // Rio de Janeiro/RJ: CEPs 20000-001 até 23799-999
  {
    name: 'Rodonaves',
    service: 'Normal',
    startZip: '20000001',
    endZip: '23799999',
    cityId: 7043,
    days: 5,
    weightPrices: [
      { maxWeight: 6, price: 213.5 },
      { maxWeight: 13, price: 241.14 },
      { maxWeight: 25, price: 242.26 },
      { maxWeight: 45, price: 270.75 },
    ],
  },
];

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
    price: numericPrice,
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

  return {
    quote: buildYampiQuote({
      name: rule.name,
      service: rule.service,
      price: priceRule.price,
      days: rule.days,
      source: 'rodonaves-fallback',
    }),
    cityId: rule.cityId,
    rule,
  };
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
    return res.status(405).json({
      error: 'Method not allowed',
    });
  }

  try {
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

    // 1) CACHE PRIMEIRO
    const cachedQuote = getCachedQuote(quoteKey);

    if (cachedQuote) {
      console.log('QUOTE CACHE OK');
      console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [cachedQuote] }));
      console.log('TOTAL MS:', elapsedMs(startedAt));

      return res.status(200).json({
        quotes: [cachedQuote],
      });
    }

    // 2) FALLBACK RÁPIDO PARA REGIÕES CONHECIDAS
    const fallbackResult = findFallbackQuote(destinationZipCode, totalWeight);

    if (fallbackResult?.quote) {
      setCachedQuote(quoteKey, fallbackResult.quote);

      console.log('FALLBACK QUOTE OK:', {
        cityId: fallbackResult.cityId,
        price: fallbackResult.quote.price,
        days: fallbackResult.quote.days,
      });

      console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [fallbackResult.quote] }));
      console.log('TOTAL MS:', elapsedMs(startedAt));

      return res.status(200).json({
        quotes: [fallbackResult.quote],
      });
    }

    // 3) RODONAVES AO VIVO SÓ SE NÃO HOUVER FALLBACK
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

    const liveQuote = buildQuoteFromSimulation(simulation);

    if (!liveQuote) {
      console.log('SEM COTAÇÃO RODONAVES');
      console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [] }));
      console.log('TOTAL MS:', elapsedMs(startedAt));

      return res.status(200).json({
        quotes: [],
      });
    }

    setCachedQuote(quoteKey, liveQuote);

    console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [liveQuote] }));
    console.log('TOTAL MS:', elapsedMs(startedAt));

    return res.status(200).json({
      quotes: [liveQuote],
    });
  } catch (error) {
    console.error('ERRO:', error.message);
    console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [] }));
    console.log('TOTAL MS ERROR:', elapsedMs(startedAt));

    return res.status(200).json({
      quotes: [],
    });
  }
}