-- A customer receipt declaration is only a report. It does not confirm cash
-- receipt, finish fulfillment, or consume inventory. Optional immediate pickup
-- runs only in the same transaction as an authenticated AAL2 payment review.
begin;
set local lock_timeout='5s';

do $$begin
 if to_regprocedure('public.food_declare_order_receipt_v1(uuid,uuid,numeric,integer)') is null
    or to_regprocedure('public.food_review_receipt_report_v1(uuid,boolean)') is null
    or to_regprocedure('public.food_commit_order_inventory(uuid)') is null
    or to_regprocedure('public.food_is_store_admin(uuid)') is null
    or to_regprocedure('public.food_is_platform_admin()') is null
    or to_regclass('public.food_order_stock_movements') is null
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='food_orders' and column_name='payment_reported_by_customer')
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='food_pickup_locations' and column_name='auto_pickup_on_receipt') then
  raise exception 'Instale e revise as migrations de comprovantes e estoque antes deste fluxo.';
 end if;
end$$;

-- O cliente só registra o envio. O pedido continua pendente e a reserva do
-- ponto permanece intacta até a conferência bancária pelo administrador.
create or replace function public.food_declare_order_receipt_v1(
 p_store_id uuid,p_order_id uuid,p_amount numeric,p_version integer
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare o public.food_orders%rowtype; enabled boolean;
begin
 select * into o from public.food_orders where id=p_order_id and store_id=p_store_id for update;
 if not found then raise exception 'Pedido indisponível.';end if;
 select receipt_click_marks_paid into enabled from public.food_stores
  where id=o.store_id and active and access_status='online' for share;
 if enabled is distinct from true then raise exception 'O aviso de comprovante ainda não está habilitado nesta loja.';end if;
 if p_version is distinct from o.payment_receipt_version or p_version<>0 or p_amount is distinct from o.total then
  raise exception 'O pedido foi alterado ou revisado. Solicite orientação à loja.' using errcode='40001';
 end if;
 if o.status='cancelled' or o.payment_method<>'pix' or o.total<=0 then
  raise exception 'Este pedido não aceita declaração de comprovante.';
 end if;
 if o.payment_reported_by_customer and o.payment_status='pending' then
  return jsonb_build_object('ok',true,'alreadyReported',true,'autoPickedUp',false);
 end if;
 if o.status in ('delivered','picked_up') or o.payment_status<>'pending' then
  raise exception 'Este pedido não aceita declaração de comprovante.';
 end if;
 update public.food_orders set payment_status='pending',payment_reported_by_customer=true,
  payment_reported_at=now(),payment_received_at=null,payment_confirmed_by=null,updated_at=now()
 where id=o.id;
 insert into public.food_platform_event_log(store_id,kind,action,result,route,metadata)
  values(o.store_id,'audit','order_receipt_declared','success','/pagamento',
    jsonb_build_object('order_id',o.id,'source','customer_declaration','payment_confirmed',false,'auto_picked_up',false));
 return jsonb_build_object('ok',true,'alreadyReported',false,'autoPickedUp',false);
end$$;
revoke all on function public.food_declare_order_receipt_v1(uuid,uuid,numeric,integer) from public,anon,authenticated;
grant execute on function public.food_declare_order_receipt_v1(uuid,uuid,numeric,integer) to service_role;

-- A declaração permanece fora do caixa até revisão. O trigger legado pode
-- tentar marcar qualquer linha associada como recebida; este trigger garante
-- que a linha financeira continue pendente enquanto o aviso estiver aberto.
create or replace function public.food_hold_reported_receipt_in_finance()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_category uuid;v_reported_at timestamptz;
begin
 if new.status='cancelled' then
  update public.food_financial_entries set status='cancelled',updated_at=now()
   where store_id=new.store_id and order_id=new.id and source='order';
  return new;
 end if;
 perform public.food_seed_financial_categories(new.store_id);
 select id into v_category from public.food_financial_categories
  where store_id=new.store_id and name='Vendas' limit 1;
 v_reported_at:=coalesce(new.payment_reported_at,new.created_at,now());
 insert into public.food_financial_entries(
  store_id,direction,source,order_id,category_id,description,amount,occurred_on,
  paid_at,status,payment_method,counterparty,document_type,document_number,notes,created_by,updated_at
 ) values(
  new.store_id,'income','order',new.id,v_category,'Pedido #'||new.order_number,new.total,
  (v_reported_at at time zone 'America/Sao_Paulo')::date,null,'pending',new.payment_method,
  new.customer_name,'none',new.order_number::text,
  'Cliente informou o envio do comprovante; aguardando conferência bancária da loja.',null,now()
 ) on conflict(store_id,order_id) where source='order' and order_id is not null
 do update set category_id=excluded.category_id,description=excluded.description,amount=excluded.amount,
  occurred_on=excluded.occurred_on,paid_at=null,status='pending',payment_method=excluded.payment_method,
  counterparty=excluded.counterparty,document_number=excluded.document_number,notes=excluded.notes,
  created_by=null,updated_at=now();
 return new;
end$$;
revoke all on function public.food_hold_reported_receipt_in_finance() from public,anon,authenticated;
drop trigger if exists zzz_food_orders_reported_receipt_finance on public.food_orders;
create trigger zzz_food_orders_reported_receipt_finance
after insert or update of status,total,payment_status,payment_received_at,payment_method,payment_reported_by_customer
on public.food_orders for each row when(new.payment_reported_by_customer)
execute function public.food_hold_reported_receipt_in_finance();

-- Reclassify any declaration left in the legacy paid state without an
-- administrator. Keep the physical fulfillment history intact for review.
insert into public.food_platform_event_log(store_id,kind,action,result,route,metadata)
 select o.store_id,'audit','order_receipt_legacy_reclassified','success','/admin/pedidos',
   jsonb_build_object('order_id',o.id,'payment_confirmed',false,'physical_status_preserved',o.status)
 from public.food_orders o
 where o.payment_reported_by_customer and o.payment_status='paid' and o.payment_confirmed_by is null;
update public.food_orders
 set payment_status='pending',payment_received_at=null,payment_confirmed_by=null,updated_at=now()
 where payment_reported_by_customer and payment_status='paid' and payment_confirmed_by is null;

-- RLS protege o tenant, mas a antiga permissão de UPDATE da tabela permite
-- que um admin tente alterar payment_status diretamente pelo REST. Mantenha
-- os campos financeiros atrás das RPCs SECURITY DEFINER. Para pedidos Pix
-- criados já recebidos no balcão, exija igualmente um admin da loja com AAL2.
create or replace function public.food_guard_order_payment_truth()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if tg_op='INSERT' then
  if new.payment_method='pix' and new.payment_status='paid' and (
      current_user not in ('postgres','supabase_admin')
      or auth.uid() is null
      or coalesce(auth.jwt()->>'aal','aal1')<>'aal2'
      or not coalesce(public.food_is_store_admin(new.store_id),false)
      or new.payment_confirmed_by is distinct from auth.uid()) then
   raise exception 'Confirme o crédito Pix com MFA pela conta autorizada da loja.' using errcode='42501';
  end if;
  return new;
 end if;
 if (new.payment_status,new.payment_received_at,new.payment_confirmed_by)
    is distinct from (old.payment_status,old.payment_received_at,old.payment_confirmed_by) then
  if current_user not in ('postgres','supabase_admin') then
   raise exception 'Use a confirmação de recebimento autorizada.' using errcode='42501';
  end if;
  if new.payment_status='paid' and new.payment_method='pix' and (
      auth.uid() is null
      or coalesce(auth.jwt()->>'aal','aal1')<>'aal2'
      or not coalesce(public.food_is_store_admin(new.store_id),false)
      or new.payment_confirmed_by is distinct from auth.uid()) then
   raise exception 'Confirme o crédito Pix com MFA pela conta autorizada da loja.' using errcode='42501';
  end if;
 end if;
 return new;
end$$;
revoke all on function public.food_guard_order_payment_truth() from public,anon,authenticated;
drop trigger if exists food_orders_payment_truth_guard on public.food_orders;
create trigger food_orders_payment_truth_guard before insert or update of payment_status,payment_received_at,payment_confirmed_by
 on public.food_orders for each row execute function public.food_guard_order_payment_truth();

-- Pix confirmation and optional immediate pickup share one transaction. The
-- customer declaration never triggers a fulfillment or inventory transition.
create or replace function public.food_review_receipt_report_v1(p_order_id uuid,p_accept boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 o public.food_orders%rowtype;
 v_auto_pickup boolean:=false;
begin
 select * into o from public.food_orders where id=p_order_id for update;
 if not found or auth.uid() is null or not coalesce(public.food_is_store_admin(o.store_id),false) then
  raise exception 'Acesso negado.' using errcode='42501';
 end if;
 if p_accept is null or o.status='cancelled' then raise exception 'Pedido ou decisão inválida.';end if;
 if p_accept and o.payment_method='pix' and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then
  raise exception 'Confirme o segundo fator antes de conferir o crédito Pix.' using errcode='42501';
 end if;
 if not o.payment_reported_by_customer then
  if (p_accept and o.payment_status='paid') or (not p_accept and o.payment_status='pending') then
   return jsonb_build_object('ok',true,'alreadyPaid',p_accept,'autoPickedUp',o.status='picked_up');
  end if;
  raise exception 'Este comprovante já foi revisado.';
 end if;
 if o.payment_status<>'pending' then raise exception 'O pedido não está aguardando conferência bancária.';end if;

 if p_accept then
  if o.source='site' and o.delivery_type='pickup' and o.pickup_location_id is not null and o.scheduled_for is null then
   select coalesce(p.auto_pickup_on_receipt,false) into v_auto_pickup
    from public.food_pickup_locations p
    join public.food_stock_locations l on l.id=p.stock_location_id and l.store_id=p.store_id and l.active
    where p.id=o.pickup_location_id and p.store_id=o.store_id and p.active and p.is_public
      and p.stock_location_id=o.stock_location_id
    for share of p,l;
   v_auto_pickup:=coalesce(v_auto_pickup,false);
  end if;
  if v_auto_pickup then
   -- Locks in product order match inventory commit and avoid completing a
   -- pickup when its reservation belongs to another point or is incomplete.
   perform p.id from public.food_products p
    where p.store_id=o.store_id and p.id in(select i.product_id from public.food_order_items i where i.order_id=o.id)
    order by p.id for update;
   if o.inventory_status in ('released','awaiting_restock')
      or not exists(select 1 from public.food_order_items i where i.order_id=o.id)
      or exists(select 1 from public.food_order_items i
        left join public.food_products p on p.id=i.product_id and p.store_id=o.store_id
        where i.order_id=o.id and (p.id is null or i.quantity<=0
          or (p.track_stock and i.inventory_reserved_quantity is distinct from i.quantity))) then
    v_auto_pickup:=false;
   end if;
   if v_auto_pickup and (
      exists(select 1 from public.food_order_stock_movements m where m.order_id=o.id and m.event_type='sale')
      or exists(select p.id from public.food_products p
        join public.food_order_items i on i.product_id=p.id and i.order_id=o.id
        where p.store_id=o.store_id and p.track_stock
        group by p.id,p.stock_quantity having coalesce(p.stock_quantity,0)<sum(i.quantity))) then
    v_auto_pickup:=false;
   end if;
  end if;
  update public.food_orders set payment_status='paid',payment_reported_by_customer=false,
   payment_receipt_version=payment_receipt_version+1,payment_received_at=now(),
   payment_confirmed_by=auth.uid(),
   status=case when v_auto_pickup then 'picked_up' else status end,updated_at=now()
  where id=o.id;
 else
  update public.food_orders set payment_status='pending',payment_reported_by_customer=false,
   payment_receipt_version=payment_receipt_version+1,payment_received_at=null,
   payment_confirmed_by=null,updated_at=now() where id=o.id;
  update public.food_financial_entries set status='pending',paid_at=null,
   notes='Declaração de comprovante devolvida para A receber pela loja.',updated_at=now()
   where store_id=o.store_id and order_id=o.id and source='order';
 end if;
 insert into public.food_platform_event_log(actor_user_id,store_id,kind,action,result,route,metadata)
  values(auth.uid(),o.store_id,'audit',case when p_accept then 'order_receipt_verified' else 'order_receipt_returned' end,
   'success','/admin/pedidos',jsonb_build_object('order_id',o.id,'auto_picked_up',p_accept and v_auto_pickup));
 return jsonb_build_object('ok',true,'alreadyPaid',false,
  'paymentReceivedAt',case when p_accept then now() else null end,'autoPickedUp',p_accept and v_auto_pickup);
end$$;
revoke all on function public.food_review_receipt_report_v1(uuid,boolean) from public,anon;
grant execute on function public.food_review_receipt_report_v1(uuid,boolean) to authenticated;

-- Manual Pix confirmation without a customer report uses the same MFA rule.
-- If the immediate-pickup rule is enabled, fulfillment and the inventory
-- commit happen in this same transaction as the verified bank credit.
create or replace function public.food_confirm_order_payment_v1(p_order_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_order public.food_orders%rowtype;v_already_paid boolean;v_auto_pickup boolean:=false;v_now timestamptz:=now();
begin
 select * into v_order from public.food_orders where id=p_order_id for update;
 if not found then raise exception 'Pedido não encontrado.';end if;
 if auth.uid() is null or not coalesce(public.food_is_store_admin(v_order.store_id),false) then
  raise exception 'Acesso negado.' using errcode='42501';
 end if;
 if v_order.status='cancelled' then raise exception 'Não é possível confirmar o recebimento de um pedido cancelado.';end if;
 if coalesce(v_order.total,0)<=0 then raise exception 'O pedido não possui valor válido para recebimento.';end if;
 if v_order.payment_method='pix' and coalesce(auth.jwt()->>'aal','aal1')<>'aal2' then
  raise exception 'Confirme o segundo fator antes de confirmar o crédito Pix.' using errcode='42501';
 end if;
 if v_order.payment_reported_by_customer then
  raise exception 'Revise a declaração do comprovante pela fila de conferência.';
 end if;
 v_already_paid:=v_order.payment_status='paid';
 if v_already_paid then
  return jsonb_build_object('ok',true,'alreadyPaid',true,'orderId',v_order.id,
   'paymentReceivedAt',v_order.payment_received_at,'amount',v_order.total,
   'inventoryStatus',v_order.inventory_status,'autoPickedUp',v_order.status='picked_up');
 end if;
 if v_order.payment_method='pix' and v_order.source='site' and v_order.delivery_type='pickup'
    and v_order.pickup_location_id is not null and v_order.scheduled_for is null
    and v_order.status not in ('cancelled','delivered','picked_up') then
  select coalesce(p.auto_pickup_on_receipt,false) into v_auto_pickup
   from public.food_pickup_locations p
   join public.food_stock_locations l on l.id=p.stock_location_id and l.store_id=p.store_id and l.active
   where p.id=v_order.pickup_location_id and p.store_id=v_order.store_id and p.active and p.is_public
     and p.stock_location_id=v_order.stock_location_id
   for share of p,l;
  v_auto_pickup:=coalesce(v_auto_pickup,false);
 end if;
 if v_auto_pickup then
  perform p.id from public.food_products p
   where p.store_id=v_order.store_id and p.id in(select i.product_id from public.food_order_items i where i.order_id=v_order.id)
   order by p.id for update;
  if v_order.inventory_status in ('released','awaiting_restock')
     or not exists(select 1 from public.food_order_items i where i.order_id=v_order.id)
     or exists(select 1 from public.food_order_items i
       left join public.food_products p on p.id=i.product_id and p.store_id=v_order.store_id
       where i.order_id=v_order.id and (p.id is null or i.quantity<=0
         or (p.track_stock and i.inventory_reserved_quantity is distinct from i.quantity))) then
   v_auto_pickup:=false;
  end if;
  if v_auto_pickup and (
     exists(select 1 from public.food_order_stock_movements m where m.order_id=v_order.id and m.event_type='sale')
     or exists(select p.id from public.food_products p
       join public.food_order_items i on i.product_id=p.id and i.order_id=v_order.id
       where p.store_id=v_order.store_id and p.track_stock
       group by p.id,p.stock_quantity having coalesce(p.stock_quantity,0)<sum(i.quantity))) then
   v_auto_pickup:=false;
  end if;
 end if;
 update public.food_orders set payment_status='paid',
  payment_received_at=v_now,
  payment_confirmed_by=auth.uid(),
  status=case when v_auto_pickup then 'picked_up' else status end,updated_at=v_now
 where id=p_order_id returning * into v_order;
 insert into public.food_platform_event_log(actor_user_id,store_id,kind,action,result,route,metadata)
  values(auth.uid(),v_order.store_id,'audit','order_payment_verified','success','/admin/pedidos',
    jsonb_build_object('order_id',v_order.id,'payment_method',v_order.payment_method,'auto_picked_up',v_auto_pickup));
 return jsonb_build_object('ok',true,'alreadyPaid',v_already_paid,'orderId',v_order.id,
  'paymentReceivedAt',v_order.payment_received_at,'amount',v_order.total,'inventoryStatus',v_order.inventory_status,'autoPickedUp',v_auto_pickup);
end$$;
revoke all on function public.food_confirm_order_payment_v1(uuid) from public,anon;
grant execute on function public.food_confirm_order_payment_v1(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
