-- One store WhatsApp, or an explicit public pickup point destination when the store has none.
-- Existing general contacts stay stored for historical compatibility but are not exposed here.
begin;
set local lock_timeout = '5s';
create function public.food_get_receipt_destinations_v2(p_store_id uuid,p_pickup_location_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare v_phone text; v_contacts jsonb; v_point record;
begin
  if not public.food_store_accessible(p_store_id) then
    return jsonb_build_object('mode','unavailable','contacts','[]'::jsonb);
  end if;
  select regexp_replace(coalesce(s.whatsapp,''),'[^0-9]','','g') into v_phone
    from public.food_stores s where s.id=p_store_id;
  if v_phone !~ '^[1-9][0-9]{9,14}$' then v_phone := null; end if;

  if p_pickup_location_id is not null then
    select p.id,p.name into v_point from public.food_pickup_locations p
      join public.food_stock_locations l on l.id=p.stock_location_id and l.store_id=p.store_id and l.active
      where p.store_id=p_store_id and p.id=p_pickup_location_id and p.active and p.is_public;
    if not found then return jsonb_build_object('mode','unavailable','contacts','[]'::jsonb); end if;
    select jsonb_agg(jsonb_build_object('slot',c.slot,'name',v_point.name,'phone',c.phone) order by c.slot)
      into v_contacts from public.food_pickup_point_contacts c
      where c.store_id=p_store_id and c.pickup_location_id=p_pickup_location_id and c.purpose in ('proof','both');
    if v_contacts is not null then return jsonb_build_object('mode','point','contacts',v_contacts); end if;
    if v_phone is not null then
      return jsonb_build_object('mode','general','contacts',jsonb_build_array(jsonb_build_object('slot',1,'name','Loja','phone',v_phone)));
    end if;
    return jsonb_build_object('mode','unassigned','contacts','[]'::jsonb);
  end if;

  if v_phone is not null then
    return jsonb_build_object('mode','general','contacts',jsonb_build_array(jsonb_build_object('slot',1,'name','Loja','phone',v_phone)));
  end if;
  select jsonb_agg(jsonb_build_object('pointId',p.id,'slot',c.slot,'name',p.name,'phone',c.phone) order by p.name,p.id,c.slot)
    into v_contacts from public.food_pickup_locations p
    join public.food_stock_locations l on l.id=p.stock_location_id and l.store_id=p.store_id and l.active
    join public.food_pickup_point_contacts c on c.store_id=p.store_id and c.pickup_location_id=p.id and c.purpose in ('proof','both')
    where p.store_id=p_store_id and p.active and p.is_public;
  return jsonb_build_object('mode','selection','contacts',coalesce(v_contacts,'[]'::jsonb));
end $$;
revoke all on function public.food_get_receipt_destinations_v2(uuid,uuid) from public;
grant execute on function public.food_get_receipt_destinations_v2(uuid,uuid) to anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
