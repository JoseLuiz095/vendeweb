-- Conversations are bound to an order and a store; no direct public Data API access.
create unique index if not exists food_orders_id_store_conversation_uidx on public.food_orders(id, store_id);

create table public.food_order_conversations (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  order_id uuid not null,
  created_at timestamptz not null default now(),
  foreign key (order_id, store_id) references public.food_orders(id, store_id) on delete cascade,
  unique (order_id),
  unique (id, store_id)
);

create table public.food_order_conversation_tokens (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  conversation_id uuid not null references public.food_order_conversations(id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create index food_order_conversation_tokens_conversation_idx on public.food_order_conversation_tokens(conversation_id);

create table public.food_order_conversation_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.food_order_conversations(id) on delete cascade,
  sender text not null check (sender in ('customer','store','system')),
  sender_user_id uuid references auth.users(id) on delete set null,
  request_id uuid not null,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  unique (conversation_id, sender, request_id)
);
create index food_order_conversation_messages_chronology_idx on public.food_order_conversation_messages(conversation_id, created_at, id);

alter table public.food_order_conversations enable row level security;
alter table public.food_order_conversation_tokens enable row level security;
alter table public.food_order_conversation_messages enable row level security;
revoke all on public.food_order_conversations, public.food_order_conversation_tokens, public.food_order_conversation_messages from public, anon, authenticated;
grant select, insert, update, delete on public.food_order_conversations, public.food_order_conversation_tokens, public.food_order_conversation_messages to service_role;

-- These service-only routines are not a public API. The edge handler must
-- verify store staff identity and permissions before calling staff operations.
create or replace function public.food_order_conversation_issue_v1(p_store uuid, p_order uuid, p_actor uuid, p_token_hash text)
returns table(conversation_id uuid, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_order public.food_orders%rowtype; v_conversation uuid; v_expiry timestamptz;
begin
  if p_actor is null or not exists (select 1 from public.food_store_users u where u.store_id=p_store and u.user_id=p_actor and u.active and not coalesce(u.must_change_password,false) and u.role in ('owner','admin','manager')) then raise exception 'ACCESS_DENIED'; end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_TOKEN'; end if;
  select * into v_order from public.food_orders where id=p_order and store_id=p_store for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  insert into public.food_order_conversations(store_id,order_id) values(p_store,p_order)
    on conflict(order_id) do update set order_id=excluded.order_id returning id into v_conversation;
  update public.food_order_conversation_tokens set revoked_at=now() where food_order_conversation_tokens.conversation_id=v_conversation and revoked_at is null;
  v_expiry := case when v_order.status in ('delivered','cancelled') then now()+interval '7 days'
    else greatest(now()+interval '30 days',coalesce(v_order.scheduled_for+interval '7 days',now())) end;
  insert into public.food_order_conversation_tokens(token_hash,conversation_id,expires_at) values(p_token_hash,v_conversation,v_expiry);
  return query select v_conversation,v_expiry;
end $$;
revoke all on function public.food_order_conversation_issue_v1(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.food_order_conversation_issue_v1(uuid,uuid,uuid,text) to service_role;

create or replace function public.food_order_conversation_customer_v1(p_token_hash text,p_action text,p_body text default null,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_conversation uuid; v_order public.food_orders%rowtype; v_existing public.food_order_conversation_messages%rowtype; v_body text;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'INVALID_ACCESS'; end if;
  select t.conversation_id into v_conversation from public.food_order_conversation_tokens t
    where t.token_hash=p_token_hash and t.revoked_at is null and t.expires_at>now();
  if v_conversation is null then raise exception 'INVALID_ACCESS'; end if;
  -- Serialize message limit and idempotency checks for this conversation.
  perform 1 from public.food_order_conversations c where c.id=v_conversation for update;
  if not exists (select 1 from public.food_order_conversation_tokens t where t.token_hash=p_token_hash and t.conversation_id=v_conversation and t.revoked_at is null and t.expires_at>now()) then raise exception 'INVALID_ACCESS'; end if;
  select o.* into v_order from public.food_order_conversations c join public.food_orders o on o.id=c.order_id and o.store_id=c.store_id where c.id=v_conversation;
  if not found then raise exception 'INVALID_ACCESS'; end if;
  if p_action='send' then
    v_body := btrim(coalesce(p_body,''));
    if length(v_body) not between 1 and 2000 or p_request_id is null then raise exception 'INVALID_MESSAGE'; end if;
    select * into v_existing from public.food_order_conversation_messages where conversation_id=v_conversation and sender='customer' and request_id=p_request_id;
    if found then
      if v_existing.body<>v_body then raise exception 'REQUEST_CONFLICT'; end if;
    else
      if (select count(*) from public.food_order_conversation_messages where conversation_id=v_conversation and sender='customer' and created_at>now()-interval '1 minute')>=20 then raise exception 'RATE_LIMITED'; end if;
      if (select count(*) from public.food_order_conversation_messages where conversation_id=v_conversation)>=2000 then raise exception 'CONVERSATION_FULL'; end if;
      insert into public.food_order_conversation_messages(conversation_id,sender,request_id,body) values(v_conversation,'customer',p_request_id,v_body);
    end if;
  elsif p_action<>'list' then raise exception 'INVALID_ACTION'; end if;
  return jsonb_build_object('orderNumber',v_order.order_number,'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'sender',m.sender,'body',m.body,'createdAt',m.created_at) order by m.created_at,m.id) from (select * from public.food_order_conversation_messages where conversation_id=v_conversation order by created_at desc,id desc limit 100) m),'[]'::jsonb));
end $$;
revoke all on function public.food_order_conversation_customer_v1(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.food_order_conversation_customer_v1(text,text,text,uuid) to service_role;

create or replace function public.food_order_conversation_staff_v1(p_store uuid,p_order uuid,p_actor uuid,p_action text,p_body text default null,p_request_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_conversation uuid; v_existing public.food_order_conversation_messages%rowtype; v_body text;
begin
  -- The caller must still verify the session and any required MFA. Membership
  -- is rechecked here so bypassing the UI cannot grant cross-store access.
  if p_actor is null or not exists (select 1 from public.food_store_users u where u.store_id=p_store and u.user_id=p_actor and u.active and not coalesce(u.must_change_password,false) and u.role in ('owner','admin','manager')) then raise exception 'ACCESS_DENIED'; end if;
  select c.id into v_conversation from public.food_order_conversations c where c.store_id=p_store and c.order_id=p_order for update;
  if v_conversation is null then raise exception 'CONVERSATION_NOT_FOUND'; end if;
  if p_action='send' then
    v_body := btrim(coalesce(p_body,''));
    if length(v_body) not between 1 and 2000 or p_request_id is null then raise exception 'INVALID_MESSAGE'; end if;
    select * into v_existing from public.food_order_conversation_messages where conversation_id=v_conversation and sender='store' and request_id=p_request_id;
    if found then
      if v_existing.body<>v_body or v_existing.sender_user_id is distinct from p_actor then raise exception 'REQUEST_CONFLICT'; end if;
    else
      if (select count(*) from public.food_order_conversation_messages where conversation_id=v_conversation and sender='store' and created_at>now()-interval '1 minute')>=20 then raise exception 'RATE_LIMITED'; end if;
      if (select count(*) from public.food_order_conversation_messages where conversation_id=v_conversation)>=2000 then raise exception 'CONVERSATION_FULL'; end if;
      insert into public.food_order_conversation_messages(conversation_id,sender,sender_user_id,request_id,body) values(v_conversation,'store',p_actor,p_request_id,v_body);
    end if;
  elsif p_action<>'list' then raise exception 'INVALID_ACTION'; end if;
  return jsonb_build_object('messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'sender',m.sender,'body',m.body,'createdAt',m.created_at) order by m.created_at,m.id) from (select * from public.food_order_conversation_messages where conversation_id=v_conversation order by created_at desc,id desc limit 100) m),'[]'::jsonb));
end $$;
revoke all on function public.food_order_conversation_staff_v1(uuid,uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.food_order_conversation_staff_v1(uuid,uuid,uuid,text,text,uuid) to service_role;
