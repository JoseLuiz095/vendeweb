-- Compatible with the 27/10 baseline and the 03/11 advanced Fitness schema.
-- Preserve the existing branch's authorization/session contracts. Notes must
-- never be in the public exercise table because assigned students can SELECT it.
begin;
do $deploy$
declare advanced boolean; found_columns integer; save_def text; list_def text; save_hash text; list_hash text; revision_hash text;
begin
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='food_fitness_exercises' and column_name='professional_notes') into advanced;
  select count(*) into found_columns from information_schema.columns where table_schema='public' and table_name='food_fitness_exercises' and column_name in ('day','primary_muscles','secondary_muscles','objective','equipment','tempo','range_of_motion','common_mistakes','precautions','media_key');
  select md5(prosrc) into save_hash from pg_proc where oid='public.food_fitness_save_workout(uuid,uuid,text,text,text,jsonb,text)'::regprocedure;
  select md5(prosrc) into list_hash from pg_proc where oid='public.food_fitness_list_workouts(uuid)'::regprocedure;
  -- Fail closed if either function differs, so newer session or authorization
  -- rules can never be replaced with an older implementation by accident.
  if advanced then
    select md5(prosrc) into revision_hash from pg_proc where oid=to_regprocedure('public.food_fitness_workout_revision_v1(uuid,uuid)');
  end if;
  if (advanced and (save_hash<>'2a49e29e721437b3f49a8857a66d6c7d' or list_hash<>'4c7479a3c02da260c6c7975e4f5b4229' or revision_hash is distinct from 'f1a706193c0ecbdabb0e7aef3cebbd2e')) or
     (not advanced and (save_hash<>'5c9d37fa6a570b8550851ac95d90018a' or list_hash<>'a01c73c303d148ae58703a2ddc92a485')) then
    raise exception 'Contratos Fitness diferentes do esperado: revisão obrigatória antes de continuar.';
  end if;
  if (advanced and (found_columns<>10 or to_regprocedure('public.food_fitness_workout_revision_v1(uuid,uuid)') is null or to_regclass('public.food_service_professionals') is null)) or (not advanced and found_columns<>0) then
    raise exception 'Esquema Fitness parcial ou desconhecido: reconcilie antes de continuar.';
  end if;
  create table food_fitness_private.workout_exercise_notes (
    exercise_id uuid primary key references public.food_fitness_exercises(id) on delete cascade,
    store_id uuid not null references public.food_stores(id),
    notes text not null check(length(notes)<=1000)
  );
  alter table food_fitness_private.workout_exercise_notes enable row level security;
  revoke all on food_fitness_private.workout_exercise_notes from public,anon,authenticated;
  if advanced then
    insert into food_fitness_private.workout_exercise_notes(exercise_id,store_id,notes)
      select id,store_id,professional_notes from public.food_fitness_exercises where length(professional_notes)>0;
    alter table public.food_fitness_exercises drop column professional_notes;
  else
    alter table public.food_fitness_exercises
      add column day text not null default 'A' check(day in ('A','B','C','D','E','F','G')),
      add column primary_muscles jsonb not null default '[]' check(jsonb_typeof(primary_muscles)='array' and jsonb_array_length(primary_muscles)<=12),
      add column secondary_muscles jsonb not null default '[]' check(jsonb_typeof(secondary_muscles)='array' and jsonb_array_length(secondary_muscles)<=12),
      add column objective text not null default '' check(length(objective)<=1000),
      add column equipment text not null default '' check(length(equipment)<=1000),
      add column tempo text not null default '' check(length(tempo)<=1000),
      add column range_of_motion text not null default '' check(length(range_of_motion)<=1000),
      add column common_mistakes text not null default '' check(length(common_mistakes)<=1000),
      add column precautions text not null default '' check(length(precautions)<=1000),
      add column media_key text not null default '' check(length(media_key)<=1000);
  end if;
  if advanced then
    execute $fn$
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
$fn$;
    execute $fn$
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
$fn$;
    execute $fn$
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
$fn$;
  else
    execute $fn$
create or replace function public.food_fitness_save_workout(p_store uuid,p_id uuid,p_level text,p_title text,p_description text,p_exercises jsonb,p_source text default 'custom')
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid:=coalesce(p_id,gen_random_uuid()); old_row public.food_fitness_workouts%rowtype; e jsonb; n integer:=0; exercise_id uuid; required_field text;
begin
  if auth.uid() is null or not food_fitness_private.can_configure(p_store) then raise exception 'Sem acesso às fichas Fitness.' using errcode='42501'; end if;
  if p_source not in ('custom','pilot') or p_level not in ('basic','medium','advanced') or jsonb_typeof(p_exercises) is distinct from 'array' or jsonb_array_length(p_exercises) not between 1 and 30 then raise exception 'Ficha inválida.' using errcode='22023'; end if;
  select * into old_row from public.food_fitness_workouts where id=target for update;
  if old_row.id is not null and (old_row.store_id<>p_store or old_row.status='approved') then raise exception 'Ficha aprovada ou de outra loja não pode ser editada.' using errcode='42501'; end if;
  insert into public.food_fitness_workouts(id,store_id,title,level,source,description,created_by)
  values(target,p_store,trim(p_title),p_level,p_source,coalesce(p_description,''),auth.uid())
  on conflict(id) do update set title=excluded.title,level=excluded.level,description=excluded.description,updated_at=now()
  where food_fitness_workouts.store_id=excluded.store_id and food_fitness_workouts.status='draft';
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
$fn$;
    execute $fn$
create or replace function public.food_fitness_list_workouts(p_store uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not food_fitness_private.is_fitness(p_store) then raise exception 'Acesso negado.' using errcode='42501'; end if;
  if food_fitness_private.can_configure(p_store) then
    return (select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('exercises',(select coalesce(jsonb_agg(to_jsonb(e)||jsonb_build_object('professional_notes',coalesce((select pn.notes from food_fitness_private.workout_exercise_notes pn where pn.exercise_id=e.id and pn.store_id=e.store_id),'')) order by e.position),'[]'::jsonb) from public.food_fitness_exercises e where e.workout_id=w.id and e.store_id=w.store_id)) order by w.created_at),'[]'::jsonb) from public.food_fitness_workouts w where w.store_id=p_store);
  end if;
  return (select coalesce(jsonb_agg(to_jsonb(w)||jsonb_build_object('exercises',(select coalesce(jsonb_agg(to_jsonb(e) order by e.position),'[]'::jsonb) from public.food_fitness_exercises e where e.workout_id=w.id and e.store_id=w.store_id)) order by w.created_at),'[]'::jsonb)
    from public.food_fitness_workouts w join public.food_fitness_workout_assignments a on a.workout_id=w.id and a.store_id=w.store_id and a.active
    join public.food_fitness_students s on s.store_id=a.store_id and s.client_id=a.client_id
    where w.store_id=p_store and w.status='approved' and s.user_id=auth.uid());
end; $$;
$fn$;
  end if;
end $deploy$;
revoke all on function public.food_fitness_save_workout(uuid,uuid,text,text,text,jsonb,text), public.food_fitness_list_workouts(uuid) from public,anon;
grant execute on function public.food_fitness_save_workout(uuid,uuid,text,text,text,jsonb,text), public.food_fitness_list_workouts(uuid) to authenticated;
commit;
