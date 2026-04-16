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

async function getRodonavesQuote(token, payload) {
  const response = await fetch('https://quotation-apigateway.rte.com.br/api/v1/gera-cotacao', {
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
    throw new Error(`Erro cotação Rodonaves: ${text}`);
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
    const receiverCpfcnp = req.body?.cart?.customer?.document || '00000000000';

    const totalWeight = (req.body?.skus || []).reduce((sum, sku) => {
      const weight = Number(sku?.weight || 0);
      const quantity = Number(sku?.quantity || 0);
      return sum + weight * quantity;
    }, 0);

    console.log('destinationZipCode:', destinationZipCode);
    console.log('eletronicInvoiceValue:', eletronicInvoiceValue);
    console.log('receiverCpfcnp:', receiverCpfcnp);
    console.log('totalWeight:', totalWeight);

    // =======================================
    // 2) Dados fixos/configurados na Vercel
    // =======================================
    const originZipCode = process.env.ESCASEVEN_ORIGIN_ZIP;
    const originCityId = Number(process.env.ESCASEVEN_ORIGIN_CITY_ID);

    // TEMPORÁRIO:
    // enquanto você ainda não automatizou a busca do city id por CEP,
    // use um city id fixo de teste para o destino.
    // depois vamos trocar por busca dinâmica.
    const destinationCityId = Number(process.env.DESTINATION_CITY_ID_TEST || 0);

    const contactName =
      process.env.ESCASEVEN_CONTACT_NAME || 'Cliente EscaSeven';
    const contactPhoneNumber =
      process.env.ESCASEVEN_CONTACT_PHONE || '11999999999';

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

    if (!destinationCityId || Number.isNaN(destinationCityId)) {
      throw new Error('Variável DESTINATION_CITY_ID_TEST não configurada corretamente');
    }

    // =========================
    // 3) Token da Rodonaves
    // =========================
    const token = await getRodonavesToken();
    console.log('TOKEN OK?', !!token);

    // =========================
    // 4) Payload da Rodonaves
    // =========================
    const rodonavesPayload = {
      OriginZipCode: originZipCode,
      OriginCityId: originCityId,
      DestinationZipCode: destinationZipCode,
      DestinationCityId: destinationCityId,
      TotalWeight: totalWeight,
      EletronicInvoiceValue: eletronicInvoiceValue,
      CustomerTaxIdRegistration: customerTaxIdRegistration,
      ReceiverCpfcnp: receiverCpfcnp,
      ContactName: contactName,
      ContactPhoneNumber: contactPhoneNumber,
    };

    console.log(
      'RODONAVES PAYLOAD:',
      JSON.stringify(rodonavesPayload, null, 2)
    );

    // =========================
    // 5) Cotação Rodonaves
    // =========================
    const rodonavesQuote = await getRodonavesQuote(token, rodonavesPayload);

    console.log(
      'RODONAVES RESPONSE:',
      JSON.stringify(rodonavesQuote, null, 2)
    );

    // ==========================================
    // 6) RETORNO MOCKADO PARA NÃO QUEBRAR A YAMPI
    // ==========================================
    // Por enquanto, mantenha isso fixo.
    // Quando você validar o formato da resposta da Rodonaves,
    // a gente troca pelo valor real.
    return res.status(200).json({
      quotes: [
        {
          name: 'Rodonaves',
          service: 'Normal',
          price: 99.9,
          days: 3,
          quote_id: 'rodonaves-teste-1',
          free_shipment: false,
        },
      ],
    });
  } catch (error) {
    console.error('ERRO:', error);
    return res.status(500).json({
      error: 'Internal error',
      message: error.message,
    });
  }
}