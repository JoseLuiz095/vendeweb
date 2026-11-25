begin;
-- Reconcile only the known 27/10 + private-notes compatibility baseline.
do $guard$ begin
 if to_regclass('public.food_service_professionals') is not null or to_regclass('public.food_fitness_student_sessions') is not null or to_regclass('public.food_fitness_offers') is not null then raise exception 'Fitness parcialmente instalado: revisão obrigatória'; end if;
 if (select md5(prosrc) from pg_proc where oid=to_regprocedure('food_business_private.public_offers(uuid)')) is distinct from 'c6dde170eb2cf69821763d3fd244b197' then raise exception 'Projeção pública diferente da baseline revisada'; end if;
 if to_regclass('food_fitness_private.workout_exercise_notes') is null or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.food_fitness_save_workout(uuid,uuid,text,text,text,jsonb,text)')) is distinct from '61e9517ea8d7fede6767581aaebc4e59' or (select md5(prosrc) from pg_proc where oid=to_regprocedure('public.food_fitness_list_workouts(uuid)')) is distinct from 'b51e9d6241745a282e165605148a07fb' then raise exception 'Contrato Fitness desconhecido'; end if;
 execute replace(pg_get_functiondef('food_business_private.public_offers(uuid)'::regprocedure),'FUNCTION food_business_private.public_offers(', 'FUNCTION food_business_private.public_offers_before_fitness(');
end $guard$;
revoke all on function food_business_private.public_offers_before_fitness(uuid) from public,anon,authenticated;
-- Source: 20261030114215_service_professional_identity.sql
-- Identidade e atribuição de prestadores de serviços (shared_future).
-- Revisar o histórico efetivo do Supabase compartilhado antes de aplicar.

create table public.food_service_professionals (
  store_id uuid not null references public.food_stores(id),
  user_id uuid not null references auth.users(id),
  name text not null check (length(trim(name)) between 3 and 120),
  kind text not null check (kind in ('training','nutrition','general')),
  council text not null check (council in ('CREF','CRN','OUTRO')),
  registration text not null check (length(trim(registration)) between 3 and 50),
  active boolean not null default true,
  confirmed_by uuid not null references auth.users(id),
  confirmed_at timestamptz not null default now(),
  primary key (store_id,user_id),
  foreign key (store_id,user_id) references public.food_store_users(store_id,user_id),
  constraint food_service_professional_council_kind check (
    (kind='nutrition' and council='CRN') or
    (kind='training' and council='CREF') or
    (kind='general')
  )
);
alter table public.food_service_professionals enable row level security;
revoke all on public.food_service_professionals from public,anon,authenticated;
grant select on public.food_service_professionals to authenticated;
create policy food_service_professionals_read on public.food_service_professionals for select to authenticated
  using (user_id=(select auth.uid()) or food_business_private.can_manage(store_id));

alter table public.food_business_services add column professional_user_id uuid;
alter table public.food_business_services add constraint food_business_service_professional_fk
  foreign key (store_id,professional_user_id) references public.food_service_professionals(store_id,user_id);
create index food_business_service_professional_idx on public.food_business_services(store_id,professional_user_id) where professional_user_id is not null;

-- Somente o proprietário vincula e atesta o registro. A verificação externa do
-- conselho é uma etapa humana; o banco não afirma validação junto ao conselho.
create function public.food_service_professional_upsert(
  p_store uuid,p_user uuid,p_name text,p_kind text,p_council text,p_registration text,p_active boolean default true
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.food_service_professionals%rowtype;
begin
  if auth.uid() is null or not exists(select 1 from public.food_store_users u where u.store_id=p_store and u.user_id=auth.uid() and u.role='owner' and u.active) then
    raise exception 'Somente o proprietário pode confirmar o prestador.' using errcode='42501';
  end if;
  if p_user is null or not exists(select 1 from public.food_store_users u where u.store_id=p_store and u.user_id=p_user and u.active and u.role in ('owner','admin','manager','attendant')) then
    raise exception 'A conta do prestador deve pertencer à mesma loja.' using errcode='42501';
  end if;
  if not p_active and exists(select 1 from public.food_business_appointments a
    where a.store_id=p_store and a.professional_id=p_user and a.status in ('scheduled','confirmed') and a.starts_at>now()) then
    raise exception 'Reatribua ou cancele as consultas futuras antes de desativar.' using errcode='23P01';
  end if;
  if exists(select 1 from public.food_business_services s where s.store_id=p_store and s.professional_user_id=p_user
    and s.active and s.kind in ('nutrition','training') and s.kind is distinct from p_kind) then
    raise exception 'Reatribua os serviços ativos antes de trocar a habilitação.' using errcode='23P01';
  end if;
  insert into public.food_service_professionals(store_id,user_id,name,kind,council,registration,active,confirmed_by,confirmed_at)
  values(p_store,p_user,trim(p_name),p_kind,p_council,trim(p_registration),p_active,auth.uid(),now())
  on conflict(store_id,user_id) do update set name=excluded.name,kind=excluded.kind,council=excluded.council,
    registration=excluded.registration,active=excluded.active,confirmed_by=excluded.confirmed_by,confirmed_at=now()
  returning * into v;
  insert into public.food_business_audit(store_id,actor_id,action,details)
    values(p_store,auth.uid(),'service.professional',jsonb_build_object('user_id',p_user,'active',p_active));
  return jsonb_build_object('user_id',v.user_id,'name',v.name,'kind',v.kind,'council',v.council,'registration',v.registration,'active',v.active);
end; $$;

create function public.food_service_professional_staff(p_store uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.food_store_users u where u.store_id=p_store and u.user_id=auth.uid() and u.role in ('owner','admin') and u.active) then
    raise exception 'Sem acesso à equipe.' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('user_id',u.user_id,'email',a.email,'name',p.name,'kind',p.kind,'council',p.council,'registration',p.registration,'professional_active',p.active) order by a.email),'[]'::jsonb)
    from public.food_store_users u join auth.users a on a.id=u.user_id
    left join public.food_service_professionals p on p.store_id=u.store_id and p.user_id=u.user_id
    where u.store_id=p_store and u.active and u.role in ('owner','admin','manager','attendant'));
end; $$;

create function public.food_service_professional_assign(p_store uuid,p_service uuid,p_user uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare service_kind text; profile_kind text; previous_user uuid;
begin
  if not exists(select 1 from public.food_store_users u where u.store_id=p_store and u.user_id=auth.uid() and u.role in ('owner','admin') and u.active) then
    raise exception 'Sem permissão para atribuir serviços.' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('food-business:'||p_store::text,0));
  select kind,professional_user_id into service_kind,previous_user from public.food_business_services where id=p_service and store_id=p_store for update;
  if service_kind is null then raise exception 'Serviço não encontrado nesta loja.' using errcode='22023'; end if;
  if previous_user is distinct from p_user and exists(select 1 from public.food_business_appointments a
    where a.store_id=p_store and a.service_id=p_service and a.status in ('scheduled','confirmed') and a.starts_at>now()) then
    raise exception 'Reatribua ou cancele as consultas futuras antes de trocar o prestador.' using errcode='23P01';
  end if;
  if p_user is not null then
    select p.kind into profile_kind from public.food_service_professionals p
      join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
      where p.store_id=p_store and p.user_id=p_user and p.active;
    if profile_kind is null or (service_kind in ('nutrition','training') and service_kind<>profile_kind) then
      raise exception 'Prestador ativo e habilitação apropriada são obrigatórios.' using errcode='42501';
    end if;
  end if;
  update public.food_business_services set professional_user_id=p_user,updated_at=now() where id=p_service and store_id=p_store;
  insert into public.food_business_audit(store_id,actor_id,action,details)
    values(p_store,auth.uid(),'service.assign',jsonb_build_object('service_id',p_service,'user_id',p_user));
  return jsonb_build_object('service_id',p_service,'professional_user_id',p_user);
end; $$;

-- A conta profissional vê apenas as próprias atribuições, sem dados de alunos.
create function public.food_service_professional_mine() returns jsonb
language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('store_id',p.store_id,'store_name',st.name,'name',p.name,'kind',p.kind,'council',p.council,'registration',p.registration,
    'services',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'kind',s.kind)),'[]'::jsonb)
      from public.food_business_services s where s.store_id=p.store_id and s.professional_user_id=p.user_id and s.active)) order by st.name),'[]'::jsonb)
  from public.food_service_professionals p
  join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
  join public.food_stores st on st.id=p.store_id and st.active and st.access_status='online'
  where p.user_id=auth.uid() and p.active;
$$;

revoke all on function public.food_service_professional_upsert(uuid,uuid,text,text,text,text,boolean),
  public.food_service_professional_staff(uuid),public.food_service_professional_assign(uuid,uuid,uuid),
  public.food_service_professional_mine() from public,anon;
grant execute on function public.food_service_professional_upsert(uuid,uuid,text,text,text,text,boolean),
  public.food_service_professional_staff(uuid),public.food_service_professional_assign(uuid,uuid,uuid),
  public.food_service_professional_mine() to authenticated;

-- O endpoint público nunca expõe uma oferta profissional anônima ou cujo
-- prestador saiu da loja. A revisão comercial Fitness continua obrigatória.
create or replace function food_business_private.public_offers(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare segment_value text; services jsonb:='[]'; links jsonb:='[]';
begin
  if not exists(select 1 from public.food_stores s where s.id=p_store and s.active and s.archived_at is null and s.approval_status='approved' and s.access_status='online') then
    return jsonb_build_object('services','[]'::jsonb,'links','[]'::jsonb,'primary_segment',null);
  end if;
  select primary_segment into segment_value from public.food_business_profiles where store_id=p_store;
  if food_business_private.module_enabled(p_store,'appointments') then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into services from (
      select s.id,s.name,s.description,s.price_cents,s.duration_minutes,s.kind,
        jsonb_build_object('user_id',p.user_id,'name',p.name,'council',p.council,'registration',p.registration) as professional
      from public.food_business_services s
      join public.food_service_professionals p on p.store_id=s.store_id and p.user_id=s.professional_user_id and p.active
      join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
      where s.store_id=p_store and s.active and (s.kind='general' or food_business_private.module_enabled(p_store,s.kind))
        and (s.kind='general' or s.kind=p.kind)
        and (segment_value is distinct from 'fitness' or exists (
          select 1 from public.food_fitness_service_terms t where t.store_id=s.store_id and t.service_id=s.id and t.price_confirmed and t.published_at is not null))
      order by s.name,s.id limit 100
    ) x;
  end if;
  if food_business_private.module_enabled(p_store,'creator') then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into links from (
      select l.id,l.label,l.url from public.food_creator_links l where l.store_id=p_store and l.active
        and (l.campaign_id is null or exists(select 1 from public.food_creator_campaigns c where c.id=l.campaign_id and c.store_id=l.store_id and c.status='active'
          and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>=now())))
      order by l.label,l.id limit 100
    ) x;
  end if;
  return jsonb_build_object('services',services,'links',links,'primary_segment',segment_value);
end; $$;

-- Atribuir um horário a outro prestador não pode contornar a vitrine nem a agenda.
create function food_business_private.guard_service_professional() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if not food_fitness_private.is_fitness(new.store_id) then return new; end if;
  if new.status in ('scheduled','confirmed') and not exists(
    select 1 from public.food_business_services s
      join public.food_service_professionals p on p.store_id=s.store_id and p.user_id=s.professional_user_id and p.active
      join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    where s.id=new.service_id and s.store_id=new.store_id and s.active and s.professional_user_id=new.professional_id
      and (s.kind='general' or s.kind=p.kind)
  ) then raise exception 'Prestador não atribuído a este serviço.' using errcode='42501'; end if;
  return new;
end; $$;
create trigger food_business_appointment_professional before insert or update of service_id,professional_id,status,starts_at,ends_at
  on public.food_business_appointments for each row execute function food_business_private.guard_service_professional();
revoke all on function food_business_private.guard_service_professional() from public,anon,authenticated;

-- A agenda pública só oferece horários do prestador atribuído ao serviço.
create or replace function public.food_fitness_list_slots(p_store uuid,p_service uuid,p_from date,p_days integer default 7)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare service_row public.food_business_services%rowtype; terms_row public.food_fitness_service_terms%rowtype; slots jsonb;
begin
  if p_days not between 1 and 30 or p_from is null or p_from<current_date-1 or p_from>current_date+90 then raise exception 'Período de consulta inválido.' using errcode='22023'; end if;
  select * into service_row from public.food_business_services where id=p_service and store_id=p_store and active and kind='training';
  select * into terms_row from public.food_fitness_service_terms where store_id=p_store and service_id=p_service and price_confirmed and published_at is not null;
  if service_row.id is null or service_row.professional_user_id is null or terms_row.service_id is null or not food_fitness_private.is_fitness(p_store)
    or not food_business_private.module_enabled(p_store,'appointments') or not food_business_private.module_enabled(p_store,'training') then
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

create function food_business_private.guard_fitness_publication() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.published_at is not null and not exists(
    select 1 from public.food_business_services s
      join public.food_service_professionals p on p.store_id=s.store_id and p.user_id=s.professional_user_id and p.active and p.kind='training' and p.council='CREF'
      join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    where s.store_id=new.store_id and s.id=new.service_id and s.active
  ) then raise exception 'Atribua um profissional com registro CREF antes de publicar.' using errcode='42501'; end if;
  return new;
end; $$;
create trigger food_fitness_terms_professional before insert or update of published_at,service_id,price_confirmed
  on public.food_fitness_service_terms for each row execute function food_business_private.guard_fitness_publication();
revoke all on function food_business_private.guard_fitness_publication() from public,anon,authenticated;


-- Source: 20261030120000_food_fitness_phone_student_sessions.sql
-- shared_future: phone OTP student access and per-store Fitness session control.
-- Does not change global Supabase Auth settings, provider credentials, or other products.

alter table public.food_fitness_students
  add constraint food_fitness_students_identity_client_uk unique(store_id,user_id,client_id);

create table public.food_fitness_student_sessions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  user_id uuid not null references auth.users(id),
  client_id uuid not null,
  auth_session_id uuid not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text check(revoke_reason is null or revoke_reason in ('user_logout','lost_device','security_review','user_request')),
  foreign key(store_id,user_id,client_id) references public.food_fitness_students(store_id,user_id,client_id) on delete cascade
);
create unique index food_fitness_student_one_live_session
  on public.food_fitness_student_sessions(store_id,user_id) where revoked_at is null;
create index food_fitness_student_sessions_lookup
  on public.food_fitness_student_sessions(store_id,client_id,granted_at desc);
alter table public.food_fitness_student_sessions enable row level security;
revoke all on public.food_fitness_student_sessions from public,anon,authenticated,service_role;

create or replace function food_fitness_private.phone_verified(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users where id=p_user_id and phone is not null and phone_confirmed_at is not null)
$$;

create or replace function food_fitness_private.student_session_active(p_store uuid,p_client uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and food_fitness_private.phone_verified(auth.uid())
    and food_business_private.module_enabled(p_store,'training')
    and nullif(auth.jwt()->>'session_id','') is not null
    and exists(
      select 1 from public.food_fitness_student_sessions fs
      join auth.sessions a on a.id=fs.auth_session_id and a.user_id=fs.user_id
      where fs.store_id=p_store and fs.client_id=p_client and fs.user_id=auth.uid()
        and fs.auth_session_id=nullif(auth.jwt()->>'session_id','')::uuid and fs.revoked_at is null
        and (a.not_after is null or a.not_after>now())
    )
$$;

create or replace function public.food_fitness_student_status_v1(p_store uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb; phone_ok boolean;
begin
  if u is null or not food_fitness_private.is_fitness(p_store)
    or not food_business_private.module_enabled(p_store,'training') then
    raise exception 'FITNESS_STUDENT_ACCESS_DENIED' using errcode='42501';
  end if;
  phone_ok:=food_fitness_private.phone_verified(u);
  if not phone_ok then raise exception 'VERIFIED_PHONE_REQUIRED' using errcode='42501'; end if;
  select jsonb_build_object('registered',true,'store_id',s.store_id,'client_id',s.client_id,'name',c.name)
    into result
    from public.food_fitness_students s join public.food_business_clients c on c.id=s.client_id and c.store_id=s.store_id and c.active
    where s.store_id=p_store and s.user_id=u;
  return coalesce(result,jsonb_build_object('registered',false,'store_id',p_store));
end; $$;

create or replace function public.food_fitness_register_student(p_store uuid,p_name text,p_phone text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); phone_value text; cid uuid;
begin
  if uid is null or not food_fitness_private.is_fitness(p_store)
    or not food_business_private.module_enabled(p_store,'clients')
    or not food_business_private.module_enabled(p_store,'training')
    or not food_fitness_private.phone_verified(uid) then
    raise exception 'Cadastro de aluno indisponível. Verifique seu telefone por código.' using errcode='42501';
  end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 120 then
    raise exception 'Informe um nome válido.' using errcode='22023';
  end if;
  select phone into phone_value from auth.users where id=uid and phone_confirmed_at is not null;
  if p_phone is not null and length(trim(p_phone))>0 and trim(p_phone)<>phone_value then
    raise exception 'O telefone do perfil precisa ser o telefone verificado desta conta.' using errcode='22023';
  end if;
  select client_id into cid from public.food_fitness_students where store_id=p_store and user_id=uid;
  if cid is null then
    insert into public.food_business_clients(store_id,name,email,phone)
      values(p_store,trim(p_name),'',phone_value) returning id into cid;
    insert into public.food_fitness_students(store_id,user_id,client_id) values(p_store,uid,cid);
  else
    update public.food_business_clients set name=trim(p_name),email='',phone=phone_value,updated_at=now()
      where id=cid and store_id=p_store and active;
    if not found then raise exception 'Perfil de aluno indisponível.' using errcode='42501'; end if;
  end if;
  return jsonb_build_object('store_id',p_store,'client_id',cid,'professional',false);
end; $$;

create or replace function public.food_fitness_student_session_v1(p_store uuid,p_client uuid,p_action text default 'claim')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
  live_session uuid; previous_revoked boolean;
begin
  if u is null or sid is null or not food_fitness_private.is_fitness(p_store)
    or not food_business_private.module_enabled(p_store,'training')
    or not food_fitness_private.phone_verified(u)
    or not exists(select 1 from auth.sessions where id=sid and user_id=u and (not_after is null or not_after>now()))
    or not exists(select 1 from public.food_fitness_students where store_id=p_store and client_id=p_client and user_id=u) then
    raise exception 'FITNESS_STUDENT_ACCESS_DENIED' using errcode='42501';
  end if;
  if p_action is null or p_action not in ('claim','release','check') then raise exception 'INVALID_STUDENT_SESSION_ACTION' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_store::text||p_client::text,0));
  if p_action='check' then
    if food_fitness_private.student_session_active(p_store,p_client) then
      return jsonb_build_object('authorized',true,'reason',null);
    end if;
    return jsonb_build_object('authorized',false,'reason','SESSION_REVOKED');
  end if;
  if p_action='release' then
    update public.food_fitness_student_sessions set revoked_at=now(),revoke_reason='user_logout'
      where store_id=p_store and client_id=p_client and user_id=u and auth_session_id=sid and revoked_at is null;
    if found then
      insert into public.food_business_audit(store_id,actor_id,action,details)
        values(p_store,u,'fitness.student_session_released',jsonb_build_object('client_id',p_client,'reason','user_logout'));
    end if;
    return jsonb_build_object('authorized',false,'released',true);
  end if;
  select auth_session_id into live_session from public.food_fitness_student_sessions
    where store_id=p_store and user_id=u and revoked_at is null;
  if live_session=sid then return jsonb_build_object('authorized',true,'reason',null); end if;
  if live_session is not null then
    if exists(select 1 from auth.sessions where id=live_session and user_id=u and (not_after is null or not_after>now())) then
      return jsonb_build_object('authorized',false,'reason','SESSION_LIMIT');
    end if;
    update public.food_fitness_student_sessions set revoked_at=now(),revoke_reason='security_review'
      where store_id=p_store and user_id=u and revoked_at is null;
  end if;
  select exists(select 1 from public.food_fitness_student_sessions where store_id=p_store and user_id=u and auth_session_id=sid and revoked_at is not null)
    into previous_revoked;
  if previous_revoked then return jsonb_build_object('authorized',false,'reason','SESSION_REVOKED'); end if;
  insert into public.food_fitness_student_sessions(store_id,user_id,client_id,auth_session_id)
    values(p_store,u,p_client,sid);
  insert into public.food_business_audit(store_id,actor_id,action,details)
    values(p_store,u,'fitness.student_session_claimed',jsonb_build_object('client_id',p_client));
  return jsonb_build_object('authorized',true,'reason',null);
end; $$;

create or replace function public.food_fitness_student_session_admin_v1(p_store uuid,p_client uuid,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare n integer; u uuid; sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2'
    or not food_fitness_private.is_fitness(p_store)
    or not (public.food_is_store_admin(p_store) or food_fitness_private.can_configure(p_store))
    or not exists(select 1 from auth.sessions where id=sid and user_id=auth.uid() and (not_after is null or not_after>now())) then
    raise exception 'FITNESS_ADMIN_MFA_REQUIRED' using errcode='42501';
  end if;
  if p_reason is null or p_reason not in ('lost_device','security_review','user_request') then raise exception 'INVALID_RECOVERY_REASON' using errcode='22023'; end if;
  select user_id into u from public.food_fitness_students where store_id=p_store and client_id=p_client;
  if u is null then raise exception 'FITNESS_STUDENT_NOT_FOUND' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_store::text||p_client::text,0));
  update public.food_fitness_student_sessions set revoked_at=now(),revoke_reason=p_reason
    where store_id=p_store and client_id=p_client and user_id=u and revoked_at is null;
  get diagnostics n=row_count;
  insert into public.food_business_audit(store_id,actor_id,action,details)
    values(p_store,auth.uid(),'fitness.student_session_admin_revoked',
      jsonb_build_object('client_id',p_client,'student_id',u,'reason',p_reason,'revoked_count',n));
  return jsonb_build_object('revoked_count',n,'student_id',u);
end; $$;

create or replace function public.food_fitness_list_workouts(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); cid uuid;
begin
  if u is null or not food_fitness_private.is_fitness(p_store) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if food_fitness_private.can_configure(p_store) then
    return (select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('exercises',(select coalesce(jsonb_agg(to_jsonb(e) order by e.position),'[]'::jsonb) from public.food_fitness_exercises e where e.workout_id=w.id and e.store_id=w.store_id)) order by w.created_at),'[]'::jsonb) from public.food_fitness_workouts w where w.store_id=p_store);
  end if;
  select client_id into cid from public.food_fitness_students where store_id=p_store and user_id=u;
  if cid is null or not food_fitness_private.student_session_active(p_store,cid) then
    raise exception 'FITNESS_STUDENT_SESSION_REQUIRED' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('exercises',(select coalesce(jsonb_agg(to_jsonb(e) order by e.position),'[]'::jsonb) from public.food_fitness_exercises e where e.workout_id=w.id and e.store_id=w.store_id)) order by w.created_at),'[]'::jsonb)
    from public.food_fitness_workouts w join public.food_fitness_workout_assignments a on a.workout_id=w.id and a.store_id=w.store_id and a.active
    where w.store_id=p_store and w.status='approved' and a.client_id=cid);
end; $$;

create or replace function public.food_fitness_list_students(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not food_fitness_private.can_configure(p_store) then raise exception 'Sem acesso aos alunos Fitness.' using errcode='42501'; end if;
  return jsonb_build_object('students',(
    select coalesce(jsonb_agg(jsonb_build_object(
      'client_id',c.id,'name',c.name,
      'session_active',exists(select 1 from public.food_fitness_student_sessions fs
        where fs.store_id=s.store_id and fs.client_id=s.client_id and fs.user_id=s.user_id and fs.revoked_at is null
          and exists(select 1 from auth.sessions a where a.id=fs.auth_session_id and a.user_id=fs.user_id and (a.not_after is null or a.not_after>now())))
    ) order by c.name),'[]'::jsonb)
    from public.food_fitness_students s join public.food_business_clients c on c.id=s.client_id and c.store_id=s.store_id
    where s.store_id=p_store and c.active
  ));
end; $$;

create or replace function public.food_fitness_book(p_store uuid,p_service uuid,p_starts timestamptz,p_professional uuid,p_terms_accepted boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare client uuid; duration_minutes integer; result public.food_business_appointments%rowtype; terms_row public.food_fitness_service_terms%rowtype;
begin
  if auth.uid() is null or p_terms_accepted is distinct from true then raise exception 'Entre na sua conta e aceite as regras antes de reservar.' using errcode='42501'; end if;
  if not food_fitness_private.is_fitness(p_store) or not food_business_private.module_enabled(p_store,'appointments') or not food_business_private.module_enabled(p_store,'training') then raise exception 'Reservas indisponíveis.' using errcode='42501'; end if;
  select s.client_id into client from public.food_fitness_students s join public.food_business_clients c on c.id=s.client_id and c.store_id=s.store_id and c.active where s.store_id=p_store and s.user_id=auth.uid();
  if client is null or not food_fitness_private.student_session_active(p_store,client) then raise exception 'FITNESS_STUDENT_SESSION_REQUIRED' using errcode='42501'; end if;
  select s.duration_minutes into duration_minutes from public.food_business_services s join public.food_fitness_service_terms t on t.store_id=s.store_id and t.service_id=s.id and t.price_confirmed and t.published_at is not null where s.store_id=p_store and s.id=p_service and s.active and s.kind='training';
  select * into terms_row from public.food_fitness_service_terms where store_id=p_store and service_id=p_service and price_confirmed and published_at is not null;
  if duration_minutes is null or p_starts is null or p_starts<=now() or p_starts>now()+interval '90 days' then raise exception 'Serviço ou horário indisponível.' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('food-fitness-slot:'||p_store::text||':'||p_professional::text,0));
  insert into public.food_business_appointments(store_id,client_id,service_id,professional_id,starts_at,ends_at,status)
  values(p_store,client,p_service,p_professional,p_starts,p_starts+make_interval(mins=>duration_minutes),'scheduled') returning * into result;
  insert into public.food_fitness_booking_terms(store_id,appointment_id,cancel_policy,reschedule_policy,cancel_before_minutes)
  values(p_store,result.id,terms_row.cancel_policy,terms_row.reschedule_policy,terms_row.cancel_before_minutes);
  return jsonb_build_object('appointment_id',result.id,'status',result.status,'starts_at',result.starts_at,'ends_at',result.ends_at);
end; $$;

create or replace function public.food_fitness_my_appointments(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=auth.uid(); cid uuid;
begin
  if u is null or not food_fitness_private.is_fitness(p_store) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  select client_id into cid from public.food_fitness_students where store_id=p_store and user_id=u;
  if cid is null or not food_fitness_private.student_session_active(p_store,cid) then raise exception 'FITNESS_STUDENT_SESSION_REQUIRED' using errcode='42501'; end if;
  return jsonb_build_object('appointments',(
    select coalesce(jsonb_agg(to_jsonb(x) order by x.starts_at desc),'[]'::jsonb)
    from (select a.id,a.service_id,a.professional_id,a.starts_at,a.ends_at,a.status,a.created_at,a.updated_at,t.cancel_policy,t.reschedule_policy
      from public.food_business_appointments a join public.food_fitness_booking_terms t on t.store_id=a.store_id and t.appointment_id=a.id
      where a.store_id=p_store and a.client_id=cid order by a.starts_at desc limit 100) x
  ));
end; $$;

create or replace function public.food_fitness_cancel(p_appointment uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.food_business_appointments%rowtype; cutoff integer; admin_action boolean;
begin
  select * into a from public.food_business_appointments where id=p_appointment for update;
  if a.id is null or not food_fitness_private.is_fitness(a.store_id) then raise exception 'Reserva não encontrada.' using errcode='22023'; end if;
  admin_action:=food_fitness_private.can_configure(a.store_id);
  if not admin_action and not exists(select 1 from public.food_fitness_students where store_id=a.store_id and client_id=a.client_id and user_id=auth.uid()) then raise exception 'Reserva de outro aluno.' using errcode='42501'; end if;
  if not admin_action and not food_fitness_private.student_session_active(a.store_id,a.client_id) then raise exception 'FITNESS_STUDENT_SESSION_REQUIRED' using errcode='42501'; end if;
  if a.status not in ('scheduled','confirmed') then raise exception 'Reserva já finalizada.' using errcode='22023'; end if;
  select coalesce(bt.cancel_before_minutes,t.cancel_before_minutes) into cutoff
  from public.food_fitness_service_terms t left join public.food_fitness_booking_terms bt on bt.store_id=a.store_id and bt.appointment_id=a.id
  where t.store_id=a.store_id and t.service_id=a.service_id;
  if not admin_action and a.starts_at<=now()+make_interval(mins=>coalesce(cutoff,0)) then raise exception 'Prazo de cancelamento encerrado. Contate o profissional.' using errcode='22023'; end if;
  update public.food_business_appointments set status='cancelled',updated_at=now() where id=a.id;
  return jsonb_build_object('appointment_id',a.id,'status','cancelled');
end; $$;

create or replace function public.food_fitness_reschedule(p_appointment uuid,p_starts timestamptz,p_professional uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.food_business_appointments%rowtype; cutoff integer; duration_minutes integer; admin_action boolean; result public.food_business_appointments%rowtype;
begin
  select * into a from public.food_business_appointments where id=p_appointment for update;
  if a.id is null or not food_fitness_private.is_fitness(a.store_id) then raise exception 'Reserva não encontrada.' using errcode='22023'; end if;
  admin_action:=food_fitness_private.can_configure(a.store_id);
  if not admin_action and not exists(select 1 from public.food_fitness_students where store_id=a.store_id and client_id=a.client_id and user_id=auth.uid()) then raise exception 'Reserva de outro aluno.' using errcode='42501'; end if;
  if not admin_action and not food_fitness_private.student_session_active(a.store_id,a.client_id) then raise exception 'FITNESS_STUDENT_SESSION_REQUIRED' using errcode='42501'; end if;
  if a.status not in ('scheduled','confirmed') then raise exception 'Reserva já finalizada.' using errcode='22023'; end if;
  select coalesce(bt.cancel_before_minutes,t.cancel_before_minutes),s.duration_minutes into cutoff,duration_minutes
  from public.food_fitness_service_terms t join public.food_business_services s on s.id=t.service_id and s.store_id=t.store_id
  left join public.food_fitness_booking_terms bt on bt.store_id=a.store_id and bt.appointment_id=a.id
  where t.store_id=a.store_id and t.service_id=a.service_id;
  if not admin_action and a.starts_at<=now()+make_interval(mins=>coalesce(cutoff,0)) then raise exception 'Prazo de reagendamento encerrado. Contate o profissional.' using errcode='22023'; end if;
  update public.food_business_appointments set starts_at=p_starts,ends_at=p_starts+make_interval(mins=>duration_minutes),professional_id=p_professional,updated_at=now() where id=a.id returning * into result;
  return jsonb_build_object('appointment_id',result.id,'status',result.status,'starts_at',result.starts_at,'ends_at',result.ends_at);
end; $$;

drop policy food_fitness_events_read on public.food_fitness_appointment_events;
create policy food_fitness_events_read on public.food_fitness_appointment_events for select to authenticated
using (food_fitness_private.can_configure(store_id) or exists (
  select 1 from public.food_business_appointments a join public.food_fitness_students s on s.store_id=a.store_id and s.client_id=a.client_id
  where a.id=appointment_id and a.store_id=food_fitness_appointment_events.store_id and food_fitness_private.student_session_active(s.store_id,s.client_id)
));
drop policy food_fitness_students_read on public.food_fitness_students;
create policy food_fitness_students_read on public.food_fitness_students for select to authenticated
using ((user_id=auth.uid() and food_fitness_private.student_session_active(store_id,client_id)) or food_fitness_private.can_configure(store_id));
drop policy food_fitness_booking_terms_read on public.food_fitness_booking_terms;
create policy food_fitness_booking_terms_read on public.food_fitness_booking_terms for select to authenticated
using (food_fitness_private.can_configure(store_id) or exists (
  select 1 from public.food_business_appointments a where a.id=appointment_id and a.store_id=food_fitness_booking_terms.store_id
    and food_fitness_private.student_session_active(a.store_id,a.client_id)
));
drop policy food_fitness_student_appointments_read on public.food_business_appointments;
create policy food_fitness_student_appointments_read on public.food_business_appointments for select to authenticated
using (food_fitness_private.is_fitness(store_id) and food_fitness_private.student_session_active(store_id,client_id));

drop policy food_fitness_workouts_read on public.food_fitness_workouts;
create policy food_fitness_workouts_read on public.food_fitness_workouts for select to authenticated
using (food_fitness_private.can_configure(store_id) or (status='approved' and exists (
  select 1 from public.food_fitness_workout_assignments a
  where a.store_id=food_fitness_workouts.store_id and a.workout_id=food_fitness_workouts.id and a.active
    and food_fitness_private.student_session_active(a.store_id,a.client_id)
)));
drop policy food_fitness_exercises_read on public.food_fitness_exercises;
create policy food_fitness_exercises_read on public.food_fitness_exercises for select to authenticated
using (food_fitness_private.can_configure(store_id) or exists (
  select 1 from public.food_fitness_workouts w join public.food_fitness_workout_assignments a on a.store_id=w.store_id and a.workout_id=w.id
  where w.id=food_fitness_exercises.workout_id and w.store_id=food_fitness_exercises.store_id
    and w.status='approved' and a.active and food_fitness_private.student_session_active(a.store_id,a.client_id)
));
drop policy food_fitness_assignments_read on public.food_fitness_workout_assignments;
create policy food_fitness_assignments_read on public.food_fitness_workout_assignments for select to authenticated
using (food_fitness_private.can_configure(store_id) or food_fitness_private.student_session_active(store_id,client_id));

revoke all on function food_fitness_private.phone_verified(uuid), food_fitness_private.student_session_active(uuid,uuid) from public,anon;
grant execute on function food_fitness_private.phone_verified(uuid) to service_role;
grant execute on function food_fitness_private.student_session_active(uuid,uuid) to authenticated,service_role;
revoke all on function public.food_fitness_student_status_v1(uuid), public.food_fitness_student_session_v1(uuid,uuid,text), public.food_fitness_student_session_admin_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.food_fitness_student_status_v1(uuid), public.food_fitness_student_session_v1(uuid,uuid,text), public.food_fitness_student_session_admin_v1(uuid,uuid,text) to authenticated;

-- Source: 20261030143000_professional_content_student_reminders.sql
-- shared_future: conteúdo profissional aprovado e rotinas configuráveis pelo aluno.
-- Conteúdo público e lembretes não armazenam prontuário, prescrição, dieta ou metas clínicas.
-- Revisar histórico e diff no Supabase compartilhado antes de aplicar.

create table public.food_professional_publications (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.food_stores(id) on delete cascade,
  professional_user_id uuid not null,
  title text not null check (length(trim(title)) between 3 and 120),
  body text not null check (length(trim(body)) between 3 and 3000),
  category text not null check (category in ('commercial','training','nutrition')),
  channel text not null default 'storefront' check (channel in ('storefront','student_message')),
  recipient_student_user_id uuid,
  status text not null default 'draft' check (status in ('draft','scheduled','published','cancelled')),
  scheduled_at timestamptz,
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  published_at timestamptz,
  cancelled_at timestamptz,
  author_name text not null,
  author_council text not null check (author_council in ('CREF','CRN','OUTRO')),
  author_registration text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (store_id,professional_user_id) references public.food_service_professionals(store_id,user_id),
  unique (id,store_id),
  check ((status='draft' and approved_by is null and approved_at is null and scheduled_at is null and published_at is null)
    or (status='scheduled' and approved_by=professional_user_id and approved_at is not null and scheduled_at is not null and published_at is null)
    or (status='published' and approved_by=professional_user_id and approved_at is not null and scheduled_at is not null and published_at is not null)
    or (status='cancelled' and cancelled_at is not null)),
  check ((channel='storefront' and recipient_student_user_id is null) or (channel='student_message' and recipient_student_user_id is not null))
);
create index food_professional_publications_calendar_idx on public.food_professional_publications(store_id,professional_user_id,scheduled_at desc);
create index food_professional_publications_public_idx on public.food_professional_publications(store_id,published_at desc) where status='published';
alter table public.food_professional_publications enable row level security;
revoke all on public.food_professional_publications from public,anon,authenticated;
grant select on public.food_professional_publications to authenticated;
create policy food_professional_publications_read on public.food_professional_publications for select to authenticated
using (professional_user_id=(select auth.uid()));

create table public.food_fitness_student_reminders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  student_user_id uuid not null,
  kind text not null check (kind in ('workout','appointment','hydration','routine')),
  label text not null check (length(trim(label)) between 2 and 100),
  reminder_time time not null,
  timezone text not null,
  weekdays smallint[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  channel text not null default 'in_app' check (channel in ('in_app','push')),
  status text not null default 'active' check (status in ('active','paused','cancelled')),
  paused_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  foreign key (store_id,student_user_id) references public.food_fitness_students(store_id,user_id),
  unique (id,store_id),
  check (length(timezone) between 1 and 80),
  check ((status='paused' and paused_until is not null) or status<>'paused'),
  check ((status='cancelled' and cancelled_at is not null) or status<>'cancelled')
);
create index food_fitness_student_reminders_due_idx on public.food_fitness_student_reminders(status,reminder_time,store_id) where status<>'cancelled';
alter table public.food_professional_publications add constraint food_professional_publication_recipient_fk
  foreign key(store_id,recipient_student_user_id) references public.food_fitness_students(store_id,user_id);
alter table public.food_fitness_student_reminders enable row level security;
revoke all on public.food_fitness_student_reminders from public,anon,authenticated;
grant select on public.food_fitness_student_reminders to authenticated;
create policy food_fitness_student_reminders_read on public.food_fitness_student_reminders for select to authenticated
using (student_user_id=(select auth.uid()));

create table public.food_fitness_professional_authorizations (
  store_id uuid not null,
  student_user_id uuid not null,
  professional_user_id uuid not null,
  purpose text not null check (purpose in ('training','nutrition')),
  authorized_at timestamptz not null default now(),
  revoked_at timestamptz,
  active boolean not null default true,
  primary key (store_id,student_user_id,professional_user_id,purpose),
  foreign key (store_id,student_user_id) references public.food_fitness_students(store_id,user_id),
  foreign key (store_id,professional_user_id) references public.food_service_professionals(store_id,user_id),
  check ((active and revoked_at is null) or (not active and revoked_at is not null))
);
alter table public.food_fitness_professional_authorizations enable row level security;
revoke all on public.food_fitness_professional_authorizations from public,anon,authenticated;
grant select on public.food_fitness_professional_authorizations to authenticated;
create policy food_fitness_authorizations_read on public.food_fitness_professional_authorizations for select to authenticated
using (student_user_id=(select auth.uid()) or professional_user_id=(select auth.uid()));

-- Consentimento de comunicação é separado da autorização para ler informação clínica.
create table public.food_fitness_student_message_permissions (
  store_id uuid not null,
  student_user_id uuid not null,
  professional_user_id uuid not null,
  enabled boolean not null default true,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key(store_id,student_user_id,professional_user_id),
  foreign key(store_id,student_user_id) references public.food_fitness_students(store_id,user_id),
  foreign key(store_id,professional_user_id) references public.food_service_professionals(store_id,user_id),
  check((enabled and revoked_at is null) or (not enabled and revoked_at is not null))
);
alter table public.food_fitness_student_message_permissions enable row level security;
revoke all on public.food_fitness_student_message_permissions from public,anon,authenticated;
grant select on public.food_fitness_student_message_permissions to authenticated;
create policy food_fitness_message_permissions_read on public.food_fitness_student_message_permissions for select to authenticated
using(student_user_id=(select auth.uid()) or professional_user_id=(select auth.uid()));

create table public.food_professional_message_deliveries (
  id uuid primary key default gen_random_uuid(),
  publication_id uuid not null,
  store_id uuid not null,
  student_user_id uuid not null,
  status text not null default 'sent' check(status in ('sent','seen','cancelled')),
  sent_at timestamptz not null default now(),
  seen_at timestamptz,
  unique(publication_id,student_user_id),
  foreign key(publication_id,store_id) references public.food_professional_publications(id,store_id) on delete cascade,
  foreign key(store_id,student_user_id) references public.food_fitness_students(store_id,user_id)
);
create index food_professional_message_inbox_idx on public.food_professional_message_deliveries(student_user_id,sent_at desc);
alter table public.food_professional_message_deliveries enable row level security;
revoke all on public.food_professional_message_deliveries from public,anon,authenticated;
grant select on public.food_professional_message_deliveries to authenticated;
create policy food_professional_message_deliveries_read on public.food_professional_message_deliveries for select to authenticated
using(student_user_id=(select auth.uid()));

create table public.food_fitness_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  reminder_id uuid not null,
  store_id uuid not null,
  student_user_id uuid not null,
  planned_for timestamptz not null,
  status text not null default 'queued' check (status in ('queued','sending','sent','seen','failed','cancelled')),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  claimed_at timestamptz,
  delivered_at timestamptz,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (reminder_id,store_id) references public.food_fitness_student_reminders(id,store_id) on delete cascade,
  foreign key (store_id,student_user_id) references public.food_fitness_students(store_id,user_id),
  unique (reminder_id,planned_for)
);
create index food_fitness_reminder_delivery_inbox_idx on public.food_fitness_reminder_deliveries(student_user_id,planned_for desc);
alter table public.food_fitness_reminder_deliveries enable row level security;
revoke all on public.food_fitness_reminder_deliveries from public,anon,authenticated;
grant select on public.food_fitness_reminder_deliveries to authenticated;
create policy food_fitness_reminder_deliveries_read on public.food_fitness_reminder_deliveries for select to authenticated
using (student_user_id=(select auth.uid()));

-- Assinaturas de alunos ficam em tabela própria: o push geral de pedidos
-- continua endereçado somente às assinaturas da equipe da loja.
create table public.food_fitness_student_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  user_id uuid not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (store_id,user_id) references public.food_fitness_students(store_id,user_id) on delete cascade,
  unique (store_id,endpoint)
);
create index food_fitness_student_push_active_idx on public.food_fitness_student_push_subscriptions(store_id,user_id,active);
alter table public.food_fitness_student_push_subscriptions enable row level security;
revoke all on public.food_fitness_student_push_subscriptions from public,anon,authenticated;
grant select,insert,update on public.food_fitness_student_push_subscriptions to authenticated;
create policy food_fitness_student_push_select_self on public.food_fitness_student_push_subscriptions for select to authenticated using (user_id=(select auth.uid()));
create policy food_fitness_student_push_insert_self on public.food_fitness_student_push_subscriptions for insert to authenticated with check (user_id=(select auth.uid()) and exists(select 1 from public.food_fitness_students st where st.store_id=food_fitness_student_push_subscriptions.store_id and st.user_id=(select auth.uid())));
create policy food_fitness_student_push_update_self on public.food_fitness_student_push_subscriptions for update to authenticated using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()) and exists(select 1 from public.food_fitness_students st where st.store_id=food_fitness_student_push_subscriptions.store_id and st.user_id=(select auth.uid())));

create function public.food_professional_publication_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active where p.store_id=p_store and p.user_id=auth.uid() and p.active) then
    raise exception 'Acesso negado ao calendário profissional.' using errcode='42501';
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb) from (
    select id,title,body,category,channel,recipient_student_user_id,status,scheduled_at,approved_at,published_at,cancelled_at,author_name,author_council,author_registration,created_at
    from public.food_professional_publications where store_id=p_store and professional_user_id=auth.uid()
    order by created_at desc limit 100
  ) x);
end; $$;

create function public.food_professional_publication_save(p_store uuid,p_id uuid,p_title text,p_body text,p_category text,p_channel text,p_recipient uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.food_service_professionals%rowtype; result public.food_professional_publications%rowtype; target uuid:=coalesce(p_id,gen_random_uuid());
begin
  select p.* into profile from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    where p.store_id=p_store and p.user_id=auth.uid() and p.active for update;
  if profile.user_id is null then raise exception 'Conta profissional ativa nesta loja é obrigatória.' using errcode='42501'; end if;
  if (p_category='training' and (profile.kind<>'training' or profile.council<>'CREF')) or (p_category='nutrition' and (profile.kind<>'nutrition' or profile.council<>'CRN')) or p_category not in ('commercial','training','nutrition') then
    raise exception 'A categoria exige profissional com registro compatível.' using errcode='42501';
  end if;
  if p_channel not in ('storefront','student_message') or length(trim(p_title)) not between 3 and 120 or length(trim(p_body)) not between 3 and 3000
    or (p_channel='storefront' and p_recipient is not null) or (p_channel='student_message' and p_recipient is null) then raise exception 'A publicação precisa de canal e destinatário válidos.' using errcode='22023'; end if;
  if p_channel='student_message' and not exists(select 1 from public.food_fitness_student_message_permissions mp where mp.store_id=p_store and mp.student_user_id=p_recipient and mp.professional_user_id=auth.uid() and mp.enabled) then
    raise exception 'O aluno não autorizou receber mensagens deste profissional.' using errcode='42501';
  end if;
  if p_channel='student_message' and p_category in ('training','nutrition') and not exists(select 1 from public.food_fitness_professional_authorizations a where a.store_id=p_store and a.student_user_id=p_recipient and a.professional_user_id=auth.uid() and a.purpose=p_category and a.active) then
    raise exception 'Conteúdo de treinamento ou nutrição exige autorização clínica correspondente do aluno.' using errcode='42501';
  end if;
  if (p_category='nutrition' and not food_business_private.module_enabled(p_store,'nutrition')) or (p_category='training' and not food_business_private.module_enabled(p_store,'training')) then
    raise exception 'O módulo profissional correspondente não está habilitado nesta loja.' using errcode='42501';
  end if;
  insert into public.food_professional_publications(id,store_id,professional_user_id,title,body,category,channel,recipient_student_user_id,author_name,author_council,author_registration)
  values(target,p_store,auth.uid(),trim(p_title),trim(p_body),p_category,p_channel,p_recipient,profile.name,profile.council,profile.registration)
  on conflict(id) do update set title=excluded.title,body=excluded.body,category=excluded.category,channel=excluded.channel,recipient_student_user_id=excluded.recipient_student_user_id,updated_at=now()
    where food_professional_publications.store_id=p_store and food_professional_publications.professional_user_id=auth.uid() and food_professional_publications.status='draft'
  returning * into result;
  if result.id is null then raise exception 'Somente rascunho próprio pode ser editado.' using errcode='42501'; end if;
  insert into public.food_business_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'professional.publication_saved',jsonb_build_object('publication_id',target,'category',p_category));
  return jsonb_build_object('id',result.id,'status',result.status,'channel',result.channel,'recipient_student_user_id',result.recipient_student_user_id,'author_name',result.author_name,'author_council',result.author_council,'author_registration',result.author_registration);
end; $$;

create function public.food_professional_publication_approve(p_store uuid,p_id uuid,p_scheduled_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.food_professional_publications%rowtype;
begin
  if p_scheduled_at is null or p_scheduled_at<now()+interval '1 minute' then raise exception 'Escolha um horário futuro para programar.' using errcode='22023'; end if;
  update public.food_professional_publications p set status='scheduled',scheduled_at=p_scheduled_at,approved_by=auth.uid(),approved_at=now(),updated_at=now()
    where p.id=p_id and p.store_id=p_store and p.professional_user_id=auth.uid() and p.status='draft'
      and exists(select 1 from public.food_service_professionals sp join public.food_store_users u on u.store_id=sp.store_id and u.user_id=sp.user_id and u.active where sp.store_id=p.store_id and sp.user_id=auth.uid() and sp.active and sp.name=p.author_name and sp.council=p.author_council and sp.registration=p.author_registration)
      and (p.channel='storefront' and p.recipient_student_user_id is null or p.channel='student_message' and exists(select 1 from public.food_fitness_student_message_permissions mp where mp.store_id=p_store and mp.student_user_id=p.recipient_student_user_id and mp.professional_user_id=auth.uid() and mp.enabled))
      and (p.channel='storefront' or p.category not in ('training','nutrition') or exists(select 1 from public.food_fitness_professional_authorizations a where a.store_id=p_store and a.student_user_id=p.recipient_student_user_id and a.professional_user_id=auth.uid() and a.purpose=p.category and a.active))
      and (p.category='commercial' or food_business_private.module_enabled(p_store,p.category))
      and ((p.category='training' and exists(select 1 from public.food_service_professionals sp where sp.store_id=p_store and sp.user_id=auth.uid() and sp.kind='training' and sp.council='CREF'))
        or (p.category='nutrition' and exists(select 1 from public.food_service_professionals sp where sp.store_id=p_store and sp.user_id=auth.uid() and sp.kind='nutrition' and sp.council='CRN')) or p.category='commercial')
    returning p.* into result;
  if result.id is null then raise exception 'Revise o rascunho; somente o profissional responsável pode aprovar e programar.' using errcode='42501'; end if;
  insert into public.food_business_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'professional.publication_approved',jsonb_build_object('publication_id',p_id,'scheduled_at',p_scheduled_at));
  return jsonb_build_object('id',result.id,'status',result.status,'scheduled_at',result.scheduled_at,'approved_by',result.approved_by,'approved_at',result.approved_at,'author_name',result.author_name,'author_council',result.author_council,'author_registration',result.author_registration);
end; $$;

create function public.food_professional_publication_cancel(p_store uuid,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.food_professional_publications%rowtype;
begin
  update public.food_professional_publications p set status='cancelled',cancelled_at=now(),updated_at=now()
    where p.id=p_id and p.store_id=p_store and p.status in ('draft','scheduled') and (p.professional_user_id=auth.uid() or exists(select 1 from public.food_store_users u where u.store_id=p_store and u.user_id=auth.uid() and u.active and u.role in ('owner','admin')))
    returning p.* into result;
  if result.id is null then raise exception 'Publicação não pode mais ser cancelada.' using errcode='42501'; end if;
  insert into public.food_business_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'professional.publication_cancelled',jsonb_build_object('publication_id',p_id));
  return jsonb_build_object('id',result.id,'status',result.status,'cancelled_at',result.cancelled_at);
end; $$;

create function public.food_professional_publication_publish_due()
returns integer language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
  update public.food_professional_publications p set status='cancelled',cancelled_at=now(),updated_at=now()
  where p.status='scheduled' and p.channel='student_message' and p.scheduled_at<=now() and (p.category='commercial' or food_business_private.module_enabled(p.store_id,p.category))
    and (not exists(select 1 from public.food_fitness_student_message_permissions mp where mp.store_id=p.store_id and mp.student_user_id=p.recipient_student_user_id and mp.professional_user_id=p.professional_user_id and mp.enabled)
      or p.category in ('training','nutrition') and not exists(select 1 from public.food_fitness_professional_authorizations a where a.store_id=p.store_id and a.student_user_id=p.recipient_student_user_id and a.professional_user_id=p.professional_user_id and a.purpose=p.category and a.active));
  update public.food_professional_publications p set status='published',published_at=now(),updated_at=now()
  where p.status='scheduled' and p.scheduled_at<=now()
    and exists(select 1 from public.food_service_professionals sp join public.food_store_users u on u.store_id=sp.store_id and u.user_id=sp.user_id and u.active where sp.store_id=p.store_id and sp.user_id=p.professional_user_id and sp.active and sp.name=p.author_name and sp.council=p.author_council and sp.registration=p.author_registration)
    and exists(select 1 from public.food_stores s where s.id=p.store_id and s.active and s.archived_at is null and s.access_status='online')
    and (p.category='commercial' or food_business_private.module_enabled(p.store_id,p.category))
    and (p.channel='storefront' or exists(select 1 from public.food_fitness_student_message_permissions mp where mp.store_id=p.store_id and mp.student_user_id=p.recipient_student_user_id and mp.professional_user_id=p.professional_user_id and mp.enabled)
      and (p.category not in ('training','nutrition') or exists(select 1 from public.food_fitness_professional_authorizations a where a.store_id=p.store_id and a.student_user_id=p.recipient_student_user_id and a.professional_user_id=p.professional_user_id and a.purpose=p.category and a.active)));
  get diagnostics changed=row_count;
  insert into public.food_professional_message_deliveries(publication_id,store_id,student_user_id)
    select p.id,p.store_id,p.recipient_student_user_id from public.food_professional_publications p
    where p.status='published' and p.channel='student_message' and p.published_at>=now()-interval '1 minute'
    on conflict(publication_id,student_user_id) do nothing;
  return changed;
end; $$;

create function public.food_fitness_student_reminders_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then raise exception 'Somente o próprio aluno pode consultar seus lembretes.' using errcode='42501'; end if;
  return jsonb_build_object(
    'reminders',(select coalesce(jsonb_agg(to_jsonb(r) order by r.reminder_time,r.id),'[]'::jsonb) from public.food_fitness_student_reminders r where r.store_id=p_store and r.student_user_id=auth.uid()),
    'inbox',(select coalesce(jsonb_agg(to_jsonb(x) order by x.planned_for desc),'[]'::jsonb) from (
      select d.id,d.reminder_id,d.planned_for,d.status,r.label,r.kind from public.food_fitness_reminder_deliveries d
      join public.food_fitness_student_reminders r on r.id=d.reminder_id and r.store_id=d.store_id
      where d.store_id=p_store and d.student_user_id=auth.uid() and d.planned_for>now()-interval '7 days' and d.status<>'cancelled'
      order by d.planned_for desc limit 50
    ) x)
  );
end; $$;

create function public.food_fitness_student_reminder_save(p_store uuid,p_id uuid,p_kind text,p_label text,p_time time,p_timezone text,p_weekdays smallint[],p_channel text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.food_fitness_student_reminders%rowtype; target uuid:=coalesce(p_id,gen_random_uuid());
begin
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then raise exception 'Somente o próprio aluno pode configurar lembretes.' using errcode='42501'; end if;
  if not food_business_private.module_enabled(p_store,'clients') or p_kind not in ('workout','appointment','hydration','routine') or length(trim(p_label)) not between 2 and 100 or p_time is null or cardinality(p_weekdays) not between 1 and 7 or not (p_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]) or p_timezone not in (select name from pg_timezone_names) or p_channel not in ('in_app','push') then
    raise exception 'Preferência de lembrete inválida ou módulo indisponível.' using errcode='22023';
  end if;
  if p_channel='push' and not exists(select 1 from public.food_fitness_student_push_subscriptions ps where ps.store_id=p_store and ps.user_id=auth.uid() and ps.active) then raise exception 'Ative notificações push neste aparelho antes de escolher esse canal.' using errcode='22023'; end if;
  insert into public.food_fitness_student_reminders(id,store_id,student_user_id,kind,label,reminder_time,timezone,weekdays,channel)
  values(target,p_store,auth.uid(),p_kind,trim(p_label),p_time,p_timezone,p_weekdays,p_channel)
  on conflict(id) do update set kind=excluded.kind,label=excluded.label,reminder_time=excluded.reminder_time,timezone=excluded.timezone,weekdays=excluded.weekdays,channel=excluded.channel,updated_at=now()
    where food_fitness_student_reminders.store_id=p_store and food_fitness_student_reminders.student_user_id=auth.uid() and food_fitness_student_reminders.status<>'cancelled'
  returning * into result;
  if result.id is null then raise exception 'Lembrete não encontrado para esta conta.' using errcode='42501'; end if;
  return jsonb_build_object('id',result.id,'status',result.status,'kind',result.kind,'label',result.label);
end; $$;

create function public.food_fitness_student_reminder_action(p_store uuid,p_id uuid,p_action text,p_paused_until timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.food_fitness_student_reminders%rowtype;
begin
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then raise exception 'Somente o próprio aluno pode alterar seus lembretes.' using errcode='42501'; end if;
  if p_action='pause' then
    if p_paused_until is null or p_paused_until<=now() or p_paused_until>now()+interval '1 year' then raise exception 'Defina uma pausa futura de até um ano.' using errcode='22023'; end if;
    update public.food_fitness_student_reminders set status='paused',paused_until=p_paused_until,updated_at=now() where id=p_id and store_id=p_store and student_user_id=auth.uid() and status<>'cancelled' returning * into result;
  elsif p_action='resume' then
    update public.food_fitness_student_reminders set status='active',paused_until=null,updated_at=now() where id=p_id and store_id=p_store and student_user_id=auth.uid() and status='paused' returning * into result;
  elsif p_action='cancel' then
    update public.food_fitness_student_reminders set status='cancelled',cancelled_at=now(),paused_until=null,updated_at=now() where id=p_id and store_id=p_store and student_user_id=auth.uid() and status<>'cancelled' returning * into result;
  else raise exception 'Ação indisponível.' using errcode='22023'; end if;
  if result.id is null then raise exception 'Lembrete não encontrado ou já desligado.' using errcode='22023'; end if;
  if p_action in ('pause','cancel') then
    update public.food_fitness_reminder_deliveries set status='cancelled',claimed_at=null
      where reminder_id=p_id and store_id=p_store and student_user_id=auth.uid() and status='queued';
  end if;
  return jsonb_build_object('id',result.id,'status',result.status,'paused_until',result.paused_until,'cancelled_at',result.cancelled_at);
end; $$;

create function public.food_fitness_reminder_enqueue_due()
returns integer language plpgsql security definer set search_path='' as $$
declare inserted integer;
begin
  insert into public.food_fitness_reminder_deliveries(reminder_id,store_id,student_user_id,planned_for)
  select r.id,r.store_id,r.student_user_id,date_trunc('minute',now())
  from public.food_fitness_student_reminders r
  where (r.status='active' or r.status='paused' and r.paused_until<=now())
    and extract(dow from (now() at time zone r.timezone))::smallint=any(r.weekdays)
    and extract(hour from (now() at time zone r.timezone))=extract(hour from r.reminder_time)
    and extract(minute from (now() at time zone r.timezone))=extract(minute from r.reminder_time)
    and food_business_private.module_enabled(r.store_id,'clients')
  on conflict(reminder_id,planned_for) do nothing;
  get diagnostics inserted=row_count;
  update public.food_fitness_student_reminders set status='active',paused_until=null,updated_at=now() where status='paused' and paused_until<=now();
  return inserted;
end; $$;

create function public.food_fitness_reminder_claim_push(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare rows jsonb;
begin
  if p_limit not between 1 and 200 then raise exception 'Limite inválido.' using errcode='22023'; end if;
  with claimed as (
    select d.id from public.food_fitness_reminder_deliveries d join public.food_fitness_student_reminders r on r.id=d.reminder_id and r.store_id=d.store_id
      join public.food_stores st on st.id=d.store_id and st.active and st.access_status='online'
    where r.channel='push' and r.status='active' and d.planned_for>=now()-interval '2 minutes'
      and (d.status='queued' or d.status='sending' and d.claimed_at<now()-interval '5 minutes') and d.attempts<3
      and exists(select 1 from public.food_fitness_student_push_subscriptions ps where ps.store_id=d.store_id and ps.user_id=d.student_user_id and ps.active)
    order by d.planned_for,d.id for update of d skip locked limit p_limit
  ), updated as (
    update public.food_fitness_reminder_deliveries d set status='sending',attempts=attempts+1,claimed_at=now() from claimed c where d.id=c.id returning d.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('delivery_id',d.id,'store_id',d.store_id,'user_id',d.student_user_id,'kind',r.kind,'title','Lembrete da sua rotina','message',case r.kind when 'hydration' then 'Seu lembrete de hidratação está na VendeWeb.' when 'workout' then 'Seu lembrete de treino está na VendeWeb.' when 'appointment' then 'Seu lembrete de agenda está na VendeWeb.' else 'Seu lembrete está na VendeWeb.' end,'url','/'||st.slug,'subscriptions',(select coalesce(jsonb_agg(jsonb_build_object('id',ps.id,'endpoint',ps.endpoint,'p256dh',ps.p256dh,'auth',ps.auth)),'[]'::jsonb) from public.food_fitness_student_push_subscriptions ps where ps.store_id=d.store_id and ps.user_id=d.student_user_id and ps.active))), '[]'::jsonb)
    into rows from updated d join public.food_fitness_student_reminders r on r.id=d.reminder_id and r.store_id=d.store_id
    join public.food_stores st on st.id=d.store_id and st.active and st.access_status='online';
  return rows;
end; $$;

create function public.food_fitness_reminder_finish_push(p_delivery uuid,p_success boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.food_fitness_reminder_deliveries%rowtype;
begin
  update public.food_fitness_reminder_deliveries set status=case when p_success then 'sent' when attempts<3 then 'queued' else 'failed' end,delivered_at=case when p_success then now() else null end,claimed_at=null
    where id=p_delivery and status='sending' returning * into result;
  if result.id is null then raise exception 'Entrega não está reservada por um worker.' using errcode='42501'; end if;
  return jsonb_build_object('id',result.id,'status',result.status,'attempts',result.attempts);
end; $$;

create function public.food_fitness_reminder_mark_seen(p_store uuid,p_delivery uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.food_fitness_reminder_deliveries%rowtype;
begin
  update public.food_fitness_reminder_deliveries set status='seen',seen_at=now() where id=p_delivery and store_id=p_store and student_user_id=auth.uid() and status in ('queued','sent') returning * into result;
  if result.id is null then raise exception 'Aviso não encontrado.' using errcode='42501'; end if;
  return jsonb_build_object('id',result.id,'status',result.status);
end; $$;

create function public.food_fitness_student_authorize_professional(p_store uuid,p_professional uuid,p_purpose text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.food_service_professionals%rowtype;
begin
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then raise exception 'Somente o próprio aluno pode conceder acesso.' using errcode='42501'; end if;
  select p.* into profile from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    where p.store_id=p_store and p.user_id=p_professional and p.active for update;
  if profile.user_id is null or p_purpose not in ('training','nutrition') or profile.kind<>p_purpose or (p_purpose='training' and profile.council<>'CREF') or (p_purpose='nutrition' and profile.council<>'CRN') then
    raise exception 'Profissional ativo e registro adequado são obrigatórios.' using errcode='42501';
  end if;
  if p_enabled and not exists(select 1 from public.food_business_services s where s.store_id=p_store and s.professional_user_id=p_professional and s.kind=p_purpose and s.active) then
    raise exception 'Este profissional ainda não presta um serviço ativo nesta loja.' using errcode='22023';
  end if;
  insert into public.food_fitness_professional_authorizations(store_id,student_user_id,professional_user_id,purpose,authorized_at,revoked_at,active)
  values(p_store,auth.uid(),p_professional,p_purpose,case when p_enabled then now() else now() end,case when p_enabled then null else now() end,p_enabled)
  on conflict(store_id,student_user_id,professional_user_id,purpose) do update set authorized_at=case when p_enabled then now() else food_fitness_professional_authorizations.authorized_at end,revoked_at=case when p_enabled then null else now() end,active=p_enabled;
  return jsonb_build_object('professional_user_id',p_professional,'purpose',p_purpose,'active',p_enabled);
end; $$;

create function public.food_fitness_student_authorization_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then raise exception 'Acesso restrito à própria conta de aluno.' using errcode='42501'; end if;
  return jsonb_build_object('professionals',(select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'name',p.name,'kind',p.kind,'council',p.council,'registration',p.registration,'authorized',exists(select 1 from public.food_fitness_professional_authorizations a where a.store_id=p_store and a.student_user_id=auth.uid() and a.professional_user_id=p.user_id and a.purpose=p.kind and a.active),'message_enabled',exists(select 1 from public.food_fitness_student_message_permissions mp where mp.store_id=p_store and mp.student_user_id=auth.uid() and mp.professional_user_id=p.user_id and mp.enabled)) order by p.name),'[]'::jsonb)
    from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    where p.store_id=p_store and p.active and p.kind in ('training','nutrition') and exists(select 1 from public.food_business_services s where s.store_id=p_store and s.professional_user_id=p.user_id and s.kind=p.kind and s.active)
      and ((p.kind='training' and food_business_private.module_enabled(p_store,'training')) or (p.kind='nutrition' and food_business_private.module_enabled(p_store,'nutrition')))));
end; $$;

create function public.food_fitness_student_message_permission_set(p_store uuid,p_professional uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.food_service_professionals%rowtype;
begin
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then raise exception 'Somente o próprio aluno pode alterar esta preferência.' using errcode='42501'; end if;
  select p.* into profile from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    where p.store_id=p_store and p.user_id=p_professional and p.active for update;
  if profile.user_id is null or not exists(select 1 from public.food_business_services s where s.store_id=p_store and s.professional_user_id=p_professional and s.kind=profile.kind and s.active)
    or (profile.kind in ('training','nutrition') and not food_business_private.module_enabled(p_store,profile.kind)) then raise exception 'Profissional com serviço ativo nesta loja é obrigatório.' using errcode='42501'; end if;
  insert into public.food_fitness_student_message_permissions(store_id,student_user_id,professional_user_id,enabled,granted_at,revoked_at)
  values(p_store,auth.uid(),p_professional,p_enabled,now(),case when p_enabled then null else now() end)
  on conflict(store_id,student_user_id,professional_user_id) do update set enabled=p_enabled,granted_at=case when p_enabled then now() else food_fitness_student_message_permissions.granted_at end,revoked_at=case when p_enabled then null else now() end;
  return jsonb_build_object('professional_user_id',p_professional,'enabled',p_enabled);
end; $$;

create function public.food_professional_message_recipients(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active where p.store_id=p_store and p.user_id=auth.uid() and p.active) then raise exception 'Conta profissional ativa obrigatória.' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('student_user_id',mp.student_user_id,'name',c.name,'training_authorized',exists(select 1 from public.food_fitness_professional_authorizations a where a.store_id=p_store and a.student_user_id=mp.student_user_id and a.professional_user_id=auth.uid() and a.purpose='training' and a.active),'nutrition_authorized',exists(select 1 from public.food_fitness_professional_authorizations a where a.store_id=p_store and a.student_user_id=mp.student_user_id and a.professional_user_id=auth.uid() and a.purpose='nutrition' and a.active)) order by c.name),'[]'::jsonb)
    from public.food_fitness_student_message_permissions mp join public.food_fitness_students st on st.store_id=mp.store_id and st.user_id=mp.student_user_id
    join public.food_business_clients c on c.store_id=st.store_id and c.id=st.client_id and c.active
    join public.food_service_professionals p on p.store_id=mp.store_id and p.user_id=mp.professional_user_id and p.active
    where mp.store_id=p_store and mp.professional_user_id=auth.uid() and mp.enabled
      and ((p.kind='training' and food_business_private.module_enabled(p_store,'training')) or (p.kind='nutrition' and food_business_private.module_enabled(p_store,'nutrition'))));
end; $$;

create function public.food_fitness_student_messages_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then raise exception 'Somente o próprio aluno pode consultar mensagens profissionais.' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'publication_id',p.id,'title',p.title,'body',p.body,'category',p.category,'status',d.status,'sent_at',d.sent_at,'author_name',p.author_name,'author_council',p.author_council,'author_registration',p.author_registration) order by d.sent_at desc),'[]'::jsonb)
    from public.food_professional_message_deliveries d join public.food_professional_publications p on p.id=d.publication_id and p.store_id=d.store_id
    where d.store_id=p_store and d.student_user_id=auth.uid() and d.status in ('sent','seen'));
end; $$;

create function public.food_fitness_student_message_mark_seen(p_store uuid,p_delivery uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.food_professional_message_deliveries%rowtype;
begin
  update public.food_professional_message_deliveries set status='seen',seen_at=now() where id=p_delivery and store_id=p_store and student_user_id=auth.uid() and status='sent' returning * into result;
  if result.id is null then raise exception 'Mensagem não encontrada.' using errcode='42501'; end if;
  return jsonb_build_object('id',result.id,'status',result.status);
end; $$;

create function public.food_professional_authorized_students(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active where p.store_id=p_store and p.user_id=auth.uid() and p.active) then raise exception 'Conta profissional ativa obrigatória.' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('student_user_id',a.student_user_id,'client_id',s.client_id,'name',c.name,'purpose',a.purpose,'authorized_at',a.authorized_at) order by c.name),'[]'::jsonb)
    from public.food_fitness_professional_authorizations a join public.food_fitness_students s on s.store_id=a.store_id and s.user_id=a.student_user_id
    join public.food_business_clients c on c.store_id=s.store_id and c.id=s.client_id and c.active
    where a.store_id=p_store and a.professional_user_id=auth.uid() and a.active);
end; $$;

create or replace function food_business_private.public_offers(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare segment_value text; services jsonb:='[]'; links jsonb:='[]'; publications jsonb:='[]';
begin
  if not exists(select 1 from public.food_stores s where s.id=p_store and s.active and s.archived_at is null and s.approval_status='approved' and s.access_status='online') then
    return jsonb_build_object('services','[]'::jsonb,'links','[]'::jsonb,'publications','[]'::jsonb,'primary_segment',null);
  end if;
  select primary_segment into segment_value from public.food_business_profiles where store_id=p_store;
  if food_business_private.module_enabled(p_store,'appointments') then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into services from (
      select s.id,s.name,s.description,s.price_cents,s.duration_minutes,s.kind,
        jsonb_build_object('user_id',p.user_id,'name',p.name,'council',p.council,'registration',p.registration) as professional
      from public.food_business_services s
      join public.food_service_professionals p on p.store_id=s.store_id and p.user_id=s.professional_user_id and p.active
      join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
      where s.store_id=p_store and s.active and (s.kind='general' or food_business_private.module_enabled(p_store,s.kind))
        and (s.kind='general' or s.kind=p.kind)
        and (segment_value is distinct from 'fitness' or exists (select 1 from public.food_fitness_service_terms t where t.store_id=s.store_id and t.service_id=s.id and t.price_confirmed and t.published_at is not null))
      order by s.name,s.id limit 100
    ) x;
  end if;
  if food_business_private.module_enabled(p_store,'creator') then
    select coalesce(jsonb_agg(to_jsonb(x)),'[]'::jsonb) into links from (
      select l.id,l.label,l.url from public.food_creator_links l where l.store_id=p_store and l.active
        and (l.campaign_id is null or exists(select 1 from public.food_creator_campaigns c where c.id=l.campaign_id and c.store_id=l.store_id and c.status='active' and (c.starts_at is null or c.starts_at<=now()) and (c.ends_at is null or c.ends_at>=now()))
        ) order by l.label,l.id limit 100
    ) x;
  end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.published_at desc,x.id),'[]'::jsonb) into publications from (
    select p.id,p.title,p.body,p.category,p.published_at,p.author_name,p.author_council,p.author_registration
    from public.food_professional_publications p join public.food_service_professionals sp on sp.store_id=p.store_id and sp.user_id=p.professional_user_id and sp.active
    join public.food_store_users u on u.store_id=sp.store_id and u.user_id=sp.user_id and u.active
    where p.store_id=p_store and p.status='published' and p.channel='storefront'
      and (p.category='commercial' or p.category='training' and food_business_private.module_enabled(p_store,'training') or p.category='nutrition' and food_business_private.module_enabled(p_store,'nutrition'))
    order by p.published_at desc,p.id limit 50
  ) x;
  return jsonb_build_object('services',services,'links',links,'publications',publications,'primary_segment',segment_value);
end; $$;

-- Fichas de treino são dados profissionais, não registros comerciais da loja.
-- Proprietários e administradores só leem uma ficha quando também são o
-- profissional responsável; o aluno lê apenas a ficha atribuída após consentir.
create function food_fitness_private.has_training_identity(p_store uuid,p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    where p.store_id=p_store and p.user_id=p_user and p.active and p.kind='training' and p.council='CREF')
$$;
revoke all on function food_fitness_private.has_training_identity(uuid,uuid) from public,anon,authenticated;
grant execute on function food_fitness_private.has_training_identity(uuid,uuid) to authenticated;
drop policy if exists food_fitness_workouts_read on public.food_fitness_workouts;
create policy food_fitness_workouts_read on public.food_fitness_workouts for select to authenticated using (
  (created_by=(select auth.uid()) or approved_by=(select auth.uid()) or exists(select 1 from public.food_fitness_workout_assignments a where a.store_id=food_fitness_workouts.store_id and a.workout_id=food_fitness_workouts.id and a.assigned_by=(select auth.uid())))
  and food_fitness_private.has_training_identity(food_fitness_workouts.store_id,(select auth.uid()))
  or (status='approved' and exists(
    select 1 from public.food_fitness_workout_assignments a join public.food_fitness_students st on st.store_id=a.store_id and st.client_id=a.client_id
    join public.food_fitness_professional_authorizations au on au.store_id=a.store_id and au.student_user_id=st.user_id and au.professional_user_id=food_fitness_workouts.approved_by and au.purpose='training' and au.active
    where a.store_id=food_fitness_workouts.store_id and a.workout_id=food_fitness_workouts.id and a.active and st.user_id=(select auth.uid())
      and food_fitness_private.has_training_identity(food_fitness_workouts.store_id,food_fitness_workouts.approved_by)
  ))
);
drop policy if exists food_fitness_exercises_read on public.food_fitness_exercises;
create policy food_fitness_exercises_read on public.food_fitness_exercises for select to authenticated using (
  exists(select 1 from public.food_fitness_workouts w
    where food_fitness_private.has_training_identity(w.store_id,(select auth.uid()))
      and w.id=food_fitness_exercises.workout_id and w.store_id=food_fitness_exercises.store_id and (w.created_by=(select auth.uid()) or w.approved_by=(select auth.uid()) or exists(select 1 from public.food_fitness_workout_assignments a where a.store_id=w.store_id and a.workout_id=w.id and a.assigned_by=(select auth.uid()))))
  or exists(select 1 from public.food_fitness_workouts w join public.food_fitness_workout_assignments a on a.store_id=w.store_id and a.workout_id=w.id and a.active
    join public.food_fitness_students st on st.store_id=a.store_id and st.client_id=a.client_id
    join public.food_fitness_professional_authorizations au on au.store_id=a.store_id and au.student_user_id=st.user_id and au.professional_user_id=w.approved_by and au.purpose='training' and au.active
    where w.id=food_fitness_exercises.workout_id and w.store_id=food_fitness_exercises.store_id and w.status='approved' and st.user_id=(select auth.uid())
      and food_fitness_private.has_training_identity(w.store_id,w.approved_by))
);
drop policy if exists food_fitness_assignments_read on public.food_fitness_workout_assignments;
create policy food_fitness_assignments_read on public.food_fitness_workout_assignments for select to authenticated using (
  assigned_by=(select auth.uid()) and food_fitness_private.has_training_identity(food_fitness_workout_assignments.store_id,(select auth.uid()))
  or exists(select 1 from public.food_fitness_students st where st.store_id=food_fitness_workout_assignments.store_id and st.client_id=food_fitness_workout_assignments.client_id and st.user_id=(select auth.uid()))
);

create or replace function public.food_fitness_save_workout(p_store uuid,p_id uuid,p_level text,p_title text,p_description text,p_exercises jsonb,p_source text default 'custom')
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid:=coalesce(p_id,gen_random_uuid()); old_row public.food_fitness_workouts%rowtype; e jsonb; n integer:=0;
begin
  if not food_fitness_private.is_fitness(p_store) or not food_business_private.module_enabled(p_store,'training') or not exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active where p.store_id=p_store and p.user_id=auth.uid() and p.active and p.kind='training' and p.council='CREF') then raise exception 'Somente profissional CREF ativo pode preparar fichas.' using errcode='42501'; end if;
  if p_source not in ('custom','pilot') or p_level not in ('basic','medium','advanced') or jsonb_typeof(p_exercises) is distinct from 'array' or jsonb_array_length(p_exercises) not between 1 and 30 then raise exception 'Ficha inválida.' using errcode='22023'; end if;
  select * into old_row from public.food_fitness_workouts where id=target for update;
  if old_row.id is not null and (old_row.store_id<>p_store or old_row.status<>'draft' or old_row.created_by<>auth.uid()) then raise exception 'Somente rascunho próprio pode ser editado.' using errcode='42501'; end if;
  insert into public.food_fitness_workouts(id,store_id,title,level,source,description,created_by)
  values(target,p_store,trim(p_title),p_level,p_source,coalesce(p_description,''),auth.uid())
  on conflict(id) do update set title=excluded.title,level=excluded.level,description=excluded.description,updated_at=now()
  where food_fitness_workouts.store_id=excluded.store_id and food_fitness_workouts.status='draft' and food_fitness_workouts.created_by=auth.uid();
  delete from public.food_fitness_exercises where workout_id=target and store_id=p_store;
  for e in select value from jsonb_array_elements(p_exercises) loop
    n:=n+1;
    if jsonb_typeof(e) is distinct from 'object' or (e-array['name','sets','repetitions','rest_seconds','load_or_effort','instructions','alternative'])<>'{}'::jsonb then raise exception 'Campos não permitidos no exercício.' using errcode='22023'; end if;
    insert into public.food_fitness_exercises(store_id,workout_id,position,name,sets,repetitions,rest_seconds,load_or_effort,instructions,alternative)
    values(p_store,target,n,trim(e->>'name'),(e->>'sets')::integer,trim(e->>'repetitions'),(e->>'rest_seconds')::integer,trim(e->>'load_or_effort'),trim(e->>'instructions'),trim(e->>'alternative'));
  end loop;
  return jsonb_build_object('id',target,'store_id',p_store,'status','draft','exercise_count',n);
end; $$;

create or replace function public.food_fitness_approve_workout(p_store uuid,p_workout uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.food_fitness_workouts%rowtype;
begin
  if not food_fitness_private.is_fitness(p_store) or not food_business_private.module_enabled(p_store,'training') or not exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active where p.store_id=p_store and p.user_id=auth.uid() and p.active and p.kind='training' and p.council='CREF') then raise exception 'Somente profissional com CREF pode aprovar fichas.' using errcode='42501'; end if;
  update public.food_fitness_workouts set status='approved',approved_by=auth.uid(),approved_at=now(),updated_at=now()
    where id=p_workout and store_id=p_store and created_by=auth.uid() and status='draft' and exists(select 1 from public.food_fitness_exercises where workout_id=p_workout and store_id=p_store)
    returning * into result;
  if result.id is null then raise exception 'Rascunho próprio não encontrado.' using errcode='22023'; end if;
  insert into public.food_business_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'fitness.workout_approved',jsonb_build_object('workout_id',p_workout));
  return jsonb_build_object('id',result.id,'status',result.status,'approved_at',result.approved_at,'professional',jsonb_build_object('name',(select name from public.food_service_professionals where store_id=p_store and user_id=auth.uid()),'council','CREF','registration',(select registration from public.food_service_professionals where store_id=p_store and user_id=auth.uid())));
end; $$;

create or replace function public.food_fitness_assign_workout(p_store uuid,p_workout uuid,p_client uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid;
begin
  if not food_fitness_private.is_fitness(p_store) or not food_business_private.module_enabled(p_store,'training') or not exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active where p.store_id=p_store and p.user_id=auth.uid() and p.active and p.kind='training' and p.council='CREF') then raise exception 'Profissional CREF ativo obrigatório.' using errcode='42501'; end if;
  if not exists(select 1 from public.food_fitness_workouts where id=p_workout and store_id=p_store and status='approved' and approved_by=auth.uid())
    or not exists(select 1 from public.food_fitness_students st where st.store_id=p_store and st.client_id=p_client and exists(select 1 from public.food_fitness_professional_authorizations a where a.store_id=st.store_id and a.student_user_id=st.user_id and a.professional_user_id=auth.uid() and a.purpose='training' and a.active)) then
    raise exception 'Ficha própria aprovada e autorização ativa do aluno são obrigatórias.' using errcode='42501';
  end if;
  insert into public.food_fitness_workout_assignments(store_id,workout_id,client_id,assigned_by) values(p_store,p_workout,p_client,auth.uid())
  on conflict(store_id,workout_id,client_id) do update set active=true,assigned_by=auth.uid(),assigned_at=now() returning id into target;
  insert into public.food_business_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'fitness.workout_assigned',jsonb_build_object('workout_id',p_workout,'client_id',p_client));
  return jsonb_build_object('assignment_id',target,'workout_id',p_workout,'client_id',p_client,'professional_user_id',auth.uid());
end; $$;

create or replace function public.food_fitness_list_workouts(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare is_professional boolean;
begin
  if auth.uid() is null or not food_fitness_private.is_fitness(p_store) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  is_professional:=exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active where p.store_id=p_store and p.user_id=auth.uid() and p.active and p.kind='training' and p.council='CREF');
  if is_professional then
    return (select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('professional',jsonb_build_object('user_id',sp.user_id,'name',sp.name,'council',sp.council,'registration',sp.registration),'exercises',(select coalesce(jsonb_agg(to_jsonb(e) order by e.position),'[]'::jsonb) from public.food_fitness_exercises e where e.workout_id=w.id and e.store_id=w.store_id)) order by w.created_at),'[]'::jsonb)
      from public.food_fitness_workouts w join public.food_service_professionals sp on sp.store_id=w.store_id and sp.user_id=coalesce(w.approved_by,w.created_by) and sp.active
      where w.store_id=p_store and (w.created_by=auth.uid() or w.approved_by=auth.uid() or exists(select 1 from public.food_fitness_workout_assignments a where a.store_id=w.store_id and a.workout_id=w.id and a.assigned_by=auth.uid())));
  end if;
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then return '[]'::jsonb; end if;
  return (select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('professional',jsonb_build_object('user_id',sp.user_id,'name',sp.name,'council',sp.council,'registration',sp.registration),'exercises',(select coalesce(jsonb_agg(to_jsonb(e) order by e.position),'[]'::jsonb) from public.food_fitness_exercises e where e.workout_id=w.id and e.store_id=w.store_id)) order by w.created_at),'[]'::jsonb)
    from public.food_fitness_workouts w join public.food_fitness_workout_assignments a on a.workout_id=w.id and a.store_id=w.store_id and a.active
    join public.food_fitness_students st on st.store_id=a.store_id and st.client_id=a.client_id and st.user_id=auth.uid()
    join public.food_fitness_professional_authorizations au on au.store_id=st.store_id and au.student_user_id=st.user_id and au.professional_user_id=w.approved_by and au.purpose='training' and au.active
    join public.food_service_professionals sp on sp.store_id=w.store_id and sp.user_id=w.approved_by and sp.active and sp.kind='training' and sp.council='CREF'
    where w.store_id=p_store and w.status='approved');
end; $$;

create or replace function public.food_fitness_list_students(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active where p.store_id=p_store and p.user_id=auth.uid() and p.active and p.kind='training' and p.council='CREF') then raise exception 'Somente profissional CREF ativo pode consultar alunos autorizados.' using errcode='42501'; end if;
  return jsonb_build_object('students',(select coalesce(jsonb_agg(jsonb_build_object('client_id',c.id,'name',c.name) order by c.name),'[]'::jsonb)
    from public.food_fitness_professional_authorizations a join public.food_fitness_students st on st.store_id=a.store_id and st.user_id=a.student_user_id
    join public.food_business_clients c on c.id=st.client_id and c.store_id=st.store_id and c.active
    where a.store_id=p_store and a.professional_user_id=auth.uid() and a.purpose='training' and a.active));
end; $$;

revoke all on function public.food_professional_publication_list(uuid),public.food_professional_publication_save(uuid,uuid,text,text,text,text,uuid),public.food_professional_publication_approve(uuid,uuid,timestamptz),public.food_professional_publication_cancel(uuid,uuid),public.food_professional_publication_publish_due(),public.food_fitness_student_reminders_list(uuid),public.food_fitness_student_reminder_save(uuid,uuid,text,text,time,text,smallint[],text),public.food_fitness_student_reminder_action(uuid,uuid,text,timestamptz),public.food_fitness_reminder_enqueue_due(),public.food_fitness_reminder_claim_push(integer),public.food_fitness_reminder_finish_push(uuid,boolean),public.food_fitness_reminder_mark_seen(uuid,uuid),public.food_fitness_student_authorize_professional(uuid,uuid,text,boolean),public.food_fitness_student_authorization_list(uuid),public.food_fitness_student_message_permission_set(uuid,uuid,boolean),public.food_professional_message_recipients(uuid),public.food_fitness_student_messages_list(uuid),public.food_fitness_student_message_mark_seen(uuid,uuid),public.food_professional_authorized_students(uuid) from public,anon,authenticated;
grant execute on function public.food_professional_publication_list(uuid),public.food_professional_publication_save(uuid,uuid,text,text,text,text,uuid),public.food_professional_publication_approve(uuid,uuid,timestamptz),public.food_professional_publication_cancel(uuid,uuid),public.food_fitness_student_reminders_list(uuid),public.food_fitness_student_reminder_save(uuid,uuid,text,text,time,text,smallint[],text),public.food_fitness_student_reminder_action(uuid,uuid,text,timestamptz),public.food_fitness_reminder_mark_seen(uuid,uuid),public.food_fitness_student_authorize_professional(uuid,uuid,text,boolean),public.food_fitness_student_authorization_list(uuid),public.food_fitness_student_message_permission_set(uuid,uuid,boolean),public.food_professional_message_recipients(uuid),public.food_fitness_student_messages_list(uuid),public.food_fitness_student_message_mark_seen(uuid,uuid),public.food_professional_authorized_students(uuid) to authenticated;
grant execute on function public.food_professional_publication_publish_due(),public.food_fitness_reminder_enqueue_due(),public.food_fitness_reminder_claim_push(integer),public.food_fitness_reminder_finish_push(uuid,boolean) to service_role;

do $$ declare v_job bigint; begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    for v_job in select jobid from cron.job where jobname='food-professional-publications-minute' loop perform cron.unschedule(v_job); end loop;
    perform cron.schedule('food-professional-publications-minute','* * * * *','select public.food_professional_publication_publish_due();');
    for v_job in select jobid from cron.job where jobname='food-fitness-reminders-minute' loop perform cron.unschedule(v_job); end loop;
    perform cron.schedule('food-fitness-reminders-minute','* * * * *','select public.food_fitness_reminder_enqueue_due();');
  end if;
exception when others then raise notice 'pg_cron indisponível; configure os jobs food-professional-publications-minute e food-fitness-reminders-minute externamente. %',sqlerrm;
end $$;


-- Source: 20261030150000_food_fitness_phone_session_enforcement.sql
-- Keep the phone-auth session boundary after professional content migrations redefine Fitness reads.

create or replace function food_fitness_private.student_session_for_user(p_store uuid,p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.food_fitness_students s
    where s.store_id=p_store and s.user_id=p_user
      and food_fitness_private.student_session_active(s.store_id,s.client_id)
  )
$$;
create or replace function food_fitness_private.require_student_session(p_store uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if not food_fitness_private.student_session_for_user(p_store,auth.uid()) then
    raise exception 'FITNESS_STUDENT_SESSION_REQUIRED' using errcode='42501';
  end if;
end; $$;
revoke all on function food_fitness_private.student_session_for_user(uuid,uuid),food_fitness_private.require_student_session(uuid) from public,anon;
grant execute on function food_fitness_private.student_session_for_user(uuid,uuid),food_fitness_private.require_student_session(uuid) to authenticated,service_role;

create or replace function food_fitness_private.has_training_identity(p_store uuid,p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    where p.store_id=p_store and p.user_id=p_user and p.active and p.kind='training' and p.council='CREF')
$$;

revoke all on function food_fitness_private.has_training_identity(uuid,uuid) from public,anon,authenticated;
grant execute on function food_fitness_private.has_training_identity(uuid,uuid) to authenticated;

drop policy if exists food_fitness_workouts_read on public.food_fitness_workouts;
create policy food_fitness_workouts_read on public.food_fitness_workouts for select to authenticated using (
  (created_by=(select auth.uid()) or approved_by=(select auth.uid()) or exists(select 1 from public.food_fitness_workout_assignments a where a.store_id=food_fitness_workouts.store_id and a.workout_id=food_fitness_workouts.id and a.assigned_by=(select auth.uid())))
  and food_fitness_private.has_training_identity(food_fitness_workouts.store_id,(select auth.uid()))
  or (status='approved' and exists(
    select 1 from public.food_fitness_workout_assignments a join public.food_fitness_students st on st.store_id=a.store_id and st.client_id=a.client_id
    join public.food_fitness_professional_authorizations au on au.store_id=a.store_id and au.student_user_id=st.user_id and au.professional_user_id=food_fitness_workouts.approved_by and au.purpose='training' and au.active
    where a.store_id=food_fitness_workouts.store_id and a.workout_id=food_fitness_workouts.id and a.active and st.user_id=(select auth.uid()) and food_fitness_private.student_session_active(a.store_id,a.client_id)
      and food_fitness_private.has_training_identity(food_fitness_workouts.store_id,food_fitness_workouts.approved_by)
  ))
);
drop policy if exists food_fitness_exercises_read on public.food_fitness_exercises;
create policy food_fitness_exercises_read on public.food_fitness_exercises for select to authenticated using (
  exists(select 1 from public.food_fitness_workouts w
    where food_fitness_private.has_training_identity(w.store_id,(select auth.uid()))
      and w.id=food_fitness_exercises.workout_id and w.store_id=food_fitness_exercises.store_id and (w.created_by=(select auth.uid()) or w.approved_by=(select auth.uid()) or exists(select 1 from public.food_fitness_workout_assignments a where a.store_id=w.store_id and a.workout_id=w.id and a.assigned_by=(select auth.uid()))))
  or exists(select 1 from public.food_fitness_workouts w join public.food_fitness_workout_assignments a on a.store_id=w.store_id and a.workout_id=w.id and a.active
    join public.food_fitness_students st on st.store_id=a.store_id and st.client_id=a.client_id
    join public.food_fitness_professional_authorizations au on au.store_id=a.store_id and au.student_user_id=st.user_id and au.professional_user_id=w.approved_by and au.purpose='training' and au.active
    where w.id=food_fitness_exercises.workout_id and w.store_id=food_fitness_exercises.store_id and w.status='approved' and st.user_id=(select auth.uid()) and food_fitness_private.student_session_active(a.store_id,a.client_id)
      and food_fitness_private.has_training_identity(w.store_id,w.approved_by))
);
drop policy if exists food_fitness_assignments_read on public.food_fitness_workout_assignments;
create policy food_fitness_assignments_read on public.food_fitness_workout_assignments for select to authenticated using (
  assigned_by=(select auth.uid()) and food_fitness_private.has_training_identity(food_fitness_workout_assignments.store_id,(select auth.uid()))
  or exists(select 1 from public.food_fitness_students st where st.store_id=food_fitness_workout_assignments.store_id and st.client_id=food_fitness_workout_assignments.client_id and st.user_id=(select auth.uid()) and food_fitness_private.student_session_active(st.store_id,st.client_id))
);

create or replace function public.food_fitness_list_workouts(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare is_professional boolean; student_client uuid;
begin
  if auth.uid() is null or not food_fitness_private.is_fitness(p_store) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  is_professional:=exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active where p.store_id=p_store and p.user_id=auth.uid() and p.active and p.kind='training' and p.council='CREF');
  if is_professional then
    return (select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('professional',jsonb_build_object('user_id',sp.user_id,'name',sp.name,'council',sp.council,'registration',sp.registration),'exercises',(select coalesce(jsonb_agg(to_jsonb(e) order by e.position),'[]'::jsonb) from public.food_fitness_exercises e where e.workout_id=w.id and e.store_id=w.store_id)) order by w.created_at),'[]'::jsonb)
      from public.food_fitness_workouts w join public.food_service_professionals sp on sp.store_id=w.store_id and sp.user_id=coalesce(w.approved_by,w.created_by) and sp.active
      where w.store_id=p_store and (w.created_by=auth.uid() or w.approved_by=auth.uid() or exists(select 1 from public.food_fitness_workout_assignments a where a.store_id=w.store_id and a.workout_id=w.id and a.assigned_by=auth.uid())));
  end if;
  select client_id into student_client from public.food_fitness_students where store_id=p_store and user_id=auth.uid();
  if student_client is null then return '[]'::jsonb; end if;
  if not food_fitness_private.student_session_active(p_store,student_client) then raise exception 'FITNESS_STUDENT_SESSION_REQUIRED' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('professional',jsonb_build_object('user_id',sp.user_id,'name',sp.name,'council',sp.council,'registration',sp.registration),'exercises',(select coalesce(jsonb_agg(to_jsonb(e) order by e.position),'[]'::jsonb) from public.food_fitness_exercises e where e.workout_id=w.id and e.store_id=w.store_id)) order by w.created_at),'[]'::jsonb)
    from public.food_fitness_workouts w join public.food_fitness_workout_assignments a on a.workout_id=w.id and a.store_id=w.store_id and a.active
    join public.food_fitness_students st on st.store_id=a.store_id and st.client_id=a.client_id and st.user_id=auth.uid() and st.client_id=student_client
    join public.food_fitness_professional_authorizations au on au.store_id=st.store_id and au.student_user_id=st.user_id and au.professional_user_id=w.approved_by and au.purpose='training' and au.active
    join public.food_service_professionals sp on sp.store_id=w.store_id and sp.user_id=w.approved_by and sp.active and sp.kind='training' and sp.council='CREF'
    where w.store_id=p_store and w.status='approved');
end; $$;

create or replace function public.food_fitness_student_session_admin_list_v1(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'aal','')<>'aal2'
    or not food_fitness_private.is_fitness(p_store)
    or not (public.food_is_store_admin(p_store) or food_fitness_private.can_configure(p_store))
    or not exists(select 1 from auth.sessions where id=sid and user_id=auth.uid() and (not_after is null or not_after>now())) then
    raise exception 'FITNESS_ADMIN_MFA_REQUIRED' using errcode='42501';
  end if;
  return jsonb_build_object('students',(
    select coalesce(jsonb_agg(jsonb_build_object(
      'client_id',s.client_id,'name',c.name,
      'session_active',exists(
        select 1 from public.food_fitness_student_sessions fs
        join auth.sessions a on a.id=fs.auth_session_id and a.user_id=fs.user_id
        where fs.store_id=s.store_id and fs.client_id=s.client_id and fs.user_id=s.user_id
          and fs.revoked_at is null and (a.not_after is null or a.not_after>now())
      )
    ) order by c.name),'[]'::jsonb)
    from public.food_fitness_students s
    join public.food_business_clients c on c.id=s.client_id and c.store_id=s.store_id
    where s.store_id=p_store and c.active
  ));
end; $$;

create or replace function public.food_fitness_student_reminders_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform food_fitness_private.require_student_session(p_store);
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then raise exception 'Somente o próprio aluno pode consultar seus lembretes.' using errcode='42501'; end if;
  return jsonb_build_object(
    'reminders',(select coalesce(jsonb_agg(to_jsonb(r) order by r.reminder_time,r.id),'[]'::jsonb) from public.food_fitness_student_reminders r where r.store_id=p_store and r.student_user_id=auth.uid()),
    'inbox',(select coalesce(jsonb_agg(to_jsonb(x) order by x.planned_for desc),'[]'::jsonb) from (
      select d.id,d.reminder_id,d.planned_for,d.status,r.label,r.kind from public.food_fitness_reminder_deliveries d
      join public.food_fitness_student_reminders r on r.id=d.reminder_id and r.store_id=d.store_id
      where d.store_id=p_store and d.student_user_id=auth.uid() and d.planned_for>now()-interval '7 days' and d.status<>'cancelled'
      order by d.planned_for desc limit 50
    ) x)
  );
end; $$;

create or replace function public.food_fitness_student_reminder_save(p_store uuid,p_id uuid,p_kind text,p_label text,p_time time,p_timezone text,p_weekdays smallint[],p_channel text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.food_fitness_student_reminders%rowtype; target uuid:=coalesce(p_id,gen_random_uuid());
begin
  perform food_fitness_private.require_student_session(p_store);
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then raise exception 'Somente o próprio aluno pode configurar lembretes.' using errcode='42501'; end if;
  if not food_business_private.module_enabled(p_store,'clients') or p_kind not in ('workout','appointment','hydration','routine') or length(trim(p_label)) not between 2 and 100 or p_time is null or cardinality(p_weekdays) not between 1 and 7 or not (p_weekdays <@ array[0,1,2,3,4,5,6]::smallint[]) or p_timezone not in (select name from pg_timezone_names) or p_channel not in ('in_app','push') then
    raise exception 'Preferência de lembrete inválida ou módulo indisponível.' using errcode='22023';
  end if;
  if p_channel='push' and not exists(select 1 from public.food_fitness_student_push_subscriptions ps where ps.store_id=p_store and ps.user_id=auth.uid() and ps.active) then raise exception 'Ative notificações push neste aparelho antes de escolher esse canal.' using errcode='22023'; end if;
  insert into public.food_fitness_student_reminders(id,store_id,student_user_id,kind,label,reminder_time,timezone,weekdays,channel)
  values(target,p_store,auth.uid(),p_kind,trim(p_label),p_time,p_timezone,p_weekdays,p_channel)
  on conflict(id) do update set kind=excluded.kind,label=excluded.label,reminder_time=excluded.reminder_time,timezone=excluded.timezone,weekdays=excluded.weekdays,channel=excluded.channel,updated_at=now()
    where food_fitness_student_reminders.store_id=p_store and food_fitness_student_reminders.student_user_id=auth.uid() and food_fitness_student_reminders.status<>'cancelled'
  returning * into result;
  if result.id is null then raise exception 'Lembrete não encontrado para esta conta.' using errcode='42501'; end if;
  return jsonb_build_object('id',result.id,'status',result.status,'kind',result.kind,'label',result.label);
end; $$;

create or replace function public.food_fitness_student_reminder_action(p_store uuid,p_id uuid,p_action text,p_paused_until timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.food_fitness_student_reminders%rowtype;
begin
  perform food_fitness_private.require_student_session(p_store);
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then raise exception 'Somente o próprio aluno pode alterar seus lembretes.' using errcode='42501'; end if;
  if p_action='pause' then
    if p_paused_until is null or p_paused_until<=now() or p_paused_until>now()+interval '1 year' then raise exception 'Defina uma pausa futura de até um ano.' using errcode='22023'; end if;
    update public.food_fitness_student_reminders set status='paused',paused_until=p_paused_until,updated_at=now() where id=p_id and store_id=p_store and student_user_id=auth.uid() and status<>'cancelled' returning * into result;
  elsif p_action='resume' then
    update public.food_fitness_student_reminders set status='active',paused_until=null,updated_at=now() where id=p_id and store_id=p_store and student_user_id=auth.uid() and status='paused' returning * into result;
  elsif p_action='cancel' then
    update public.food_fitness_student_reminders set status='cancelled',cancelled_at=now(),paused_until=null,updated_at=now() where id=p_id and store_id=p_store and student_user_id=auth.uid() and status<>'cancelled' returning * into result;
  else raise exception 'Ação indisponível.' using errcode='22023'; end if;
  if result.id is null then raise exception 'Lembrete não encontrado ou já desligado.' using errcode='22023'; end if;
  if p_action in ('pause','cancel') then
    update public.food_fitness_reminder_deliveries set status='cancelled',claimed_at=null
      where reminder_id=p_id and store_id=p_store and student_user_id=auth.uid() and status='queued';
  end if;
  return jsonb_build_object('id',result.id,'status',result.status,'paused_until',result.paused_until,'cancelled_at',result.cancelled_at);
end; $$;

create or replace function public.food_fitness_reminder_mark_seen(p_store uuid,p_delivery uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.food_fitness_reminder_deliveries%rowtype;
begin
  perform food_fitness_private.require_student_session(p_store);
  update public.food_fitness_reminder_deliveries set status='seen',seen_at=now() where id=p_delivery and store_id=p_store and student_user_id=auth.uid() and status in ('queued','sent') returning * into result;
  if result.id is null then raise exception 'Aviso não encontrado.' using errcode='42501'; end if;
  return jsonb_build_object('id',result.id,'status',result.status);
end; $$;

create or replace function public.food_fitness_student_authorize_professional(p_store uuid,p_professional uuid,p_purpose text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.food_service_professionals%rowtype;
begin
  perform food_fitness_private.require_student_session(p_store);
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then raise exception 'Somente o próprio aluno pode conceder acesso.' using errcode='42501'; end if;
  select p.* into profile from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    where p.store_id=p_store and p.user_id=p_professional and p.active for update;
  if profile.user_id is null or p_purpose not in ('training','nutrition') or profile.kind<>p_purpose or (p_purpose='training' and profile.council<>'CREF') or (p_purpose='nutrition' and profile.council<>'CRN') then
    raise exception 'Profissional ativo e registro adequado são obrigatórios.' using errcode='42501';
  end if;
  if p_enabled and not exists(select 1 from public.food_business_services s where s.store_id=p_store and s.professional_user_id=p_professional and s.kind=p_purpose and s.active) then
    raise exception 'Este profissional ainda não presta um serviço ativo nesta loja.' using errcode='22023';
  end if;
  insert into public.food_fitness_professional_authorizations(store_id,student_user_id,professional_user_id,purpose,authorized_at,revoked_at,active)
  values(p_store,auth.uid(),p_professional,p_purpose,case when p_enabled then now() else now() end,case when p_enabled then null else now() end,p_enabled)
  on conflict(store_id,student_user_id,professional_user_id,purpose) do update set authorized_at=case when p_enabled then now() else food_fitness_professional_authorizations.authorized_at end,revoked_at=case when p_enabled then null else now() end,active=p_enabled;
  return jsonb_build_object('professional_user_id',p_professional,'purpose',p_purpose,'active',p_enabled);
end; $$;

create or replace function public.food_fitness_student_authorization_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform food_fitness_private.require_student_session(p_store);
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then raise exception 'Acesso restrito à própria conta de aluno.' using errcode='42501'; end if;
  return jsonb_build_object('professionals',(select coalesce(jsonb_agg(jsonb_build_object('user_id',p.user_id,'name',p.name,'kind',p.kind,'council',p.council,'registration',p.registration,'authorized',exists(select 1 from public.food_fitness_professional_authorizations a where a.store_id=p_store and a.student_user_id=auth.uid() and a.professional_user_id=p.user_id and a.purpose=p.kind and a.active),'message_enabled',exists(select 1 from public.food_fitness_student_message_permissions mp where mp.store_id=p_store and mp.student_user_id=auth.uid() and mp.professional_user_id=p.user_id and mp.enabled)) order by p.name),'[]'::jsonb)
    from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    where p.store_id=p_store and p.active and p.kind in ('training','nutrition') and exists(select 1 from public.food_business_services s where s.store_id=p_store and s.professional_user_id=p.user_id and s.kind=p.kind and s.active)
      and ((p.kind='training' and food_business_private.module_enabled(p_store,'training')) or (p.kind='nutrition' and food_business_private.module_enabled(p_store,'nutrition')))));
end; $$;

create or replace function public.food_fitness_student_message_permission_set(p_store uuid,p_professional uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.food_service_professionals%rowtype;
begin
  perform food_fitness_private.require_student_session(p_store);
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then raise exception 'Somente o próprio aluno pode alterar esta preferência.' using errcode='42501'; end if;
  select p.* into profile from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    where p.store_id=p_store and p.user_id=p_professional and p.active for update;
  if profile.user_id is null or not exists(select 1 from public.food_business_services s where s.store_id=p_store and s.professional_user_id=p_professional and s.kind=profile.kind and s.active)
    or (profile.kind in ('training','nutrition') and not food_business_private.module_enabled(p_store,profile.kind)) then raise exception 'Profissional com serviço ativo nesta loja é obrigatório.' using errcode='42501'; end if;
  insert into public.food_fitness_student_message_permissions(store_id,student_user_id,professional_user_id,enabled,granted_at,revoked_at)
  values(p_store,auth.uid(),p_professional,p_enabled,now(),case when p_enabled then null else now() end)
  on conflict(store_id,student_user_id,professional_user_id) do update set enabled=p_enabled,granted_at=case when p_enabled then now() else food_fitness_student_message_permissions.granted_at end,revoked_at=case when p_enabled then null else now() end;
  return jsonb_build_object('professional_user_id',p_professional,'enabled',p_enabled);
end; $$;

create or replace function public.food_fitness_student_messages_list(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform food_fitness_private.require_student_session(p_store);
  if not exists(select 1 from public.food_fitness_students where store_id=p_store and user_id=auth.uid()) then raise exception 'Somente o próprio aluno pode consultar mensagens profissionais.' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'publication_id',p.id,'title',p.title,'body',p.body,'category',p.category,'status',d.status,'sent_at',d.sent_at,'author_name',p.author_name,'author_council',p.author_council,'author_registration',p.author_registration) order by d.sent_at desc),'[]'::jsonb)
    from public.food_professional_message_deliveries d join public.food_professional_publications p on p.id=d.publication_id and p.store_id=d.store_id
    where d.store_id=p_store and d.student_user_id=auth.uid() and d.status in ('sent','seen'));
end; $$;

create or replace function public.food_fitness_student_message_mark_seen(p_store uuid,p_delivery uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.food_professional_message_deliveries%rowtype;
begin
  perform food_fitness_private.require_student_session(p_store);
  update public.food_professional_message_deliveries set status='seen',seen_at=now() where id=p_delivery and store_id=p_store and student_user_id=auth.uid() and status='sent' returning * into result;
  if result.id is null then raise exception 'Mensagem não encontrada.' using errcode='42501'; end if;
  return jsonb_build_object('id',result.id,'status',result.status);
end; $$;

drop policy if exists food_fitness_student_reminders_read on public.food_fitness_student_reminders;
create policy food_fitness_student_reminders_read on public.food_fitness_student_reminders for select to authenticated
using (food_fitness_private.student_session_for_user(store_id,student_user_id));
drop policy if exists food_fitness_authorizations_read on public.food_fitness_professional_authorizations;
create policy food_fitness_authorizations_read on public.food_fitness_professional_authorizations for select to authenticated
using (food_fitness_private.student_session_for_user(store_id,student_user_id) or professional_user_id=(select auth.uid()));
drop policy if exists food_fitness_message_permissions_read on public.food_fitness_student_message_permissions;
create policy food_fitness_message_permissions_read on public.food_fitness_student_message_permissions for select to authenticated
using (food_fitness_private.student_session_for_user(store_id,student_user_id) or professional_user_id=(select auth.uid()));
drop policy if exists food_professional_message_deliveries_read on public.food_professional_message_deliveries;
create policy food_professional_message_deliveries_read on public.food_professional_message_deliveries for select to authenticated
using (food_fitness_private.student_session_for_user(store_id,student_user_id));
drop policy if exists food_fitness_reminder_deliveries_read on public.food_fitness_reminder_deliveries;
create policy food_fitness_reminder_deliveries_read on public.food_fitness_reminder_deliveries for select to authenticated
using (food_fitness_private.student_session_for_user(store_id,student_user_id));

drop policy if exists food_fitness_student_push_select_self on public.food_fitness_student_push_subscriptions;
create policy food_fitness_student_push_select_self on public.food_fitness_student_push_subscriptions for select to authenticated
using (food_fitness_private.student_session_for_user(store_id,user_id));
drop policy if exists food_fitness_student_push_insert_self on public.food_fitness_student_push_subscriptions;
create policy food_fitness_student_push_insert_self on public.food_fitness_student_push_subscriptions for insert to authenticated
with check (food_fitness_private.student_session_for_user(store_id,user_id));
drop policy if exists food_fitness_student_push_update_self on public.food_fitness_student_push_subscriptions;
create policy food_fitness_student_push_update_self on public.food_fitness_student_push_subscriptions for update to authenticated
using (food_fitness_private.student_session_for_user(store_id,user_id))
with check (food_fitness_private.student_session_for_user(store_id,user_id));

revoke all on function public.food_fitness_student_session_admin_list_v1(uuid) from public,anon,authenticated;
grant execute on function public.food_fitness_student_session_admin_list_v1(uuid) to authenticated;

-- Source: 20261030170000_food_fitness_pilot_offers.sql
-- Fitness offers and verified manual Pix fulfillment. Apply after the phone-session migrations.
-- Shared Supabase: only food_fitness_* tables, no writes to FloriWeb data.

create table public.food_fitness_offers (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null references public.food_stores(id),
  kind text not null check (kind in ('workout','assessment','combo','nutrition_consult','nutrition_plan')),
  name text not null check (length(trim(name)) between 3 and 120),
  description text not null default '' check (length(description) <= 2000),
  price_cents integer not null check (price_cents > 0),
  workout_id uuid,
  service_id uuid,
  professional_user_id uuid not null,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id,store_id),
  foreign key (workout_id,store_id) references public.food_fitness_workouts(id,store_id),
  foreign key (service_id,store_id) references public.food_business_services(id,store_id),
  foreign key (store_id,professional_user_id) references public.food_service_professionals(store_id,user_id),
  check ((kind='workout' and workout_id is not null and service_id is null)
    or (kind='combo' and workout_id is not null and service_id is not null)
    or (kind in ('assessment','nutrition_consult','nutrition_plan') and workout_id is null and service_id is not null))
);
create index food_fitness_offers_public on public.food_fitness_offers(store_id,published) where published;

create table public.food_fitness_offer_orders (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  offer_id uuid not null,
  student_user_id uuid not null,
  client_id uuid not null,
  request_id uuid not null,
  price_cents integer not null check (price_cents > 0),
  offer_name text not null,
  state text not null default 'pending' check (state in ('pending','paid','cancelled','refunded')),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  confirmed_by uuid references auth.users(id),
  revoked_at timestamptz,
  unique (store_id,student_user_id,request_id),
  unique (id,store_id),
  foreign key (offer_id,store_id) references public.food_fitness_offers(id,store_id),
  foreign key (store_id,student_user_id) references public.food_fitness_students(store_id,user_id),
  foreign key (client_id,store_id) references public.food_business_clients(id,store_id),
  check ((state='paid' and paid_at is not null and confirmed_by is not null and revoked_at is null)
    or (state in ('pending','cancelled') and paid_at is null and confirmed_by is null and revoked_at is null)
    or (state='refunded' and paid_at is not null and confirmed_by is not null and revoked_at is not null))
);
alter table public.food_fitness_workout_assignments add column purchase_id uuid references public.food_fitness_offer_orders(id);

create index food_fitness_orders_admin on public.food_fitness_offer_orders(store_id,created_at desc);
create index food_fitness_orders_student on public.food_fitness_offer_orders(store_id,student_user_id,created_at desc);

-- Portal delivery is committed with the payment transition. External channels remain optional.
create table public.food_fitness_order_notifications (
  id uuid primary key default gen_random_uuid(),
  store_id uuid not null,
  order_id uuid not null,
  student_user_id uuid not null,
  event_kind text not null check (event_kind in ('paid','refunded')),
  created_at timestamptz not null default now(),
  unique (order_id,event_kind),
  foreign key (order_id,store_id) references public.food_fitness_offer_orders(id,store_id),
  foreign key (store_id,student_user_id) references public.food_fitness_students(store_id,user_id)
);
create index food_fitness_order_notifications_student on public.food_fitness_order_notifications(store_id,student_user_id,created_at desc);

alter table public.food_fitness_offers enable row level security;
alter table public.food_fitness_offer_orders enable row level security;
alter table public.food_fitness_order_notifications enable row level security;
revoke all on public.food_fitness_offers,public.food_fitness_offer_orders,public.food_fitness_order_notifications from public,anon,authenticated;
grant all on public.food_fitness_offers,public.food_fitness_offer_orders,public.food_fitness_order_notifications to service_role;

-- No direct table write grants: all mutations below validate store, role, identity and status.
create function food_fitness_private.offer_ready(p_offer public.food_fitness_offers)
returns boolean language sql stable security definer set search_path='' as $$
  -- Only the approved digital workout has an automatic paid fulfillment path today.
  -- Appointment and nutrition products stay drafts until paid booking/delivery is implemented.
  select p_offer.published and p_offer.kind='workout' and exists (
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
      and sv.kind=case when p_offer.kind in ('nutrition_consult','nutrition_plan') then 'nutrition' else 'training' end
  ))
$$;
revoke all on function food_fitness_private.offer_ready(public.food_fitness_offers) from public,anon,authenticated;
grant execute on function food_fitness_private.offer_ready(public.food_fitness_offers) to authenticated;

create function public.food_fitness_offer_save_v1(
  p_store uuid,p_id uuid,p_kind text,p_name text,p_description text,p_price_cents integer,
  p_workout uuid,p_service uuid,p_professional uuid,p_published boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.food_fitness_offers%rowtype; target uuid:=coalesce(p_id,gen_random_uuid());
begin
  if not food_fitness_private.is_fitness(p_store) or not exists (
    select 1 from public.food_store_users u where u.store_id=p_store and u.user_id=auth.uid()
      and u.active and u.role in ('owner','admin')
  ) then raise exception 'Sem permissão para administrar ofertas.' using errcode='42501'; end if;
  if p_id is not null and exists(
    select 1 from public.food_fitness_offers old
    where old.id=p_id and old.store_id=p_store
      and (old.kind is distinct from p_kind or old.price_cents is distinct from p_price_cents
        or old.workout_id is distinct from p_workout or old.service_id is distinct from p_service
        or old.professional_user_id is distinct from p_professional)
      and exists(select 1 from public.food_fitness_offer_orders ord where ord.offer_id=old.id and ord.store_id=old.store_id)
  ) then raise exception 'Oferta com pedidos não pode mudar preço ou entrega; crie uma nova versão.' using errcode='23P01'; end if;
  if p_id is not null and not exists(select 1 from public.food_fitness_offers where id=p_id and store_id=p_store) then
    raise exception 'Oferta não encontrada nesta loja.' using errcode='42501';
  end if;
  insert into public.food_fitness_offers(id,store_id,kind,name,description,price_cents,workout_id,service_id,professional_user_id,published)
  values(target,p_store,p_kind,trim(p_name),coalesce(p_description,''),p_price_cents,p_workout,p_service,p_professional,false)
  on conflict(id) do update set kind=excluded.kind,name=excluded.name,description=excluded.description,
    price_cents=excluded.price_cents,workout_id=excluded.workout_id,service_id=excluded.service_id,
    professional_user_id=excluded.professional_user_id,published=false,updated_at=now()
  where food_fitness_offers.store_id=p_store returning * into v;
  if v.id is null then raise exception 'Oferta pertence a outra loja.' using errcode='42501'; end if;
  if p_published then
    v.published:=true;
    if not food_fitness_private.offer_ready(v) then raise exception 'Ficha, serviço, módulo ou profissional ainda não estão aprovados.' using errcode='42501'; end if;
    update public.food_fitness_offers set published=true where id=v.id;
  end if;
  insert into public.food_business_audit(store_id,actor_id,action,details)
    values(p_store,auth.uid(),'fitness.offer_saved',jsonb_build_object('offer_id',v.id,'published',p_published));
  return jsonb_build_object('id',v.id,'published',p_published);
end; $$;

create function public.food_fitness_offers_v1(p_store uuid,p_admin boolean default false)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if p_admin and not exists(select 1 from public.food_store_users u where u.store_id=p_store and u.user_id=auth.uid()
      and u.active and u.role in ('owner','admin')) then
    raise exception 'Sem permissão para consultar rascunhos.' using errcode='42501';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',o.id,'kind',o.kind,'name',o.name,'description',o.description,'price_cents',o.price_cents,
    'workout_id',o.workout_id,'service_id',o.service_id,'professional_user_id',o.professional_user_id,
    'professional_name',p.name,'professional_council',p.council,'published',o.published
  ) order by o.created_at,o.id)
  from public.food_fitness_offers o
  join public.food_service_professionals p on p.store_id=o.store_id and p.user_id=o.professional_user_id
  where o.store_id=p_store and (p_admin or food_fitness_private.offer_ready(o))),'[]'::jsonb);
end; $$;

create function public.food_fitness_order_v1(p_store uuid,p_offer uuid,p_request uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.food_fitness_offers%rowtype; student uuid; result public.food_fitness_offer_orders%rowtype;
  v_purpose text;
begin
  if auth.uid() is null or p_request is null then raise exception 'Sessão de aluno obrigatória.' using errcode='42501'; end if;
  select client_id into student from public.food_fitness_students where store_id=p_store and user_id=auth.uid();
  if student is null or not food_fitness_private.student_session_active(p_store,student) then
    raise exception 'FITNESS_STUDENT_SESSION_REQUIRED' using errcode='42501';
  end if;
  select * into v from public.food_fitness_offers where id=p_offer and store_id=p_store;
  if v.id is null or not food_fitness_private.offer_ready(v) then raise exception 'Oferta indisponível.' using errcode='22023'; end if;
  v_purpose:=case when v.kind in ('nutrition_consult','nutrition_plan') then 'nutrition' else 'training' end;
  if not exists(select 1 from public.food_fitness_professional_authorizations au where au.store_id=p_store
      and au.student_user_id=auth.uid() and au.professional_user_id=v.professional_user_id
      and au.purpose=v_purpose and au.active) then
    raise exception 'Autorize o profissional desta oferta antes de comprar.' using errcode='42501';
  end if;
  insert into public.food_fitness_offer_orders(store_id,offer_id,student_user_id,client_id,request_id,price_cents,offer_name)
  values(p_store,v.id,auth.uid(),student,p_request,v.price_cents,v.name)
  on conflict(store_id,student_user_id,request_id) do nothing;
  select * into result from public.food_fitness_offer_orders where store_id=p_store and student_user_id=auth.uid() and request_id=p_request;
  if result.offer_id<>p_offer then raise exception 'Chave de pedido já utilizada para outra oferta.' using errcode='23505'; end if;
  return jsonb_build_object('id',result.id,'state',result.state,'price_cents',result.price_cents,'offer_name',result.offer_name);
end; $$;

create function public.food_fitness_my_orders_v1(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform food_fitness_private.require_student_session(p_store);
  return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'offer_id',o.offer_id,'offer_name',o.offer_name,
    'state',o.state,'price_cents',o.price_cents,'created_at',o.created_at) order by o.created_at desc)
    from public.food_fitness_offer_orders o where o.store_id=p_store and o.student_user_id=auth.uid()),'[]'::jsonb);
end; $$;

create function public.food_fitness_order_notifications_v1(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform food_fitness_private.require_student_session(p_store);
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',n.id,'order_id',n.order_id,'event_kind',n.event_kind,'created_at',n.created_at,
    'offer_name',o.offer_name) order by n.created_at desc)
    from public.food_fitness_order_notifications n
    join public.food_fitness_offer_orders o on o.id=n.order_id and o.store_id=n.store_id
    where n.store_id=p_store and n.student_user_id=auth.uid()),'[]'::jsonb);
end; $$;

create function public.food_fitness_admin_orders_v1(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.food_store_users u where u.store_id=p_store and u.user_id=auth.uid()
      and u.active and u.role in ('owner','admin')) then raise exception 'Sem acesso aos pedidos.' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'offer_name',o.offer_name,'price_cents',o.price_cents,
    'state',o.state,'created_at',o.created_at,'client_id',o.client_id,'student_name',c.name) order by o.created_at desc)
    from public.food_fitness_offer_orders o join public.food_business_clients c on c.id=o.client_id and c.store_id=o.store_id
    where o.store_id=p_store),'[]'::jsonb);
end; $$;

create function public.food_fitness_confirm_order_v1(p_store uuid,p_order uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.food_fitness_offer_orders%rowtype; offer public.food_fitness_offers%rowtype;
  sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
begin
  if auth.uid() is null or auth.jwt()->>'aal' <> 'aal2' or sid is null
    or not exists(select 1 from auth.sessions s where s.id=sid and s.user_id=auth.uid() and (s.not_after is null or s.not_after>now()))
    or not exists(select 1 from public.food_store_users u where u.store_id=p_store and u.user_id=auth.uid()
      and u.active and u.role in ('owner','admin')) then raise exception 'FITNESS_ADMIN_MFA_REQUIRED' using errcode='42501'; end if;
  if p_action not in ('confirm','refund') then raise exception 'Ação inválida.' using errcode='22023'; end if;
  select * into v from public.food_fitness_offer_orders where id=p_order and store_id=p_store for update;
  if v.id is null then raise exception 'Pedido não encontrado nesta loja.' using errcode='42501'; end if;
  select * into offer from public.food_fitness_offers where id=v.offer_id and store_id=v.store_id;
  if p_action='confirm' then
    if v.state='paid' then return jsonb_build_object('id',v.id,'state','paid'); end if;
    if v.state<>'pending' or not food_fitness_private.offer_ready(offer) or offer.price_cents<>v.price_cents then
      raise exception 'Pedido ou oferta mudou; revisão manual obrigatória.' using errcode='22023';
    end if;
    update public.food_fitness_offer_orders set state='paid',paid_at=now(),confirmed_by=auth.uid() where id=v.id;
    if offer.workout_id is not null then
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
    update public.food_fitness_offer_orders set state='refunded',revoked_at=now() where id=v.id;
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

create function public.food_fitness_pix_v1(p_store uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select case when s.active and s.access_status='online' and s.pix_enabled
    then jsonb_build_object('pix_key',s.pix_key,'pix_copy_paste',s.pix_copy_paste,'holder_name',s.pix_holder_name)
    else '{}'::jsonb end
  from public.food_stores s join public.food_business_profiles b on b.store_id=s.id and b.primary_segment='fitness'
  where s.id=p_store
$$;

revoke all on function public.food_fitness_offer_save_v1(uuid,uuid,text,text,text,integer,uuid,uuid,uuid,boolean),
  public.food_fitness_offers_v1(uuid,boolean),public.food_fitness_order_v1(uuid,uuid,uuid),
  public.food_fitness_my_orders_v1(uuid),public.food_fitness_admin_orders_v1(uuid),
  public.food_fitness_order_notifications_v1(uuid),public.food_fitness_confirm_order_v1(uuid,uuid,text),public.food_fitness_pix_v1(uuid) from public,anon,authenticated;
grant execute on function public.food_fitness_offers_v1(uuid,boolean),public.food_fitness_pix_v1(uuid) to anon,authenticated;
grant execute on function public.food_fitness_offer_save_v1(uuid,uuid,text,text,text,integer,uuid,uuid,uuid,boolean),
  public.food_fitness_order_v1(uuid,uuid,uuid),public.food_fitness_my_orders_v1(uuid),public.food_fitness_order_notifications_v1(uuid),
  public.food_fitness_admin_orders_v1(uuid),public.food_fitness_confirm_order_v1(uuid,uuid,text) to authenticated;

-- Source: 20261103164300_food_fitness_content_delivery.sql
-- Additive content contracts. Requires the five 30/10 Fitness dependencies, in order.
-- No clinical seeds, no publication, no remote deployment implied.

alter table public.food_fitness_workouts add column previous_version_id uuid;
alter table public.food_fitness_workouts add constraint food_fitness_workout_version_store_fk foreign key(previous_version_id,store_id) references public.food_fitness_workouts(id,store_id);
alter table public.food_fitness_exercises add column if not exists day text not null default 'A' check(day in ('A','B','C','D','E','F','G'));
alter table public.food_fitness_exercises add column if not exists primary_muscles jsonb not null default '[]' check(jsonb_typeof(primary_muscles)='array' and jsonb_array_length(primary_muscles)<=12);
alter table public.food_fitness_exercises add column if not exists secondary_muscles jsonb not null default '[]' check(jsonb_typeof(secondary_muscles)='array' and jsonb_array_length(secondary_muscles)<=12);
alter table public.food_fitness_exercises add column if not exists objective text not null default '' check(length(objective)<=1000);
alter table public.food_fitness_exercises add column if not exists equipment text not null default '' check(length(equipment)<=1000);
alter table public.food_fitness_exercises add column if not exists tempo text not null default '' check(length(tempo)<=1000);
alter table public.food_fitness_exercises add column if not exists range_of_motion text not null default '' check(length(range_of_motion)<=1000);
alter table public.food_fitness_exercises add column if not exists common_mistakes text not null default '' check(length(common_mistakes)<=1000);
alter table public.food_fitness_exercises add column if not exists precautions text not null default '' check(length(precautions)<=1000);
alter table public.food_fitness_exercises add column if not exists professional_notes text not null default '' check(length(professional_notes)<=1000);
alter table public.food_fitness_exercises add column if not exists media_key text not null default '' check(length(media_key)<=1000);
create or replace function public.food_fitness_save_workout(p_store uuid,p_id uuid,p_level text,p_title text,p_description text,p_exercises jsonb,p_source text default 'custom')
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid:=coalesce(p_id,gen_random_uuid()); old_row public.food_fitness_workouts%rowtype; e jsonb; n integer:=0;
begin
  if not food_fitness_private.is_fitness(p_store) or not food_business_private.module_enabled(p_store,'training') or not exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active where p.store_id=p_store and p.user_id=auth.uid() and p.active and p.kind='training' and p.council='CREF') then raise exception 'Somente profissional CREF ativo pode preparar fichas.' using errcode='42501'; end if;
  if p_source not in ('custom','pilot') or p_level not in ('basic','medium','advanced') or jsonb_typeof(p_exercises) is distinct from 'array' or jsonb_array_length(p_exercises) not between 1 and 30 then raise exception 'Ficha inválida.' using errcode='22023'; end if;
  select * into old_row from public.food_fitness_workouts where id=target for update;
  if old_row.id is not null and (old_row.store_id<>p_store or old_row.status<>'draft' or old_row.created_by<>auth.uid()) then raise exception 'Somente rascunho próprio pode ser editado.' using errcode='42501'; end if;
  insert into public.food_fitness_workouts(id,store_id,title,level,source,description,created_by)
  values(target,p_store,trim(p_title),p_level,p_source,coalesce(p_description,''),auth.uid())
  on conflict(id) do update set title=excluded.title,level=excluded.level,description=excluded.description,updated_at=now()
  where food_fitness_workouts.store_id=excluded.store_id and food_fitness_workouts.status='draft' and food_fitness_workouts.created_by=auth.uid();
  delete from public.food_fitness_exercises where workout_id=target and store_id=p_store;
  for e in select value from jsonb_array_elements(p_exercises) loop
    n:=n+1;
    if jsonb_typeof(e) is distinct from 'object' or (e-array['name','sets','repetitions','rest_seconds','load_or_effort','instructions','alternative','day','primary_muscles','secondary_muscles','objective','equipment','tempo','range_of_motion','common_mistakes','precautions','professional_notes','media_key'])<>'{}'::jsonb then raise exception 'Campos não permitidos no exercício.' using errcode='22023'; end if;
    insert into public.food_fitness_exercises(store_id,workout_id,position,name,sets,repetitions,rest_seconds,load_or_effort,instructions,alternative,day,primary_muscles,secondary_muscles,objective,equipment,tempo,range_of_motion,common_mistakes,precautions,professional_notes,media_key)
    values(p_store,target,n,trim(e->>'name'),(e->>'sets')::integer,trim(e->>'repetitions'),(e->>'rest_seconds')::integer,trim(e->>'load_or_effort'),trim(e->>'instructions'),trim(e->>'alternative'),coalesce(e->>'day','A'),coalesce(e->'primary_muscles','[]'::jsonb),coalesce(e->'secondary_muscles','[]'::jsonb),coalesce(e->>'objective',''),coalesce(e->>'equipment',''),coalesce(e->>'tempo',''),coalesce(e->>'range_of_motion',''),coalesce(e->>'common_mistakes',''),coalesce(e->>'precautions',''),coalesce(e->>'professional_notes',''),coalesce(e->>'media_key',''));
  end loop;
  return jsonb_build_object('id',target,'store_id',p_store,'status','draft','exercise_count',n);
end; $$;

create function public.food_fitness_workout_revision_v1(p_store uuid,p_workout uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.food_fitness_workouts%rowtype; result jsonb; exercises jsonb;
begin
  if not food_fitness_private.has_training_identity(p_store,auth.uid()) then raise exception 'Profissional CREF obrigatório.' using errcode='42501'; end if;
  select * into w from public.food_fitness_workouts where id=p_workout and store_id=p_store and created_by=auth.uid() for update;
  if w.id is null then raise exception 'Ficha própria não encontrada.' using errcode='42501'; end if;
  select jsonb_agg(to_jsonb(e)-array['id','store_id','workout_id','position'] order by position) into exercises from public.food_fitness_exercises e where workout_id=w.id and store_id=p_store;
  result:=public.food_fitness_save_workout(p_store,null,w.level,w.title,w.description,exercises,'custom');
  update public.food_fitness_workouts set previous_version_id=w.id where id=(result->>'id')::uuid;
  return result;
end; $$;

create function food_fitness_private.active_identity(p_store uuid,p_kind text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    join auth.sessions s on s.user_id=p.user_id and s.id=nullif(auth.jwt()->>'session_id','')::uuid and (s.not_after is null or s.not_after>now())
    where p.store_id=p_store and p.user_id=auth.uid() and p.active and p.kind=p_kind
      and p.council=case when p_kind='nutrition' then 'CRN' else 'CREF' end
      and food_business_private.module_enabled(p_store,p_kind));
$$;

create table public.food_fitness_nutrition_plans (
  id uuid primary key default gen_random_uuid(), store_id uuid not null,
  student_user_id uuid not null, professional_user_id uuid not null,
  title text not null check(length(trim(title)) between 3 and 120),
  meals jsonb not null check(jsonb_typeof(meals)='array' and jsonb_array_length(meals) between 1 and 42),
  reported_restrictions text not null default '' check(length(reported_restrictions)<=2000),
  notes text not null default '' check(length(notes)<=2000),
  valid_until date not null, status text not null default 'draft' check(status in ('draft','approved','revoked')),
  approved_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  previous_version_id uuid,
  unique(id,store_id),
  foreign key(store_id,student_user_id) references public.food_fitness_students(store_id,user_id),
  foreign key(store_id,professional_user_id) references public.food_service_professionals(store_id,user_id),
  foreign key(previous_version_id,store_id) references public.food_fitness_nutrition_plans(id,store_id),
  check(status<>'approved' or approved_at is not null)
);
create index food_fitness_nutrition_student on public.food_fitness_nutrition_plans(store_id,student_user_id,status);
create index food_fitness_nutrition_professional on public.food_fitness_nutrition_plans(store_id,professional_user_id);
alter table public.food_fitness_nutrition_plans enable row level security;
revoke all on public.food_fitness_nutrition_plans from public,anon,authenticated;

create function food_fitness_private.nutrition_consent(p_store uuid,p_student uuid,p_professional uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.food_fitness_professional_authorizations a
    join public.food_service_professionals p on p.store_id=a.store_id and p.user_id=a.professional_user_id and p.active and p.kind='nutrition' and p.council='CRN'
    join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active
    where a.store_id=p_store and a.student_user_id=p_student and a.professional_user_id=p_professional and a.purpose='nutrition' and a.active)
    and food_business_private.module_enabled(p_store,'nutrition');
$$;

create function public.food_fitness_nutrition_save_v1(p_store uuid,p_id uuid,p_student uuid,p_title text,p_valid_until date,p_meals jsonb,p_restrictions text,p_notes text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid:=coalesce(p_id,gen_random_uuid()); m jsonb; i jsonb;
begin
  if not food_fitness_private.active_identity(p_store,'nutrition') or not food_fitness_private.nutrition_consent(p_store,p_student,auth.uid()) then
    raise exception 'Nutricionista CRN e consentimento ativo obrigatórios.' using errcode='42501'; end if;
  if p_valid_until is null or p_valid_until<(now() at time zone 'America/Sao_Paulo')::date
    or jsonb_typeof(p_meals) is distinct from 'array' or jsonb_array_length(p_meals) not between 1 and 42 or octet_length(p_meals::text)>100000 then
    raise exception 'Validade ou refeições inválidas.' using errcode='22023'; end if;
  for m in select value from jsonb_array_elements(p_meals) loop
    if jsonb_typeof(m) is distinct from 'object' or length(coalesce(m->>'day','')) not between 1 and 30 or length(coalesce(m->>'name','')) not between 2 and 120
      or (m-array['day','name','time','instructions','seasonings','items'])<>'{}'::jsonb
      or jsonb_typeof(m->'items') is distinct from 'array' or jsonb_array_length(m->'items') not between 1 and 30 then
      raise exception 'Preencha dia, refeição e alimentos.' using errcode='22023'; end if;
    for i in select value from jsonb_array_elements(m->'items') loop
      if jsonb_typeof(i) is distinct from 'object' or length(coalesce(i->>'name','')) not between 2 and 120
        or (i-array['name','group','amount','unit','weight_state','household_measure','alternatives'])<>'{}'::jsonb
        or coalesce(i->>'unit','') not in ('g','ml','unit') or coalesce(i->>'weight_state','') not in ('raw','cooked','prepared','not_applicable')
        or jsonb_typeof(i->'amount') is distinct from 'number' then raise exception 'Porção, unidade e estado do alimento obrigatórios.' using errcode='22023'; end if;
      if (i->>'amount')::numeric<=0 or (i->>'amount')::numeric>10000 then raise exception 'Porção fora do limite.' using errcode='22023'; end if;
    end loop;
  end loop;
  if p_id is not null then
    perform 1 from public.food_fitness_nutrition_plans where id=p_id and store_id=p_store and professional_user_id=auth.uid() and student_user_id=p_student and status='draft' for update;
    if not found then raise exception 'Somente rascunho próprio pode ser editado.' using errcode='42501'; end if;
  end if;
  insert into public.food_fitness_nutrition_plans(id,store_id,student_user_id,professional_user_id,title,valid_until,meals,reported_restrictions,notes)
  values(target,p_store,p_student,auth.uid(),trim(p_title),p_valid_until,p_meals,coalesce(p_restrictions,''),coalesce(p_notes,''))
  on conflict(id) do update set title=excluded.title,valid_until=excluded.valid_until,meals=excluded.meals,reported_restrictions=excluded.reported_restrictions,notes=excluded.notes,updated_at=now();
  insert into public.food_business_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'fitness.nutrition_saved',jsonb_build_object('plan_id',target));
  return jsonb_build_object('id',target,'status','draft');
end; $$;

create function public.food_fitness_nutrition_approve_v1(p_store uuid,p_plan uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not food_fitness_private.active_identity(p_store,'nutrition') then raise exception 'Aprovação exclusiva da nutricionista CRN.' using errcode='42501'; end if;
  update public.food_fitness_nutrition_plans p set status='approved',approved_at=now(),updated_at=now()
  where p.id=p_plan and p.store_id=p_store and p.professional_user_id=auth.uid() and p.status='draft'
    and p.valid_until>=(now() at time zone 'America/Sao_Paulo')::date
    and food_fitness_private.nutrition_consent(p_store,p.student_user_id,p.professional_user_id);
  if not found then raise exception 'Rascunho próprio válido e autorizado obrigatório.' using errcode='42501'; end if;
  insert into public.food_business_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'fitness.nutrition_approved',jsonb_build_object('plan_id',p_plan));
  return jsonb_build_object('id',p_plan,'status','approved');
end; $$;

create function public.food_fitness_nutrition_list_v1(p_store uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; professional boolean:=food_fitness_private.active_identity(p_store,'nutrition');
begin
  if not professional then
    -- Staff without CRN sees no clinical payload. Students must prove a live scoped session.
    if exists(select 1 from public.food_store_users where store_id=p_store and user_id=auth.uid() and active) then return '[]'::jsonb; end if;
    perform food_fitness_private.require_student_session(p_store);
  end if;
  select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('professional_name',sp.name,'registration',sp.registration) order by p.created_at desc),'[]'::jsonb) into result
    from public.food_fitness_nutrition_plans p join public.food_service_professionals sp on sp.store_id=p.store_id and sp.user_id=p.professional_user_id
    where p.store_id=p_store and food_fitness_private.nutrition_consent(p.store_id,p.student_user_id,p.professional_user_id)
      and ((professional and p.professional_user_id=auth.uid()) or (not professional and p.student_user_id=auth.uid() and p.status='approved' and p.valid_until>=(now() at time zone 'America/Sao_Paulo')::date));
  insert into public.food_business_audit(store_id,actor_id,action,details) values(p_store,auth.uid(),'fitness.nutrition_read',jsonb_build_object('count',jsonb_array_length(result)));
  return result;
end; $$;

revoke all on function food_fitness_private.active_identity(uuid,text),food_fitness_private.nutrition_consent(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.food_fitness_workout_revision_v1(uuid,uuid),public.food_fitness_nutrition_save_v1(uuid,uuid,uuid,text,date,jsonb,text,text),public.food_fitness_nutrition_approve_v1(uuid,uuid),public.food_fitness_nutrition_list_v1(uuid) from public,anon,authenticated;
grant execute on function public.food_fitness_workout_revision_v1(uuid,uuid),public.food_fitness_nutrition_save_v1(uuid,uuid,uuid,text,date,jsonb,text,text),public.food_fitness_nutrition_approve_v1(uuid,uuid),public.food_fitness_nutrition_list_v1(uuid) to authenticated;
notify pgrst, 'reload schema';

-- Source: 20261103164842_food_fitness_paid_appointments.sql
-- Paid service delivery; no reservations during pending manual Pix.

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

-- Keep professional notes private, including existing notes and advanced fields.
alter table public.food_fitness_exercises drop column professional_notes;

create or replace function public.food_fitness_save_workout(p_store uuid,p_id uuid,p_level text,p_title text,p_description text,p_exercises jsonb,p_source text default 'custom')
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid:=coalesce(p_id,gen_random_uuid()); old_row public.food_fitness_workouts%rowtype; e jsonb; n integer:=0; exercise_id uuid; required_field text;
begin
  if auth.uid() is null or not food_fitness_private.is_fitness(p_store) or not food_business_private.module_enabled(p_store,'training') or not exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active where p.store_id=p_store and p.user_id=auth.uid() and p.active and p.kind='training' and p.council='CREF') then raise exception 'Somente profissional CREF ativo pode preparar fichas.' using errcode='42501'; end if;
  if p_source not in ('custom','pilot') or p_level not in ('basic','medium','advanced') or jsonb_typeof(p_exercises) is distinct from 'array' or jsonb_array_length(p_exercises) not between 1 and 30 then raise exception 'Ficha inválida.' using errcode='22023'; end if;
  select * into old_row from public.food_fitness_workouts where id=target for update;
  if old_row.id is not null and (old_row.store_id<>p_store or old_row.status<>'draft' or old_row.created_by<>auth.uid()) then raise exception 'Ficha aprovada ou de outra loja não pode ser editada.' using errcode='42501'; end if;
  insert into public.food_fitness_workouts(id,store_id,title,level,source,description,created_by)
  values(target,p_store,trim(p_title),p_level,p_source,coalesce(p_description,''),auth.uid())
  on conflict(id) do update set title=excluded.title,level=excluded.level,description=excluded.description,updated_at=now()
  where food_fitness_workouts.store_id=excluded.store_id and food_fitness_workouts.status='draft' and food_fitness_workouts.created_by=auth.uid();
  -- Replace-all cannot preserve fields omitted by an older client. Refuse the
  -- update whenever a previously non-default value would otherwise disappear.
  for required_field in
    select distinct field from public.food_fitness_exercises x
    cross join lateral unnest(array_remove(array[
      case when x.day<>'A' then 'day' end,
      case when x.primary_muscles<>'[]'::jsonb then 'primary_muscles' end,
      case when x.secondary_muscles<>'[]'::jsonb then 'secondary_muscles' end,
      case when x.objective<>'' then 'objective' end,
      case when x.equipment<>'' then 'equipment' end,
      case when x.tempo<>'' then 'tempo' end,
      case when x.range_of_motion<>'' then 'range_of_motion' end,
      case when x.common_mistakes<>'' then 'common_mistakes' end,
      case when x.precautions<>'' then 'precautions' end,
      case when x.media_key<>'' then 'media_key' end
    ],null)) field where x.workout_id=target and x.store_id=p_store
  loop
    if exists(select 1 from jsonb_array_elements(p_exercises) item where jsonb_typeof(item) is distinct from 'object' or not (item ? required_field) or jsonb_typeof(item->required_field)='null') then
      raise exception 'Atualize a página para preservar os detalhes dos exercícios antes de salvar.' using errcode='22023';
    end if;
  end loop;
  -- Older clients may not send notes; do not erase existing private data on save.
  if exists(select 1 from food_fitness_private.workout_exercise_notes pn join public.food_fitness_exercises x on x.id=pn.exercise_id and x.store_id=pn.store_id where x.workout_id=target and x.store_id=p_store)
    and exists(select 1 from jsonb_array_elements(p_exercises) item where jsonb_typeof(item) is distinct from 'object' or not (item ? 'professional_notes') or jsonb_typeof(item->'professional_notes')='null') then
    raise exception 'Atualize a página para preservar as anotações profissionais antes de salvar.' using errcode='22023';
  end if;
  delete from public.food_fitness_exercises where workout_id=target and store_id=p_store;
  for e in select value from jsonb_array_elements(p_exercises) loop
    n:=n+1;
    if jsonb_typeof(e) is distinct from 'object' or (e-array['name','sets','repetitions','rest_seconds','load_or_effort','instructions','alternative','day','primary_muscles','secondary_muscles','objective','equipment','tempo','range_of_motion','common_mistakes','precautions','professional_notes','media_key'])<>'{}'::jsonb then raise exception 'Campos não permitidos no exercício.' using errcode='22023'; end if;
    insert into public.food_fitness_exercises(store_id,workout_id,position,name,sets,repetitions,rest_seconds,load_or_effort,instructions,alternative,day,primary_muscles,secondary_muscles,objective,equipment,tempo,range_of_motion,common_mistakes,precautions,media_key)
    values(p_store,target,n,trim(e->>'name'),(e->>'sets')::integer,trim(e->>'repetitions'),(e->>'rest_seconds')::integer,trim(e->>'load_or_effort'),trim(e->>'instructions'),trim(e->>'alternative'),coalesce(e->>'day','A'),coalesce(e->'primary_muscles','[]'::jsonb),coalesce(e->'secondary_muscles','[]'::jsonb),coalesce(e->>'objective',''),coalesce(e->>'equipment',''),coalesce(e->>'tempo',''),coalesce(e->>'range_of_motion',''),coalesce(e->>'common_mistakes',''),coalesce(e->>'precautions',''),coalesce(e->>'media_key','')) returning id into exercise_id;
    if length(coalesce(e->>'professional_notes',''))>0 then
      insert into food_fitness_private.workout_exercise_notes(exercise_id,store_id,notes) values(exercise_id,p_store,e->>'professional_notes');
    end if;
  end loop;
  return jsonb_build_object('id',target,'store_id',p_store,'status','draft','exercise_count',n);
end; $$;


create or replace function public.food_fitness_list_workouts(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare is_professional boolean; student_client uuid;
begin
  if auth.uid() is null or not food_fitness_private.is_fitness(p_store) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  is_professional:=exists(select 1 from public.food_service_professionals p join public.food_store_users u on u.store_id=p.store_id and u.user_id=p.user_id and u.active where p.store_id=p_store and p.user_id=auth.uid() and p.active and p.kind='training' and p.council='CREF');
  if is_professional then
    return (select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('professional',jsonb_build_object('user_id',sp.user_id,'name',sp.name,'council',sp.council,'registration',sp.registration),'exercises',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('professional_notes',coalesce((select pn.notes from food_fitness_private.workout_exercise_notes pn where pn.exercise_id=e.id and pn.store_id=e.store_id),'')) order by e.position),'[]'::jsonb) from public.food_fitness_exercises e where e.workout_id=w.id and e.store_id=w.store_id)) order by w.created_at),'[]'::jsonb)
      from public.food_fitness_workouts w join public.food_service_professionals sp on sp.store_id=w.store_id and sp.user_id=coalesce(w.approved_by,w.created_by) and sp.active
      where w.store_id=p_store and (w.created_by=auth.uid() or w.approved_by=auth.uid() or exists(select 1 from public.food_fitness_workout_assignments a where a.store_id=w.store_id and a.workout_id=w.id and a.assigned_by=auth.uid())));
  end if;
  select client_id into student_client from public.food_fitness_students where store_id=p_store and user_id=auth.uid();
  if student_client is null then return '[]'::jsonb; end if;
  if not food_fitness_private.student_session_active(p_store,student_client) then raise exception 'FITNESS_STUDENT_SESSION_REQUIRED' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('professional',jsonb_build_object('user_id',sp.user_id,'name',sp.name,'council',sp.council,'registration',sp.registration),'exercises',(select coalesce(jsonb_agg(to_jsonb(e) order by e.position),'[]'::jsonb) from public.food_fitness_exercises e where e.workout_id=w.id and e.store_id=w.store_id)) order by w.created_at),'[]'::jsonb)
    from public.food_fitness_workouts w join public.food_fitness_workout_assignments a on a.workout_id=w.id and a.store_id=w.store_id and a.active
    join public.food_fitness_students st on st.store_id=a.store_id and st.client_id=a.client_id and st.user_id=auth.uid() and st.client_id=student_client
    join public.food_fitness_professional_authorizations au on au.store_id=st.store_id and au.student_user_id=st.user_id and au.professional_user_id=w.approved_by and au.purpose='training' and au.active
    join public.food_service_professionals sp on sp.store_id=w.store_id and sp.user_id=w.approved_by and sp.active and sp.kind='training' and sp.council='CREF'
    where w.store_id=p_store and w.status='approved');
end; $$;


create or replace function public.food_fitness_workout_revision_v1(p_store uuid,p_workout uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare w public.food_fitness_workouts%rowtype; result jsonb; exercises jsonb;
begin
  if not food_fitness_private.has_training_identity(p_store,auth.uid()) then raise exception 'Profissional CREF obrigatório.' using errcode='42501'; end if;
  select * into w from public.food_fitness_workouts where id=p_workout and store_id=p_store and created_by=auth.uid() for update;
  if w.id is null then raise exception 'Ficha própria não encontrada.' using errcode='42501'; end if;
  select jsonb_agg((to_jsonb(e)-array['id','store_id','workout_id','position'])||jsonb_build_object('professional_notes',coalesce((select pn.notes from food_fitness_private.workout_exercise_notes pn where pn.exercise_id=e.id and pn.store_id=e.store_id),'')) order by position) into exercises from public.food_fitness_exercises e where workout_id=w.id and store_id=p_store;
  result:=public.food_fitness_save_workout(p_store,null,w.level,w.title,w.description,exercises,'custom');
  update public.food_fitness_workouts set previous_version_id=w.id where id=(result->>'id')::uuid;
  return result;
end; $$;

-- Keep the exact old public projection for all other business branches.
do $copy$ begin
 execute replace(pg_get_functiondef('food_business_private.public_offers(uuid)'::regprocedure),'FUNCTION food_business_private.public_offers(', 'FUNCTION food_business_private.public_offers_fitness_reconciled(');
end $copy$;
revoke all on function food_business_private.public_offers_fitness_reconciled(uuid) from public,anon,authenticated;
create or replace function food_business_private.public_offers(p_store uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$ begin
 if food_fitness_private.is_fitness(p_store) then return food_business_private.public_offers_fitness_reconciled(p_store); end if;
 return food_business_private.public_offers_before_fitness(p_store);
end; $$;
notify pgrst, 'reload schema';
commit;