-- Disabled pilot infrastructure; test orders and synthetic stock never update
-- operational orders or inventory. Requires a separate gated service endpoint.
begin;
create table public.food_mp_isolated_test_orders (
 id uuid primary key default gen_random_uuid(),
 store_id uuid not null references public.food_stores(id),
 seller_id text not null, generation bigint not null,
 payment_method text not null check(payment_method in ('pix','card')),
 card_method_id text,card_type text check(card_type in ('credit_card','debit_card')),
 client_request_id uuid not null,
 amount numeric(12,2) not null default 50.00 check(amount = 50.00),
 external_reference text not null unique default replace(gen_random_uuid()::text,'-',''),
 idempotency_key uuid not null unique default gen_random_uuid(),
 provider_order_id text unique, payment_id text unique,
 payment_status text not null default 'pending' check(payment_status in ('pending','paid')),
 fulfillment_status text not null default 'open' check(fulfillment_status='open'),
 stock_remaining integer not null default 10 check(stock_remaining between 0 and 10),
 created_at timestamptz not null default now(),
 unique(id,store_id),unique(store_id,client_request_id)
);
alter table public.food_mp_isolated_test_orders enable row level security;
revoke all on public.food_mp_isolated_test_orders from public,anon,authenticated;
grant select,insert,update on public.food_mp_isolated_test_orders to service_role;

-- Only a service endpoint that has already verified the store owner/admin may
-- invoke these routines. An allowlisted store and fresh seller connection are
-- required; no browser may execute them directly.
create function public.food_mp_isolated_auth_lock_v1(p_store uuid,p_actor uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.food_stores where id=p_store and active and access_status='online' for share;
 if not found then return false;end if;
 perform 1 from public.food_store_users where store_id=p_store and user_id=p_actor and active and role in ('owner','admin') and not coalesce(must_change_password,false) for share;
 return found;
end $$;

create function public.food_mp_isolated_create_v1(p_store uuid,p_actor uuid,p_method text,p_request uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.food_mp_test_oauth_slots%rowtype; o public.food_mp_isolated_test_orders%rowtype;
begin
 if p_request is null or p_method is null or p_method not in ('pix','card') or not public.food_mp_isolated_auth_lock_v1(p_store,p_actor) then return null;end if;
 select s.* into c from public.food_mp_test_oauth_slots s join public.food_mp_test_oauth_allowed_stores a on a.store_id=s.store_id
 where s.store_id=p_store and s.seller_id ~ '^[0-9]{1,32}$' and s.token_expires_at>now() for update of s;
 if not found then return null;end if;
 insert into public.food_mp_isolated_test_orders(store_id,seller_id,generation,payment_method,client_request_id)
 values(p_store,c.seller_id,c.generation,p_method,p_request) on conflict(store_id,client_request_id) do nothing;
 select * into o from public.food_mp_isolated_test_orders where store_id=p_store and client_request_id=p_request;
 if not found or o.payment_method is distinct from p_method or o.seller_id is distinct from c.seller_id or o.generation is distinct from c.generation then return null;end if;
 return jsonb_build_object('order_id',o.id,'payment_status',o.payment_status,'fulfillment_status',o.fulfillment_status,'stock_remaining',o.stock_remaining);
end $$;

create function public.food_mp_isolated_reserve_v1(p_store uuid,p_actor uuid,p_order uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare o public.food_mp_isolated_test_orders%rowtype; c public.food_mp_test_oauth_slots%rowtype;
begin
 if not public.food_mp_isolated_auth_lock_v1(p_store,p_actor) then return null;end if;
 select * into o from public.food_mp_isolated_test_orders where id=p_order and store_id=p_store for update;
 if not found then return null;end if;
 select * into c from public.food_mp_test_oauth_slots where store_id=p_store for update;
 if not found or c.seller_id is distinct from o.seller_id or c.generation is distinct from o.generation or c.token_expires_at is null or c.token_expires_at<=now() or c.sealed_tokens is null or not exists(select 1 from public.food_mp_test_oauth_allowed_stores a where a.store_id=p_store) then return null;end if;
 return jsonb_build_object('seller_id',c.seller_id,'sealed_tokens',c.sealed_tokens,'expires_at',c.token_expires_at,'total',to_char(o.amount,'FM9999999990.00'),'external_reference',o.external_reference,'idempotency_key',o.idempotency_key,'payer_email','test_payer@example.com','method',o.payment_method,'card_method_id',o.card_method_id,'card_type',o.card_type,'provider_order_id',o.provider_order_id);
end $$;

-- Persist only method identity, never card numbers, security codes or tokens.
create function public.food_mp_isolated_card_method_v1(p_store uuid,p_actor uuid,p_order uuid,p_method text,p_type text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare o public.food_mp_isolated_test_orders%rowtype;
begin
 if p_method is null or p_method !~ '^[A-Za-z0-9_-]{1,64}$' or p_type is null or p_type not in ('credit_card','debit_card') then return false;end if;
 if public.food_mp_isolated_reserve_v1(p_store,p_actor,p_order) is null then return false;end if;
 select * into o from public.food_mp_isolated_test_orders where id=p_order and store_id=p_store for update;
 if not found or o.payment_method<>'card' or o.payment_status<>'pending' or o.provider_order_id is not null then return false;end if;
 if o.card_method_id is not null then return o.card_method_id=p_method and o.card_type=p_type;end if;
 update public.food_mp_isolated_test_orders set card_method_id=p_method,card_type=p_type where id=p_order and store_id=p_store;
 return true;
end $$;

create function public.food_mp_isolated_bind_v1(p_store uuid,p_actor uuid,p_order uuid,p_provider text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare o public.food_mp_isolated_test_orders%rowtype; c public.food_mp_test_oauth_slots%rowtype;
begin
 if p_provider is null or p_provider !~ '^[A-Za-z0-9_-]{1,128}$' or not public.food_mp_isolated_auth_lock_v1(p_store,p_actor) then return false;end if;
 select * into o from public.food_mp_isolated_test_orders where id=p_order and store_id=p_store for update;
 if not found then return false;end if;
 select * into c from public.food_mp_test_oauth_slots where store_id=p_store for update;
 if not found or c.seller_id is distinct from o.seller_id or c.generation is distinct from o.generation or c.token_expires_at is null or c.token_expires_at<=now() or not exists(select 1 from public.food_mp_test_oauth_allowed_stores a where a.store_id=p_store) then return false;end if;
 if o.provider_order_id is not null then return o.provider_order_id=p_provider;end if;
 if o.payment_status<>'pending' then return false;end if;
 begin update public.food_mp_isolated_test_orders set provider_order_id=p_provider where id=p_order and store_id=p_store;
 exception when unique_violation then return false;end;
 return true;
end $$;

-- Caller must verify webhook authentication and consult the provider directly;
-- these supplied fields are not evidence on their own.
create function public.food_mp_isolated_apply_v1(p_store uuid,p_order uuid,p_seller text,p_provider text,p_payment text,p_amount numeric,p_status text,p_detail text) returns text
language plpgsql security invoker set search_path='' as $$
declare o public.food_mp_isolated_test_orders%rowtype; c public.food_mp_test_oauth_slots%rowtype;
begin
 if p_status is distinct from 'processed' or p_detail is distinct from 'accredited' or p_payment is null or p_payment !~ '^[A-Za-z0-9_-]{1,128}$' then return 'conflict';end if;
 select * into o from public.food_mp_isolated_test_orders where id=p_order and store_id=p_store for update;
 if not found then return 'conflict';end if;
 select * into c from public.food_mp_test_oauth_slots where store_id=p_store for update;
 if not found or c.seller_id is distinct from o.seller_id or c.generation is distinct from o.generation or c.token_expires_at is null or c.token_expires_at<=now() or not exists(select 1 from public.food_mp_test_oauth_allowed_stores a where a.store_id=p_store) or o.seller_id is distinct from p_seller or o.provider_order_id is null or o.provider_order_id is distinct from p_provider or o.amount is distinct from p_amount then return 'conflict';end if;
 if o.payment_status='paid' then if o.payment_id=p_payment then return 'duplicate';end if;return 'conflict';end if;
 if o.stock_remaining<1 then return 'conflict';end if;
 begin update public.food_mp_isolated_test_orders set payment_id=p_payment,payment_status='paid',stock_remaining=stock_remaining-1 where id=p_order and store_id=p_store;
 exception when unique_violation then return 'conflict';end;
 return 'applied';
end $$;
-- Administrative polling must recheck access in the same transaction as apply.
create function public.food_mp_isolated_apply_admin_v1(p_store uuid,p_actor uuid,p_order uuid,p_seller text,p_provider text,p_payment text,p_amount numeric,p_status text,p_detail text) returns text
language plpgsql security invoker set search_path='' as $$
begin
 if not public.food_mp_isolated_auth_lock_v1(p_store,p_actor) then return 'conflict';end if;
 return public.food_mp_isolated_apply_v1(p_store,p_order,p_seller,p_provider,p_payment,p_amount,p_status,p_detail);
end $$;
revoke all on function public.food_mp_isolated_auth_lock_v1(uuid,uuid),public.food_mp_isolated_create_v1(uuid,uuid,text,uuid),public.food_mp_isolated_reserve_v1(uuid,uuid,uuid),public.food_mp_isolated_card_method_v1(uuid,uuid,uuid,text,text),public.food_mp_isolated_bind_v1(uuid,uuid,uuid,text),public.food_mp_isolated_apply_v1(uuid,uuid,text,text,text,numeric,text,text),public.food_mp_isolated_apply_admin_v1(uuid,uuid,uuid,text,text,text,numeric,text,text) from public,anon,authenticated;
grant execute on function public.food_mp_isolated_auth_lock_v1(uuid,uuid),public.food_mp_isolated_create_v1(uuid,uuid,text,uuid),public.food_mp_isolated_reserve_v1(uuid,uuid,uuid),public.food_mp_isolated_card_method_v1(uuid,uuid,uuid,text,text),public.food_mp_isolated_bind_v1(uuid,uuid,uuid,text),public.food_mp_isolated_apply_v1(uuid,uuid,text,text,text,numeric,text,text),public.food_mp_isolated_apply_admin_v1(uuid,uuid,uuid,text,text,text,numeric,text,text) to service_role;
commit;
