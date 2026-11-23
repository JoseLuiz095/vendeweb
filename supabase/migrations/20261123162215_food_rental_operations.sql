-- shared_future: somente equipamentos/reservas do módulo de aluguel food_*.
-- Aditiva: não infere saída/devolução nem modifica preços, sinais ou reservas antigas.
begin;
alter table public.food_rental_reservations
 add column checked_out_at timestamptz,
 add column checked_out_by uuid references auth.users(id),
 add column handover_method text check(handover_method in ('pickup','delivery')),
 add column returned_at timestamptz,
 add column returned_by uuid references auth.users(id),
 add column return_notes text not null default '',
 add constraint food_rental_event_order check(returned_at is null or (checked_out_at is not null and returned_at>=checked_out_at));

create table public.food_rental_events (
 id bigint generated always as identity primary key,
 organization_id uuid not null, store_id uuid not null, offer_id uuid not null,
 reservation_id uuid references public.food_rental_reservations(id),
 actor_id uuid, occurred_at timestamptz not null default clock_timestamp(),
 action text not null, details jsonb not null default '{}',
 foreign key(offer_id,organization_id,store_id) references public.food_rental_assets(offer_id,organization_id,store_id)
);
create index food_rental_events_history_idx on public.food_rental_events(store_id,offer_id,id desc);
alter table public.food_rental_events enable row level security;
revoke all on public.food_rental_events from public,anon,authenticated;
grant select on public.food_rental_events to authenticated;
create policy food_rental_events_read on public.food_rental_events for select to authenticated
 using(food_modules_private.food_modules_access(organization_id,store_id));

-- A mesma trava de ativo usada pelo checkout protege qualquer escrita de reserva.
create function food_modules_private.food_rental_guard() returns trigger
language plpgsql security definer set search_path='' as $$
declare in_maintenance boolean;
begin
 if tg_op='UPDATE' and row(new.offer_id,new.item_id,new.organization_id,new.store_id,new.starts_at,new.ends_at)
   is distinct from row(old.offer_id,old.item_id,old.organization_id,old.store_id,old.starts_at,old.ends_at) then
   raise exception 'Equipamento e período de uma reserva existente são preservados.';
 end if;
 if tg_op='INSERT' or (new.status='reserved' and old.status<>'reserved') then
   select maintenance into strict in_maintenance from public.food_rental_assets where offer_id=new.offer_id for update;
   if in_maintenance then raise exception 'Ativo em manutenção ou indisponível.'; end if;
   if exists(select 1 from public.food_rental_reservations r where r.offer_id=new.offer_id and r.id<>new.id
      and ((r.status='reserved' and r.starts_at<new.ends_at and r.ends_at>new.starts_at)
        or (r.checked_out_at is not null and r.returned_at is null and r.starts_at<new.ends_at and greatest(r.ends_at,clock_timestamp())>new.starts_at))) then
     raise exception 'Ativo já reservado neste período.';
   end if;
 end if;
 return new;
end $$;
create trigger food_rental_guard before insert or update on public.food_rental_reservations
 for each row execute function food_modules_private.food_rental_guard();

-- Histórico inclusive para os comandos legados, cancelamento e expiração.
create function food_modules_private.food_rental_history() returns trigger
language plpgsql security definer set search_path='' as $$
declare action_name text; old_data jsonb; new_data jsonb;
begin
 if tg_table_name='food_rental_assets' then
   old_data:=jsonb_build_object('maintenance',old.maintenance,'notes',old.maintenance_notes);
   new_data:=jsonb_build_object('maintenance',new.maintenance,'notes',new.maintenance_notes);
   action_name:=case when new.maintenance<>old.maintenance then case when new.maintenance then 'maintenance_started' else 'maintenance_finished' end else 'maintenance_notes' end;
 else
   old_data:=to_jsonb(old)-array['organization_id','store_id','offer_id','item_id'];
   new_data:=to_jsonb(new)-array['organization_id','store_id','offer_id','item_id'];
   action_name:=case when new.returned_at is distinct from old.returned_at then 'returned'
     when new.checked_out_at is distinct from old.checked_out_at then 'checked_out'
     when new.status is distinct from old.status then 'status_changed' else 'reservation_updated' end;
 end if;
 if old_data is distinct from new_data then
   insert into public.food_rental_events(organization_id,store_id,offer_id,reservation_id,actor_id,action,details)
   values(new.organization_id,new.store_id,new.offer_id,case when tg_table_name='food_rental_reservations' then (to_jsonb(new)->>'id')::uuid end,
     auth.uid(),action_name,jsonb_build_object('before',old_data,'after',new_data));
 end if;
 return new;
end $$;
create trigger food_rental_asset_history after update on public.food_rental_assets for each row execute function food_modules_private.food_rental_history();
create trigger food_rental_reservation_history after update on public.food_rental_reservations for each row execute function food_modules_private.food_rental_history();

-- Visões invocadoras: o fornecedor não ganha acesso ao cabeçalho financeiro de outra loja.
create view public.food_rental_operation_rows with(security_invoker=true) as
 select r.*,o.name as equipment_name,i.order_id,i.total_cents,p.code as order_code,
   parent.status as billing_status,parent.paid_cents as order_paid_cents
 from public.food_rental_reservations r
 join public.food_module_offers o on o.id=r.offer_id
 join public.food_module_order_items i on i.id=r.item_id
 join public.food_module_order_parts p on p.id=i.part_id
 left join public.food_module_orders parent on parent.id=i.order_id;
create view public.food_rental_asset_rows with(security_invoker=true) as
 select a.*,o.name as equipment_name,o.active from public.food_rental_assets a join public.food_module_offers o on o.id=a.offer_id;
revoke all on public.food_rental_operation_rows,public.food_rental_asset_rows from public,anon,authenticated;
grant select on public.food_rental_operation_rows,public.food_rental_asset_rows to authenticated;

create function public.food_rental_availability_v1(p_store uuid,p_starts timestamptz,p_ends timestamptz) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare org uuid;
begin
 select organization_id into org from public.food_module_stores where store_id=p_store;
 if auth.uid() is null or not coalesce(food_modules_private.food_modules_access(org,p_store),false) then
   raise exception 'Acesso negado.' using errcode='42501';
 end if;
 if p_starts is null or p_ends is null or p_ends<=p_starts then raise exception 'Informe início e término válidos.'; end if;
 return jsonb_build_object('checked_at',now(),'assets',coalesce((
   select jsonb_agg(jsonb_build_object('offer_id',a.offer_id,'equipment_name',o.name,'maintenance',a.maintenance,
     'in_use',exists(select 1 from public.food_rental_reservations u where u.offer_id=a.offer_id and u.checked_out_at is not null and u.returned_at is null),
     'status',case when a.maintenance then 'maintenance'
       when exists(select 1 from public.food_rental_reservations r where r.offer_id=a.offer_id and
         ((r.status='reserved' and r.starts_at<p_ends and r.ends_at>p_starts)
          or (r.checked_out_at is not null and r.returned_at is null and r.starts_at<p_ends and greatest(r.ends_at,now())>p_starts))) then 'reserved'
       else 'available' end,
     'reservation_ids',coalesce((select jsonb_agg(r.id order by r.starts_at) from public.food_rental_reservations r where r.offer_id=a.offer_id
       and ((r.status='reserved' and r.starts_at<p_ends and r.ends_at>p_starts)
         or (r.checked_out_at is not null and r.returned_at is null and r.starts_at<p_ends and greatest(r.ends_at,now())>p_starts))),'[]'::jsonb)) order by o.name,a.offer_id)
   from public.food_rental_assets a join public.food_module_offers o on o.id=a.offer_id
   where a.store_id=p_store and o.active),'[]'::jsonb));
end $$;
revoke all on function public.food_rental_availability_v1(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.food_rental_availability_v1(uuid,timestamptz,timestamptz) to authenticated;

create function public.food_rental_command_v1(p_store uuid,p_action text,p_data jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare org uuid; offer uuid; ord uuid; r public.food_rental_reservations%rowtype; a public.food_rental_assets%rowtype; k text; list jsonb;
begin
 select organization_id into org from public.food_module_stores where store_id=p_store;
 if auth.uid() is null or not coalesce(food_modules_private.food_modules_access(org,p_store,true),false) then
   raise exception 'Acesso negado.' using errcode='42501';
 end if;
 if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'Dados inválidos.'; end if;
 -- Mesma ordem do comando administrativo legado: configuração, pedido, oferta, ativo, reserva.
 perform 1 from public.food_module_settings where store_id=p_store for update;
 if p_action='rental_asset' then
   offer:=(p_data->>'offer_id')::uuid;
 else
   select rr.offer_id,i.order_id into offer,ord from public.food_rental_reservations rr
     join public.food_module_order_items i on i.id=rr.item_id where rr.id=(p_data->>'id')::uuid and rr.store_id=p_store;
   if not found then raise exception 'Reserva indisponível.'; end if;
   perform 1 from public.food_module_orders where id=ord for update;
 end if;
 perform 1 from public.food_module_offers where id=offer and store_id=p_store for update;
 select * into a from public.food_rental_assets where offer_id=offer and store_id=p_store for update;
 if not found then raise exception 'Ativo indisponível.'; end if;
 if p_action='rental_asset' then
   if jsonb_typeof(p_data->'maintenance') is distinct from 'boolean' then raise exception 'Informe a situação da manutenção.'; end if;
   update public.food_rental_assets set maintenance=(p_data->>'maintenance')::boolean,
     maintenance_notes=case when p_data ? 'notes' then left(coalesce(p_data->>'notes',''),2000) else maintenance_notes end where offer_id=offer;
 else
   select * into strict r from public.food_rental_reservations where id=(p_data->>'id')::uuid and store_id=p_store for update;
   if p_action='rental_update' then
     foreach k in array array['assembly_checklist','return_checklist'] loop
       if p_data ? k then
         list:=p_data->k;
         if jsonb_typeof(list) is distinct from 'array' then raise exception 'Checklist inválido.'; end if;
         if jsonb_array_length(list)>50 or exists(select 1 from jsonb_array_elements(list) x
           where jsonb_typeof(x) is distinct from 'object' or jsonb_typeof(x->'label') is distinct from 'string'
             or length(x->>'label') not between 1 and 200 or jsonb_typeof(x->'checked') is distinct from 'boolean') then raise exception 'Checklist inválido.'; end if;
       end if;
     end loop;
     if p_data ? 'deposit_cents' and ((p_data->>'deposit_cents') is null or (p_data->>'deposit_cents')::bigint<0) then raise exception 'Sinal inválido.'; end if;
     if (p_data ? 'deposit_cents' or p_data ? 'deposit_reference') and coalesce((p_data->>'deposit_cents')::bigint,r.deposit_cents)>0
       and length(trim(coalesce(case when p_data ? 'deposit_reference' then p_data->>'deposit_reference' else r.deposit_reference end,'')))=0 then
       raise exception 'Informe a referência do sinal manual.';
     end if;
     update public.food_rental_reservations set
       deposit_cents=case when p_data ? 'deposit_cents' then (p_data->>'deposit_cents')::bigint else deposit_cents end,
       deposit_reference=case when p_data ? 'deposit_reference' then nullif(left(trim(p_data->>'deposit_reference'),200),'') else deposit_reference end,
       contract=case when p_data ? 'contract' then left(coalesce(p_data->>'contract',''),20000) else contract end,
       assembly_checklist=coalesce(p_data->'assembly_checklist',assembly_checklist),return_checklist=coalesce(p_data->'return_checklist',return_checklist)
       where id=r.id;
   elsif p_action='rental_checkout' then
     if r.checked_out_at is not null then return jsonb_build_object('id',r.id,'already_recorded',true); end if;
     if r.status<>'reserved' or a.maintenance then raise exception 'Reserva cancelada, devolvida ou equipamento em manutenção.'; end if;
     if exists(select 1 from public.food_module_orders where id=ord and (status='cancelled' or (status in ('draft','payment_pending') and expires_at<=now()))) then
       raise exception 'Pedido cancelado ou expirado. Revise a reserva antes da saída.';
     end if;
     if coalesce(p_data->>'method','') not in ('pickup','delivery') then raise exception 'Informe retirada ou entrega.'; end if;
     if exists(select 1 from public.food_rental_reservations u where u.offer_id=offer and u.id<>r.id and u.checked_out_at is not null and u.returned_at is null) then
       raise exception 'Equipamento ainda não devolvido em outra reserva.';
     end if;
     if exists(select 1 from public.food_rental_reservations u where u.offer_id=offer and u.id<>r.id and u.status='reserved'
       and u.starts_at<greatest(r.ends_at,clock_timestamp()) and u.ends_at>least(r.starts_at,clock_timestamp())) then
       raise exception 'Saída antecipada ou atrasada conflita com outra reserva.';
     end if;
     perform public.food_rental_command_v1(p_store,'rental_update',jsonb_build_object('id',r.id)||case when p_data ? 'assembly_checklist' then jsonb_build_object('assembly_checklist',p_data->'assembly_checklist') else '{}'::jsonb end);
     update public.food_rental_reservations set checked_out_at=clock_timestamp(),checked_out_by=auth.uid(),handover_method=p_data->>'method' where id=r.id;
   elsif p_action='rental_return' then
     if r.returned_at is not null then return jsonb_build_object('id',r.id,'already_recorded',true); end if;
     if r.checked_out_at is null then raise exception 'Registre a saída antes da devolução.'; end if;
     if length(trim(coalesce(p_data->>'notes','')))=0 then raise exception 'Informe as condições na devolução.'; end if;
     if p_data ? 'maintenance' and jsonb_typeof(p_data->'maintenance') is distinct from 'boolean' then raise exception 'Manutenção inválida.'; end if;
     perform public.food_rental_command_v1(p_store,'rental_update',jsonb_build_object('id',r.id)||case when p_data ? 'return_checklist' then jsonb_build_object('return_checklist',p_data->'return_checklist') else '{}'::jsonb end);
     update public.food_rental_reservations set returned_at=clock_timestamp(),returned_by=auth.uid(),return_notes=left(trim(p_data->>'notes'),2000),
       status=case when status='cancelled' then status else 'returned' end where id=r.id;
     -- A devolução nunca conclui uma manutenção preexistente.
     if coalesce((p_data->>'maintenance')::boolean,false) then
       update public.food_rental_assets set maintenance=true,maintenance_notes=left(trim(p_data->>'notes'),2000) where offer_id=offer;
     end if;
   elsif p_action='rental_followup' then
     if length(trim(coalesce(p_data->>'notes','')))=0 then raise exception 'Descreva o acompanhamento.'; end if;
     insert into public.food_rental_events(organization_id,store_id,offer_id,reservation_id,actor_id,action,details)
       values(org,p_store,offer,r.id,auth.uid(),'followup',jsonb_build_object('notes',left(trim(p_data->>'notes'),2000)));
   else raise exception 'Comando de aluguel desconhecido.';
   end if;
 end if;
 return jsonb_build_object('id',coalesce(r.id,offer));
end $$;
revoke all on function public.food_rental_command_v1(uuid,text,jsonb) from public,anon;
grant execute on function public.food_rental_command_v1(uuid,text,jsonb) to authenticated;

-- Clientes antigos também usam a validação nova. Nenhum comando de outro ramo é substituído.
do $patch$
declare source text; marker text := E'\n if p_action=\x27settings\x27 and org is null then';
begin
 source:=pg_get_functiondef('public.food_modules_command(uuid,text,jsonb)'::regprocedure);
 if strpos(source,marker)=0 then raise exception 'food_modules_command divergiu; revise antes de instalar.'; end if;
 source:=replace(source,marker,E'\n if p_action in (\x27rental_asset\x27,\x27rental_update\x27) then return public.food_rental_command_v1(p_store,p_action,p_data); end if;'||marker);
 execute source;
end $patch$;
revoke all on function food_modules_private.food_rental_guard(),food_modules_private.food_rental_history() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
