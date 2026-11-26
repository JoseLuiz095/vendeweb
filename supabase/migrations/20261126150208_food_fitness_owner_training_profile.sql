-- Treinamento Fitness: proprietário responsável por padrão; CREF informativo.
-- CREF sem número é classificação interna de área, não certificação verificada.
-- Não preenche registros, não altera Nutrição, alunos, pagamentos ou outras lojas.
begin;

alter table public.food_service_professionals
  drop constraint food_service_professionals_registration_check;
alter table public.food_service_professionals
  add constraint food_service_professionals_registration_check check (
    length(trim(registration)) between 3 and 50 or (kind='training' and registration='')
  );

create function food_business_private.guard_optional_training_registration()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.registration='' and not (
    new.kind='training' and new.council='CREF'
    and food_fitness_private.is_fitness(new.store_id)
    and exists(select 1 from public.food_store_users u
      where u.store_id=new.store_id and u.user_id=new.user_id and u.role='owner' and u.active)
  ) then
    raise exception 'Registro opcional somente para o proprietário Fitness em Treinamento.' using errcode='23514';
  end if;
  return new;
end; $$;
revoke all on function food_business_private.guard_optional_training_registration() from public,anon,authenticated;
create trigger food_service_professional_optional_registration
before insert or update of registration,kind,council,store_id,user_id on public.food_service_professionals
for each row execute function food_business_private.guard_optional_training_registration();

create or replace function public.food_service_professional_upsert(
  p_store uuid,p_user uuid,p_name text,p_kind text,p_council text,p_registration text,p_active boolean default true
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.food_service_professionals%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended('food-business:'||p_store::text,0));
  perform 1 from public.food_store_users u where u.store_id=p_store and u.user_id=auth.uid() and u.role='owner' and u.active for share;
  if not found then
    raise exception 'Somente o proprietário pode confirmar o prestador.' using errcode='42501';
  end if;
  if coalesce(trim(p_registration),'')='' then
    perform 1 from public.food_business_profiles b where b.store_id=p_store and b.primary_segment='fitness' for share;
  end if;
  if p_user is null or not exists(select 1 from public.food_store_users u where u.store_id=p_store and u.user_id=p_user and u.active and u.role in ('owner','admin','manager','attendant')) then
    raise exception 'A conta do prestador deve pertencer à mesma loja.' using errcode='42501';
  end if;
  -- Somente o próprio proprietário Fitness pode omitir o registro de treinamento.
  if coalesce(trim(p_registration),'')='' and not (
    p_user=auth.uid() and p_kind='training' and p_council='CREF'
    and food_fitness_private.is_fitness(p_store)
    and food_business_private.module_enabled(p_store,'training')
  ) then
    raise exception 'Informe o registro para este prestador e área.' using errcode='22023';
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
  values(p_store,p_user,trim(p_name),p_kind,p_council,coalesce(trim(p_registration),''),p_active,auth.uid(),now())
  on conflict(store_id,user_id) do update set name=excluded.name,kind=excluded.kind,council=excluded.council,
    registration=excluded.registration,active=excluded.active,confirmed_by=excluded.confirmed_by,confirmed_at=now()
  returning * into v;
  insert into public.food_business_audit(store_id,actor_id,action,details)
    values(p_store,auth.uid(),'service.professional',jsonb_build_object('user_id',p_user,'active',p_active));
  return jsonb_build_object('user_id',v.user_id,'name',v.name,'kind',v.kind,'council',v.council,'registration',v.registration,'active',v.active);
end; $$;

-- Cria apenas o vínculo da própria conta ativa. Nunca sobrescreve um perfil
-- existente, inclusive nome, registro, área e desativação deliberada.
create function public.food_fitness_ensure_owner_training(p_store uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v public.food_service_professionals%rowtype; display_name text; created boolean:=false;
begin
  perform pg_advisory_xact_lock(hashtextextended('food-business:'||p_store::text,0));
  perform 1 from public.food_store_users u where u.store_id=p_store and u.user_id=auth.uid() and u.role='owner' and u.active for share;
  if not found then
    raise exception 'Somente o proprietário ativo desta loja Fitness pode usar seu perfil de treinamento.' using errcode='42501';
  end if;
  perform 1 from public.food_business_profiles b where b.store_id=p_store and b.primary_segment='fitness' for share;
  if auth.uid() is null or not food_fitness_private.is_fitness(p_store)
    or not food_business_private.module_enabled(p_store,'training')
    or not exists(select 1 from public.food_store_users u
      where u.store_id=p_store and u.user_id=auth.uid() and u.role='owner' and u.active)
  then
    raise exception 'Somente o proprietário ativo desta loja Fitness pode usar seu perfil de treinamento.' using errcode='42501';
  end if;
  select * into v from public.food_service_professionals where store_id=p_store and user_id=auth.uid() for update;
  if found and (v.kind<>'training' or not v.active) then
    return jsonb_build_object('created',false,'available',false,'reason','existing_profile');
  end if;
  if exists(select 1 from public.food_fitness_professionals where store_id=p_store and user_id=auth.uid() and not active) then
    return jsonb_build_object('created',false,'available',false,'reason','inactive_profile');
  end if;
  if v.user_id is null then
    select case when length(trim(s.name))>=3 then left(trim(s.name),120) else 'Responsável da loja' end
      into display_name from public.food_stores s where s.id=p_store;
    perform public.food_service_professional_upsert(p_store,auth.uid(),display_name,'training','CREF','',true);
    created:=true;
  end if;
  insert into public.food_fitness_professionals(store_id,user_id,active)
    values(p_store,auth.uid(),true) on conflict(store_id,user_id) do nothing;
  return jsonb_build_object('created',created,'available',true,'user_id',auth.uid());
end; $$;
revoke all on function public.food_fitness_ensure_owner_training(uuid) from public,anon;
grant execute on function public.food_fitness_ensure_owner_training(uuid) to authenticated;

-- A exceção sem registro acompanha o papel de proprietário e o segmento.
-- Saídas desse escopo revogam somente esses perfis; não reativam nem apagam dados.
create function food_business_private.revoke_optional_owner_training()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_table_name='food_store_users' then
    if new.role='owner' and new.active then return new; end if;
    update public.food_fitness_professionals f set active=false
      where f.store_id=new.store_id and f.user_id=new.user_id and f.active
      and exists(select 1 from public.food_service_professionals p
        where p.store_id=f.store_id and p.user_id=f.user_id and p.kind='training' and p.registration='');
    update public.food_service_professionals p set active=false
      where p.store_id=new.store_id and p.user_id=new.user_id and p.kind='training' and p.registration='' and p.active;
  else
    if old.primary_segment<>'fitness' or new.primary_segment='fitness' then return new; end if;
    update public.food_fitness_professionals f set active=false
      where f.store_id=new.store_id and f.active
      and exists(select 1 from public.food_service_professionals p
        where p.store_id=f.store_id and p.user_id=f.user_id and p.kind='training' and p.registration='');
    update public.food_service_professionals p set active=false
      where p.store_id=new.store_id and p.kind='training' and p.registration='' and p.active;
  end if;
  return new;
end; $$;
revoke all on function food_business_private.revoke_optional_owner_training() from public,anon,authenticated;
create trigger food_store_user_revoke_optional_training
  after update of role,active on public.food_store_users for each row
  when (old.role='owner' and old.active and (new.role is distinct from 'owner' or not new.active))
  execute function food_business_private.revoke_optional_owner_training();
create trigger food_segment_revoke_optional_training
  after update of primary_segment on public.food_business_profiles for each row
  when (old.primary_segment is distinct from new.primary_segment)
  execute function food_business_private.revoke_optional_owner_training();

commit;
