const CACHE = globalThis.__RODONAVES_CACHE__ || {
  token: null,
  tokenExpiresAt: 0,
  cityByZipcode: new Map(),
};

globalThis.__RODONAVES_CACHE__ = CACHE;

function onlyDigits(value) {
  return String(value || '').replace(/\D/g, '');
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
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
    2000
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Erro token Rodonaves: ${text}`);
  }

  const data = JSON.parse(text);

  if (!data.access_token) {
    throw new Error('Token não retornado pela Rodonaves');
  }

  CACHE.token = data.access_token;
  CACHE.tokenExpiresAt = Date.now() + 7 * 60 * 60 * 1000;

  console.log('TOKEN NOVO OK');

  return CACHE.token;
}

async function getCityByZipcode(token, zipcode) {
  const cleanZipcode = onlyDigits(zipcode);

  if (CACHE.cityByZipcode.has(cleanZipcode)) {
    console.log('CITY CACHE OK:', cleanZipcode);
    return CACHE.cityByZipcode.get(cleanZipcode);
  }

  const url = `https://dne-api.rte.com.br/api/cities/byzipcode?zipCode=${encodeURIComponent(cleanZipcode)}`;

  const response = await fetchWithTimeout(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    },
    2500
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Erro cidade Rodonaves: ${text}`);
  }

  const city = JSON.parse(text);

  CACHE.cityByZipcode.set(cleanZipcode, city);

  console.log('CITY NOVA OK:', cleanZipcode, city?.Id || city?.id);

  return city;
}

function extractCityId(city) {
  if (!city) {
    throw new Error('Cidade não retornada');
  }

  if (city.Id) return Number(city.Id);
  if (city.id) return Number(city.id);
  if (city.CityId) return Number(city.CityId);
  if (city.cityId) return Number(city.cityId);

  if (Array.isArray(city) && city.length > 0) {
    return extractCityId(city[0]);
  }

  throw new Error(`CityId não encontrado: ${JSON.stringify(city)}`);
}

async function simulateRodonaves(token, payload) {
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
    10000
  );

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Erro simulação Rodonaves: ${text}`);
  }

  return JSON.parse(text);
}

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
    const destinationZipCode = onlyDigits(req.body?.zipcode);
    const amount = Number(req.body?.amount || 0);
    const skus = Array.isArray(req.body?.skus) ? req.body.skus : [];

    const totalWeight = skus.reduce((sum, sku) => {
      return sum + Number(sku?.weight || 0) * Number(sku?.quantity || 0);
    }, 0);

    const totalPackages = skus.reduce((sum, sku) => {
      return sum + Number(sku?.quantity || 0);
    }, 0);

    const originZipCode = onlyDigits(process.env.ESCASEVEN_ORIGIN_ZIP);
    const originCityId = Number(process.env.ESCASEVEN_ORIGIN_CITY_ID);
    const customerTaxIdRegistration = process.env.RODONAVES_CUSTOMER_TAX_ID;

    console.log('CEP:', destinationZipCode);
    console.log('VALOR:', amount);
    console.log('PESO:', totalWeight);
    console.log('VOLUMES:', totalPackages);

    if (!destinationZipCode || destinationZipCode.length !== 8) {
      throw new Error('CEP inválido');
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

    if (!originZipCode || !originCityId || !customerTaxIdRegistration) {
      throw new Error('Variáveis da Vercel incompletas');
    }

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

    const simulation = await simulateRodonaves(token, payload);

    console.log('SIMULATION:', JSON.stringify({
      Value: simulation?.Value,
      DeliveryTime: simulation?.DeliveryTime,
      Message: simulation?.Message,
    }));

    if (!simulation || simulation.Message) {
      return res.status(200).json({
        quotes: [],
      });
    }

    const price = Number(simulation.Value || 0);
    const days = Number(simulation.DeliveryTime || 0);

    if (!price || price <= 0 || !days || days <= 0) {
      return res.status(200).json({
        quotes: [],
      });
    }

    console.log('TOTAL MS:', Date.now() - startedAt);

    return res.status(200).json({
      quotes: [
        {
          name: 'Rodonaves',
          service: 'Normal',
          price,
          days,
          quote_id: `rodonaves-${Date.now()}`,
          free_shipment: false,
        },
      ],
    });
  } catch (error) {
    console.error('ERRO:', error.message);
    console.log('TOTAL MS ERROR:', Date.now() - startedAt);

    return res.status(200).json({
      quotes: [],
    });
  }
}