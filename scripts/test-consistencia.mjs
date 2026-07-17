// Compara a CALCULADORA (motor _engine) com o CHECKOUT (rodonaves.js v6).
// Se algum caso divergir, o teste falha.
import { cotar, chargeableWeight, skuData } from '../api/shipping/_engine.js';
import DIMS from '../api/shipping/_dimensoes.js';
import fs from 'fs';

// carrega o handler do checkout
const src = fs.readFileSync(new URL('../api/shipping/rodonaves.js', import.meta.url), 'utf8')
  .replace("import crypto from 'crypto';", "import crypto from 'node:crypto';")
  .replace('export default async function handler', 'export async function handler');
fs.writeFileSync('/tmp/_chk.mjs', src);
const checkout = await import('/tmp/_chk.mjs');

const callCheckout = (zip, skus) => new Promise(res => {
  checkout.handler({ method: 'POST', headers: {}, body: { zipcode: zip, skus } },
    { status() { return this; }, json(d) { res(d); return this; } });
});

const CEPS = ['01310100','03402001','08740060','06233030','09560000','07115000',
              '13140605','14026574','17404242','11015100','22790620','30140071',
              '80010010','88010001','90010150','70040010','74003010','78575000',
              '69900000','66010100','29010000','79002000'];

const SKUS = Object.keys(DIMS).slice(0, 40);
let testes = 0, divergencias = [];

for (const sku of SKUS) {
  const d = skuData(sku);
  for (const cep of CEPS) {
    for (const qtd of [1, 2]) {
      const taxado = chargeableWeight(d) * qtd;
      const calc = cotar(cep, taxado);
      const chk = await callCheckout(cep, [{
        weight: d.weight, height: d.height, width: d.width, length: d.length, quantity: qtd,
      }]);
      const q = chk.quotes[0];
      const chkPrice = q ? (q.free_shipment ? 0 : q.price) : null;
      const calcPrice = calc.atende ? calc.price : null;
      testes++;
      if (chkPrice !== calcPrice) {
        divergencias.push({ sku, cep, qtd, taxado: +taxado.toFixed(2), calculadora: calcPrice, checkout: chkPrice });
      }
    }
  }
}

console.log(`Casos testados: ${testes}  (${SKUS.length} SKUs x ${CEPS.length} CEPs x 2 qtds)`);
if (divergencias.length === 0) {
  console.log('RESULTADO: calculadora e checkout batem em 100% dos casos.');
} else {
  console.log(`RESULTADO: ${divergencias.length} DIVERGENCIA(S):`);
  console.table(divergencias.slice(0, 15));
  process.exit(1);
}
