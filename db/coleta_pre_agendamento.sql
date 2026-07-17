-- EscaSeven — Tabela de pré-agendamento de coleta (semi-automática, 1 toque)
-- Rodar uma vez no Supabase/Postgres (credencial n8n: "Escaseven (supabase caiovieira64)").
-- Usada pelos workflows:
--   - escaseven-coleta-notificar (rvhiZbcUDQNxq3pE) — INSERT/UPSERT
--   - escaseven-coleta-confirmar (P4eQm5dEJ8ANmqBq) — SELECT + UPDATE

create table if not exists public.coleta_pre_agendamento (
  id              bigint generated always as identity primary key,

  -- identificação / idempotência
  order_number    text not null,
  protocol_id     text,                 -- ProtocolId retornado pela cotação Rodonaves
  token           text not null,        -- autentica o link de confirmação (1 toque)
  status          text not null default 'aguardando',  -- aguardando | agendada | falha

  -- destinatário (cliente)
  dest_nome       text,
  dest_doc        text,
  dest_cep        text,
  dest_cidade     text,
  dest_uf         text,
  dest_logradouro text,
  dest_numero     text,
  dest_bairro     text,
  dest_complemento text,
  dest_telefone   text,

  -- remetente / nota
  remetente_cnpj  text default '51835028000180',  -- titular do contrato Rodonaves
  peso_taxado     numeric,
  total_volumes   integer,
  valor_nf        numeric,
  freight_value   numeric,              -- valor cotado (para reconciliar com CT-e depois)

  -- itens / alerta
  items_summary   text,
  alert_to        text,                 -- número WhatsApp do Caio/Betão (Evolution)

  -- retorno da API de coleta
  pickup_response jsonb,
  pickup_id       text,

  created_at      timestamptz default now(),
  scheduled_at    timestamptz,

  unique (order_number)
);

create index if not exists idx_coleta_status on public.coleta_pre_agendamento (status);
create index if not exists idx_coleta_order  on public.coleta_pre_agendamento (order_number);
