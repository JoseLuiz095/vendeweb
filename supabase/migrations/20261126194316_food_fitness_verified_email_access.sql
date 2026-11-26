-- shared_future: aluno Fitness com identidade confirmada pelo Supabase Auth.
-- Aceita e-mail confirmado ou SMS legado; não altera Auth global, senhas, conselhos,
-- regras de pagamento, MFA administrativo ou vínculos entre lojas.
begin;
-- Normaliza somente CRLF do SQL aplicado manualmente no Windows.
do $$
declare expected record;
begin
  for expected in select * from (values
    ('public','food_fitness_student_status_v1','1fb0eb7d8c139fd9948386117a62762e'),
    ('public','food_fitness_student_session_v1','b4af0d02e2c7477af3983eab33eb8e37'),
    ('public','food_fitness_register_student','964be2042c37f44c564676d1db458a08'),
    ('food_fitness_private','student_session_active','cd9d20fe6f9bbeed879d7baa8e3d5aa2')
  ) as baseline(schema_name,function_name,body_hash) loop
    if not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname=expected.schema_name and p.proname=expected.function_name and md5(replace(p.prosrc,E'\r',''))=expected.body_hash)
    then raise exception 'Contrato Fitness alterado: revise %.% antes de aplicar.',expected.schema_name,expected.function_name;
    end if;
  end loop;
end; $$;

create function food_fitness_private.identity_verified(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from auth.users
    where id=p_user_id and (
      (nullif(trim(email),'') is not null and email_confirmed_at is not null)
      or (nullif(trim(phone),'') is not null and phone_confirmed_at is not null)
    )) and (
      coalesce(auth.jwt()->>'aal','')='aal2' or not exists(
        select 1 from auth.mfa_factors f where f.user_id=p_user_id and f.status='verified'
      )
    )
$$;
revoke all on function food_fitness_private.identity_verified(uuid) from public,anon,authenticated;
grant execute on function food_fitness_private.identity_verified(uuid) to service_role;

CREATE OR REPLACE FUNCTION public.food_fitness_student_status_v1(p_store uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=auth.uid(); result jsonb; identity_ok boolean;
begin
  if u is null or not food_fitness_private.is_fitness(p_store)
    or not food_business_private.module_enabled(p_store,'training') then
    raise exception 'FITNESS_STUDENT_ACCESS_DENIED' using errcode='42501';
  end if;
  identity_ok:=food_fitness_private.identity_verified(u);
  if not identity_ok then raise exception 'VERIFIED_IDENTITY_REQUIRED' using errcode='42501'; end if;
  select jsonb_build_object('registered',true,'store_id',s.store_id,'client_id',s.client_id,'name',c.name)
    into result
    from public.food_fitness_students s join public.food_business_clients c on c.id=s.client_id and c.store_id=s.store_id and c.active
    where s.store_id=p_store and s.user_id=u;
  return coalesce(result,jsonb_build_object('registered',false,'store_id',p_store));
end; $function$;

CREATE OR REPLACE FUNCTION public.food_fitness_student_session_v1(p_store uuid, p_client uuid, p_action text DEFAULT 'claim'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare u uuid:=auth.uid(); sid uuid:=nullif(auth.jwt()->>'session_id','')::uuid;
  live_session uuid; previous_revoked boolean;
begin
  if u is null or sid is null or not food_fitness_private.is_fitness(p_store)
    or not food_business_private.module_enabled(p_store,'training')
    or not food_fitness_private.identity_verified(u)
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
end; $function$;

CREATE OR REPLACE FUNCTION food_fitness_private.student_session_active(p_store uuid, p_client uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select auth.uid() is not null
    and food_fitness_private.identity_verified(auth.uid())
    and food_fitness_private.is_fitness(p_store)
    and food_business_private.module_enabled(p_store,'training')
    and nullif(auth.jwt()->>'session_id','') is not null
    and exists(
      select 1 from public.food_fitness_student_sessions fs
      join auth.sessions a on a.id=fs.auth_session_id and a.user_id=fs.user_id
      where fs.store_id=p_store and fs.client_id=p_client and fs.user_id=auth.uid()
        and fs.auth_session_id=nullif(auth.jwt()->>'session_id','')::uuid and fs.revoked_at is null
        and (a.not_after is null or a.not_after>now())
    )
$function$;

create or replace function public.food_fitness_register_student(p_store uuid,p_name text,p_phone text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); phone_value text; email_value text; cid uuid;
begin
  if uid is null or not food_fitness_private.is_fitness(p_store)
    or not food_business_private.module_enabled(p_store,'clients')
    or not food_business_private.module_enabled(p_store,'training')
    or not food_fitness_private.identity_verified(uid) then
    raise exception 'Cadastro de aluno indisponível. Confirme o e-mail ou telefone da sua conta.' using errcode='42501';
  end if;
  if length(trim(coalesce(p_name,''))) not between 2 and 120 then
    raise exception 'Informe um nome válido.' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fitness-student-profile:'||p_store::text||uid::text,0));
  select case when phone_confirmed_at is not null then coalesce(phone,'') else '' end,
    case when email_confirmed_at is not null then coalesce(email,'') else '' end
    into phone_value,email_value from auth.users where id=uid;
  if p_phone is not null and length(trim(p_phone))>0 and trim(p_phone) is distinct from phone_value then
    raise exception 'O telefone do perfil precisa ser o telefone verificado desta conta.' using errcode='22023';
  end if;
  select client_id into cid from public.food_fitness_students where store_id=p_store and user_id=uid;
  if cid is null then
    insert into public.food_business_clients(store_id,name,email,phone)
      values(p_store,trim(p_name),email_value,phone_value) returning id into cid;
    insert into public.food_fitness_students(store_id,user_id,client_id) values(p_store,uid,cid);
  else
    update public.food_business_clients set name=trim(p_name),email=coalesce(nullif(email_value,''),email),phone=coalesce(nullif(phone_value,''),phone),updated_at=now()
      where id=cid and store_id=p_store and active;
    if not found then raise exception 'Perfil de aluno indisponível.' using errcode='42501'; end if;
  end if;
  return jsonb_build_object('store_id',p_store,'client_id',cid,'professional',false);
end; $$;


commit;

