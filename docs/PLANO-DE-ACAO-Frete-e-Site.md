# EscaSeven — Plano de ação: Frete & Site

> Frente de **frete e loja (Shopify/Yampi/Vercel)**. Atualizado em 17/07/2026.
>
> Não confundir com os outros docs desta pasta, que cobrem outra frente:
> `Arquitetura-Monitoramento-Vendas-Entregas.md` (monitoramento pós-venda),
> `ML-Ecossistema-Consolidado.md` (Mercado Livre) e `coleta-semi-automatica.md`
> (coleta pelo n8n).

---

## 1. Onde as peças se encaixam

```
                       ┌──────────────────────┐
   cliente digita CEP  │  PÁGINA DO PRODUTO   │
   na página  ───────► │  (Shopify · tema)    │
                       └──────────┬───────────┘
                                  │  navegador chama (CORS)
                                  ▼
                       /api/shipping/calculadora ──┐
                                                   │  mesmas regras
   cliente fecha       ┌──────────────────────┐    │  (_engine.js)
   a compra    ──────► │  CHECKOUT (Yampi)    │    │  mesmas medidas
                       └──────────┬───────────┘    │  (_dimensoes.js)
                                  │  servidor chama │
                                  ▼                 │
                       /api/shipping/rodonaves  ◄──┘
                                  │
                                  ▼
                          Vercel (gru1)

   pós-pedido:  Yampi ──► n8n ──► cotação/coleta real na Rodonaves ──► Bling
```

**A regra do frete vive num lugar só: a API na Vercel.** Não está na Yampi nem no
tema. Isso foi decisão consciente — ver seção 5.

**Os dois caminhos têm que dar o mesmo preço.** É o que o
`scripts/test-consistencia.mjs` garante (1.760 casos, 100%).

---

## 2. A regra, decidida pelo Betão em 16/07/2026

| Destino | O que acontece | Custo real pra loja |
|---|---|---|
| Capital + Grande SP (CEP 0xxxx) | **Frete grátis** | ~R$ 124 a R$ 159 por entrega |
| Interior de SP (11xxx–19xxx) | Cobra normal | ~R$ 167 a R$ 189 |
| Demais estados | Cobra normal | RJ ~R$ 213 · MT ~R$ 296 |

O "frete grátis SP" é investimento em conversão, não custo zero. Base: 7 boletos
reais (CT-e) analisados. Média em SP: **R$ 161,42 por entrega**.

---

## 3. Status

### Pronto e validado (falta só o deploy)
- [x] **v6 do checkout** — Grande SP grátis. Sintaxe e comportamento testados.
- [x] **Calculadora** — endpoint com CORS + bloco do tema. 1.760 casos, 100%.
- [x] **Base de medidas** — 280 SKUs do Bling, validada contra log real da Yampi.
- [x] **Cópia do tema** criada no Shopify, com bloco Liquid personalizado esperando o código.
- [x] **Ficha técnica em lote** — 291 produtos, garantia 12 meses fechada.

### Próximo passo imediato
- [ ] **Deploy** — ver `PROMPT-CLAUDE-CODE.md`. Enquanto não subir, o banner da
      home promete "Frete Grátis Grande SP" e o checkout cobra. É um furo vivo.
- [ ] **Colar o `theme/calculadora-frete.liquid`** no bloco já criado, e arrastar
      pra baixo de "Botões de compra".

### Depende de decisão do Betão
- [ ] Preço promocional dos 8 produtos das Promoções do Mês + quais vão pro Mais Vendidos
- [ ] Quais acessórios entram no site (hoje **nenhum** está publicado)
- [ ] Quais combos rodam (sugestão: começar pelo Kit Sapata, que serve em todas)
- [ ] Banner TE 6-10: vale R$ 999,90 ou R$ 1.009,90?
- [ ] Lista dos multifuncionais (hoje só aparece fibra)
- [ ] Capacidade de carga de 55 itens (plataforma/multi/trepadeira): 120 ou 150 kg?

### Backlog técnico (meu, sem depender de ninguém)
- [ ] Ocultar esgotados via tag `sob-encomenda` + filtro no tema (mantendo trepadeiras)
- [ ] Metafields da ficha técnica + import CSV dos 281 publicados
- [ ] Subcategoria Trepadeiras dentro de Plataforma
- [ ] Coleção Mais Vendidos sem esgotados
- [ ] Corrigir a busca (mostra contagem, não lista produtos)
- [ ] Remover "Anuncie algo aqui" da barra do topo

---

## 4. Problemas achados que ninguém tinha visto

Todos descobertos ao investigar o frete. Nenhum trava o deploy, mas custam dinheiro.

**1. O site cota entregas que a Rodonaves não faz.**
Log real de produção: CEP 50810000 (Recife) cotado a **R$ 482,86 em 18 dias**.
A Rodonaves atende 18 estados saindo de SP, e o Nordeste não está entre eles.
Caiu no *emergency fallback*, que cota qualquer CEP do Brasil.
→ Decidir: responder "não entregamos nesse CEP" ou manter e tratar na mão.

**2. TAF-7 cadastrada com 11 gramas.**
SKU `TAFESCESC7DE`. A descrição do produto diz 11 kg, o cadastro diz 0,011 kg.
O checkout da Yampi provavelmente está errando o frete desse produto.
→ Corrigir no Bling/Shopify.

**3. Preço "de" invertido em 7 dos 8 produtos da promoção.**
O Shopify risca o preço usando o campo "Comparar com", que precisa ser MAIOR que
o preço de venda. Está igual ou menor. Ex.: Degrau Duplo vende a R$ 519,90 com
"de" R$ 459,90. Resultado: **a promoção não aparece riscada**.
→ Pré-requisito das Promoções do Mês.

**4. Marca cadastrada como "escaseven" em 7 de 8 produtos.**
A vitrine "Navegue por marcas" (item 11 do projeto de R$ 600) depende desse campo.
→ Preencher a marca real no catálogo.

**5. Faixas de CEP começam em `...0001`.**
`20000001` (RJ), `30000001` (MG), `69900001` (AC). O primeiro CEP de cada faixa
escapa e cai na emergência. Rio Branco (69900-000) é caso real.

**6. Nenhum produto tem tag.**
Tags facilitariam as coleções automáticas (Promoções, Mais Vendidos) e a regra de
ocultar esgotados. Vale criar o padrão.

---

## 5. Decisões técnicas e por quê

**Por que a regra do frete não está na Yampi.**
A regra nativa de frete grátis da Yampi funciona **por estado**, não por faixa de
CEP. Não dá pra separar Grande SP do interior — que é exatamente a decisão do
Betão. A única alternativa nativa seria frete por planilha, que vira tabela
estática, não conversa com a cubagem e apareceria como uma segunda opção no
checkout. A Yampi recomenda o Frete por API justamente pra quem quer centralizar
regras próprias, que é o caso.

**Por que existem duas rotas em vez de uma.**
Contratos diferentes: o checkout é servidor→servidor com HMAC; a calculadora é
navegador→servidor com CORS. Unificar significaria colocar regras de navegador num
endpoint que fecha venda.

**Por que o `_dimensoes.js` existe.**
O Shopify não tem campo de dimensão, e o frete da Rodonaves é por cubagem — em 279
de 280 SKUs o peso cubado é maior que o real e é ele que manda. Sem as medidas, a
calculadora mostraria um preço menor que o checkout.

**Por que o multiplicador é 2,0x.**
A tabela da Rodonaves é só o "frete-peso". O cobrado de verdade inclui ICMS, GRIS,
Ad Valorem, pedágio e SECCAT. Nos boletos reais o total ficou entre 2,5x e 2,7x.
Usamos 2,0x, que é conservador — a loja absorve a diferença em troca de um preço
mais atrativo na tela.

---

## 6. Ordem sugerida daqui

1. **Deploy** (`PROMPT-CLAUDE-CODE.md`) — fecha o furo do banner. Hoje.
2. **Colar o Liquid** na cópia do tema, testar com 01310-100 e 14026-574, publicar.
3. **Corrigir os cadastros** — TAF-7 (peso), preços "de", marcas. Destrava as
   Promoções do Mês e a vitrine de marcas.
4. **Metafields da ficha técnica** — serve à ficha e reforça a calculadora.
5. **Decisões do Betão** — promoções, acessórios, combos.
6. **Dívidas do frete** — Nordeste e faixas de CEP, com o teste de consistência
   rodando junto.
