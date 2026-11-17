// api/shipping/rodonaves.js
// v7: FRETE FIXO POR REGIAO (chamado pelo checkout da Yampi, servidor-a-servidor).
//
// MODELO (nov/2026):
//   - Grande SP (Capital + Osasco + Guarulhos + ABC) = GRATIS.
//   - Alto Tiete e Mogi das Cruzes = cobram (faixa de SP).
//   - Resto de SP (interior + Alto Tiete/Mogi) = R$ 30 fixo.
//   - Demais estados atendidos pela Rodonaves = R$ 50 fixo.
//   - Item acima do teto de peso taxado = sem frete online (vai pro WhatsApp).
//   - Regiao fora da area atendida = sem frete online (vai pro WhatsApp).
//
// Precisa ficar IGUAL ao api/shipping/_engine.js (teste: scripts/test-consistencia.mjs).
// O nome exibido ao cliente e "Frete Escaseven".

import crypto from 'crypto';

// =========================
// CONFIGURACOES (espelham _engine.js)
// =========================
const CUBAGE_FACTOR_KG_M3 = 300;   // fator do contrato RM Escadas (so p/ o teto)
const DELIVERY_DAYS_BUFFER = 3;
const TETO_PESO_KG = 80;           // acima disso: sem frete fixo -> WhatsApp
const FRETE_SP = 30;               // interior de SP + Alto Tiete / Mogi
const FRETE_OUTROS = 50;           // demais estados atendidos
const NOME_FRETE = 'Frete Escaseven';
const GRATIS_DAYS = 2;

const ZONAS_GRATIS = [
  { nome: 'SP Capital',           startZip: '01000000', endZip: '05999999' },
  { nome: 'Osasco e regiao',      startZip: '06000000', endZip: '06999999' },
  { nome: 'Guarulhos e regiao',   startZip: '07000000', endZip: '07399999' },
  { nome: 'SP Capital (Z.Leste)', startZip: '08000000', endZip: '08499999' },
  { nome: 'ABC Paulista',         startZip: '09000000', endZip: '09999999' },
];

const SP_ESTADO = { startZip: '01000000', endZip: '19999999', days: 2 };

// R$ 50 = Sudeste (fora SP) + Sul. Centro-Oeste/Norte/Nordeste = sem frete
// online (WhatsApp): basta nao estarem nesta lista (caem no return vazio final).
const ESTADOS_ATENDIDOS = [
  { uf: 'MG', startZip: '30000000', endZip: '39999999', days: 2 },
  { uf: 'RJ', startZip: '20000000', endZip: '28999999', days: 4 },
  { uf: 'ES', startZip: '29000000', endZip: '29999999', days: 5 },
  { uf: 'PR', startZip: '80000000', endZip: '87999999', days: 2 },
  { uf: 'SC', startZip: '88000000', endZip: '89999999', days: 3 },
  { uf: 'RS', startZip: '90000000', endZip: '99999999', days: 3 },
];

// =========================
// HELPERS
// =========================
function onlyDigits(value) { return String(value || '').replace(/\D/g, ''); }
function elapsedMs(startedAt) { return Date.now() - startedAt; }
function zipToNumber(zip) { return Number(onlyDigits(zip)); }
function isZipInRange(zip, startZip, endZip) {
  const value = zipToNumber(zip);
  return value >= zipToNumber(startZip) && value <= zipToNumber(endZip);
}
function isGratis(zip) {
  return ZONAS_GRATIS.some((z) => isZipInRange(zip, z.startZip, z.endZip));
}

// Lê a dimensão do SKU em cm, tolerando diferentes nomes de campo da Yampi.
function dimCm(sku, ...keys) {
  for (const k of keys) {
    const v = Number(sku?.[k]);
    if (v && v > 0) return v;
  }
  return 0;
}

// Peso taxado de UMA unidade do SKU = max(peso real, peso cubado @300).
function chargeableWeightForSku(sku) {
  const real = Number(sku?.weight || 0);
  const length = dimCm(sku, 'length', 'comprimento', 'depth', 'profundidade');
  const width = dimCm(sku, 'width', 'largura');
  const height = dimCm(sku, 'height', 'altura');
  const cubicMeters = (length * width * height) / 1_000_000; // cm³ -> m³
  const cubedWeight = cubicMeters * CUBAGE_FACTOR_KG_M3;
  return Math.max(real, cubedWeight);
}

function buildYampiQuote({ price, days }) {
  const numericPrice = Number(price || 0);
  const numericDays = Number(days || 0);
  if (!numericPrice || numericPrice <= 0 || !numericDays || numericDays <= 0) return null;
  return {
    name: NOME_FRETE,
    service: 'Normal',
    price: Number(numericPrice.toFixed(2)),
    days: numericDays,
    quote_id: `frete-escaseven-${Date.now()}`,
    free_shipment: false,
  };
}

// Cotacao de frete gratis (price 0 + free_shipment true).
function buildFreeQuote({ days }) {
  const numericDays = Number(days || 0);
  if (!numericDays || numericDays <= 0) return null;
  return {
    name: NOME_FRETE,
    service: 'Normal',
    price: 0,
    days: numericDays,
    quote_id: `frete-escaseven-gratis-${Date.now()}`,
    free_shipment: true,
  };
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
// DADOS DA YAMPI
// =========================
function getCartDataFromYampi(body) {
  const destinationZipCode = onlyDigits(body?.zipcode);
  const skus = Array.isArray(body?.skus) ? body.skus : [];

  let totalRealWeight = 0;
  let totalWeight = 0; // peso taxado (cubado quando maior)
  for (const sku of skus) {
    const qty = Number(sku?.quantity || 0);
    totalRealWeight += Number(sku?.weight || 0) * qty;
    totalWeight += chargeableWeightForSku(sku) * qty;
  }
  const totalPackages = skus.reduce((sum, sku) => sum + Number(sku?.quantity || 0), 0);

  return { destinationZipCode, totalWeight, totalRealWeight, totalPackages };
}

// =========================
// HANDLER PRINCIPAL
// =========================
export default async function handler(req, res) {
  const startedAt = Date.now();

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'Frete Escaseven v7 (fixo por regiao: Grande SP gratis, SP R$30, demais R$50, grandes no WhatsApp)' });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!validateYampiHmac(req)) {
      console.error('HMAC INVÁLIDO');
      return res.status(401).json({ quotes: [] });
    }

    const { destinationZipCode, totalWeight, totalRealWeight, totalPackages } = getCartDataFromYampi(req.body);
    console.log('CEP:', destinationZipCode);
    console.log('PESO REAL:', totalRealWeight);
    console.log('PESO TAXADO (cubado@300):', totalWeight);
    console.log('VOLUMES:', totalPackages);

    if (!destinationZipCode || destinationZipCode.length !== 8) {
      console.log('CEP inválido');
      return res.status(200).json({ quotes: [] });
    }
    if (!totalWeight || totalWeight <= 0) {
      console.log('Peso inválido');
      return res.status(200).json({ quotes: [] });
    }

    // 1) GRANDE SP = GRATIS (vale ate para itens grandes).
    if (isGratis(destinationZipCode)) {
      const freeQuote = buildFreeQuote({ days: GRATIS_DAYS + DELIVERY_DAYS_BUFFER });
      if (freeQuote) {
        console.log('FRETE GRATIS (Grande SP):', { days: freeQuote.days });
        return res.status(200).json({ quotes: [freeQuote] });
      }
    }

    // 2) Item grande/pesado demais -> sem frete online (WhatsApp).
    if (totalWeight > TETO_PESO_KG) {
      console.log('ACIMA DO TETO -> WhatsApp (sem cotacao online):', { totalWeight, teto: TETO_PESO_KG });
      return res.status(200).json({ quotes: [] });
    }

    // 3) Resto de SP = R$ 30.
    if (isZipInRange(destinationZipCode, SP_ESTADO.startZip, SP_ESTADO.endZip)) {
      const q = buildYampiQuote({ price: FRETE_SP, days: SP_ESTADO.days + DELIVERY_DAYS_BUFFER });
      console.log('SP FIXO:', q && { price: q.price, days: q.days });
      return res.status(200).json({ quotes: q ? [q] : [] });
    }

    // 4) Demais estados atendidos = R$ 50.
    const est = ESTADOS_ATENDIDOS.find((e) => isZipInRange(destinationZipCode, e.startZip, e.endZip));
    if (est) {
      const q = buildYampiQuote({ price: FRETE_OUTROS, days: est.days + DELIVERY_DAYS_BUFFER });
      console.log('ESTADO FIXO:', est.uf, q && { price: q.price, days: q.days });
      return res.status(200).json({ quotes: q ? [q] : [] });
    }

    // 5) Fora da area atendida -> sem frete online (WhatsApp).
    console.log('REGIAO NAO ATENDIDA -> WhatsApp (sem cotacao online)');
    return res.status(200).json({ quotes: [] });
  } catch (error) {
    console.error('ERRO:', error.message);
    return res.status(200).json({ quotes: [] });
  } finally {
    console.log('TOTAL MS:', elapsedMs(startedAt));
  }
}
