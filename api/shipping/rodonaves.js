export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = req.body;

    console.log('Payload recebido da Yampi:', body);

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
    console.error(error);
    return res.status(500).json({ error: 'Internal error' });
  }
}