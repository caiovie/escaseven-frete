# escaseven-frete

API de frete da EscaSeven. Calcula o frete da Rodonaves em dois lugares:
no **checkout da Yampi** e na **página do produto** no Shopify.

Rodando em: `https://escaseven-frete.vercel.app` (região `gru1`, São Paulo).

---

## A regra de negócio, em uma frase

**Capital e Grande São Paulo (CEP 01000-000 a 09999-999) têm frete grátis. O resto
do Brasil é cotado pela tabela da Rodonaves.**

Decisão do Betão em 16/07/2026. Interior de SP (11xxx em diante) **cobra normal** —
uma entrega em Ribeirão Preto custa ~R$ 167 reais pra loja, não dá pra absorver.

Para desligar o frete grátis: `GRANDE_SP.gratis = false` (nos dois arquivos).

---

## Estrutura

```
api/shipping/
  rodonaves.js      ROTA  → checkout da Yampi (servidor chama servidor)
  calculadora.js    ROTA  → página do produto (navegador chama)
  _engine.js        ────── regras de frete compartilhadas
  _dimensoes.js     ────── peso e medidas por SKU

theme/
  calculadora-frete.liquid    → bloco pro Shopify (NÃO vai pra Vercel)

scripts/
  test-consistencia.mjs       → garante que os dois lugares dão o mesmo preço

docs/                         → documentação do ecossistema (ML, coleta, etc.)
db/                           → SQL do Supabase
```

**Arquivos com `_` na frente não viram rota.** É assim que a Vercel funciona:
`_engine.js` e `_dimensoes.js` são bibliotecas, não endpoints. Ninguém acessa de fora.

---

## As duas rotas, e por que são separadas

| | `rodonaves.js` | `calculadora.js` |
|---|---|---|
| Quem chama | Servidor da Yampi | Navegador do cliente |
| Quando | No checkout, ao fechar a compra | Na página do produto, ao digitar o CEP |
| Precisa de CORS? | Não | **Sim** (senão o navegador bloqueia) |
| Valida HMAC? | Sim | Não (é só consulta de preço) |
| De onde vêm as medidas | A Yampi manda no payload | Busca no `_dimensoes.js` pelo SKU |

Elas são separadas porque o contrato é diferente. Misturar as duas significaria
colocar CORS e regras de navegador num endpoint que fecha venda — não vale o risco.

### Por que o `_dimensoes.js` existe

O Shopify **não tem campo de dimensão**. Só peso. E o frete da Rodonaves é por
cubagem: em 279 dos 280 SKUs, o peso cubado é maior que o real e é ele que manda.

Sem as medidas, a calculadora usaria só o peso real e mostraria um preço mais barato
que o checkout. O cliente veria um valor na página e outro, maior, na hora de pagar.

Então o `_dimensoes.js` guarda peso + medidas dos 280 SKUs, extraídos da base do
Bling — a mesma fonte que alimenta a Yampi.

**Validado contra log real da Yampi:** SKU `8US5V7PPR`, 17×58×180 cm e 13,5 kg,
dá cubado 35,496 kg. O log de produção da Yampi mostrou exatamente `PESO TAXADO
(cubado): 35.496`. Bate.

---

## Como o frete é calculado

1. **Peso taxado** = maior valor entre o peso real e o peso cubado.
   Cubado = (altura × largura × comprimento em m³) × **200 kg/m³**
   (fator do contrato RM Escadas / Rodonaves).

2. **Grande SP?** → grátis, acabou.

3. **Senão** → acha a faixa de CEP na `FALLBACK_RULES`, pega o preço da faixa de
   peso e multiplica por **2,0**.

O multiplicador existe porque a tabela da Rodonaves é só o "frete-peso". O que ela
cobra de verdade inclui ICMS, GRIS, Ad Valorem, pedágio e SECCAT. Conferindo boletos
reais (CT-e), o total fica entre 2,5x e 2,7x o frete-peso. Usamos 2,0x, que é
conservador.

---

## Testes

```bash
node scripts/test-consistencia.mjs
```

Compara a calculadora com o checkout em 1.760 casos (40 SKUs × 22 CEPs × 2 qtds).
**Tem que dar 100%.** Se divergir, o cliente vai ver um preço na página do produto e
outro no checkout — que é exatamente o que não pode acontecer.

Rode sempre que mexer em `_engine.js` ou `rodonaves.js`.

Teste rápido das rotas, depois do deploy:

```
/api/shipping/rodonaves                                  → deve dizer "v6"
/api/shipping/calculadora?cep=01310100&sku=8US5V7PPR     → gratis: true
/api/shipping/calculadora?cep=14026574&sku=8US5V7PPR     → price: 176.38
```

---

## O que sobe onde

**Vercel** (deploy automático no push da `main`): tudo em `api/` + `vercel.json`.

**Shopify** (na mão, pelo editor de tema): `theme/calculadora-frete.liquid`.
Vai como bloco **Liquid personalizado** dentro da seção "Página de produto",
logo abaixo de "Botões de compra".

⚠️ **O site está no ar e vendendo.** Mexa sempre numa cópia do tema, teste no
preview (computador e celular), e só depois publique.

Ao testar a calculadora, use **dois** CEPs: um de SP (01310-100 → grátis) e um de
fora (14026-574 → R$ 176,38). Se testar só com CEP de SP, tudo dá grátis e você não
valida o cálculo.

---

## Dívidas conhecidas

**1. O emergency fallback cota o Brasil inteiro.**
Quando o CEP não casa com nenhuma faixa, cai no `EMERGENCY_FALLBACK`, que cota
qualquer lugar. Só que a Rodonaves **não atende o Nordeste saindo de SP**.
Um log real mostrou o site cotando R$ 482,86 em 18 dias para Recife (CEP 50810000) —
uma entrega que não sai. O certo seria responder "não entregamos nesse CEP".

**2. As faixas de CEP começam em `...0001`.**
`20000001` (RJ), `30000001` (MG), `69900001` (AC). O primeiro CEP de cada faixa
escapa e cai na emergência. Rio Branco (69900-000) é um caso real.
Corrigir para `...0000` — mas nos **dois** arquivos ao mesmo tempo, senão o teste
de consistência quebra.

**3. Tabela duplicada.**
`rodonaves.js` tem a própria cópia das tabelas em vez de importar do `_engine.js`.
Foi de propósito: o v6 já estava testado e não quis mexer nele de novo. O
`test-consistencia.mjs` é a rede de proteção. Quando for unificar, rode o teste.

**4. TAF-7 com peso errado no Shopify.**
SKU `TAFESCESC7DE` está cadastrado com **11 gramas** em vez de 11 kg. A calculadora
não erra (busca pelo SKU no `_dimensoes.js`), mas **o checkout da Yampi pode estar
errando o frete desse produto**. Corrigir no Bling/Shopify.

---

## Contexto

- Tabela contratada: **RM Escadas** (Rodonaves), CNPJ 66.593.708/0001-01 — diferente
  do CNPJ da loja. Fator cúbico 200 kg/m³ (DF usa 300).
- Origem das entregas: loja em São Paulo, CEP 03402-001 (Vila Carrão).
- A Rodonaves atende 18 estados saindo de SP. Nordeste não entra.
- A cotação real, pós-pedido, continua sendo feita no n8n. As rotas daqui são a
  estimativa mostrada e cobrada na hora da compra.
