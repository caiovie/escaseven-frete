# escaseven-frete

API de frete da EscaSeven. Calcula o frete da Rodonaves em dois lugares:
no **checkout da Yampi** e na **página do produto** no Shopify.

Rodando em: `https://escaseven-frete.vercel.app` (região `gru1`, São Paulo).

---

## A regra de negócio, em uma frase

**Frete fixo por região (nov/2026):** Grande SP (Capital + Osasco + Guarulhos +
ABC) é **grátis**; **Alto Tietê e Mogi das Cruzes cobram**. Resto de SP = **R$ 30**.
Demais estados atendidos pela Rodonaves = **R$ 50**. Item grande demais (peso taxado
acima do teto) ou região não atendida = **"fale no WhatsApp"**.

- **Grátis** (CEPs): SP Capital `01000-05999` e `08000-08499`; Osasco e região `06xxx`;
  Guarulhos e região `07000-07399`; ABC Paulista `09xxx`.
- **R$ 30**: qualquer outro CEP de SP (`01000-000`–`19999-999`) — inclui interior,
  Alto Tietê (`07400-07999`, `08500-08999`) e Mogi das Cruzes.
- **R$ 50**: Sudeste (fora SP) + Sul — MG, RJ, ES, PR, SC, RS.
- **WhatsApp (frete sob consulta)**: peso taxado (cubado@300) acima de
  **`TETO_PESO_KG`** (hoje 80 kg) — plataformas/escadas gigantes —, **ou**
  Centro-Oeste, Norte e Nordeste (custo real alto demais para um fixo baixo).

Os valores, o teto e as faixas ficam no topo do `_engine.js`/`rodonaves.js` (constantes
`FRETE_SP`, `FRETE_OUTROS`, `TETO_PESO_KG`, `ZONAS_GRATIS`, `ESTADOS_R50`). Para dar
R$ 50 a mais um estado, é só adicioná-lo em `ESTADOS_R50`.
Trocar é mudar o número **nos dois arquivos** (o teste de consistência garante que batem).

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

1. **CEP na zona grátis** (SP Capital / Osasco / Guarulhos / ABC)? → **grátis**,
   acabou — vale até para itens grandes (entrega própria/local).

2. **Peso taxado** = maior valor entre o peso real e o cubado
   (cubado = altura × largura × comprimento em m³ × **300 kg/m³**, fator do contrato).
   Acima de `TETO_PESO_KG` (80 kg) → **"fale no WhatsApp"** (plataforma/escada gigante).

3. **CEP de SP** (não grátis)? → **R$ 30**.

4. **Sudeste (fora SP) ou Sul** (MG, RJ, ES, PR, SC, RS)? → **R$ 50**.

5. **Senão** (Centro-Oeste, Norte, Nordeste) → **"fale no WhatsApp"** (sob consulta).

> Modelo anterior (tabela RM Escadas por faixa de peso × distância, com multiplicador
> 2,0x) foi substituído por este frete fixo por região em nov/2026. O cálculo por
> tabela/cubagem continua sendo feito pós-pedido no n8n; aqui é só a vitrine de preço.

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
/api/shipping/rodonaves                                  → deve dizer "v7"
/api/shipping/calculadora?cep=01310100&sku=8US5V7PPR     → gratis: true  (SP Capital)
/api/shipping/calculadora?cep=14026574&sku=8US5V7PPR     → price: 30     (interior SP)
/api/shipping/calculadora?cep=30140071&sku=8US5V7PPR     → price: 50     (MG)
/api/shipping/calculadora?cep=13015000&sku=PLAT300L      → atende:false, motivo: consultar_whatsapp
```

---

## O que sobe onde

**Vercel** (deploy automático no push da `main`): tudo em `api/` + `vercel.json`.

**Shopify** (na mão, pelo editor de tema): `theme/calculadora-frete.liquid`.
Vai como bloco **Liquid personalizado** dentro da seção "Página de produto",
logo abaixo de "Botões de compra".

⚠️ **O site está no ar e vendendo.** Mexa sempre numa cópia do tema, teste no
preview (computador e celular), e só depois publique.

Ao testar a calculadora, use CEPs de **três zonas**: Grande SP (01310-100 → grátis),
interior de SP (14026-574 → R$ 30) e outro estado (30140-071 → R$ 50). Teste também um
item grande (ex.: `PLAT300L`) num CEP pago → deve cair em "fale no WhatsApp".

---

## Dívidas conhecidas

**1. (Resolvido) Nordeste não mostra mais preço impossível.**
No modelo flat, CEP fora da lista de estados atendidos responde
`regiao_nao_atendida` → "fale no WhatsApp", em vez de cotar uma entrega que não sai.

**2. (Resolvido) Faixas de CEP agora começam em `...0000`.**
Rio Branco (69900-000) e os primeiros CEPs de cada estado deixaram de escapar.

**2b. (Resolvido) Estados distantes não têm mais fixo baixo.**
Centro-Oeste, Norte e Nordeste vão para o WhatsApp (frete sob consulta), porque o
custo real é alto demais para um fixo de R$ 50 mesmo em item leve. Só Sudeste+Sul
têm o fixo. Para dar fixo a mais um estado, inclua-o em `ESTADOS_R50`.

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
