async function getRodonavesToken() {
  const body = new URLSearchParams({
    grant_type: 'password',
    username: process.env.RODONAVES_USERNAME,
    password: process.env.RODONAVES_PASSWORD,
    companyId: process.env.RODONAVES_COMPANY_ID || '1',
    auth_type: process.env.RODONAVES_AUTH_TYPE || 'dev',
  });

  const response = await fetch('https://quotation-apigateway.rte.com.br/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Erro ao autenticar Rodonaves: ${text}`);
  }

  const data = JSON.parse(text);

  if (!data.access_token) {
    throw new Error('Rodonaves não retornou access_token');
  }

  return data.access_token;
}

async function getCityByZipcode(token, zipCode) {
  const url = `https://dne-api.rte.com.br/api/cities/byzipcode?zipCode=${encodeURIComponent(
    zipCode
  )}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Erro busca-cidade Rodonaves: ${text}`);
  }

  const data = JSON.parse(text);
  return data;
}

function extractCityId(cityResponse) {
  if (!cityResponse) {
    throw new Error('Resposta de cidade vazia');
  }

  // cobre formatos comuns possíveis
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

async function getRodonavesSimulation(token, payload) {
  const response = await fetch('https://quotation-apigateway.rte.com.br/api/v1/simula-cotacao', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Erro simulação Rodonaves: ${text}`);
  }

  return JSON.parse(text);
}

export default async function handler(req, res) {
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
    console.log('METHOD:', req.method);
    console.log('HEADERS:', JSON.stringify(req.headers, null, 2));
    console.log('BODY:', JSON.stringify(req.body, null, 2));

    // =========================
    // 1) Dados vindos da Yampi
    // =========================
    const destinationZipCode = req.body?.zipcode || '';
    const eletronicInvoiceValue = Number(req.body?.amount || 0);

    const totalWeight = (req.body?.skus || []).reduce((sum, sku) => {
      const weight = Number(sku?.weight || 0);
      const quantity = Number(sku?.quantity || 0);
      return sum + weight * quantity;
    }, 0);

    const totalPackages = (req.body?.skus || []).reduce((sum, sku) => {
      return sum + Number(sku?.quantity || 0);
    }, 0);

    console.log('destinationZipCode:', destinationZipCode);
    console.log('eletronicInvoiceValue:', eletronicInvoiceValue);
    console.log('totalWeight:', totalWeight);
    console.log('totalPackages:', totalPackages);

    // =======================================
    // 2) Dados fixos/configurados na Vercel
    // =======================================
    const originZipCode = process.env.ESCASEVEN_ORIGIN_ZIP;
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

    // =========================
    // 3) Token da Rodonaves
    // =========================
    const token = await getRodonavesToken();
    console.log('TOKEN OK?', !!token);

    // =========================
    // 4) Buscar city id do destino por CEP
    // =========================
    const destinationCityResponse = await getCityByZipcode(token, destinationZipCode);

    console.log(
      'RODONAVES DESTINATION CITY RESPONSE:',
      JSON.stringify(destinationCityResponse, null, 2)
    );

    const destinationCityId = extractCityId(destinationCityResponse);

    console.log('destinationCityId:', destinationCityId);

    // =========================
    // 5) Payload da simulação
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

    console.log(
      'RODONAVES SIMULATION PAYLOAD:',
      JSON.stringify(rodonavesSimulationPayload, null, 2)
    );

    // =========================
    // 6) Simulação Rodonaves
    // =========================
    const rodonavesSimulation = await getRodonavesSimulation(
      token,
      rodonavesSimulationPayload
    );

    console.log(
      'RODONAVES SIMULATION RESPONSE:',
      JSON.stringify(rodonavesSimulation, null, 2)
    );

    // =========================
    // 7) Retorno real para Yampi
    // =========================
    const quoteId =
      rodonavesSimulation.ProtocolNumber &&
      rodonavesSimulation.ProtocolNumber !== '0'
        ? String(rodonavesSimulation.ProtocolNumber)
        : `rodonaves-${Date.now()}`;

    return res.status(200).json({
      quotes: [
        {
          name: 'Rodonaves',
          service: 'Normal',
          price: Number(rodonavesSimulation.Value || 0),
          days: Number(rodonavesSimulation.DeliveryTime || 0),
          quote_id: quoteId,
          free_shipment: false,
        },
      ],
    });
  } catch (error) {
    console.error('ERRO:', error);

    // Evita quebrar completamente o checkout
    return res.status(200).json({
      quotes: [],
      error: 'Internal error',
      message: error.message,
    });
  }
}