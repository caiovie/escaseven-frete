// api/shipping/_engine.js
// Motor de frete compartilhado (mesmas regras do checkout).
// Prefixo _ faz a Vercel NAO tratar este arquivo como rota.
//
// Fonte da verdade das regras usadas pela calculadora da pagina do produto.
// Precisa ficar igual ao api/shipping/rodonaves.js (v6). Ha um teste de
// consistencia que compara os dois: scripts/test-consistencia.mjs

import DIMENSOES from './_dimensoes.js';

export const CUBAGE_FACTOR_KG_M3 = 200;
export const FALLBACK_PRICE_MULTIPLIER = 2.0;
export const DELIVERY_DAYS_BUFFER = 3;

// Capital + Regiao Metropolitana de SP = FRETE GRATIS
export const GRANDE_SP = {
  startZip: '01000000',
  endZip:   '09999999',
  gratis: true,
  days: 2,
};

export const FALLBACK_RULES = [
  { uf: 'SP', startZip: '01000000', endZip: '19999999', days: 2,
    weightPrices: [ { maxWeight: 10, price: 54.15 }, { maxWeight: 20, price: 71.16 }, { maxWeight: 40, price: 88.19 }, { maxWeight: 60, price: 113.74 }, { maxWeight: 100, price: 139.28 } ], perKgOver100: 1.8684 },
  { uf: 'MG', startZip: '30000001', endZip: '39997999', days: 2,
    weightPrices: [ { maxWeight: 10, price: 74.57 }, { maxWeight: 20, price: 105.22 }, { maxWeight: 40, price: 122.25 }, { maxWeight: 60, price: 147.79 }, { maxWeight: 100, price: 190.35 } ], perKgOver100: 2.2947 },
  { uf: 'RJ', startZip: '20000001', endZip: '28999999', days: 4,
    weightPrices: [ { maxWeight: 10, price: 74.57 }, { maxWeight: 20, price: 105.22 }, { maxWeight: 40, price: 122.25 }, { maxWeight: 60, price: 147.79 }, { maxWeight: 100, price: 190.35 } ], perKgOver100: 2.2947 },
  { uf: 'ES', startZip: '29000001', endZip: '29999999', days: 5,
    weightPrices: [ { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 }, { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 }, { maxWeight: 100, price: 224.40 } ], perKgOver100: 2.6709 },
  { uf: 'PR', startZip: '80000001', endZip: '87999999', days: 2,
    weightPrices: [ { maxWeight: 10, price: 74.57 }, { maxWeight: 20, price: 105.22 }, { maxWeight: 40, price: 122.25 }, { maxWeight: 60, price: 147.79 }, { maxWeight: 100, price: 190.35 } ], perKgOver100: 2.2947 },
  { uf: 'SC', startZip: '88000001', endZip: '89999999', days: 3,
    weightPrices: [ { maxWeight: 10, price: 74.57 }, { maxWeight: 20, price: 105.22 }, { maxWeight: 40, price: 122.25 }, { maxWeight: 60, price: 147.79 }, { maxWeight: 100, price: 190.35 } ], perKgOver100: 2.2947 },
  { uf: 'RS', startZip: '90000001', endZip: '99999999', days: 3,
    weightPrices: [ { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 }, { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 }, { maxWeight: 100, price: 224.40 } ], perKgOver100: 2.6709 },
  { uf: 'DF', startZip: '70000001', endZip: '72799999', days: 4,
    weightPrices: [ { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 }, { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 }, { maxWeight: 100, price: 224.40 } ], perKgOver100: 2.6709 },
  { uf: 'GO', startZip: '72800001', endZip: '76759999', days: 3,
    weightPrices: [ { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 }, { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 }, { maxWeight: 100, price: 224.40 } ], perKgOver100: 2.6709 },
  { uf: 'MS', startZip: '79000001', endZip: '79999999', days: 3,
    weightPrices: [ { maxWeight: 10, price: 130.76 }, { maxWeight: 20, price: 132.47 }, { maxWeight: 40, price: 156.30 }, { maxWeight: 60, price: 190.36 }, { maxWeight: 100, price: 224.40 } ], perKgOver100: 2.6709 },
  { uf: 'MT', startZip: '78000001', endZip: '78899999', days: 4,
    weightPrices: [ { maxWeight: 10, price: 147.79 }, { maxWeight: 20, price: 156.30 }, { maxWeight: 40, price: 190.36 }, { maxWeight: 60, price: 275.49 }, { maxWeight: 100, price: 284.00 } ], perKgOver100: 3.5737 },
  { uf: 'TO', startZip: '77000000', endZip: '77999999', days: 6,
    weightPrices: [ { maxWeight: 10, price: 147.79 }, { maxWeight: 20, price: 156.30 }, { maxWeight: 40, price: 190.36 }, { maxWeight: 60, price: 275.49 }, { maxWeight: 100, price: 284.00 } ], perKgOver100: 3.5737 },
  { uf: 'RO', startZip: '76800001', endZip: '76999999', days: 8,
    weightPrices: [ { maxWeight: 10, price: 164.82 }, { maxWeight: 20, price: 181.85 }, { maxWeight: 40, price: 224.40 }, { maxWeight: 60, price: 309.55 }, { maxWeight: 100, price: 343.59 } ], perKgOver100: 3.9123 },
  { uf: 'PA', startZip: '66000001', endZip: '68899999', days: 9,
    weightPrices: [ { maxWeight: 10, price: 164.82 }, { maxWeight: 20, price: 181.85 }, { maxWeight: 40, price: 224.40 }, { maxWeight: 60, price: 309.55 }, { maxWeight: 100, price: 343.59 } ], perKgOver100: 3.9123 },
  { uf: 'AP', startZip: '68900001', endZip: '68999999', days: 13,
    weightPrices: [ { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 }, { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 }, { maxWeight: 100, price: 377.65 } ], perKgOver100: 4.2509 },
  { uf: 'AC', startZip: '69900001', endZip: '69999999', days: 11,
    weightPrices: [ { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 }, { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 }, { maxWeight: 100, price: 377.65 } ], perKgOver100: 4.2509 },
  { uf: 'RR', startZip: '69300001', endZip: '69399999', days: 22,
    weightPrices: [ { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 }, { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 }, { maxWeight: 100, price: 377.65 } ], perKgOver100: 4.2509 },
  { uf: 'AM', startZip: '69000001', endZip: '69899999', days: 11,
    weightPrices: [ { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 }, { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 }, { maxWeight: 100, price: 377.65 } ], perKgOver100: 4.2509 },
];

// =========================================================
// HELPERS
// =========================================================
export function onlyDigits(v) { return String(v || '').replace(/\D/g, ''); }
export function zipToNumber(z) { return Number(onlyDigits(z)); }
export function isZipInRange(zip, startZip, endZip) {
  const v = zipToNumber(zip);
  return v >= zipToNumber(startZip) && v <= zipToNumber(endZip);
}

// Peso taxado de UMA unidade = max(peso real, peso cubado @200)
export function chargeableWeight({ weight = 0, height = 0, width = 0, length = 0 }) {
  const real = Number(weight) || 0;
  const cubed = ((Number(height) || 0) * (Number(width) || 0) * (Number(length) || 0) / 1_000_000) * CUBAGE_FACTOR_KG_M3;
  return Math.max(real, cubed);
}

// Busca peso/medidas do SKU na base do Bling.
export function skuData(sku) {
  if (!sku) return null;
  const d = DIMENSOES[String(sku).trim()];
  if (!d) return null;
  return { weight: d.p, height: d.a, width: d.l, length: d.c };
}

export function priceForWeight(rule, w) {
  const b = rule.weightPrices.find((i) => w <= i.maxWeight);
  if (b) return b.price;
  if (rule.perKgOver100) return rule.perKgOver100 * w;
  return null;
}

export function ruleForZip(zip) {
  return FALLBACK_RULES.find((r) => isZipInRange(zip, r.startZip, r.endZip)) || null;
}

// Ultimo recurso, identico ao do checkout: garante que a Rodonaves nunca
// "suma" da tela. ATENCAO: hoje ele cota QUALQUER CEP do Brasil, inclusive
// regioes que a Rodonaves nao atende saindo de SP (Nordeste). Esta aqui
// somente para a calculadora nao contradizer o checkout.
export const EMERGENCY_FALLBACK = {
  uf: null, days: 15,
  weightPrices: [ { maxWeight: 10, price: 173.33 }, { maxWeight: 20, price: 190.36 }, { maxWeight: 40, price: 241.43 }, { maxWeight: 60, price: 326.56 }, { maxWeight: 100, price: 377.65 } ],
  perKgOver100: 4.2509,
};

// Resultado do frete para um CEP + peso taxado.
// Espelha exatamente o api/shipping/rodonaves.js (v6): Grande SP gratis,
// tabela regional, e emergency fallback no que sobrar.
export function cotar(zip, chargeable) {
  const cep = onlyDigits(zip);
  if (!cep || cep.length !== 8) return { atende: false, motivo: 'cep_invalido' };
  if (!chargeable || chargeable <= 0) return { atende: false, motivo: 'peso_invalido' };

  if (GRANDE_SP.gratis && isZipInRange(cep, GRANDE_SP.startZip, GRANDE_SP.endZip)) {
    return { atende: true, gratis: true, price: 0, days: GRANDE_SP.days + DELIVERY_DAYS_BUFFER, uf: 'SP' };
  }

  const rule = ruleForZip(cep);
  const usada = rule || EMERGENCY_FALLBACK;

  const base = priceForWeight(usada, chargeable);
  if (base == null) return { atende: false, motivo: 'sem_faixa' };

  return {
    atende: true,
    gratis: false,
    price: Number((base * FALLBACK_PRICE_MULTIPLIER).toFixed(2)),
    days: usada.days + DELIVERY_DAYS_BUFFER,
    uf: usada.uf,
    emergencia: !rule,
  };
}
