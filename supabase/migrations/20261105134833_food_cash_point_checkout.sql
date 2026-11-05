-- Retirada imediata em dinheiro por link do próprio ponto; pagamento permanece pendente.
begin;
set local lock_timeout = '5s';
do $$
begin
  if to_regclass('public.food_order_receipt_sources') is null
     or to_regprocedure('public.food_create_public_order_with_receipt_v1(jsonb)') is null
     or to_regprocedure('public.food_create_public_order(jsonb)') is null
     or to_regprocedure('public.food_commit_order_inventory(uuid)') is null
     or pg_get_function_result('public.food_create_public_order(jsonb)'::regprocedure) <> 'TABLE(order_id uuid, order_number bigint, order_total numeric)' then
    raise exception 'Revise as dependências de checkout, origem e estoque antes de instalar.';
  end if;
end $$;

create or replace function public.food_create_public_order_with_receipt_v1(payload jsonb)
returns table(order_id uuid,order_number bigint,order_total numeric)
language plpgsql security definer set search_path='' as $$
declare
  v_store uuid := (payload->>'store_id')::uuid;
  v_point uuid := nullif(payload->>'receipt_pickup_location_id','')::uuid;
  v_request uuid := nullif(payload->>'public_request_id','')::uuid;
  v_existing boolean;
  v_inserted integer;
  v_result record;
  v_order public.food_orders%rowtype;
begin
  if v_point is not null then
    perform 1 from public.food_pickup_locations p
      join public.food_stock_locations l on l.id=p.stock_location_id and l.store_id=p.store_id and l.active
      where p.id=v_point and p.store_id=v_store and p.active and p.is_public for share of p,l;
    if not found then raise exception 'O ponto de origem do comprovante está indisponível. Confira o link da loja.' using errcode='22023'; end if;
  end if;
  select exists(select 1 from public.food_orders o where o.store_id=v_store and o.public_request_id=v_request)
    into v_existing;
  for v_result in select * from public.food_create_public_order(payload-'receipt_pickup_location_id') loop
    insert into public.food_order_receipt_sources(order_id,store_id,pickup_location_id)
      select o.id,o.store_id,v_point from public.food_orders o where o.id=v_result.order_id and o.store_id=v_store
      on conflict on constraint food_order_receipt_sources_pkey do nothing;
    get diagnostics v_inserted = row_count;
    if not exists(select 1 from public.food_order_receipt_sources s where s.order_id=v_result.order_id and s.store_id=v_store) then
      raise exception 'Não foi possível validar a origem do pedido';
    end if;

    select * into v_order from public.food_orders o where o.id=v_result.order_id and o.store_id=v_store for update;
    if not v_existing and v_inserted=1 and v_point is not null and v_order.payment_method='cash'
       and v_order.payment_status='pending' and v_order.status='received'
       and v_order.delivery_type='pickup' and v_order.pickup_location_id=v_point then
      if not exists(select 1 from public.food_pickup_locations p
          join public.food_stock_locations l on l.id=p.stock_location_id and l.store_id=p.store_id and l.active
          where p.id=v_point and p.store_id=v_store and l.id=v_order.stock_location_id) then
        raise exception 'O estoque do pedido não corresponde ao ponto de retirada.' using errcode='23514';
      end if;
      -- O trigger de entrega baixa a reserva e reverte toda a transação em caso de falha.
      update public.food_orders set status='delivered',updated_at=now() where id=v_order.id and store_id=v_store;
      insert into public.food_platform_event_log(store_id,kind,action,result,route,metadata)
        values(v_store,'audit','cash_point_pickup_completed','success','/finalizar',
          jsonb_build_object('order_id',v_order.id,'pickup_location_id',v_point));
    end if;
    return query select v_result.order_id::uuid,v_result.order_number::bigint,v_result.order_total::numeric;
  end loop;
end $$;
revoke all on function public.food_create_public_order_with_receipt_v1(jsonb) from public,anon,authenticated;
grant execute on function public.food_create_public_order_with_receipt_v1(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
