export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({
      ok: true,
      message: 'API Rodonaves da EscaSeven no ar'
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('METHOD:', req.method);
    console.log('HEADERS:', JSON.stringify(req.headers, null, 2));
    console.log('BODY:', JSON.stringify(req.body, null, 2));

    return res.status(200).json({
      quotes: [
        {
          name: 'Rodonaves',
          service: 'Normal',
          price: 99.9,
          days: 3,
          quote_id: 'rodonaves-teste-1',
          free_shipment: false
        }
      ]
    });
  } catch (error) {
    console.error('ERRO:', error);
    return res.status(500).json({ error: 'Internal error' });
  }
}