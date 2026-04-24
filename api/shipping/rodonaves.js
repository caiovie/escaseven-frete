// =========================
// Cache em memória
// =========================
// Observação: em Vercel/serverless, esse cache funciona enquanto a instância estiver "quente".
// Não é um banco de dados, mas já reduz muito chamadas repetidas.
const CACHE = globalThis.__RODONAVES_CACHE__ || {
  token: null,
  tokenExpiresAt: 0,
  cityByZipcode: new Map(),
};

globalThis.__RODONAVES_CACHE__ = CACHE;

// =========================
// Helpers
// =========================
function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

function isDebugEnabled() {
  return process.env.DEBUG_LOGS === 'true';
}

function logDebug(label, data) {
  if (!isDebugEnabled()) return;

  if (typeof data === 'string') {
    console.log(label, data);
    return;
  }

  console.log(label, JSON.stringify(data, null, 2));
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
// Token Rodonaves com cache
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
    1500
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Erro ao autenticar Rodonaves: ${text}`);
  }

  const data = JSON.parse(text);

  if (!data.access_token) {
    throw new Error('Rodonaves não retornou access_token');
  }

  // O token costuma ter expires_in de 28800 segundos.
  // Aqui usamos 7 horas para renovar antes de expirar.
  CACHE.token = data.access_token;
  CACHE.tokenExpiresAt = Date.now() + 7 * 60 * 60 * 1000;

  console.log('TOKEN NOVO OK');

  return CACHE.token;
}

// =========================
// Busca city id por CEP com cache
// =========================
async function getCityByZipcode(token, zipCode) {
  const normalizedZipCode = onlyDigits(zipCode);

  if (!normalizedZipCode) {
    throw new Error('CEP inválido para busca de cidade');
  }

  if (CACHE.cityByZipcode.has(normalizedZipCode)) {
    const cachedCity = CACHE.cityByZipcode.get(normalizedZipCode);
    console.log('CITY CACHE OK:', normalizedZipCode, cachedCity?.Id || cachedCity?.id);
    return cachedCity;
  }

  const url = `https://dne-api.rte.com.br/api/cities/byzipcode?zipCode=${encodeURIComponent(
    normalizedZipCode
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
    1200
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Erro busca-cidade Rodonaves: ${text}`);
  }

  const data = JSON.parse(text);

  CACHE.cityByZipcode.set(normalizedZipCode, data);

  console.log('CITY NOVA OK:', normalizedZipCode);

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
    const item = cityResponse[0];

    if (typeof item.Id !== 'undefined') return Number(item.Id);
    if (typeof item.id !== 'undefined') return Number(item.id);
    if (typeof item.CityId !== 'undefined') return Number(item.CityId);
    if (typeof item.cityId !== 'undefined') return Number(item.cityId);
  }

  throw new Error(
    `Não foi possível identificar o city id na resposta: ${JSON.stringify(cityResponse)}`
  );
}

// =========================
// Simulação Rodonaves
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
    3500
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Erro simulação Rodonaves: ${text}`);
  }

  return JSON.parse(text);
}

// =========================
// Handler Vercel / Yampi
// =========================
export default async function handler(req, res) {
  const startedAt = Date.now();

  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      message: 'API Rodonaves da EscaSeven no ar',
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Logs leves
    console.log('METHOD:', req.method);

    logDebug('HEADERS:', req.headers);
    logDebug('BODY:', req.body);

    // =========================
    // 1) Dados vindos da Yampi
    // =========================
    const destinationZipCode = onlyDigits(req.body?.zipcode);
    const eletronicInvoiceValue = Number(req.body?.amount || 0);

    const skus = Array.isArray(req.body?.skus) ? req.body.skus : [];

    const totalWeight = skus.reduce((sum, sku) => {
      const weight = Number(sku?.weight || 0);
      const quantity = Number(sku?.quantity || 0);
      return sum + weight * quantity;
    }, 0);

    const totalPackages = skus.reduce((sum, sku) => {
      return sum + Number(sku?.quantity || 0);
    }, 0);

    console.log('destinationZipCode:', destinationZipCode);
    console.log('eletronicInvoiceValue:', eletronicInvoiceValue);
    console.log('totalWeight:', totalWeight);
    console.log('totalPackages:', totalPackages);

    // =========================
    // 2) Dados fixos da Vercel
    // =========================
    const originZipCode = onlyDigits(process.env.ESCASEVEN_ORIGIN_ZIP);
    const originCityId = Number(process.env.ESCASEVEN_ORIGIN_CITY_ID);
    const customerTaxIdRegistration =
      process.env.RODONAVES_CUSTOMER_TAX_ID || '51835028000180';

    if (!originZipCode) {
      throw new Error('Variável ESCASEVEN_ORIGIN_ZIP não configurada');
    }

    if (!originCityId || Number.isNaN(originCityId)) {
      throw new Error('Variável ESCASEVEN_ORIGIN_CITY_ID não configurada corretamente');
    }

    if (!destinationZipCode) {
      throw new Error('CEP de destino não recebido da Yampi');
    }

    if (!totalPackages || totalPackages < 1) {
      throw new Error('TotalPackages inválido');
    }

    if (!totalWeight || totalWeight <= 0) {
      throw new Error('TotalWeight inválido');
    }

    if (!eletronicInvoiceValue || eletronicInvoiceValue <= 0) {
      throw new Error('EletronicInvoiceValue inválido');
    }

    // =========================
    // 3) Token
    // =========================
    const token = await getRodonavesToken();

    // =========================
    // 4) City id dinâmico
    // =========================
    const destinationCityResponse = await getCityByZipcode(token, destinationZipCode);

    logDebug('RODONAVES DESTINATION CITY RESPONSE:', destinationCityResponse);

    const destinationCityId = extractCityId(destinationCityResponse);

    console.log('destinationCityId:', destinationCityId);

    // =========================
    // 5) Payload de simulação
    // =========================
    const rodonavesSimulationPayload = {
      OriginZipCode: originZipCode,
      OriginCityId: originCityId,
      DestinationZipCode: destinationZipCode,
      DestinationCityId: destinationCityId,
      TotalWeight: totalWeight,
      EletronicInvoiceValue: eletronicInvoiceValue,
      CustomerTaxIdRegistration: customerTaxIdRegistration,
      TotalPackages: totalPackages,
      Packs: [],
    };

    logDebug('RODONAVES SIMULATION PAYLOAD:', rodonavesSimulationPayload);

    // =========================
    // 6) Simulação
    // =========================
    const rodonavesSimulation = await getRodonavesSimulation(
      token,
      rodonavesSimulationPayload
    );

    console.log('RODONAVES SIMULATION VALUE:', rodonavesSimulation?.Value);
    console.log('RODONAVES SIMULATION DELIVERY:', rodonavesSimulation?.DeliveryTime);
    logDebug('RODONAVES SIMULATION RESPONSE:', rodonavesSimulation);

    if (!rodonavesSimulation || rodonavesSimulation.Message) {
      console.log('RODONAVES SEM COTAÇÃO:', rodonavesSimulation?.Message);
      return res.status(200).json({ quotes: [] });
    }

    const price = Number(rodonavesSimulation.Value || 0);
    const days = Number(rodonavesSimulation.DeliveryTime || 0);

    if (!price || price <= 0 || !days || days <= 0) {
      console.log('RODONAVES RETORNO INVÁLIDO:', {
        price,
        days,
      });

      return res.status(200).json({ quotes: [] });
    }

    const quoteId =
      rodonavesSimulation.ProtocolNumber &&
      rodonavesSimulation.ProtocolNumber !== '0'
        ? String(rodonavesSimulation.ProtocolNumber)
        : `rodonaves-${Date.now()}`;

    const totalMs = Date.now() - startedAt;
    console.log('TOTAL EXECUTION MS:', totalMs);

    return res.status(200).json({
      quotes: [
        {
          name: 'Rodonaves',
          service: 'Normal',
          price,
          days,
          quote_id: quoteId,
          free_shipment: false,
        },
      ],
    });
  } catch (error) {
    const totalMs = Date.now() - startedAt;

    console.error('ERRO:', error.message);
    console.log('TOTAL EXECUTION MS WITH ERROR:', totalMs);

    return res.status(200).json({
      quotes: [],
    });
  }
}