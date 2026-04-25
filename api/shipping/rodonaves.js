// api/shipping/rodonaves.js

const CACHE = globalThis.__RODONAVES_CACHE__ || {
  token: null,
  tokenExpiresAt: 0,
  cityByZipcode: new Map(),
  quoteByKey: new Map(),
};

globalThis.__RODONAVES_CACHE__ = CACHE;

// =========================
// Configurações fixas
// =========================
const TOKEN_TIMEOUT_MS = 3000;
const CITY_TIMEOUT_MS = 3000;
const SIMULATION_TIMEOUT_MS = 8000;
const QUOTE_CACHE_TTL_MS = 10 * 60 * 1000;

// =========================
// Helpers
// =========================
function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function elapsedMs(startedAt) {
  return Date.now() - startedAt;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
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

function buildQuoteKey({
  originZipCode,
  originCityId,
  destinationZipCode,
  destinationCityId,
  totalWeight,
  amount,
  totalPackages,
}) {
  return [
    originZipCode,
    originCityId,
    destinationZipCode,
    destinationCityId,
    Number(totalWeight).toFixed(3),
    Number(amount).toFixed(2),
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

function buildYampiQuote(simulation) {
  if (!simulation || simulation.Message) return null;

  const price = Number(simulation.Value || 0);
  const days = Number(simulation.DeliveryTime || 0);

  if (!price || price <= 0) return null;
  if (!days || days <= 0) return null;

  const quoteId =
    simulation.ProtocolNumber && simulation.ProtocolNumber !== '0'
      ? String(simulation.ProtocolNumber)
      : `rodonaves-${Date.now()}`;

  return {
    name: 'Rodonaves',
    service: 'Normal',
    price,
    days,
    quote_id: quoteId,
    free_shipment: false,
  };
}

// =========================
// Token Rodonaves
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
    throw new Error(`Erro ao autenticar Rodonaves: ${text}`);
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
// Cidade por CEP
// =========================
async function getCityByZipcode(token, zipcode) {
  const cleanZipcode = onlyDigits(zipcode);

  if (CACHE.cityByZipcode.has(cleanZipcode)) {
    const cachedCity = CACHE.cityByZipcode.get(cleanZipcode);
    console.log('CITY CACHE OK:', cleanZipcode, cachedCity?.Id || cachedCity?.id);
    return cachedCity;
  }

  const url = `https://dne-api.rte.com.br/api/cities/byzipcode?zipCode=${encodeURIComponent(
    cleanZipcode
  )}`;

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
    throw new Error(`Erro busca-cidade Rodonaves: ${text}`);
  }

  const data = JSON.parse(text);

  CACHE.cityByZipcode.set(cleanZipcode, data);

  console.log('CITY NOVA OK:', cleanZipcode, data?.Id || data?.id);

  return data;
}

function extractCityId(cityResponse) {
  if (!cityResponse) {
    throw new Error('Resposta de cidade vazia');
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
// Simulação Rodonaves
// =========================
async function getRodonavesSimulation(token, payload) {
  console.log('SIMULATION TIMEOUT MS:', SIMULATION_TIMEOUT_MS);

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

// =========================
// Dados Yampi
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
    throw new Error('Valor da mercadoria inválido');
  }

  if (!totalWeight || totalWeight <= 0) {
    throw new Error('Peso total inválido');
  }

  if (!totalPackages || totalPackages <= 0) {
    throw new Error('Quantidade de volumes inválida');
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
// Handler principal
// =========================
export default async function handler(req, res) {
  const startedAt = Date.now();

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      message: 'API Rodonaves EscaSeven no ar',
      status: 'ready',
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

    const quoteKey = buildQuoteKey({
      originZipCode,
      originCityId,
      destinationZipCode,
      destinationCityId,
      totalWeight,
      amount,
      totalPackages,
    });

    const cachedQuote = getCachedQuote(quoteKey);

    if (cachedQuote) {
      console.log('QUOTE CACHE OK');
      console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [cachedQuote] }));
      console.log('TOTAL MS:', elapsedMs(startedAt));

      return res.status(200).json({
        quotes: [cachedQuote],
      });
    }

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

    const quote = buildYampiQuote(simulation);

    if (!quote) {
      console.log('SEM COTAÇÃO RODONAVES');
      console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [] }));
      console.log('TOTAL MS:', elapsedMs(startedAt));

      return res.status(200).json({
        quotes: [],
      });
    }

    setCachedQuote(quoteKey, quote);

    console.log('YAMPI RESPONSE:', JSON.stringify({ quotes: [quote] }));
    console.log('TOTAL MS:', elapsedMs(startedAt));

    return res.status(200).json({
      quotes: [quote],
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