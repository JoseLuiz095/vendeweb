-- Additive content contracts. Requires the five 30/10 Fitness dependencies, in order.
-- No clinical seeds, no publication, no remote deployment implied.
begin;
alter table public.food_fitness_workouts add column previous_version_id uuid;
alter table public.food_fitness_workouts add constraint food_fitness_workout_version_store_fk foreign key(previous_version_id,store_id) references public.food_fitness_workouts(id,store_id);
alter table public.food_fitness_exercises add column day text not null default 'A' check(day in ('A','B','C','D','E','F','G'));
alter table public.food_fitness_exercises add column primary_muscles jsonb not null default '[]' check(jsonb_typeof(primary_muscles)='array' and jsonb_array_length(primary_muscles)<=12);
alter table public.food_fitness_exercises add column secondary_muscles jsonb not null default '[]' check(jsonb_typeof(secondary_muscles)='array' and jsonb_array_length(secondary_muscles)<=12);
alter table public.food_fitness_exercises add column objective text not null default '' check(length(objective)<=1000);
alter table public.food_fitness_exercises add column equipment text not null default '' check(length(equipment)<=1000);
alter table public.food_fitness_exercises add column tempo text not null default '' check(length(tempo)<=1000);
alter table public.food_fitness_exercises add column range_of_motion text not null default '' check(length(range_of_motion)<=1000);
alter table public.food_fitness_exercises add column common_mistakes text not null default '' check(length(common_mistakes)<=1000);
alter table public.food_fitness_exercises add column precautions text not null default '' check(length(precautions)<=1000);
alter table public.food_fitness_exercises add column professional_notes text not null default '' check(length(professional_notes)<=1000);
alter table public.food_fitness_exercises add column media_key text not null default '' check(length(media_key)<=1000);
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
commit;
