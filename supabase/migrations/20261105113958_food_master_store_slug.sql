-- Core: alteração de endereço restrita ao Admin Master com MFA.
begin;

create function public.food_guard_store_slug_master()
returns trigger language plpgsql security invoker set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug
     and not (coalesce(public.food_is_platform_admin(),false) and coalesce(auth.jwt()->>'aal','') = 'aal2')
     and not (auth.uid() is null and current_user in ('postgres','supabase_admin','service_role')) then
    raise exception 'Somente o Admin Master com MFA pode alterar o endereço da loja.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger food_store_slug_master_guard
before update of slug on public.food_stores
for each row execute function public.food_guard_store_slug_master();

create function public.food_master_change_store_slug_v1(p_store uuid, p_old_slug text, p_slug text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare current_slug text;
begin
  if auth.uid() is null or not coalesce(public.food_is_platform_admin(),false)
     or coalesce(auth.jwt()->>'aal','') <> 'aal2' then
    raise exception 'Acesso restrito ao Admin Master com MFA.' using errcode = '42501';
  end if;
  if p_slug is null or length(p_slug) not between 3 and 80
     or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'
     or p_slug = any(array['admin','admin-master','produto','carrinho','finalizar','pedido','404','fitness','profissional','modulos','login','cadastro','planos','lojas','api','assets']) then
    raise exception 'Endereço inválido ou reservado. Use letras minúsculas, números e hífens.' using errcode = '22023';
  end if;
  select slug into current_slug from public.food_stores where id = p_store for update;
  if not found then raise exception 'Loja não encontrada.' using errcode = '22023'; end if;
  if current_slug is distinct from p_old_slug then
    raise exception 'O endereço já foi alterado. Recarregue a loja antes de tentar novamente.' using errcode = '40001';
  end if;
  if current_slug = p_slug then return jsonb_build_object('slug', current_slug); end if;
  if exists(select 1 from public.food_stores where lower(slug) = p_slug and id <> p_store) then
    raise exception 'Este endereço já está em uso.' using errcode = '23505';
  end if;
  begin
    update public.food_stores set slug = p_slug, updated_at = now() where id = p_store;
  exception when unique_violation then
    raise exception 'Este endereço já está em uso.' using errcode = '23505';
  end;
  insert into public.food_platform_event_log(actor_user_id,store_id,kind,action,result,route,metadata)
    values(auth.uid(),p_store,'audit','store_slug_changed','success','/admin-master/lojas',
      jsonb_build_object('old_slug',current_slug,'new_slug',p_slug));
  return jsonb_build_object('slug',p_slug);
end;
$$;
revoke all on function public.food_guard_store_slug_master() from public, anon, authenticated;
revoke all on function public.food_master_change_store_slug_v1(uuid,text,text) from public, anon, authenticated;
grant execute on function public.food_master_change_store_slug_v1(uuid,text,text) to authenticated;

-- Resumo agregado, usando as permissões e isolamento já existentes para pedidos.
create function public.food_master_store_order_summary_v1(p_store uuid, p_from timestamptz, p_to timestamptz)
returns jsonb language plpgsql stable security invoker set search_path = ''
as $$
declare summary jsonb;
begin
  if auth.uid() is null or not coalesce(public.food_is_platform_admin(),false)
     or coalesce(auth.jwt()->>'aal','') <> 'aal2' then
    raise exception 'Acesso restrito ao Admin Master com MFA.' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to <= p_from or p_to - p_from > interval '366 days' then
    raise exception 'Período inválido.' using errcode = '22023';
  end if;
  select jsonb_build_object(
    'paidOrders', count(*) filter (where status <> 'cancelled' and payment_status = 'paid'),
    'paidValue', coalesce(sum(total) filter (where status <> 'cancelled' and payment_status = 'paid'),0),
    'cancelledOrders', count(*) filter (where status = 'cancelled')
  ) into summary from public.food_orders
  where store_id = p_store and created_at >= p_from and created_at < p_to;
  return summary;
end;
$$;
revoke all on function public.food_master_store_order_summary_v1(uuid,timestamptz,timestamptz) from public, anon, authenticated;
grant execute on function public.food_master_store_order_summary_v1(uuid,timestamptz,timestamptz) to authenticated;
notify pgrst, 'reload schema';
commit;
