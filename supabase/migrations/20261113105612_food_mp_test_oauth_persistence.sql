-- Pilot test OAuth only. Review and compare the target schema before applying.
begin;
-- Default deny: eligible sandbox stores are configured only by trusted backend operations.
create table public.food_mp_test_oauth_allowed_stores (
  store_id uuid primary key references public.food_stores(id) on delete cascade
);
create table public.food_mp_test_oauth_slots (
  store_id uuid primary key references public.food_stores(id) on delete cascade,
  generation bigint not null default 0,
  seller_id text check (seller_id is null or seller_id ~ '^[0-9]{1,32}$'),
  sealed_tokens text,
  token_expires_at timestamptz,
  check ((seller_id is null and sealed_tokens is null and token_expires_at is null) or
         (seller_id is not null and sealed_tokens is not null and token_expires_at is not null))
);
create table public.food_mp_test_oauth_states (
  state_hash text primary key check (state_hash ~ '^[A-Za-z0-9_-]{43}$'),
  store_id uuid not null references public.food_mp_test_oauth_slots(store_id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  sealed_verifier text not null check (sealed_verifier like 'v1.%' and length(sealed_verifier)<=30000),
  expires_at timestamptz not null,
  generation bigint not null,
  claim uuid unique,
  claimed_at timestamptz
);
create index food_mp_test_oauth_states_store_idx on public.food_mp_test_oauth_states(store_id);
alter table public.food_mp_test_oauth_allowed_stores enable row level security;
alter table public.food_mp_test_oauth_slots enable row level security;
alter table public.food_mp_test_oauth_states enable row level security;
revoke all on public.food_mp_test_oauth_allowed_stores,public.food_mp_test_oauth_slots,public.food_mp_test_oauth_states from public,anon,authenticated;
grant select,insert,update,delete on public.food_mp_test_oauth_allowed_stores,public.food_mp_test_oauth_slots,public.food_mp_test_oauth_states to service_role;

-- Somente a Edge Function verificada pode informar p_actor. Nunca expor a clientes.
create function public.food_mp_test_oauth_authorize_v1(p_actor uuid,p_store uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.food_store_users u join public.food_stores s on s.id=u.store_id
 where u.store_id=p_store and u.user_id=p_actor and u.active and u.role in ('owner','admin')
 and not coalesce(u.must_change_password,false) and s.active and s.access_status='online'
 and exists(select 1 from public.food_mp_test_oauth_allowed_stores allowed where allowed.store_id=s.id))
$$;
create function public.food_mp_test_oauth_status_v1(p_store uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce((select jsonb_build_object('connected',seller_id is not null and token_expires_at>now(),'seller_id',seller_id)
 from public.food_mp_test_oauth_slots where store_id=p_store),jsonb_build_object('connected',false))
$$;
create function public.food_mp_test_oauth_start_v1(p_store uuid,p_actor uuid,p_state_hash text,p_verifier text,p_expires_at timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v_generation bigint;
begin
 if not public.food_mp_test_oauth_authorize_v1(p_actor,p_store) then return false; end if;
 if p_state_hash !~ '^[A-Za-z0-9_-]{43}$' or p_verifier not like 'v1.%' or length(p_verifier)>30000
 or p_expires_at<=clock_timestamp() or p_expires_at>clock_timestamp()+interval '11 minutes' then return false; end if;
 perform 1 from public.food_stores where id=p_store and active and access_status='online' for share;
 if not found then return false; end if;
 perform 1 from public.food_store_users where store_id=p_store and user_id=p_actor and active and role in ('owner','admin') and not coalesce(must_change_password,false) for share;
 if not found then return false; end if;
 perform 1 from public.food_mp_test_oauth_allowed_stores where store_id=p_store for share;
 if not found then return false; end if;
 insert into public.food_mp_test_oauth_slots(store_id) values(p_store) on conflict do nothing;
 update public.food_mp_test_oauth_slots set generation=generation+1 where store_id=p_store returning generation into v_generation;
 delete from public.food_mp_test_oauth_states where store_id=p_store;
 insert into public.food_mp_test_oauth_states(state_hash,store_id,actor_id,sealed_verifier,expires_at,generation)
 values(p_state_hash,p_store,p_actor,p_verifier,p_expires_at,v_generation);
 return true;
end $$;
create function public.food_mp_test_oauth_consume_v1(p_state_hash text,p_store uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare s public.food_mp_test_oauth_states%rowtype; g bigint; c uuid;
begin
 if not public.food_mp_test_oauth_authorize_v1(p_actor,p_store) then return null; end if;
 select generation into g from public.food_mp_test_oauth_slots where store_id=p_store for update;
 if not found then return null; end if;
 c:=gen_random_uuid();
 update public.food_mp_test_oauth_states set claim=c,claimed_at=clock_timestamp()
 where state_hash=p_state_hash and store_id=p_store and actor_id=p_actor and claim is null and generation=g and expires_at>clock_timestamp()
 returning * into s;
 if not found then return null; end if;
 return jsonb_build_object('sealed_verifier',s.sealed_verifier,'claim',c::text);
end $$;
create function public.food_mp_test_oauth_commit_v1(p_store uuid,p_actor uuid,p_claim uuid,p_seller_id text,p_sealed_tokens text,p_expires_at timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
declare g bigint;
begin
 if not public.food_mp_test_oauth_authorize_v1(p_actor,p_store) then return false; end if;
 if p_seller_id !~ '^[0-9]{1,32}$' or p_sealed_tokens not like 'v1.%' or length(p_sealed_tokens)>30000 or p_expires_at<=clock_timestamp() then return false; end if;
 perform 1 from public.food_stores where id=p_store and active and access_status='online' for share;
 if not found then return false; end if;
 perform 1 from public.food_store_users where store_id=p_store and user_id=p_actor and active and role in ('owner','admin') and not coalesce(must_change_password,false) for share;
 if not found then return false; end if;
 perform 1 from public.food_mp_test_oauth_allowed_stores where store_id=p_store for share;
 if not found then return false; end if;
 select generation into g from public.food_mp_test_oauth_slots where store_id=p_store for update;
 if not found then return false; end if;
 delete from public.food_mp_test_oauth_states where store_id=p_store and actor_id=p_actor and claim=p_claim and generation=g and expires_at>clock_timestamp();
 if not found then return false; end if;
 update public.food_mp_test_oauth_slots set seller_id=p_seller_id,sealed_tokens=p_sealed_tokens,token_expires_at=p_expires_at where store_id=p_store;
 return true;
end $$;
create function public.food_mp_test_oauth_disconnect_v1(p_store uuid,p_actor uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if not public.food_mp_test_oauth_authorize_v1(p_actor,p_store) then return false; end if;
 perform 1 from public.food_stores where id=p_store and active and access_status='online' for share;
 if not found then return false; end if;
 perform 1 from public.food_store_users where store_id=p_store and user_id=p_actor and active and role in ('owner','admin') and not coalesce(must_change_password,false) for share;
 if not found then return false; end if;
 perform 1 from public.food_mp_test_oauth_allowed_stores where store_id=p_store for share;
 if not found then return false; end if;
 insert into public.food_mp_test_oauth_slots(store_id) values(p_store) on conflict do nothing;
 update public.food_mp_test_oauth_slots set generation=generation+1,seller_id=null,sealed_tokens=null,token_expires_at=null where store_id=p_store;
 delete from public.food_mp_test_oauth_states where store_id=p_store;
 return true;
end $$;
revoke all on function public.food_mp_test_oauth_authorize_v1(uuid,uuid),public.food_mp_test_oauth_status_v1(uuid),public.food_mp_test_oauth_start_v1(uuid,uuid,text,text,timestamptz),public.food_mp_test_oauth_consume_v1(text,uuid,uuid),public.food_mp_test_oauth_commit_v1(uuid,uuid,uuid,text,text,timestamptz),public.food_mp_test_oauth_disconnect_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.food_mp_test_oauth_authorize_v1(uuid,uuid),public.food_mp_test_oauth_status_v1(uuid),public.food_mp_test_oauth_start_v1(uuid,uuid,text,text,timestamptz),public.food_mp_test_oauth_consume_v1(text,uuid,uuid),public.food_mp_test_oauth_commit_v1(uuid,uuid,uuid,text,text,timestamptz),public.food_mp_test_oauth_disconnect_v1(uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
