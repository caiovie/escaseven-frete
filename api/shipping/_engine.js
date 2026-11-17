// api/shipping/_engine.js
// Motor de frete compartilhado (mesmas regras do checkout).
// Prefixo _ faz a Vercel NAO tratar este arquivo como rota.
//
// MODELO (nov/2026): FRETE FIXO POR REGIAO.
//   - Grande SP (Capital + Osasco + Guarulhos + ABC) = GRATIS.
//   - Alto Tiete e Mogi das Cruzes = cobram (ficam na faixa de SP).
//   - Resto de SP (interior + Alto Tiete/Mogi) = R$ 30 fixo.
//   - Demais estados atendidos pela Rodonaves = R$ 50 fixo.
//   - Item muito grande/pesado (peso taxado acima do teto) = cotar no WhatsApp.
//   - Regiao fora da area atendida (ex.: Nordeste saindo de SP) = cotar no WhatsApp.
//
// Precisa ficar IGUAL ao api/shipping/rodonaves.js. Ha um teste de consistencia
// que compara os dois: scripts/test-consistencia.mjs

import DIMENSOES from './_dimensoes.js';

// Fator de cubagem do contrato RM Escadas (Rodonaves): 300 kg/m3 (oficial da tabela).
// Usado so para o TETO (decidir se o item e grande demais para o frete fixo).
export const CUBAGE_FACTOR_KG_M3 = 300;

// Buffer de dias somado ao prazo de transporte (separacao, NF, coleta, fins de semana).
export const DELIVERY_DAYS_BUFFER = 3;

// Peso TAXADO (cubado) acima do qual o item nao recebe frete fixo: cota no WhatsApp.
// Protege a loja de vender uma plataforma/escada gigante por R$ 30-50.
export const TETO_PESO_KG = 80;

// Valores fixos de frete (R$ inteiros).
export const FRETE_SP = 30;      // interior de SP + Alto Tiete / Mogi das Cruzes
export const FRETE_OUTROS = 50;  // demais estados atendidos pela Rodonaves

// ───────────────────────────────────────────────
// ZONA GRATIS — SP Capital + Osasco + Guarulhos + ABC
// (Alto Tiete e Mogi NAO entram: caem na faixa de SP que cobra.)
// ───────────────────────────────────────────────
export const GRATIS_DAYS = 2;
export const ZONAS_GRATIS = [
  { nome: 'SP Capital',          startZip: '01000000', endZip: '05999999' },
  { nome: 'Osasco e regiao',     startZip: '06000000', endZip: '06999999' },
  { nome: 'Guarulhos e regiao',  startZip: '07000000', endZip: '07399999' },
  { nome: 'SP Capital (Z.Leste)',startZip: '08000000', endZip: '08499999' },
  { nome: 'ABC Paulista',        startZip: '09000000', endZip: '09999999' },
];

// SP estado inteiro (01xxx a 19xxx). O que nao for gratis aqui = R$ 30.
export const SP_ESTADO = { startZip: '01000000', endZip: '19999999', days: 2 };

// Demais estados atendidos pela Rodonaves saindo de SP (prazo em dias uteis).
// Faixas comecam em ...0000 (corrige o bug do 1o CEP de cada faixa cair fora).
// ORDEM IMPORTA: RR (subfaixa) vem antes de AM.
export const ESTADOS_ATENDIDOS = [
  { uf: 'MG', startZip: '30000000', endZip: '39999999', days: 2 },
  { uf: 'RJ', startZip: '20000000', endZip: '28999999', days: 4 },
  { uf: 'ES', startZip: '29000000', endZip: '29999999', days: 5 },
  { uf: 'PR', startZip: '80000000', endZip: '87999999', days: 2 },
  { uf: 'SC', startZip: '88000000', endZip: '89999999', days: 3 },
  { uf: 'RS', startZip: '90000000', endZip: '99999999', days: 3 },
  { uf: 'DF', startZip: '70000000', endZip: '72799999', days: 4 },
  { uf: 'GO', startZip: '72800000', endZip: '76799999', days: 3 },
  { uf: 'MT', startZip: '78000000', endZip: '78899999', days: 4 },
  { uf: 'MS', startZip: '79000000', endZip: '79999999', days: 3 },
  { uf: 'TO', startZip: '77000000', endZip: '77999999', days: 6 },
  { uf: 'RO', startZip: '76800000', endZip: '76999999', days: 8 },
  { uf: 'PA', startZip: '66000000', endZip: '68899999', days: 9 },
  { uf: 'AP', startZip: '68900000', endZip: '68999999', days: 13 },
  { uf: 'RR', startZip: '69300000', endZip: '69399999', days: 22 },
  { uf: 'AM', startZip: '69000000', endZip: '69899999', days: 11 },
  { uf: 'AC', startZip: '69900000', endZip: '69999999', days: 11 },
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

export function isGratis(zip) {
  return ZONAS_GRATIS.some((z) => isZipInRange(zip, z.startZip, z.endZip));
}

// Peso taxado de UMA unidade = max(peso real, peso cubado @300).
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

// Resultado do frete para um CEP + peso taxado.
// Espelha exatamente o api/shipping/rodonaves.js.
export function cotar(zip, chargeable) {
  const cep = onlyDigits(zip);
  if (!cep || cep.length !== 8) return { atende: false, motivo: 'cep_invalido' };
  if (!chargeable || chargeable <= 0) return { atende: false, motivo: 'peso_invalido' };

  // 1) Zona gratis (vale ate para itens grandes — entrega propria/local da loja).
  if (isGratis(cep)) {
    return { atende: true, gratis: true, price: 0, days: GRATIS_DAYS + DELIVERY_DAYS_BUFFER, zona: 'gratis' };
  }

  // 2) Item grande/pesado demais para o frete fixo -> WhatsApp.
  if (chargeable > TETO_PESO_KG) {
    return { atende: false, motivo: 'consultar_whatsapp' };
  }

  // 3) Resto de SP (interior + Alto Tiete/Mogi) = R$ 30.
  if (isZipInRange(cep, SP_ESTADO.startZip, SP_ESTADO.endZip)) {
    return { atende: true, gratis: false, price: FRETE_SP, days: SP_ESTADO.days + DELIVERY_DAYS_BUFFER, zona: 'sp', uf: 'SP' };
  }

  // 4) Demais estados atendidos = R$ 50.
  const est = ESTADOS_ATENDIDOS.find((e) => isZipInRange(cep, e.startZip, e.endZip));
  if (est) {
    return { atende: true, gratis: false, price: FRETE_OUTROS, days: est.days + DELIVERY_DAYS_BUFFER, zona: 'br', uf: est.uf };
  }

  // 5) Fora da area atendida pela Rodonaves (ex.: Nordeste saindo de SP).
  return { atende: false, motivo: 'regiao_nao_atendida' };
}
