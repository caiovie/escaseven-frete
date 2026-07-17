# EscaSeven — Arquitetura & Plano de Ação
### Monitorar entregas + centralizar vendas (Yampi + Mercado Livre) + dados de clientes
_Verificado ao vivo em 25/06/2026_

---

## 1. Objetivo
Um sistema único que:
1. **Recebe as vendas** dos dois canais — **Yampi** (loja própria) e **Mercado Livre**.
2. **Guarda os dados do cliente** de cada venda (unificado, sem duplicar).
3. **Monitora as entregas** solicitadas (coletas Rodonaves) de ponta a ponta e avisa (grupo interno + comprador).

---

## 2. Estado das conexões (verificado agora)

| Conexão | Status | Observação |
|---|---|---|
| **n8n** (motor) | 🟢 ok | API respondendo; workflows organizados por prefixo |
| **Mercado Livre** (OAuth, app próprio) | 🟢 conectado | Lê pedidos/envios/comprador. **Falta:** registrar o webhook no DevCenter |
| **Rodonaves** (cotação/coleta/rastreio) | 🟢 ok | Token 200; CNPJ remetente 51.835.028/0001-80 |
| **WhatsApp Oficial** (Cloud API) | 🟢 ok | Envio testado (phone id configurado) |
| **Evolution** (grupo WhatsApp) | 🟢 ok | Instância `agenteia` → grupo da operação |
| **Supabase** (Postgres) | 🟢 ok | ⚠️ RLS desativado em 2 tabelas (ver §6) |
| **Google Sheets** | 🟢 ok | Planilha operacional (Coletas/Resumo/Rastreio ML) |
| **Yampi** | 🟢 ok | Webhook `order.paid` (merchant-token) testado |
| **Bling** | 🟡 a validar | Credencial existe; necessária p/ NF (fase 5) |

**O que falta pro objetivo:** (a) **tabela de clientes unificada** (não existe), (b) **webhook do ML registrado** (captura de vendas/clientes ML), (c) **pedidos do Yampi entrarem no rastreio**.

---

## 3. Arquitetura completa

```
   ┌── CANAIS DE VENDA ──────────────────────────────┐
   │                                                  │
   │   Yampi (loja própria)        Mercado Livre      │
   │   webhook order.paid          webhook orders_v2  │
   └──────────┬───────────────────────────┬──────────┘
              ▼                            ▼
        [WF Yampi]                   [WF1 ML Ingestão]
     cotação + coleta            busca pedido/envio (custom)
              │                            │
              └──────────┬─────────────────┘
                         ▼
              ┌── SUPABASE (base única) ──────────────┐
              │  customers   (cliente unificado)      │
              │  orders      (venda: canal, valor…)   │
              │  entregas    (rastreio: NF/protocolo) │  ← evolui de tracking_ml
              └──────────────┬────────────────────────┘
                             ▼
        [WF Rastreio agendado — 1h, 8–19h, Seg–Sáb]
        consulta Rodonaves (CNPJ remetente + NF/protocolo/CT-e)
                             │
        ┌────────────────────┼───────────────────────┐
        ▼                    ▼                        ▼
   Planilha            Grupo WhatsApp         [go-live] Comprador
   (Rastreio ML)       (Evolution)            (ML seller_notifications)
                             │
        [WF Consolidado — 19h30] panorama do dia no grupo
```

**Chaves de busca do rastreio (confirmadas):** `protocolo` (sozinho) · `NF + CNPJ` · `CT-e + CNPJ` — e o `TaxIdRegistration` aceita **tanto o CNPJ do remetente (fixo) quanto o CPF/CNPJ do cliente**.

---

## 4. Modelo de dados (o que muda)

**Já existe:**
- `coleta_pre_agendamento` — dados do pedido Yampi + cotação/coleta (doc, nome, endereço, protocolo, valor).
- `tracking_ml` — estado de rastreio (5 pedidos hoje). Tem `nf_numero`, `protocolo`, `ml_status`, etc.

**A criar:**
- **`customers`** — cliente unificado. Dedup por documento. Campos: `doc` (CPF/CNPJ, único), `nome`, `email`, `telefone`, `endereço`, `canal_origem` (yampi/ml), `primeiro_pedido`, `ultimo_pedido`, `total_pedidos`.
- **`orders`** — venda de qualquer canal. Campos: `canal` (yampi/ml), `order_id_canal`, `customer_doc` (→ customers), `valor`, `data`, `status`, `nf`, `protocolo`, `shipment_id`.
- **`entregas`** (evolução do `tracking_ml`) — 1 linha por envio a rastrear, agnóstico de canal (`canal`, `order_id`, chave de busca, `status`, `is_final`).

> Alternativa mais rápida: manter `tracking_ml` e só adicionar coluna `canal` — decidimos na execução.

---

## 5. Plano de ação (faseado)

### Fase 1 — Base unificada de clientes (fundação)
- Criar `customers` + `orders` no Supabase.
- Alimentar pelo **Yampi** (o fluxo já captura doc/nome/email/telefone/endereço → upsert em `customers`+`orders`).
- **Entrega:** todo cliente da loja própria fica registrado e deduplicado.

### Fase 2 — Captura de clientes e vendas do Mercado Livre
- **Registrar o webhook no DevCenter do ML** (URL `…/webhook/ml-notif`, tópico `orders_v2`).
- Evoluir o **WF1** para, além de criar o pedido, **puxar os dados do comprador** (nickname, nome/endereço do envio, doc via billing) → upsert em `customers`+`orders`.
- **Entrega:** vendas ML entram sozinhas + cliente do ML capturado.

### Fase 3 — Yampi no monitoramento de entregas
- Fazer os pedidos do Yampi (que já têm protocolo da cotação) entrarem no **WF Rastreio** (via `entregas`/`canal`).
- **Entrega:** loja própria e ML no mesmo monitoramento (planilha + grupo).

### Fase 4 — Go-live das notificações + segurança
- Ativar o aviso ao **comprador no ML** (nó hoje desativado).
- Ativar o **"Confirmar Coleta"** (1 toque real) da loja própria.
- **Segurança:** habilitar RLS (ver §6).

### Fase 5 — Nota fiscal automática (opcional)
- Puxar a NF-e do **Bling** e **anexar no pedido do ML** (`POST /packs/{id}/fiscal_documents`, XML ≤1MB).
- **Entrega:** zero anexo manual de nota.

---

## 6. Segurança (importante)
⚠️ As tabelas `coleta_pre_agendamento` e `tracking_ml` estão **sem RLS (Row Level Security)** — em tese, quem tiver a chave `anon` do Supabase pode ler/alterar. Nossa automação usa conexão direta Postgres (não é afetada por RLS), então **dá pra ligar o RLS sem quebrar nada**:
```sql
ALTER TABLE public.coleta_pre_agendamento ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracking_ml ENABLE ROW LEVEL SECURITY;
```
Recomendo aplicar na Fase 4. (Não apliquei ainda — decisão de vocês.)

---

## 7. O que preciso de vocês (para executar)
| Item | Quem | Necessário para |
|---|---|---|
| Registrar webhook no **DevCenter do ML** | Betão/Caio | Fase 2 (vendas+clientes ML) |
| Confirmar **Bling** (como emite NF, endpoint) | Betão/operação | Fase 5 (NF automática) |
| **Whitelist do IP do n8n** na Rodonaves | operação | evitar 403/timeout |
| Aprovar **go-live** (aviso ao comprador) | Betão | Fase 4 |

---

## 8. O que eu faço assim que você aprovar
1. Crio `customers` + `orders` e ligo o Yampi (Fase 1).
2. Evoluo o WF1 pra capturar o cliente do ML (Fase 2) — falta só você registrar o webhook.
3. Ponho o Yampi no rastreio (Fase 3).
4. Deixo tudo pronto pro toggle de go-live (Fase 4).

**Sugestão de ordem:** Fase 1 → 2 → 3 (entrega o monitoramento unificado), e Fase 4/5 quando quiser ir pra produção total.
