-- Preserva descrição e vínculo ao salvar orçamento antes da aprovação.
begin;
create or replace function food_modules_private.print_plan(p_store uuid,p_plan jsonb,p_quantity integer) returns jsonb
language plpgsql set search_path='' as $$
declare l jsonb; i public.food_inventory_items%rowtype; q numeric; h numeric; seen uuid[]:='{}';
begin
  if p_plan is null or jsonb_typeof(p_plan)<>'object' or p_quantity is null or p_quantity not between 1 and 100000
    or jsonb_typeof(p_plan->'materials') is distinct from 'array' then raise exception 'Revise o plano da impressão.'; end if;
  if jsonb_array_length(p_plan->'materials')>30 then raise exception 'Use até 30 materiais por impressão.'; end if;
  h:=(p_plan->>'hours')::numeric;
  if h is null or h::text in ('NaN','Infinity','-Infinity') or h<0 or h>1000000 or coalesce(p_plan->>'time_basis','') not in ('piece','batch') then raise exception 'Tempo previsto inválido.'; end if;
  for l in select value from jsonb_array_elements(p_plan->'materials') loop
    if coalesce(l->>'basis','') not in ('piece','batch') then raise exception 'Informe se o material é por peça ou por lote.'; end if;
    q:=(l->>'quantity')::numeric;
    -- Material ainda não associado fica como pendência, sem impedir aceitar o orçamento.
    if nullif(l->>'inventory_item_id','') is null then
      perform food_modules_private.print_quantity(q,l->>'unit',l->>'unit');
    else
      select * into i from public.food_inventory_items where id=(l->>'inventory_item_id')::uuid and store_id=p_store;
      if not found or not i.active or i.id=any(seen) then raise exception 'Material repetido, inativo ou de outra loja.'; end if;
      seen:=array_append(seen,i.id);
      perform food_modules_private.print_quantity(q*case when l->>'basis'='piece' then p_quantity else 1 end,l->>'unit',i.unit);
    end if;
  end loop;
  perform food_modules_private.print_check_order(p_store,nullif(p_plan->>'order_id','')::uuid);
  return jsonb_build_object('materials',p_plan->'materials','hours',h,'time_basis',p_plan->>'time_basis',
    'description',left(trim(coalesce(p_plan->>'description','')),300),
    'order_id',nullif(p_plan->>'order_id','')::uuid);
end $$;
revoke all on function food_modules_private.print_plan(uuid,jsonb,integer) from public,anon,authenticated;
commit;
