-- A retirada automática depende do ponto selecionado, não da origem do link.
begin;
set local lock_timeout = '5s';
do $$
begin
  if to_regclass('public.food_order_receipt_sources') is null
     or to_regclass('public.food_order_stock_movements') is null
     or to_regprocedure('public.food_commit_order_inventory(uuid)') is null
     or to_regprocedure('public.food_declare_order_receipt_v1(uuid,uuid,numeric,integer)') is null then
    raise exception 'Instale primeiro a base de comprovantes, origem e estoque.';
  end if;
end $$;

create or replace function public.food_declare_order_receipt_v1(
  p_store_id uuid,p_order_id uuid,p_amount numeric,p_version integer
) returns jsonb language plpgsql security invoker set search_path = ''
as $$
declare
  o public.food_orders%rowtype;
  v_auto_picked_up boolean;
begin
  select * into o from public.food_orders where id=p_order_id and store_id=p_store_id for update;
  if not found then raise exception 'Pedido indisponível.'; end if;
  if p_version is distinct from o.payment_receipt_version or p_version<>0
     or p_amount is distinct from o.total then
    raise exception 'O pedido foi alterado ou revisado. Solicite orientação à loja.' using errcode='40001';
  end if;
  if o.status='cancelled' or o.payment_method<>'pix' or o.total<=0 then
    raise exception 'Este pedido não aceita confirmação de pagamento.';
  end if;
  v_auto_picked_up:=coalesce(o.delivery_type='pickup' and o.pickup_location_id is not null,false);
  if v_auto_picked_up and not exists (
    select 1 from public.food_pickup_locations p
    join public.food_stock_locations l on l.id=p.stock_location_id and l.store_id=p.store_id
    where p.id=o.pickup_location_id and p.store_id=o.store_id and l.id=o.stock_location_id
  ) then
    raise exception 'O estoque do ponto não corresponde ao pedido. Contate a loja.' using errcode='23514';
  end if;
  if o.payment_status='paid' and o.payment_reported_by_customer then
    return jsonb_build_object('ok',true,'alreadyPaid',true,
      'autoPickedUp',v_auto_picked_up and o.status in ('delivered','picked_up'));
  end if;
  if o.status in ('delivered','picked_up') or o.payment_status<>'pending' then
    raise exception 'Este pedido não aceita confirmação de pagamento.';
  end if;
  update public.food_orders
    set payment_status='paid',payment_reported_by_customer=true,payment_reported_at=now(),
        payment_received_at=now(),payment_confirmed_by=null,
        status=case when v_auto_picked_up then 'delivered' else o.status end,updated_at=now()
    where id=o.id;
  insert into public.food_platform_event_log(store_id,kind,action,result,route,metadata)
    values(o.store_id,'audit','order_receipt_paid_by_customer','success','/pagamento',
      jsonb_build_object('order_id',o.id,'source','whatsapp_receipt_button','auto_picked_up',v_auto_picked_up));
  return jsonb_build_object('ok',true,'alreadyPaid',false,'autoPickedUp',v_auto_picked_up);
end $$;
revoke all on function public.food_declare_order_receipt_v1(uuid,uuid,numeric,integer) from public,anon,authenticated;
grant execute on function public.food_declare_order_receipt_v1(uuid,uuid,numeric,integer) to service_role;
notify pgrst,'reload schema';
commit;
