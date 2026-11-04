-- Customer click sends the receipt to WhatsApp and marks the Pix order paid.
-- Pickup orders complete in the same transaction, which also commits inventory.
begin;
set local lock_timeout='5s';

do $$
begin
 if to_regprocedure('public.food_declare_order_receipt_v1(uuid,uuid,numeric,integer)') is null
    or to_regprocedure('public.food_commit_order_inventory(uuid)') is null
    or to_regclass('public.food_order_stock_movements') is null
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='food_orders' and column_name='payment_reported_by_customer')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='food_orders' and column_name='payment_receipt_version')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='food_orders' and column_name='pickup_location_id') then
  raise exception 'Instale primeiro a base de comprovantes e estoque do VendeWeb.';
 end if;
end$$;

create or replace function public.food_declare_order_receipt_v1(
 p_store_id uuid,p_order_id uuid,p_amount numeric,p_version integer
) returns jsonb
language plpgsql
security invoker
set search_path=''
as $$
declare
 o public.food_orders%rowtype;
 v_auto_picked_up boolean;
begin
 select * into o
   from public.food_orders
  where id=p_order_id and store_id=p_store_id
  for update;
 if not found then raise exception 'Pedido indisponível.';end if;
 if p_version is distinct from o.payment_receipt_version
    or p_version<>0
    or p_amount is distinct from o.total then
  raise exception 'O pedido foi alterado ou revisado. Solicite orientação à loja.'
    using errcode='40001';
 end if;
 if o.status='cancelled' or o.payment_method<>'pix' or o.total<=0 then
  raise exception 'Este pedido não aceita confirmação de pagamento.';
 end if;
 if o.payment_status='paid' and o.payment_reported_by_customer then
  return jsonb_build_object(
   'ok',true,
   'alreadyPaid',true,
   'autoPickedUp',coalesce(o.delivery_type='pickup' and o.pickup_location_id is not null and o.status in ('delivered','picked_up'),false)
  );
 end if;
 if o.status in ('delivered','picked_up') or o.payment_status<>'pending' then
  raise exception 'Este pedido não aceita confirmação de pagamento.';
 end if;

 v_auto_picked_up:=coalesce(o.delivery_type='pickup' and o.pickup_location_id is not null,false);
 update public.food_orders
    set payment_status='paid',
        payment_reported_by_customer=true,
        payment_reported_at=now(),
        payment_received_at=now(),
        payment_confirmed_by=null,
        status=case when v_auto_picked_up then 'delivered' else o.status end,
        updated_at=now()
  where id=o.id;

 insert into public.food_platform_event_log(store_id,kind,action,result,route,metadata)
 values(o.store_id,'audit','order_receipt_paid_by_customer','success','/pagamento',
   jsonb_build_object('order_id',o.id,'source','whatsapp_receipt_button','auto_picked_up',v_auto_picked_up));

 return jsonb_build_object('ok',true,'alreadyPaid',false,'autoPickedUp',v_auto_picked_up);
end
$$;

revoke all on function public.food_declare_order_receipt_v1(uuid,uuid,numeric,integer) from public,anon,authenticated;
grant execute on function public.food_declare_order_receipt_v1(uuid,uuid,numeric,integer) to service_role;

create or replace function public.food_note_customer_receipt_finance()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
 update public.food_financial_entries
    set notes='Cliente confirmou o pagamento Pix ao abrir o WhatsApp para enviar o comprovante.',
        created_by=null,
        updated_at=now()
  where store_id=new.store_id and order_id=new.id and source='order';
 return new;
end
$$;

commit;
