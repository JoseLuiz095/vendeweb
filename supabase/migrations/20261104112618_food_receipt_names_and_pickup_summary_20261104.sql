begin;
set local lock_timeout = '5s';

-- Return the configured contact name to the customer-facing receipt screen.
create or replace function public.food_get_receipt_destinations_v2(
  p_store_id uuid,
  p_pickup_location_id uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_phone text;
  v_contacts jsonb;
  v_point_id uuid;
  v_slot smallint;
begin
  if not public.food_store_accessible(p_store_id) then
    return jsonb_build_object('mode', 'unavailable', 'contacts', '[]'::jsonb);
  end if;

  select regexp_replace(coalesce(s.whatsapp, ''), '[^0-9]', '', 'g')
    into v_phone
    from public.food_stores s
   where s.id = p_store_id;
  if v_phone !~ '^[1-9][0-9]{9,14}$' then
    v_phone := null;
  end if;

  if p_pickup_location_id is not null then
    select p.id
      into v_point_id
      from public.food_pickup_locations p
      join public.food_stock_locations l
        on l.id = p.stock_location_id
       and l.store_id = p.store_id
       and l.active
     where p.store_id = p_store_id
       and p.id = p_pickup_location_id
       and p.active
       and p.is_public;
    if not found then
      return jsonb_build_object('mode', 'unavailable', 'contacts', '[]'::jsonb);
    end if;

    select jsonb_agg(
             jsonb_build_object('slot', c.slot, 'name', c.name, 'phone', c.phone)
             order by c.slot
           )
      into v_contacts
      from public.food_pickup_point_contacts c
     where c.store_id = p_store_id
       and c.pickup_location_id = p_pickup_location_id
       and c.purpose in ('proof', 'both');
    if v_contacts is not null then
      return jsonb_build_object('mode', 'point', 'contacts', v_contacts);
    end if;

    -- Respect an explicitly mapped store contact for this pickup point.
    select c.contact_slot
      into v_slot
      from public.food_pickup_receipt_contacts c
     where c.store_id = p_store_id
       and c.pickup_location_id = p_pickup_location_id;

    if v_slot is not null then
      select jsonb_agg(
               jsonb_build_object('slot', c.slot, 'name', c.name, 'phone', c.phone)
               order by c.slot
             )
        into v_contacts
        from public.food_receipt_contacts c
       where c.store_id = p_store_id
         and c.slot = v_slot;
      if v_contacts is not null then
        return jsonb_build_object('mode', 'point', 'contacts', v_contacts);
      end if;
    end if;

    -- General receipt contacts are a safe fallback when this point has no
    -- dedicated contact or explicit binding.
    select jsonb_agg(
             jsonb_build_object('slot', c.slot, 'name', c.name, 'phone', c.phone)
             order by c.slot
           )
      into v_contacts
      from public.food_receipt_contacts c
     where c.store_id = p_store_id;
    if v_contacts is not null then
      return jsonb_build_object('mode', 'point', 'contacts', v_contacts);
    end if;

    if v_phone is not null then
      return jsonb_build_object(
        'mode', 'general',
        'contacts', jsonb_build_array(jsonb_build_object('slot', 1, 'name', 'Loja', 'phone', v_phone))
      );
    end if;

    return jsonb_build_object('mode', 'unassigned', 'contacts', '[]'::jsonb);
  end if;

  select jsonb_agg(
           jsonb_build_object('slot', c.slot, 'name', c.name, 'phone', c.phone)
           order by c.slot
         )
    into v_contacts
    from public.food_receipt_contacts c
   where c.store_id = p_store_id;
  if v_contacts is not null then
    return jsonb_build_object('mode', 'general', 'contacts', v_contacts);
  end if;

  if v_phone is not null then
    return jsonb_build_object(
      'mode', 'general',
      'contacts', jsonb_build_array(jsonb_build_object('slot', 1, 'name', 'Loja', 'phone', v_phone))
    );
  end if;

  select jsonb_agg(
           jsonb_build_object(
             'pointId', p.id,
             'slot', c.slot,
             'name', c.name,
             'phone', c.phone
           )
           order by p.name, p.id, c.slot
         )
    into v_contacts
    from public.food_pickup_locations p
    join public.food_stock_locations l
      on l.id = p.stock_location_id
     and l.store_id = p.store_id
     and l.active
    join public.food_pickup_point_contacts c
      on c.store_id = p.store_id
     and c.pickup_location_id = p.id
     and c.purpose in ('proof', 'both')
   where p.store_id = p_store_id
     and p.active
     and p.is_public;

  return jsonb_build_object('mode', 'selection', 'contacts', coalesce(v_contacts, '[]'::jsonb));
end
$function$;

create or replace function public.food_get_pickup_order_summary_v1(
  p_store_id uuid,
  p_from timestamptz,
  p_to timestamptz
) returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_result jsonb;
begin
  if p_store_id is null or p_from is null or p_to is null or p_to <= p_from then
    raise exception 'Informe um período válido para a conferência.'
      using errcode = '22023';
  end if;

  if not coalesce(public.food_is_store_admin(p_store_id), false) then
    raise exception 'Acesso negado.'
      using errcode = '42501';
  end if;

  with order_scope as materialized (
    select o.id, o.order_number, o.pickup_location_id, o.created_at,
           o.status, o.payment_status, o.total
      from public.food_orders o
     where o.store_id = p_store_id
       and o.delivery_type = 'pickup'
       and o.created_at >= p_from
       and o.created_at < p_to
  ),
  item_movements as materialized (
    select oi.id as order_item_id,
           oi.order_id,
           oi.product_id,
           oi.product_name,
           oi.variant_name,
           oi.quantity,
           coalesce(oi.item_total, oi.unit_price * oi.quantity, 0)::numeric as product_value,
           coalesce(sum(
             case m.event_type
               when 'sale' then m.quantity
               when 'return' then -m.quantity
               else 0
             end
           ), 0)::bigint as withdrawn_quantity
      from order_scope o
      join public.food_order_items oi on oi.order_id = o.id
      left join public.food_order_stock_movements m
        on m.order_item_id = oi.id
       and m.order_id = oi.order_id
       and m.store_id = p_store_id
     group by oi.id, oi.order_id, oi.product_id, oi.product_name,
              oi.variant_name, oi.quantity, oi.item_total, oi.unit_price
  ),
  order_totals as (
    select o.id,
           o.order_number,
           o.pickup_location_id,
           o.created_at,
           o.status,
           o.payment_status,
           o.total as order_total,
           coalesce(sum(
             case when o.status <> 'cancelled' then i.product_value else 0 end
           ), 0)::numeric as product_value,
           coalesce(sum(
             case when o.status <> 'cancelled' then i.quantity else 0 end
           ), 0)::bigint as ordered_quantity,
           coalesce(sum(i.withdrawn_quantity), 0)::bigint as withdrawn_quantity
      from order_scope o
      left join item_movements i on i.order_id = o.id
     group by o.id, o.order_number, o.pickup_location_id, o.created_at,
              o.status, o.payment_status, o.total
  ),
  product_totals as (
    select o.pickup_location_id,
           i.product_id,
           i.product_name,
           i.variant_name,
           coalesce(sum(
             case when o.status <> 'cancelled' then i.quantity else 0 end
           ), 0)::bigint as ordered_quantity,
           coalesce(sum(
             case when o.status <> 'cancelled' then i.product_value else 0 end
           ), 0)::numeric as product_value,
           coalesce(sum(i.withdrawn_quantity), 0)::bigint as withdrawn_quantity
      from order_scope o
      join item_movements i on i.order_id = o.id
     group by o.pickup_location_id, i.product_id, i.product_name, i.variant_name
    having coalesce(sum(
             case when o.status <> 'cancelled' then i.quantity else 0 end
           ), 0) <> 0
        or coalesce(sum(i.withdrawn_quantity), 0) <> 0
  ),
  point_totals as (
    select o.pickup_location_id,
           count(*)::bigint as order_count,
           count(*) filter (where o.status = 'cancelled')::bigint as cancelled_order_count,
           count(*) filter (where o.payment_status = 'paid' and o.status <> 'cancelled')::bigint as paid_order_count,
           count(*) filter (where o.payment_status is distinct from 'paid' and o.status <> 'cancelled')::bigint as pending_payment_order_count,
           coalesce(sum(o.product_value), 0)::numeric as product_value,
           coalesce(sum(o.ordered_quantity), 0)::bigint as ordered_quantity,
           coalesce(sum(o.withdrawn_quantity), 0)::bigint as withdrawn_quantity
      from order_totals o
     group by o.pickup_location_id
  ),
  points as (
    select p.id as pickup_location_id, p.name
      from public.food_pickup_locations p
     where p.store_id = p_store_id
    union all
    select null::uuid, 'Ponto não informado'
     where exists (select 1 from order_scope o where o.pickup_location_id is null)
  )
  select jsonb_build_object(
    'points',
    coalesce(jsonb_agg(
      jsonb_build_object(
        'pickupLocationId', p.pickup_location_id,
        'name', p.name,
        'orderCount', coalesce(pt.order_count, 0),
        'paidOrderCount', coalesce(pt.paid_order_count, 0),
        'pendingPaymentOrderCount', coalesce(pt.pending_payment_order_count, 0),
        'cancelledOrderCount', coalesce(pt.cancelled_order_count, 0),
        'productValue', coalesce(pt.product_value, 0),
        'orderedQuantity', coalesce(pt.ordered_quantity, 0),
        'withdrawnQuantity', coalesce(pt.withdrawn_quantity, 0),
        'orders',
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', ot.id,
              'orderNumber', ot.order_number,
              'createdAt', ot.created_at,
              'status', ot.status,
              'paymentStatus', ot.payment_status,
              'orderTotal', ot.order_total,
              'productValue', ot.product_value,
              'orderedQuantity', ot.ordered_quantity,
              'withdrawnQuantity', ot.withdrawn_quantity
            )
            order by ot.created_at desc, ot.order_number desc
          )
            from order_totals ot
           where ot.pickup_location_id is not distinct from p.pickup_location_id
        ), '[]'::jsonb),
        'products',
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'productId', products.product_id,
              'productName', products.product_name,
              'variantName', products.variant_name,
              'orderedQuantity', products.ordered_quantity,
              'withdrawnQuantity', products.withdrawn_quantity,
              'productValue', products.product_value
            )
            order by products.product_name, products.variant_name
          )
            from product_totals products
           where products.pickup_location_id is not distinct from p.pickup_location_id
        ), '[]'::jsonb)
      )
      order by p.name
    ), '[]'::jsonb)
  )
    into v_result
    from points p
    left join point_totals pt
      on pt.pickup_location_id is not distinct from p.pickup_location_id;

  return coalesce(v_result, jsonb_build_object('points', '[]'::jsonb));
end
$function$;

revoke all on function public.food_get_pickup_order_summary_v1(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.food_get_pickup_order_summary_v1(uuid, timestamptz, timestamptz)
  to authenticated;
comment on function public.food_get_pickup_order_summary_v1(uuid, timestamptz, timestamptz)
  is 'Read-only pickup point order and stock withdrawal summary for authorized store administrators.';

commit;
