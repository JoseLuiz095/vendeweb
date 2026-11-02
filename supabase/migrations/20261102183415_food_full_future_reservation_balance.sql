-- Uma encomenda futura compromete sua quantidade integral no ponto escolhido.
-- O físico não muda até a entrega; disponível = físico - reservado pode ser negativo.
-- A verificação de saldo físico na entrega permanece no fluxo existente.
alter table public.food_product_location_stock
  drop constraint if exists food_product_location_stock_check;
alter table public.food_product_location_stock
  drop constraint if exists food_product_location_stock_reserved_nonnegative;
alter table public.food_product_location_stock
  add constraint food_product_location_stock_reserved_nonnegative
  check (stock_reserved_quantity >= 0);

CREATE OR REPLACE FUNCTION public.food_reserve_product_inventory(p_product_id uuid, p_quantity integer, p_allow_future boolean DEFAULT false)
 RETURNS TABLE(reserved_quantity integer, awaiting_restock boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_product public.food_products%rowtype;
  v_available integer;
  v_reserved integer;
  v_location_id uuid;
  v_local_available integer;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception 'Quantidade de estoque inválida.';
  end if;

  select * into v_product
    from public.food_products
   where id = p_product_id
   for update;
  if not found then raise exception 'Produto não encontrado.'; end if;

  if not v_product.track_stock then
    return query select 0, false;
    return;
  end if;

  begin v_location_id := nullif(current_setting('food.order_stock_location',true),'')::uuid; exception when others then raise exception 'Local de estoque inválido.'; end;
  if v_location_id is null then select id into v_location_id from public.food_stock_locations where store_id=v_product.store_id and is_default; end if;
  select greatest(stock_quantity-stock_reserved_quantity,0) into v_local_available from public.food_product_location_stock where product_id=p_product_id and location_id=v_location_id and store_id=v_product.store_id for update;
  if not found then raise exception 'Produto sem saldo no local selecionado.'; end if;
  v_available := v_local_available;
  if v_available >= p_quantity then
    v_reserved := p_quantity;
    update public.food_products
       set stock_reserved_quantity = coalesce(stock_reserved_quantity, 0) + v_reserved,
           stock_status = case when stock_status='unavailable' then 'unavailable' when coalesce(stock_quantity, 0) - coalesce(stock_reserved_quantity, 0) - v_reserved <= 3 then 'low_stock' else 'available' end,
           availability_status = case when availability_status='unavailable' then 'unavailable' when coalesce(stock_quantity, 0) - coalesce(stock_reserved_quantity, 0) - v_reserved <= 0 then 'sold_out' else 'available' end,
           updated_at = now()
     where id = p_product_id;
    return query select v_reserved, false;
    return;
  end if;

  if not p_allow_future then
    raise exception 'Estoque insuficiente para %.', v_product.name;
  end if;

  -- Encomenda futura compromete a quantidade inteira, mesmo sem físico.
  v_reserved := p_quantity;
  update public.food_products
     set stock_reserved_quantity = coalesce(stock_reserved_quantity, 0) + v_reserved,
         stock_status = case when stock_status='unavailable' then 'unavailable' when coalesce(stock_quantity, 0) - coalesce(stock_reserved_quantity, 0) - v_reserved <= 3 then 'low_stock' else 'available' end,
         availability_status = case when availability_status='unavailable' then 'unavailable' when coalesce(stock_quantity, 0) - coalesce(stock_reserved_quantity, 0) - v_reserved <= 0 then 'sold_out' else 'available' end,
         updated_at = now()
   where id = p_product_id;
  return query select v_reserved, true;
end;
$function$;


-- Pedido avulso imediato usa o saldo do ponto escolhido, mesmo quando reservas
-- futuras em outro ponto deixam o agregado global negativo.
CREATE OR REPLACE FUNCTION public.food_create_admin_order_v1(payload jsonb)
 RETURNS TABLE(order_id uuid, order_number bigint, order_total numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_store_id uuid; v_order_id uuid := gen_random_uuid(); v_order_number bigint;
  v_customer_name text; v_customer_phone text; v_delivery_type text; v_source text; v_payment_method text; v_status text;
  v_received boolean := false; v_notes text; v_item jsonb; v_option jsonb; v_product public.food_products%rowtype;
  v_group record; v_option_record record; v_product_id uuid; v_group_id uuid; v_option_id uuid;
  v_quantity integer; v_option_quantity integer; v_choice_count integer; v_unit_price numeric(12,2); v_item_total numeric(12,2);
  v_subtotal numeric(12,2) := 0; v_preparation_extra integer := 0; v_order_item_id uuid;
  v_scheduled_for timestamptz; v_allow_future boolean := false; v_timezone text := 'America/Sao_Paulo';
  v_items_calculated jsonb := '[]'::jsonb; v_options_calculated jsonb;
  v_location_id uuid; v_request_id uuid; v_request_fingerprint text;
begin
  if auth.uid() is null then raise exception 'Sessão autenticada obrigatória.' using errcode='42501'; end if;
  if payload is null or jsonb_typeof(payload) <> 'object' then raise exception 'Pedido avulso inválido.'; end if;
  begin v_store_id := (payload->>'store_id')::uuid; exception when others then raise exception 'Loja inválida.'; end;
  if not exists (select 1 from public.food_store_users su where su.store_id=v_store_id and su.user_id=auth.uid() and su.active and su.role in ('owner','admin','manager')) then raise exception 'Acesso negado para lançar pedidos desta loja.' using errcode='42501'; end if;
  begin v_location_id:=nullif(payload->>'stock_location_id','')::uuid; v_request_id:=nullif(payload->>'admin_request_id','')::uuid;
  exception when others then raise exception 'Identificador do local ou da tentativa inválido.'; end;
  if v_location_id is not null and not exists(select 1 from public.food_stock_locations where id=v_location_id and store_id=v_store_id and active) then raise exception 'Local de estoque indisponível.'; end if;
  if v_request_id is not null then
    v_request_fingerprint:=md5(payload::text);
    perform pg_advisory_xact_lock(hashtextextended(v_store_id::text||v_request_id::text,0));
    if exists(select 1 from public.food_orders where store_id=v_store_id and admin_request_id=v_request_id) then
      if exists(select 1 from public.food_orders where store_id=v_store_id and admin_request_id=v_request_id and admin_request_fingerprint is distinct from v_request_fingerprint) then
        raise exception 'Esta chave já foi usada para uma venda diferente.' using errcode='23505';
      end if;
      return query select o.id,o.order_number,o.total from public.food_orders o where o.store_id=v_store_id and o.admin_request_id=v_request_id;
      return;
    end if;
  end if;
  v_customer_name:=trim(coalesce(payload->>'customer_name','')); v_customer_phone:=nullif(trim(coalesce(payload->>'customer_phone','')),''); v_delivery_type:=coalesce(nullif(trim(payload->>'delivery_type'),''),'pickup'); v_source:=coalesce(nullif(trim(payload->>'source'),''),'counter'); v_payment_method:=coalesce(nullif(trim(payload->>'payment_method'),''),'cash'); v_status:=coalesce(nullif(trim(payload->>'status'),''),'received'); v_notes:=nullif(left(trim(coalesce(payload->>'notes','')),500),'');
  if length(v_customer_name)<2 then raise exception 'Informe o nome do cliente.'; end if;
  if v_delivery_type not in ('delivery','pickup') then raise exception 'Forma de recebimento inválida.'; end if;
  if v_source not in ('counter','whatsapp','phone','ifood','other') then raise exception 'Origem do pedido inválida.'; end if;
  if v_payment_method not in ('confirm','pix','card','cash') then raise exception 'Forma de pagamento inválida.'; end if;
  if v_status not in ('received','confirmed','preparing','ready','out_for_delivery','delivered','picked_up','cancelled') then raise exception 'Status inicial inválido.'; end if;
  begin v_received:=coalesce((payload->>'received')::boolean,false); exception when others then raise exception 'Situação de recebimento inválida.'; end;
  if v_status='cancelled' and v_received then raise exception 'Um pedido cancelado não pode ser marcado como recebido.'; end if;
  if nullif(payload->>'scheduled_for','') is not null then
    begin v_scheduled_for := (payload->>'scheduled_for')::timestamptz; exception when others then raise exception 'Agendamento inválido.'; end;
    select coalesce(nullif(opening_hours->>'timezone',''),'America/Sao_Paulo') into v_timezone from public.food_stores where id=v_store_id;
    if v_scheduled_for <= now() or (v_scheduled_for at time zone v_timezone)::date < ((now() at time zone v_timezone)::date + 1) then raise exception 'O lançamento futuro precisa ser agendado a partir de amanhã.'; end if;
    v_allow_future := true;
  end if;
  if jsonb_typeof(payload->'items')<>'array' or jsonb_array_length(payload->'items')=0 then raise exception 'Selecione ao menos um produto.'; end if;
  if jsonb_array_length(payload->'items')>50 then raise exception 'O pedido excede o limite de itens.'; end if;
  for v_item in select * from jsonb_array_elements(payload->'items') loop
    begin v_product_id:=(v_item->>'product_id')::uuid; v_quantity:=(v_item->>'quantity')::integer; exception when others then raise exception 'Produto ou quantidade inválidos.'; end;
    if v_quantity<1 or v_quantity>99 then raise exception 'Quantidade inválida.'; end if;
    select * into v_product from public.food_products p where p.id=v_product_id and p.store_id=v_store_id and p.active and (v_allow_future or (p.availability_status<>'unavailable' and p.stock_status<>'unavailable' and (case when p.track_stock then exists (select 1 from public.food_product_location_stock ls where ls.store_id=v_store_id and ls.product_id=p.id and ls.location_id=coalesce(v_location_id,(select id from public.food_stock_locations where store_id=v_store_id and is_default)) and ls.stock_quantity-ls.stock_reserved_quantity>=v_quantity) else p.availability_status='available' end))) and exists(select 1 from public.food_categories c where c.id=p.category_id and c.store_id=p.store_id and c.active);
    if v_product.id is null then raise exception 'Um dos produtos não está disponível.'; end if;
    v_unit_price:=coalesce(v_product.promotional_price,v_product.price); v_options_calculated:='[]'::jsonb;
    for v_group in select og.* from public.food_option_groups og join public.food_product_option_groups pog on pog.option_group_id=og.id and pog.store_id=og.store_id where pog.product_id=v_product.id and pog.store_id=v_store_id and og.active order by pog.sort_order,og.sort_order loop
      select count(distinct entry->>'item_id')::integer into v_choice_count from jsonb_array_elements(coalesce(v_item->'options','[]'::jsonb)) entry where entry->>'group_id'=v_group.id::text;
      if v_choice_count<v_group.min_choices then raise exception 'Faltam escolhas obrigatórias em %.',v_group.name; end if;
      if v_choice_count>v_group.max_choices then raise exception 'Quantidade de escolhas excedida em %.',v_group.name; end if;
    end loop;
    for v_option in select * from jsonb_array_elements(coalesce(v_item->'options','[]'::jsonb)) loop
      begin v_group_id:=(v_option->>'group_id')::uuid; v_option_id:=(v_option->>'item_id')::uuid; v_option_quantity:=coalesce((v_option->>'quantity')::integer,1); exception when others then raise exception 'Opção inválida.'; end;
      if v_option_quantity<1 or v_option_quantity>20 then raise exception 'Quantidade da opção inválida.'; end if;
      select og.id group_id,og.name group_name,og.kind,oi.id item_id,oi.name item_name,oi.price_delta into v_option_record from public.food_option_groups og join public.food_product_option_groups pog on pog.option_group_id=og.id and pog.store_id=og.store_id join public.food_option_items oi on oi.group_id=og.id and oi.store_id=og.store_id where pog.product_id=v_product.id and pog.store_id=v_store_id and og.id=v_group_id and oi.id=v_option_id and og.active and oi.active;
      if not found then raise exception 'Uma das opções não está disponível.'; end if;
      if v_option_record.kind<>'addon' and v_option_quantity<>1 then raise exception 'Quantidade inválida para a opção.'; end if;
      if v_option_record.kind='removal' and v_option_record.price_delta<>0 then raise exception 'Remoção com preço inválido.'; end if;
      if exists(select 1 from jsonb_array_elements(v_options_calculated) selected where selected->>'item_id'=v_option_record.item_id::text) then raise exception 'Opção duplicada.'; end if;
      v_unit_price:=v_unit_price+v_option_record.price_delta*v_option_quantity;
      v_options_calculated:=v_options_calculated||jsonb_build_array(jsonb_build_object('group_id',v_option_record.group_id,'group_name',v_option_record.group_name,'kind',v_option_record.kind,'item_id',v_option_record.item_id,'item_name',v_option_record.item_name,'price_delta',v_option_record.price_delta,'quantity',v_option_quantity));
    end loop;
    if v_unit_price<0 then raise exception 'Preço final inválido.'; end if;
    v_item_total:=round(v_unit_price*v_quantity,2); v_subtotal:=v_subtotal+v_item_total; v_preparation_extra:=greatest(v_preparation_extra,coalesce(v_product.preparation_time_minutes,0));
    v_items_calculated:=v_items_calculated||jsonb_build_array(jsonb_build_object('product_id',v_product.id,'product_name',v_product.name,'quantity',v_quantity,'unit_price',round(v_unit_price,2),'options',v_options_calculated,'item_total',v_item_total));
  end loop;
  v_subtotal:=round(v_subtotal,2);
  insert into public.food_orders(id,store_id,customer_name,customer_phone,delivery_type,desired_date,scheduled_for,notes,payment_method,review_confirmed,subtotal,total,status,payment_status,payment_received_at,payment_confirmed_by,preparation_estimate_minutes,source,stock_location_id,admin_request_id,admin_request_fingerprint)
  values(v_order_id,v_store_id,v_customer_name,v_customer_phone,v_delivery_type,coalesce((v_scheduled_for at time zone v_timezone)::date,current_date),v_scheduled_for,v_notes,v_payment_method,true,v_subtotal,v_subtotal,v_status,case when v_received then 'paid' else 'pending' end,case when v_received then now() else null end,case when v_received then auth.uid() else null end,v_preparation_extra,v_source,v_location_id,v_request_id,v_request_fingerprint) returning food_orders.order_number into v_order_number;
  for v_item in select * from jsonb_array_elements(v_items_calculated) loop
    insert into public.food_order_items(order_id,product_id,product_name,quantity,unit_price,variant_name,variant_price_delta,addons,item_total) values(v_order_id,(v_item->>'product_id')::uuid,v_item->>'product_name',(v_item->>'quantity')::integer,(v_item->>'unit_price')::numeric,null,0,coalesce(v_item->'options','[]'::jsonb),(v_item->>'item_total')::numeric) returning id into v_order_item_id;
    for v_option in select * from jsonb_array_elements(coalesce(v_item->'options','[]'::jsonb)) loop
      insert into public.food_order_item_options(order_item_id,option_group_id,option_item_id,group_name,option_name,option_kind,price_delta,quantity) values(v_order_item_id,(v_option->>'group_id')::uuid,(v_option->>'item_id')::uuid,v_option->>'group_name',v_option->>'item_name',v_option->>'kind',(v_option->>'price_delta')::numeric,(v_option->>'quantity')::integer);
    end loop;
  end loop;
  return query select v_order_id,v_order_number,v_subtotal;
end;
$function$;
