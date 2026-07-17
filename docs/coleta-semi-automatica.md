# EscaSeven — Coleta semi-automática (1 toque): guia de ativação

Status: **construído, falta plugar credenciais/config**. Decisões travadas com o Caio:
canal de alerta = **Evolution API**, remetente = **CNPJ 51.835.028/0001-80**, credencial Rodonaves = **a cadastrar**.

## Workflows criados (n8n)

| Workflow | ID | Webhook | Função |
|---|---|---|---|
| EscaSeven — Notificar Coleta | `rvhiZbcUDQNxq3pE` | `POST /webhook/notificar-coleta` | Persiste pré-agendamento + token, envia alerta WhatsApp com 2 links |
| EscaSeven — Confirmar Coleta (1 toque) | `P4eQm5dEJ8ANmqBq` | `GET /webhook/confirmar-coleta?id=&token=` | Valida → token Rodonaves → coleta por protocolo (retry 3x) → atualiza status → responde no WhatsApp |

Fluxo: `Yampi pago → cotação (fluxo atual) → POST notificar-coleta → WhatsApp → Caio toca "Agendar agora" → confirmar-coleta → coleta agendada / fallback manual`.

## Passos para ligar (em ordem)

### 1. Criar a tabela
Rodar [`db/coleta_pre_agendamento.sql`](../db/coleta_pre_agendamento.sql) no Supabase/Postgres.

### 2. Conferir credencial Postgres nos nós
Nos 2 workflows, abrir cada nó Postgres e confirmar que está selecionada a credencial **"Escaseven (supabase caiovieira64)"** (`HJtBJIFlstoCrDIG`).

### 3. Evolution API (alerta WhatsApp)
- Criar credencial **HTTP Header Auth**: header `apikey` = sua API key do Evolution. (Os nós já referenciam "Evolution API key (header apikey)".)
- Preencher o `placeholder` da **URL** em todos os nós "WhatsApp": `https://SEU-EVOLUTION/message/sendText/SUA-INSTANCIA`.
- Body já vai como `{ number, text }` (Evolution v2). Se sua instância for v1, ajustar para `textMessage.text`.

### 4. Rodonaves (coleta) — workflow confirmar
Preencher os `placeholder` do nó **Token Rodonaves**: `username`, `password`, `auth_type` (confirmar o valor de `auth_type` com a transportadora). `grant_type` já está como `password`.
- Conferir o campo do token na resposta: o nó coleta usa `access_token` (com fallback p/ `accessToken`/`token`).
- `ScheduleDate` = próximo dia útil 09:00 (pula fim de semana). `PickupServiceType=1` (Convencional), `RegisterSource=2`.

### 5. Plugar no fluxo pós-pagamento atual (`pl6cdceCos3hbwNF`)
> ⚠️ Esse workflow **não está disponível via MCP** ("Enable MCP access in workflow settings"). Para eu editá-lo automaticamente, ative **Settings → Make available to MCP**. Enquanto isso, adicionar manualmente **1 nó HTTP Request** após `Gera Cotacao1`:
- `POST https://workflowsmatriz.cassinweb.shop/webhook/notificar-coleta`
- Body JSON com: `order_number`, `protocol_id` (= `{{ $('Gera Cotacao1').item.json.ProtocolId }}`), `dest_nome`, `dest_doc`, `dest_cep`, `dest_cidade`, `dest_uf`, `peso_taxado`, `total_volumes`, `valor_nf`, `freight_value`, `items_summary`, e **`alert_to`** (número do Caio/Betão).

### 6. Ativar os dois workflows (toggle Active).

## Pré-requisitos operacionais (fora do n8n)
1. **Whitelist do IP de saída do n8n na Rodonaves** — causa provável dos 403/timeouts. Sem isso a coleta falha de forma intermitente (mas o fallback manual cobre).
2. **Reconciliação cotado × CT-e**: a coluna `freight_value` fica salva por pedido para comparar com o CT-e real e ajustar o fator do site.

## Idempotência e segurança
- 2º toque no link com status `agendada` → responde "já agendada", não duplica coleta.
- `token` aleatório por pedido autentica o link.
- Falha da API → status `falha` + WhatsApp com dados prontos p/ agendar manual em `cliente.rte.com.br`.

## Pendências para revisar com a operação
- Valor correto de `auth_type` e nome do campo do token na resposta da Rodonaves.
- Endereço completo do destinatário (logradouro/número/bairro) se a API por protocolo exigir — hoje a coleta usa só `ProtocolId` (mais robusto).
- Mover usuário/senha da Rodonaves de `placeholder` para uma credencial **HTTP Custom Auth** quando possível (em vez de ficar no nó).
