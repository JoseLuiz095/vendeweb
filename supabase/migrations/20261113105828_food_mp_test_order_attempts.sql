-- Test-only; fail closed by default. No payment or fulfillment changes.
begin;
create table public.food_mp_test_orders_feature (singleton boolean primary key default true check(singleton),enabled boolean not null default false);
insert into public.food_mp_test_orders_feature(singleton,enabled) values(true,false);
create unique index if not exists food_orders_id_store_mp_test_uidx on public.food_orders(id,store_id);
create table public.food_mp_test_order_attempts (
 store_id uuid not null references public.food_stores(id),
 order_id uuid not null,
 amount numeric(12,2) not null check(amount>0), version integer not null,
 payer_email text not null, seller_id text not null, generation bigint not null,
 external_reference text not null unique, idempotency_key uuid not null unique,
 provider_order_id text unique, needs_review boolean not null default false,
 primary key(store_id,order_id),
 foreign key(order_id,store_id) references public.food_orders(id,store_id)
);
alter table public.food_mp_test_orders_feature enable row level security;
alter table public.food_mp_test_order_attempts enable row level security;
revoke all on public.food_mp_test_orders_feature,public.food_mp_test_order_attempts from public,anon,authenticated;
grant select,insert,update,delete on public.food_mp_test_orders_feature,public.food_mp_test_order_attempts to service_role;
create function public.food_mp_test_checkout_eligible_v1(p_store uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.food_mp_test_orders_feature f join public.food_mp_test_oauth_allowed_stores a on a.store_id=p_store
 join public.food_mp_test_oauth_slots c on c.store_id=a.store_id
 join public.food_stores s on s.id=a.store_id
 where f.singleton and f.enabled and s.active and s.access_status='online' and c.seller_id is not null and c.token_expires_at>now())
$$;
-- A snapshot only becomes valid while the referenced local order remains unchanged.
create function public.food_mp_test_order_reserve_v1(p_store uuid,p_order uuid,p_amount numeric,p_version integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.food_orders%rowtype; a public.food_mp_test_order_attempts%rowtype; c public.food_mp_test_oauth_slots%rowtype;
begin
 if not public.food_mp_test_checkout_eligible_v1(p_store) then return null; end if;
 select * into o from public.food_orders where id=p_order and store_id=p_store for update;
 if not found or o.status='cancelled' or o.payment_method<>'pix' or o.payment_status<>'pending' or o.total<=0
 or o.total is distinct from p_amount or o.payment_receipt_version is distinct from p_version
 or o.customer_email is null or length(o.customer_email)>254 or o.customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then return null; end if;
 select * into c from public.food_mp_test_oauth_slots where store_id=p_store for update;
 if not found or not public.food_mp_test_checkout_eligible_v1(p_store) then return null; end if;
 select * into a from public.food_mp_test_order_attempts where store_id=p_store and order_id=p_order for update;
 if found then
  if a.needs_review or a.amount is distinct from o.total or a.version is distinct from o.payment_receipt_version or a.payer_email is distinct from o.customer_email or a.seller_id is distinct from c.seller_id or a.generation is distinct from c.generation then
   update public.food_mp_test_order_attempts set needs_review=true where store_id=p_store and order_id=p_order;return null;
  end if;
 else
  insert into public.food_mp_test_order_attempts(store_id,order_id,amount,version,payer_email,seller_id,generation,external_reference,idempotency_key)
  values(p_store,p_order,o.total,o.payment_receipt_version,o.customer_email,c.seller_id,c.generation,replace(gen_random_uuid()::text,'-',''),gen_random_uuid()) returning * into a;
 end if;
 return jsonb_build_object('mode','test','provenance','oauth_test_token','seller_id',c.seller_id,'sealed_tokens',c.sealed_tokens,'expires_at',c.token_expires_at,
 'total',to_char(a.amount,'FM9999999990.00'),'external_reference',a.external_reference,'idempotency_key',a.idempotency_key,'payer_email',a.payer_email,'provider_order_id',a.provider_order_id);
end $$;
create function public.food_mp_test_order_find_v1(p_store uuid,p_order uuid,p_amount numeric,p_version integer) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('mode','test','provenance','oauth_test_token','seller_id',c.seller_id,'sealed_tokens',c.sealed_tokens,'expires_at',c.token_expires_at,
 'total',to_char(a.amount,'FM9999999990.00'),'external_reference',a.external_reference,'idempotency_key',a.idempotency_key,'payer_email',a.payer_email,'provider_order_id',a.provider_order_id)
 from public.food_mp_test_order_attempts a join public.food_orders o on o.id=a.order_id and o.store_id=a.store_id
 join public.food_mp_test_oauth_slots c on c.store_id=a.store_id
 where a.store_id=p_store and a.order_id=p_order and not a.needs_review and public.food_mp_test_checkout_eligible_v1(p_store)
 and o.status<>'cancelled' and o.payment_method='pix' and o.payment_status='pending'
 and a.amount=p_amount and a.version=p_version and o.total=a.amount and o.payment_receipt_version=a.version
 and o.customer_email=a.payer_email and c.seller_id=a.seller_id and c.generation=a.generation
$$;
create function public.food_mp_test_order_bind_v1(p_store uuid,p_order uuid,p_amount numeric,p_version integer,p_provider_order_id text) returns boolean language plpgsql security invoker set search_path='' as $$
declare o public.food_orders%rowtype;a public.food_mp_test_order_attempts%rowtype;c public.food_mp_test_oauth_slots%rowtype;
begin
 if p_provider_order_id is null or p_provider_order_id !~ '^[A-Za-z0-9_-]{1,128}$' then return false; end if;
 select * into o from public.food_orders where id=p_order and store_id=p_store for update;if not found then return false;end if;
 select * into c from public.food_mp_test_oauth_slots where store_id=p_store for update;if not found then return false;end if;
 select * into a from public.food_mp_test_order_attempts where store_id=p_store and order_id=p_order for update;if not found then return false;end if;
 if a.provider_order_id is not null and a.provider_order_id<>p_provider_order_id then update public.food_mp_test_order_attempts set needs_review=true where store_id=p_store and order_id=p_order;return false;end if;
 if not public.food_mp_test_checkout_eligible_v1(p_store) or a.needs_review or o.status='cancelled' or o.payment_method<>'pix' or o.payment_status<>'pending'
 or a.amount is distinct from p_amount or a.version is distinct from p_version or o.total is distinct from a.amount or o.payment_receipt_version is distinct from a.version
 or o.customer_email is distinct from a.payer_email or c.seller_id is distinct from a.seller_id or c.generation is distinct from a.generation then
  update public.food_mp_test_order_attempts set needs_review=true,provider_order_id=coalesce(provider_order_id,p_provider_order_id) where store_id=p_store and order_id=p_order;return false;
 end if;
 update public.food_mp_test_order_attempts set provider_order_id=p_provider_order_id where store_id=p_store and order_id=p_order;
 return true;
end $$;
revoke all on function public.food_mp_test_checkout_eligible_v1(uuid),public.food_mp_test_order_reserve_v1(uuid,uuid,numeric,integer),public.food_mp_test_order_find_v1(uuid,uuid,numeric,integer),public.food_mp_test_order_bind_v1(uuid,uuid,numeric,integer,text) from public,anon,authenticated;
grant execute on function public.food_mp_test_checkout_eligible_v1(uuid),public.food_mp_test_order_reserve_v1(uuid,uuid,numeric,integer),public.food_mp_test_order_find_v1(uuid,uuid,numeric,integer),public.food_mp_test_order_bind_v1(uuid,uuid,numeric,integer,text) to service_role;
-- Sandbox ledger only: never alter a real order, its delivery or inventory.
create table public.food_mp_test_pix_ledger (
 store_id uuid not null,order_id uuid not null,seller_id text not null,payment_id text not null,
 idempotency_key text not null unique,provider_order_id text not null,amount numeric(12,2) not null,
 primary key(store_id,order_id),unique(seller_id,payment_id),
 foreign key(store_id,order_id) references public.food_mp_test_order_attempts(store_id,order_id)
);
alter table public.food_mp_test_pix_ledger enable row level security;
revoke all on public.food_mp_test_pix_ledger from public,anon,authenticated;
grant select,insert,update,delete on public.food_mp_test_pix_ledger to service_role;
create function public.food_mp_test_apply_verified_pix_v1(p_store uuid,p_order uuid,p_seller text,p_provider_order text,p_payment text,p_reference text,p_amount numeric,p_version integer,p_key text,p_status text,p_detail text) returns text language plpgsql security invoker set search_path='' as $$
declare o public.food_orders%rowtype;a public.food_mp_test_order_attempts%rowtype;c public.food_mp_test_oauth_slots%rowtype;existing public.food_mp_test_pix_ledger%rowtype;
begin
 -- Only a trusted service may call this, after an authenticated provider GET.
 if p_status is distinct from 'processed' or p_detail is distinct from 'accredited' or p_seller !~ '^[0-9]{1,32}$' or p_payment !~ '^[A-Za-z0-9_-]{1,128}$' or p_key is distinct from 'mp:test:'||p_seller||':'||p_payment then return 'conflict';end if;
 select * into o from public.food_orders where id=p_order and store_id=p_store for update;if not found then return 'conflict';end if;
 select * into c from public.food_mp_test_oauth_slots where store_id=p_store for update;if not found then return 'conflict';end if;
 select * into a from public.food_mp_test_order_attempts where store_id=p_store and order_id=p_order for update;if not found then return 'conflict';end if;
 if not public.food_mp_test_checkout_eligible_v1(p_store) or a.needs_review or o.status='cancelled' or o.payment_method<>'pix' or o.payment_status<>'pending'
 or a.amount is distinct from p_amount or a.version is distinct from p_version or o.total is distinct from a.amount or o.payment_receipt_version is distinct from a.version
 or o.customer_email is distinct from a.payer_email or c.seller_id is distinct from a.seller_id or c.generation is distinct from a.generation
 or a.seller_id is distinct from p_seller or a.provider_order_id is distinct from p_provider_order or a.provider_order_id is null or a.external_reference is distinct from p_reference then return 'conflict';end if;
 select * into existing from public.food_mp_test_pix_ledger where store_id=p_store and order_id=p_order;
 if found then if existing.idempotency_key=p_key and existing.payment_id=p_payment and existing.provider_order_id=p_provider_order and existing.amount=p_amount then return 'duplicate';end if;return 'conflict';end if;
 begin
  insert into public.food_mp_test_pix_ledger(store_id,order_id,seller_id,payment_id,idempotency_key,provider_order_id,amount) values(p_store,p_order,p_seller,p_payment,p_key,p_provider_order,p_amount);
 exception when unique_violation then return 'conflict';end;
 return 'applied';
end $$;
revoke all on function public.food_mp_test_apply_verified_pix_v1(uuid,uuid,text,text,text,text,numeric,integer,text,text,text) from public,anon,authenticated;
grant execute on function public.food_mp_test_apply_verified_pix_v1(uuid,uuid,text,text,text,text,numeric,integer,text,text,text) to service_role;
notify pgrst,'reload schema';
commit;
