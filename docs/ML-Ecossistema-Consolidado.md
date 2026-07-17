# EscaSeven — Ecossistema de Fretes & Mercado Livre
### Documento consolidado para apresentação e go-live
_Última atualização: 25/06/2026_

---

## 1. Em uma frase
Automatizamos o caminho **pedido → cotação → coleta → rastreio → cliente avisado**, eliminando a redigitação manual, e conectamos o **Mercado Livre** para que o comprador acompanhe a entrega da Rodonaves nativamente.

---

## 2. O que JÁ está no ar (funcionando de verdade)

| # | Capacidade | Status | Como ajuda |
|---|---|---|---|
| 1 | **Cotação automática Rodonaves** (pós-pedido) | 🟢 produção | Toda venda paga é cotada sozinha (ex. real: SP→Guarujá = R$ 217,84) |
| 2 | **Planilha operacional** (Coletas + Resumo + Rastreio ML) | 🟢 produção | Cada venda vira linha organizada, com painel de totais e status colorido |
| 3 | **Aprovação de coleta no grupo de WhatsApp** | 🟢 ativo | A venda chega no grupo com link de "1 toque" pra agendar a coleta |
| 4 | **Rastreio Rodonaves → planilha + grupo** (a cada 1h) | 🟢 ativo (interno) | De hora em hora (8–19h, Seg–Sáb) lê o trajeto e avisa o grupo quando muda |
| 5 | **Consolidado diário** (19h30 no grupo) | 🟢 ativo | Panorama dos pedidos dos últimos 7 dias e seus status |
| 6 | **Disparos WhatsApp** (oficial + grupo via Evolution) | 🟢 testado | Alertas internos e (no go-live) avisos ao comprador |
| 7 | **Ingestão automática de vendas ML** | 🟡 pronto, falta 1 config | Novas vendas custom entram sozinhas na lista (falta registrar o webhook no ML) |

---

## 3. O que dá pra fazer com a conexão do Mercado Livre

A integração (OAuth oficial, app próprio) já autentica e lê a conta. Com ela conseguimos:

**Hoje, prontos pra usar:**
- **Ler** pedidos, envios, comprador, status, valor, cidade.
- **Registrar o rastreio + marcar "enviado"** num pedido de frete próprio (custom) → **o ML notifica o comprador** por e-mail/app.
- **Atualizar o trajeto**: enviado → saiu para entrega → entregue (final).
- **Descobrir vendas novas automaticamente** (webhook de notificações).

**Dá pra evoluir depois:**
- Mensagem pós-venda ao comprador (dentro das regras do ML).
- Tratar perguntas / reclamações (claims) via API.
- Puxar a NF automaticamente do emissor (Bling/ERP) e eliminar o input manual.

**O que NÃO dá / cuidados:**
- A API **oficial não envia em grupo** de WhatsApp (grupo só pela Evolution — que já está ligada).
- Em pedido custom, **o ML não rastreia a transportadora sozinho** — quem empurra cada atualização é a nossa automação.
- O `seller_notifications` **notifica o comprador de verdade** → só dispara com status correto (lido da Rodonaves).
- **ME2** (envios que o ML cuida) a gente **não toca** — são tratados nativamente pelo ML.

---

## 4. Como o fluxo completo funciona

```
   Venda ML  ─────────────▶  WF1 Ingestão  ──▶  cria registro (pending) no Supabase
                                                       │
   Despacho (NF/protocolo) ─────────────────────────▶ │  (você ou Bling informam a chave)
                                                       ▼
   A cada 1h (8–19h, Seg–Sáb) ─▶ WF3 Rastreio ─▶ lê Rodonaves ─▶ status mudou?
                                                       │
                          ┌────────────────────────────┼───────────────────────────┐
                          ▼                             ▼                            ▼
                  registra na planilha          avisa no grupo            [go-live] notifica
                  (aba "Rastreio ML")           de WhatsApp               o comprador no ML
                                                       │
   19h30 (Seg–Sáb) ─────────────────────────────────▶ Consolidado do dia no grupo
```

Para o **frete via Yampi** (loja própria), o mesmo motor faz: pedido pago → cotação automática → planilha → aprovação de coleta no grupo (1 toque) → coleta agendada.

---

## 5. Estado de produção (honesto)

| Componente | Estado | Falta para 100% |
|---|---|---|
| Cotação + planilha (Yampi) | 🟢 produção | — |
| Aprovação de coleta no grupo | 🟢 ativo | ativar o "Confirmar" para o toque agendar de verdade |
| Confirmar coleta (toque → agenda na Rodonaves) | 🔴 inativo | ativar (é ação real: agenda caminhão) |
| Rastreio ML interno (planilha + grupo) | 🟢 ativo | — |
| Ingestão automática de vendas ML (WF1) | 🟡 pronto | registrar o callback no DevCenter do ML |
| Notificar o comprador no ML | 🔴 desativado | dar o "go-live" (1 toggle) |
| Fonte da NF/protocolo no despacho | 🟡 manual | integrar Bling (opcional) |

---

## 6. Checklist para botar em PRODUÇÃO

**Decisões / ações do Betão & operação:**
- [ ] **Aprovar o modelo "1 toque"** (a venda chega no grupo, alguém toca pra agendar a coleta).
- [ ] **Go-live do aviso ao comprador no ML** (a partir daí o cliente recebe o rastreio automático).
- [ ] **Confirmar o grupo de alertas** (já configurado).
- [ ] **Definir quem cobre exceção** (quando a transportadora falha → agendamento manual).

**Configurações (rápidas, eu oriento):**
- [ ] **Registrar o webhook de vendas no DevCenter do ML** (URL `…/webhook/ml-notif`, tópico `orders_v2`) → liga a entrada automática.
- [ ] **Whitelist do IP de saída do n8n na Rodonaves** (evita 403/timeout intermitente).
- [ ] (Opcional) **Integrar Bling** para puxar a NF automática por pedido.

**Eu ativo no sistema quando vocês liberarem:**
- [ ] Ligar o nó "Notificar Comprador ML" (go-live do aviso ao comprador).
- [ ] Ativar o "Confirmar Coleta" (1 toque real).
- [ ] Semear os pedidos em rota na watchlist (precisam de NF/protocolo com CT-e emitido).

---

## 7. Onde está cada coisa (referência técnica)

**Workflows (n8n):**
- Cotação + planilha (Yampi): `pl6cdceCos3hbwNF`
- Notificar coleta (grupo / 1 toque): `rvhiZbcUDQNxq3pE`
- Confirmar coleta (agenda na Rodonaves): `P4eQm5dEJ8ANmqBq` _(inativo)_
- ML Despacho (registro): `f6zdk6CeLU87AqHz`
- ML Rastreio (schedule 1h): `BRU5iCDLfNE4ysRe`
- ML Consolidado diário (19h30): `GWreSXeGtCxYhePt`
- ML Ingestão de vendas (WF1): `gN62YIDK24hiNJbg`

**Conexões:**
- Mercado Livre (OAuth app próprio), conta ESCASEVEN — leitura + notificação de envios.
- WhatsApp oficial (Cloud API) — avisos diretos.
- Evolution (WhatsApp não-oficial) — avisos no grupo da operação.
- Rodonaves — cotação, coleta e rastreio (mesmas credenciais).
- Supabase (Postgres) — base de estado/idempotência.
- Google Sheets — planilha operacional.

**Planilha:** EscaSeven — Fretes & Coletas (abas: Coletas · Resumo · Config · Rastreio ML).

---

## 8. Por que isso vale a pena
- **Menos trabalho braçal**: ninguém redigita venda; cotação e rastreio sozinhos.
- **Menos erro**: endereço, NF e protocolo certos, vindos da fonte.
- **Cliente avisado sozinho**: menos "cadê meu pedido?" — melhora reputação no ML.
- **Visão da operação**: planilha viva + consolidado diário no grupo.
- **Custo**: roda no que já temos (n8n + Supabase). Sem mensalidade nova.
