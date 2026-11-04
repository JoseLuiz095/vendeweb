-- Paid service delivery; no reservations during pending manual Pix.
begin;
-- Fail before changing anything if the blocking RPC dependencies are absent.
do $$ begin
  if to_regprocedure('public.food_fitness_offers_v1(uuid,boolean)') is null or to_regprocedure('public.food_fitness_student_session_admin_list_v1(uuid)') is null then
    raise exception 'Instale e valide o manifesto Fitness de 30/10 antes desta migration.';
  end if;
end $$;
alter table public.food_fitness_offers add column delivery_mode text not null default 'ready' check(delivery_mode in ('ready','personalized'));
alter table public.food_fitness_offers add column delivery_terms text not null default '' check(length(delivery_terms)<=2000);
alter table public.food_fitness_offers add column location_label text not null default '' check(length(location_label)<=500);
alter table public.food_fitness_offers add column modality text not null default 'onsite' check(modality in ('onsite','online'));
alter table public.food_fitness_offers add column arrival_instructions text not null default '' check(length(arrival_instructions)<=1000);
alter table public.food_fitness_offers add column lead_minutes integer not null default 60 check(lead_minutes between 0 and 10080);
alter table public.food_fitness_offer_orders add column snapshot jsonb not null default '{}';
alter table public.food_fitness_offer_orders add column fulfillment_state text not null default 'awaiting_payment' check(fulfillment_state in ('awaiting_payment','booking_pending','scheduled','in_service','review_pending','delivered','cancelled','refunded'));
alter table public.food_fitness_offer_orders add column appointment_id uuid;
alter table public.food_fitness_offer_orders add constraint food_fitness_order_appointment_store_fk foreign key(appointment_id,store_id) references public.food_business_appointments(id,store_id);
create unique index food_fitness_paid_appointment_once on public.food_fitness_offer_orders(appointment_id) where appointment_id is not null;
alter table public.food_fitness_order_notifications drop constraint food_fitness_order_notifications_event_kind_check;
alter table public.food_fitness_order_notifications add constraint food_fitness_order_notifications_event_kind_check check(event_kind in ('paid','refunded','scheduled','delivered'));
create or replace function food_fitness_private.offer_ready(p_offer public.food_fitness_offers)
returns boolean language sql stable security definer set search_path='' as $$
  -- Only the approved digital workout has an automatic paid fulfillment path today.
  -- Appointment and nutrition products stay drafts until paid booking/delivery is implemented.
  select p_offer.published and (p_offer.kind='workout' or (length(trim(p_offer.delivery_terms))>=10 and (p_offer.kind='nutrition_plan' or length(trim(p_offer.location_label))>=3))) and exists (
    select 1 from public.food_stores s join public.food_business_profiles b on b.store_id=s.id
    join public.food_store_subscriptions sub on sub.store_id=s.id
    where s.id=p_offer.store_id and s.active and s.access_status='online'
      and b.primary_segment='fitness' and sub.status in ('trial','active')
  ) and exists (
    select 1 from public.food_service_professionals p join public.food_store_users u
      on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    where p.store_id=p_offer.store_id and p.user_id=p_offer.professional_user_id and p.active
      and ((p_offer.kind in ('workout','assessment','combo') and p.kind='training' and p.council='CREF'
            and food_business_private.module_enabled(p_offer.store_id,'training'))
        or (p_offer.kind in ('nutrition_consult','nutrition_plan') and p.kind='nutrition' and p.council='CRN'
            and food_business_private.module_enabled(p_offer.store_id,'nutrition')))
  ) and (p_offer.workout_id is null or exists (
    select 1 from public.food_fitness_workouts w where w.store_id=p_offer.store_id and w.id=p_offer.workout_id
      and w.status='approved' and w.approved_by=p_offer.professional_user_id
  )) and (p_offer.service_id is null or exists (
    select 1 from public.food_business_services sv where sv.store_id=p_offer.store_id and sv.id=p_offer.service_id
      and sv.active and sv.professional_user_id=p_offer.professional_user_id
      and exists(select 1 from public.food_fitness_service_terms t where t.store_id=sv.store_id and t.service_id=sv.id and t.published_at is not null and t.price_confirmed)
      and food_business_private.module_enabled(p_offer.store_id,'appointments')
      and sv.kind=case when p_offer.kind in ('nutrition_consult','nutrition_plan') then 'nutrition' else 'training' end
  ))
$$;
create or replace function public.food_fitness_confirm_order_v1(p_store uuid,p_order uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.food_fitness_offer_orders%rowtype; offer public.food_fitness_offers%rowtype;
  sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'aal','') <> 'aal2' or sid is null
    or not exists(select 1 from auth.sessions s where s.id=sid and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
    or not exists(select 1 from public.food_store_users u where u.store_id=p_store and u.user_id=auth.uid()
      and u.active and u.role in ('owner','admin')) then raise exception 'FITNESS_ADMIN_MFA_REQUIRED' using errcode='42501'; end if;
  if p_action is null or p_action not in ('confirm','refund') then raise exception 'Ação inválida.' using errcode='22023'; end if;
  select * into v from public.food_fitness_offer_orders where id=p_order and store_id=p_store for update;
  if v.id is null then raise exception 'Pedido não encontrado nesta loja.' using errcode='42501'; end if;
  select * into offer from public.food_fitness_offers where id=v.offer_id and store_id=v.store_id;
  if p_action='confirm' then
    if v.state='paid' then return jsonb_build_object('id',v.id,'state','paid'); end if;
    if v.state<>'pending' or not food_fitness_private.offer_ready(offer) or offer.price_cents<>v.price_cents then
      raise exception 'Pedido ou oferta mudou; revisão manual obrigatória.' using errcode='22023';
    end if;
    update public.food_fitness_offer_orders set state='paid',paid_at=now(),confirmed_by=auth.uid(),fulfillment_state=case when offer.kind in ('assessment','combo','nutrition_consult') then 'booking_pending' when offer.kind='nutrition_plan' or offer.delivery_mode='personalized' then 'review_pending' else 'delivered' end where id=v.id;
    if offer.kind='workout' and offer.delivery_mode='ready' and offer.workout_id is not null then
      if exists(select 1 from public.food_fitness_workout_assignments a where a.store_id=p_store
        and a.workout_id=offer.workout_id and a.client_id=v.client_id and a.purchase_id is null and not a.active) then
        raise exception 'Atribuição manual revogada exige revisão profissional.' using errcode='42501';
      end if;
      insert into public.food_fitness_workout_assignments(store_id,workout_id,client_id,assigned_by,purchase_id)
      values(p_store,offer.workout_id,v.client_id,offer.professional_user_id,v.id)
      on conflict(store_id,workout_id,client_id) do update set active=true,assigned_by=excluded.assigned_by,
        assigned_at=now(),purchase_id=excluded.purchase_id
      where food_fitness_workout_assignments.purchase_id is not null;
    end if;
  else
    if v.state='refunded' then return jsonb_build_object('id',v.id,'state','refunded'); end if;
    if v.state<>'paid' then raise exception 'Somente compra paga pode ser reembolsada.' using errcode='22023'; end if;
    if v.appointment_id is not null and exists(select 1 from public.food_business_appointments a where a.id=v.appointment_id and (a.status='completed' or a.starts_at<=now() and a.status<>'cancelled')) then raise exception 'Atendimento iniciado exige revisão profissional antes do reembolso.' using errcode='22023'; end if;
    if v.appointment_id is not null then update public.food_business_appointments set status='cancelled',updated_at=now() where id=v.appointment_id and store_id=p_store; end if;
    update public.food_fitness_offer_orders set state='refunded',revoked_at=now(),fulfillment_state='refunded' where id=v.id;
    if offer.workout_id is not null and not exists(select 1 from public.food_fitness_offer_orders other
      join public.food_fitness_offers f on f.id=other.offer_id and f.store_id=other.store_id
      where other.store_id=p_store and other.client_id=v.client_id and other.id<>v.id and other.state='paid'
        and f.workout_id=offer.workout_id) then
      update public.food_fitness_workout_assignments set active=false
      where store_id=p_store and workout_id=offer.workout_id and client_id=v.client_id and purchase_id is not null;
    end if;
  end if;
  insert into public.food_business_audit(store_id,actor_id,action,details)
    values(p_store,auth.uid(),'fitness.order_'||p_action,jsonb_build_object('order_id',v.id,'student_user_id',v.student_user_id));
  insert into public.food_fitness_order_notifications(store_id,order_id,student_user_id,event_kind)
    values(p_store,v.id,v.student_user_id,case when p_action='confirm' then 'paid' else 'refunded' end);
  return jsonb_build_object('id',v.id,'state',case when p_action='confirm' then 'paid' else 'refunded' end);
end; $$;

create or replace function public.food_fitness_list_slots(p_store uuid,p_service uuid,p_from date,p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare service_row public.food_business_services%rowtype; terms_row public.food_fitness_service_terms%rowtype; slots jsonb;
begin
  if p_days not between 1 and 30 or p_from is null or p_from<current_date-1 or p_from>current_date+90 then raise exception 'Período de consulta inválido.' using errcode='22023'; end if;
  select * into service_row from public.food_business_services where id=p_service and store_id=p_store and active and kind in ('training','nutrition');
  select * into terms_row from public.food_fitness_service_terms where store_id=p_store and service_id=p_service and price_confirmed and published_at is not null;
  if service_row.id is null or service_row.professional_user_id is null or terms_row.service_id is null or not food_fitness_private.is_fitness(p_store)
    or not food_business_private.module_enabled(p_store,'appointments') or not food_business_private.module_enabled(p_store,service_row.kind) then
    return jsonb_build_object('slots','[]'::jsonb,'cancel_policy',null,'reschedule_policy',null);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('starts_at',x.starts_at,'ends_at',x.ends_at,'professional_id',x.professional_id) order by x.starts_at,x.professional_id),'[]'::jsonb)
  into slots from (
    select distinct w.professional_id, (g.local_start at time zone w.timezone) as starts_at,
      (g.local_start at time zone w.timezone)+make_interval(mins=>service_row.duration_minutes) as ends_at
    from public.food_fitness_windows w
    join public.food_fitness_professionals p on p.store_id=w.store_id and p.user_id=w.professional_id and p.active
    join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    cross join generate_series(0,p_days-1) d(n)
    cross join lateral generate_series((p_from+d.n)+w.starts_local,(p_from+d.n)+w.ends_local-make_interval(mins=>service_row.duration_minutes),make_interval(mins=>w.step_minutes)) g(local_start)
    where w.store_id=p_store and w.professional_id=service_row.professional_user_id and w.active and extract(dow from p_from+d.n)=w.weekday
      and (g.local_start at time zone w.timezone)>now()
      and not exists (select 1 from public.food_fitness_blocks b where b.store_id=w.store_id and b.professional_id=w.professional_id and b.starts_at<(g.local_start at time zone w.timezone)+make_interval(mins=>service_row.duration_minutes+w.buffer_minutes) and b.ends_at>(g.local_start at time zone w.timezone)-make_interval(mins=>w.buffer_minutes))
      and not exists (select 1 from public.food_business_appointments a where a.store_id=w.store_id and a.professional_id=w.professional_id and a.status in ('scheduled','confirmed') and a.starts_at<(g.local_start at time zone w.timezone)+make_interval(mins=>service_row.duration_minutes+w.buffer_minutes) and a.ends_at>(g.local_start at time zone w.timezone)-make_interval(mins=>w.buffer_minutes))
    order by starts_at,professional_id limit 500
  ) x;
  return jsonb_build_object('slots',slots,'cancel_policy',terms_row.cancel_policy,'reschedule_policy',terms_row.reschedule_policy,'cancel_before_minutes',terms_row.cancel_before_minutes,'terms_published_at',terms_row.published_at);
end; $$;

create or replace function food_business_private.guard_fitness_publication() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.published_at is not null and not exists(
    select 1 from public.food_business_services s
      join public.food_service_professionals p on p.store_id=s.store_id and p.user_id=s.professional_user_id and p.active and p.kind=s.kind and p.council=case when s.kind='nutrition' then 'CRN' else 'CREF' end
      join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    where s.store_id=new.store_id and s.id=new.service_id and s.active
  ) then raise exception 'Atribua um profissional com registro CREF antes de publicar.' using errcode='42501'; end if;
  return new;
end; $$;
create or replace function food_fitness_private.guard_appointment()
returns trigger language plpgsql security definer set search_path='' as $$
declare duration_minutes integer; buffer_value integer; matched boolean;
begin
  if not food_fitness_private.is_fitness(new.store_id) or new.status not in ('scheduled','confirmed') then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('food-fitness-slot:'||new.store_id::text||':'||new.professional_id::text,0));
  if new.starts_at<=now() or not food_fitness_private.is_professional(new.store_id,new.professional_id) then raise exception 'Profissional ou horário indisponível.' using errcode='42501'; end if;
  select s.duration_minutes into duration_minutes from public.food_business_services s
    join public.food_fitness_service_terms t on t.store_id=s.store_id and t.service_id=s.id and t.price_confirmed and t.published_at is not null
    where s.id=new.service_id and s.store_id=new.store_id and s.active and s.kind in ('training','nutrition');
  if duration_minutes is null or new.ends_at<>new.starts_at+make_interval(mins=>duration_minutes) then raise exception 'Serviço indisponível ou duração incorreta.' using errcode='22023'; end if;
  select true,w.buffer_minutes into matched,buffer_value from public.food_fitness_windows w
    where w.store_id=new.store_id and w.professional_id=new.professional_id and w.active
      and w.weekday=extract(dow from new.starts_at at time zone w.timezone)
      and (new.starts_at at time zone w.timezone)::time>=w.starts_local
      and (new.ends_at at time zone w.timezone)::time<=w.ends_local
      and (new.starts_at at time zone w.timezone)::date=(new.ends_at at time zone w.timezone)::date
      and mod((extract(epoch from ((new.starts_at at time zone w.timezone)::time-w.starts_local))/60)::integer,w.step_minutes)=0
    order by w.buffer_minutes desc limit 1;
  if not coalesce(matched,false) then raise exception 'Horário fora da disponibilidade publicada.' using errcode='22023'; end if;
  if exists(select 1 from public.food_fitness_blocks b where b.store_id=new.store_id and b.professional_id=new.professional_id and b.starts_at<new.ends_at+make_interval(mins=>buffer_value) and b.ends_at>new.starts_at-make_interval(mins=>buffer_value)) then raise exception 'Horário bloqueado.' using errcode='23P01'; end if;
  if exists(select 1 from public.food_business_appointments a where a.store_id=new.store_id and a.professional_id=new.professional_id and a.id<>new.id and a.status in ('scheduled','confirmed') and a.starts_at<new.ends_at+make_interval(mins=>buffer_value) and a.ends_at>new.starts_at-make_interval(mins=>buffer_value)) then raise exception 'Horário já reservado.' using errcode='23P01'; end if;
  return new;
end; $$;
create or replace function public.food_fitness_publish_service(p_store uuid,p_service uuid,p_cancel_policy text,p_reschedule_policy text,p_cancel_before_minutes integer,p_price_confirmed boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.food_fitness_service_terms%rowtype;
begin
  if not food_fitness_private.can_configure(p_store) then raise exception 'Sem acesso à loja Fitness.' using errcode='42501'; end if;
  if p_price_confirmed is distinct from true or not exists(select 1 from public.food_business_services where id=p_service and store_id=p_store and kind in ('training','nutrition') and active and price_cents is not null) then raise exception 'Confirme o preço e ative o serviço antes de publicar a reserva.' using errcode='22023'; end if;
  insert into public.food_fitness_service_terms(store_id,service_id,cancel_policy,reschedule_policy,cancel_before_minutes,price_confirmed,published_at,published_by)
  values(p_store,p_service,trim(p_cancel_policy),trim(p_reschedule_policy),p_cancel_before_minutes,true,now(),auth.uid())
  on conflict(store_id,service_id) do update set cancel_policy=excluded.cancel_policy,reschedule_policy=excluded.reschedule_policy,cancel_before_minutes=excluded.cancel_before_minutes,price_confirmed=true,published_at=now(),published_by=auth.uid()
  returning * into result;
  return to_jsonb(result);
end; $$;


create function public.food_fitness_offer_delivery_v1(p_store uuid,p_offer uuid,p_mode text,p_terms text,p_location text,p_modality text,p_instructions text,p_lead integer)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not public.food_is_store_admin(p_store) then raise exception 'Admin da loja obrigatório.' using errcode='42501'; end if;
  perform 1 from public.food_fitness_offers where id=p_offer and store_id=p_store for update;
  if not found then raise exception 'Oferta não encontrada.' using errcode='42501'; end if;
  if exists(select 1 from public.food_fitness_offer_orders where offer_id=p_offer and store_id=p_store) then raise exception 'Oferta comprada é imutável. Crie nova versão.' using errcode='22023'; end if;
  update public.food_fitness_offers set delivery_mode=p_mode,delivery_terms=p_terms,location_label=p_location,modality=p_modality,arrival_instructions=p_instructions,lead_minutes=p_lead,published=false where id=p_offer and store_id=p_store;
  insert into public.food_business_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'fitness.delivery_configured',jsonb_build_object('offer_id',p_offer));
  return jsonb_build_object('id',p_offer,'published',false);
end; $$;

create function food_fitness_private.freeze_order_delivery() returns trigger language plpgsql security definer set search_path='' as $$
declare offer public.food_fitness_offers%rowtype;
begin
  select * into offer from public.food_fitness_offers where id=new.offer_id and store_id=new.store_id for update;
  if not food_fitness_private.offer_ready(offer) then raise exception 'Oferta indisponível.' using errcode='22023'; end if;
  new.snapshot:=to_jsonb(offer)||jsonb_build_object('professional',(select jsonb_build_object('name',p.name,'council',p.council,'registration',p.registration) from public.food_service_professionals p where p.store_id=offer.store_id and p.user_id=offer.professional_user_id),'terms',(select to_jsonb(t) from public.food_fitness_service_terms t where t.store_id=offer.store_id and t.service_id=offer.service_id),'duration_minutes',(select duration_minutes from public.food_business_services s where s.store_id=offer.store_id and s.id=offer.service_id));
  return new;
end; $$;
create trigger food_fitness_order_delivery_snapshot before insert on public.food_fitness_offer_orders for each row execute function food_fitness_private.freeze_order_delivery();

create function public.food_fitness_paid_book_v1(p_store uuid,p_order uuid,p_starts timestamptz,p_terms_accepted boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.food_fitness_offer_orders%rowtype; a public.food_business_appointments%rowtype; prof uuid; service uuid; paid_purpose text;
begin
  perform food_fitness_private.require_student_session(p_store);
  select * into o from public.food_fitness_offer_orders where id=p_order and store_id=p_store and student_user_id=auth.uid() for update;
  if o.id is null or o.state<>'paid' or o.snapshot->>'kind' not in ('assessment','combo','nutrition_consult') then raise exception 'Compra paga deste atendimento obrigatória.' using errcode='42501'; end if;
  if o.appointment_id is not null then
    select * into a from public.food_business_appointments where id=o.appointment_id and store_id=p_store;
    if a.status<>'cancelled' then return jsonb_build_object('appointment_id',a.id,'status',a.status,'starts_at',a.starts_at,'ends_at',a.ends_at); end if;
    raise exception 'Reserva cancelada: solicite revisão à loja; não cria nova entrega automaticamente.' using errcode='22023';
  end if;
  prof:=(o.snapshot->>'professional_user_id')::uuid; service:=(o.snapshot->>'service_id')::uuid;
  paid_purpose:=case when o.snapshot->>'kind'='nutrition_consult' then 'nutrition' else 'training' end;
  if not exists(select 1 from public.food_fitness_professional_authorizations au where au.store_id=p_store and au.student_user_id=auth.uid() and au.professional_user_id=prof and au.purpose=paid_purpose and au.active) then raise exception 'Consentimento profissional revogado.' using errcode='42501'; end if;
  if p_terms_accepted is distinct from true or p_starts is null or p_starts<now()+make_interval(mins=>(o.snapshot->>'lead_minutes')::integer) or p_starts>now()+interval '90 days' then raise exception 'Aceite as condições e escolha horário válido.' using errcode='22023'; end if;
  if not exists(select 1 from public.food_business_services where id=service and store_id=p_store and professional_user_id=prof and active and duration_minutes=(o.snapshot->>'duration_minutes')::integer) then raise exception 'Serviço alterado. A loja precisa revisar sua compra.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('food-fitness-slot:'||p_store::text||':'||prof::text,0));
  insert into public.food_business_appointments(store_id,client_id,service_id,professional_id,starts_at,ends_at,status)
    values(p_store,o.client_id,service,prof,p_starts,p_starts+make_interval(mins=>(o.snapshot->>'duration_minutes')::integer),'confirmed') returning * into a;
  insert into public.food_fitness_booking_terms(store_id,appointment_id,cancel_policy,reschedule_policy,cancel_before_minutes)
    values(p_store,a.id,o.snapshot#>>'{terms,cancel_policy}',o.snapshot#>>'{terms,reschedule_policy}',(o.snapshot#>>'{terms,cancel_before_minutes}')::integer);
  update public.food_fitness_offer_orders set appointment_id=a.id,fulfillment_state='scheduled' where id=o.id;
  insert into public.food_fitness_order_notifications(store_id,order_id,student_user_id,event_kind) values(p_store,o.id,o.student_user_id,'scheduled') on conflict(order_id,event_kind) do nothing;
  return jsonb_build_object('appointment_id',a.id,'status',a.status,'starts_at',a.starts_at,'ends_at',a.ends_at);
end; $$;

-- The legacy API remains for services without paid offers; a paid service cannot bypass its order.
alter function public.food_fitness_book(uuid,uuid,timestamptz,uuid,boolean) set schema food_fitness_private;
revoke all on function food_fitness_private.food_fitness_book(uuid,uuid,timestamptz,uuid,boolean) from public,anon,authenticated;
create function public.food_fitness_book(p_store uuid,p_service uuid,p_starts timestamptz,p_professional uuid,p_terms_accepted boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.food_fitness_offers where store_id=p_store and service_id=p_service) then raise exception 'Agende pela compra após a confirmação do pagamento.' using errcode='42501'; end if;
  return food_fitness_private.food_fitness_book(p_store,p_service,p_starts,p_professional,p_terms_accepted);
end; $$;

create function food_fitness_private.guard_paid_appointment() returns trigger language plpgsql security definer set search_path='' as $$
declare o public.food_fitness_offer_orders%rowtype;
begin
  select * into o from public.food_fitness_offer_orders where appointment_id=new.id and store_id=new.store_id;
  if o.id is null then return new; end if;
  if new.status in ('scheduled','confirmed') and (o.state<>'paid' or new.professional_id is distinct from (o.snapshot->>'professional_user_id')::uuid or new.service_id is distinct from (o.snapshot->>'service_id')::uuid) then raise exception 'Pagamento ou profissional diverge da compra.' using errcode='42501'; end if;
  return new;
end; $$;
create trigger food_fitness_paid_appointment_guard before update on public.food_business_appointments for each row execute function food_fitness_private.guard_paid_appointment();

create or replace function public.food_fitness_my_orders_v1(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform food_fitness_private.require_student_session(p_store);
  return coalesce((select jsonb_agg(to_jsonb(o)||jsonb_build_object('appointment',(select jsonb_build_object('id',a.id,'starts_at',a.starts_at,'ends_at',a.ends_at,'status',a.status) from public.food_business_appointments a where a.id=o.appointment_id and a.store_id=o.store_id)) order by o.created_at desc) from public.food_fitness_offer_orders o where o.store_id=p_store and o.student_user_id=auth.uid()),'[]'::jsonb);
end; $$;

create function public.food_fitness_order_cancel_v1(p_store uuid,p_order uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare o public.food_fitness_offer_orders%rowtype;
begin
  perform food_fitness_private.require_student_session(p_store);
  select * into o from public.food_fitness_offer_orders where id=p_order and store_id=p_store and student_user_id=auth.uid() for update;
  if o.id is null then raise exception 'Pedido não encontrado.' using errcode='42501'; end if;
  if o.state='cancelled' then return jsonb_build_object('id',o.id,'state','cancelled'); end if;
  if o.state<>'pending' then raise exception 'Compra paga exige conferência de cancelamento/reembolso pela loja.' using errcode='22023'; end if;
  update public.food_fitness_offer_orders set state='cancelled',fulfillment_state='cancelled' where id=o.id;
  return jsonb_build_object('id',o.id,'state','cancelled');
end; $$;

revoke all on function public.food_fitness_offer_delivery_v1(uuid,uuid,text,text,text,text,text,integer),public.food_fitness_paid_book_v1(uuid,uuid,timestamptz,boolean),public.food_fitness_order_cancel_v1(uuid,uuid),public.food_fitness_book(uuid,uuid,timestamptz,uuid,boolean) from public,anon,authenticated;
grant execute on function public.food_fitness_offer_delivery_v1(uuid,uuid,text,text,text,text,text,integer),public.food_fitness_paid_book_v1(uuid,uuid,timestamptz,boolean),public.food_fitness_order_cancel_v1(uuid,uuid),public.food_fitness_book(uuid,uuid,timestamptz,uuid,boolean) to authenticated;
revoke all on function food_fitness_private.freeze_order_delivery(),food_fitness_private.guard_paid_appointment() from public,anon,authenticated;
create or replace function public.food_fitness_offers_v1(p_store uuid,p_admin boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_admin and not exists(select 1 from public.food_store_users u where u.store_id=p_store and u.user_id=auth.uid()
      and u.active and u.role in ('owner','admin')) then
    raise exception 'Sem permissão para consultar rascunhos.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',o.id,'kind',o.kind,'name',o.name,'description',o.description,'price_cents',o.price_cents,
    'workout_id',o.workout_id,'service_id',o.service_id,'professional_user_id',o.professional_user_id,
    'delivery_mode',o.delivery_mode,'delivery_terms',o.delivery_terms,'location_label',o.location_label,'modality',o.modality,'arrival_instructions',o.arrival_instructions,'lead_minutes',o.lead_minutes,'professional_registration',p.registration,'professional_name',p.name,'professional_council',p.council,'published',o.published
  ) order by o.created_at,o.id)
  from public.food_fitness_offers o
  join public.food_service_professionals p on p.store_id=o.store_id and p.user_id=o.professional_user_id
  where o.store_id=p_store and (p_admin or food_fitness_private.offer_ready(o))),'[]'::jsonb);
end; $$;


notify pgrst, 'reload schema';
commit;
