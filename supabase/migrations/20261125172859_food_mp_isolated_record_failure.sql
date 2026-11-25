-- Only the isolated pilot table is changed; operational orders and stock are untouched.
begin;
alter table public.food_mp_isolated_test_orders drop constraint food_mp_isolated_test_orders_payment_status_check;
alter table public.food_mp_isolated_test_orders add constraint food_mp_isolated_test_orders_payment_status_check check(payment_status in ('pending','paid','failed'));

-- Caller must first independently fetch and validate the provider order.
create function public.food_mp_isolated_record_failure_v1(p_store uuid,p_actor uuid,p_order uuid,p_seller text,p_provider text,p_reference text,p_amount numeric) returns text
language plpgsql security invoker set search_path='' as $$
declare o public.food_mp_isolated_test_orders%rowtype; c public.food_mp_test_oauth_slots%rowtype;
begin
 if not public.food_mp_isolated_auth_lock_v1(p_store,p_actor) then return 'conflict';end if;
 select * into o from public.food_mp_isolated_test_orders where id=p_order and store_id=p_store for update;
 if not found then return 'conflict';end if;
 select * into c from public.food_mp_test_oauth_slots where store_id=p_store for update;
 if not found or c.seller_id is distinct from o.seller_id or c.generation is distinct from o.generation or c.token_expires_at is null or c.token_expires_at<=now()
  or not exists(select 1 from public.food_mp_test_oauth_allowed_stores a where a.store_id=p_store)
  or o.seller_id is distinct from p_seller or o.provider_order_id is null or o.provider_order_id is distinct from p_provider
  or o.external_reference is distinct from p_reference or o.amount is distinct from p_amount then return 'conflict';end if;
 if o.payment_status='failed' then return 'duplicate';end if;
 if o.payment_status<>'pending' then return 'conflict';end if;
 update public.food_mp_isolated_test_orders set payment_status='failed' where id=p_order and store_id=p_store;
 return 'recorded';
end $$;
revoke all on function public.food_mp_isolated_record_failure_v1(uuid,uuid,uuid,text,text,text,numeric) from public,anon,authenticated;
grant execute on function public.food_mp_isolated_record_failure_v1(uuid,uuid,uuid,text,text,text,numeric) to service_role;
commit;
