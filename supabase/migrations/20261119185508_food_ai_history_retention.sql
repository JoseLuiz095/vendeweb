-- Histórico privado por usuário e loja. Arquivos anexados não são persistidos.
create table public.food_ai_history_policy (
  id boolean primary key default true check (id),
  retention_days integer not null default 30 check (retention_days between 7 and 365),
  updated_at timestamptz not null default now()
);
insert into public.food_ai_history_policy(id) values (true);
alter table public.food_ai_history_policy enable row level security;
revoke all on public.food_ai_history_policy from public, anon, authenticated;

create table public.food_ai_conversations (
  id uuid primary key,
  store_id uuid not null references public.food_stores(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index food_ai_conversations_owner_idx on public.food_ai_conversations(store_id,user_id,updated_at desc);
create index food_ai_conversations_retention_idx on public.food_ai_conversations(updated_at);

create table public.food_ai_messages (
  id bigint generated always as identity primary key,
  conversation_id uuid not null references public.food_ai_conversations(id) on delete cascade,
  turn_id uuid not null,
  role text not null check(role in ('user','assistant')),
  unique(conversation_id,turn_id,role),
  content text not null check(length(content) between 1 and 6000),
  source text check(source in ('consulta','orientacao')),
  actions jsonb not null default '[]'::jsonb check(jsonb_typeof(actions)='array' and octet_length(actions::text)<=3000),
  created_at timestamptz not null default now()
);
create index food_ai_messages_conversation_idx on public.food_ai_messages(conversation_id,id);
alter table public.food_ai_conversations enable row level security;
alter table public.food_ai_messages enable row level security;
revoke all on public.food_ai_conversations, public.food_ai_messages from public, anon, authenticated;
grant select on public.food_ai_conversations, public.food_ai_messages to authenticated;

create policy food_ai_conversations_own on public.food_ai_conversations for select to authenticated
using (user_id=(select auth.uid()) and exists (
  select 1 from public.food_store_users u join public.food_stores s on s.id=u.store_id
  where u.user_id=(select auth.uid()) and u.store_id=food_ai_conversations.store_id
    and u.active and u.role in ('owner','admin') and not coalesce(u.must_change_password,false)
    and s.active and coalesce(s.access_status,'online')='online'
));
create policy food_ai_messages_own on public.food_ai_messages for select to authenticated
using (exists (select 1 from public.food_ai_conversations c where c.id=food_ai_messages.conversation_id));

-- As escritas são atômicas e conferem tanto a identidade quanto a loja da conversa.
create or replace function public.food_ai_append_turn(p_store uuid,p_conversation uuid,p_turn uuid,p_prompt text,p_reply text,p_source text,p_actions jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_user uuid:=auth.uid(); v_owner uuid; v_store uuid;
begin
  if v_user is null or not exists(select 1 from public.food_store_users u join public.food_stores s on s.id=u.store_id
    where u.user_id=v_user and u.store_id=p_store and u.active and u.role in ('owner','admin')
    and not coalesce(u.must_change_password,false) and s.active and coalesce(s.access_status,'online')='online') then
    raise exception 'Acesso indisponível';
  end if;
  if p_conversation is null or p_turn is null or length(trim(coalesce(p_prompt,''))) not between 3 and 2000
     or length(trim(coalesce(p_reply,''))) not between 1 and 6000
     or (p_source is not null and p_source not in ('consulta','orientacao'))
     or jsonb_typeof(coalesce(p_actions,'[]'::jsonb))<>'array' or octet_length(coalesce(p_actions,'[]'::jsonb)::text)>3000 then
    raise exception 'Mensagem inválida';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user::text, 0));
  insert into public.food_ai_conversations(id,store_id,user_id,title) values(p_conversation,p_store,v_user,left(trim(p_prompt),100)) on conflict(id) do nothing;
  select c.user_id,c.store_id into v_owner,v_store from public.food_ai_conversations c where c.id=p_conversation for update;
  if v_owner is distinct from v_user or v_store is distinct from p_store then raise exception 'Acesso indisponível'; end if;
  if exists(select 1 from public.food_ai_messages m where m.conversation_id=p_conversation and m.turn_id=p_turn) then return p_conversation; end if;
  if (select count(*) from public.food_ai_messages m join public.food_ai_conversations c on c.id=m.conversation_id where c.user_id=v_user and m.role='user' and m.created_at>now()-interval '1 minute') >= 30 then raise exception 'Limite temporário atingido'; end if;
  insert into public.food_ai_messages(conversation_id,turn_id,role,content) values(p_conversation,p_turn,'user',trim(p_prompt)) on conflict(conversation_id,turn_id,role) do nothing;
  insert into public.food_ai_messages(conversation_id,turn_id,role,content,source,actions) values(p_conversation,p_turn,'assistant',trim(p_reply),p_source,coalesce(p_actions,'[]'::jsonb)) on conflict(conversation_id,turn_id,role) do nothing;
  update public.food_ai_conversations set updated_at=now() where id=p_conversation;
  return p_conversation;
end $$;
revoke all on function public.food_ai_append_turn(uuid,uuid,uuid,text,text,text,jsonb) from public, anon;
grant execute on function public.food_ai_append_turn(uuid,uuid,uuid,text,text,text,jsonb) to authenticated;

-- Estatísticas agregadas; o Admin Master não recebe o conteúdo das conversas.
create or replace function public.food_ai_history_admin(p_retention_days integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_days integer; v_messages bigint; v_conversations bigint; v_expiring bigint; v_recent_bytes bigint; v_bytes bigint;
begin
  if not public.food_is_platform_admin() then raise exception 'Acesso indisponível'; end if;
  if p_retention_days is not null then
    if p_retention_days not between 7 and 365 then raise exception 'Prazo inválido'; end if;
    update public.food_ai_history_policy set retention_days=p_retention_days,updated_at=now() where id;
  end if;
  select retention_days into v_days from public.food_ai_history_policy where id;
  select count(*),count(*) filter(where updated_at < now() - make_interval(days=>v_days)) into v_conversations,v_expiring from public.food_ai_conversations;
  select count(*),coalesce(sum(octet_length(content)) filter(where created_at>=now()-interval '30 days'),0) into v_messages,v_recent_bytes from public.food_ai_messages;
  select pg_catalog.pg_total_relation_size('public.food_ai_conversations'::regclass)+pg_catalog.pg_total_relation_size('public.food_ai_messages'::regclass) into v_bytes;
  return jsonb_build_object('retention_days',v_days,'conversations',v_conversations,'messages',v_messages,'expired_conversations',v_expiring,'storage_bytes',v_bytes,'recent_text_bytes',v_recent_bytes);
end $$;
revoke all on function public.food_ai_history_admin(integer) from public, anon;
grant execute on function public.food_ai_history_admin(integer) to authenticated;

create or replace function public.food_ai_history_purge() returns void language sql security definer set search_path='' as $$
  delete from public.food_ai_conversations c where c.updated_at < now() - make_interval(days => (select retention_days from public.food_ai_history_policy where id));
$$;
revoke all on function public.food_ai_history_purge() from public, anon, authenticated;
do $$ begin
  if not exists(select 1 from pg_catalog.pg_extension where extname='pg_cron') then raise exception 'pg_cron é necessário para a retenção do histórico de IA'; end if;
  perform cron.schedule('food-ai-history-retention','23 6 * * *','select public.food_ai_history_purge()');
end $$;
