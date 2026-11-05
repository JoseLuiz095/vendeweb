import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
const master='10000000-0000-4000-8000-000000000001', owner='10000000-0000-4000-8000-000000000002';
const store='20000000-0000-4000-8000-000000000001', other='20000000-0000-4000-8000-000000000002';
const session=async(user,aal)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:user,aal})]);await db.exec('set role authenticated');};
try {
  await db.exec([
    "create role anon; create role authenticated; create role service_role; create schema auth;",
    "create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;",
    "create function auth.uid() returns uuid language sql stable as $$select nullif(auth.jwt()->>'sub','')::uuid$$; grant usage on schema auth to authenticated;",
    "create table public.food_platform_admins(user_id uuid,active boolean);",
    "create function public.food_is_platform_admin() returns boolean language sql stable security definer set search_path='' as $$select exists(select 1 from public.food_platform_admins where user_id=auth.uid() and active)$$;",
    "create table public.food_stores(id uuid primary key,slug text unique not null,updated_at timestamptz default now());",
    "create table public.food_orders(store_id uuid,status text,payment_status text,total numeric,created_at timestamptz); grant select on public.food_orders to authenticated;",
    "create table public.food_platform_event_log(actor_user_id uuid,store_id uuid,kind text,action text,result text,route text,metadata jsonb);",
    "alter table public.food_stores enable row level security; create policy store_access on public.food_stores for all to authenticated using(true) with check(true); grant select,update on public.food_stores to authenticated;"
  ].join('\n'));
  await db.query('insert into public.food_platform_admins values($1,true)',[master]);
  await db.query('insert into public.food_stores(id,slug) values($1,$2),($3,$4)',[store,'vicio-docd',other,'outro']);
  await db.exec(readFileSync('supabase/migrations/20261105113958_food_master_store_slug.sql','utf8'));
  await db.query("insert into public.food_orders values($1,'received','paid',50,now()-interval '1 day'),($1,'cancelled','paid',20,now()-interval '1 day'),($2,'received','paid',900,now()-interval '1 day')",[store,other]);
  await session(owner,'aal2');
  await assert.rejects(()=>db.query('select public.food_master_change_store_slug_v1($1,$2,$3)',[store,'vicio-docd','vicio-doce']));
  await assert.rejects(()=>db.query("select public.food_master_store_order_summary_v1($1,now()-interval '30 days',now())",[store]));
  await assert.rejects(()=>db.query('update public.food_stores set slug=$1 where id=$2',['vicio-doce',store]));
  await session(master,'aal1');
  await assert.rejects(()=>db.query('select public.food_master_change_store_slug_v1($1,$2,$3)',[store,'vicio-docd','vicio-doce']));
  await assert.rejects(()=>db.query("select public.food_master_store_order_summary_v1($1,now()-interval '30 days',now())",[store]));
  await session(master,'aal2');
  const summary=(await db.query("select public.food_master_store_order_summary_v1($1,now()-interval '30 days',now()) as result",[store])).rows[0].result;
  assert.equal(Number(summary.paidValue),50);assert.equal(Number(summary.paidOrders),1);assert.equal(Number(summary.cancelledOrders),1);
  for(const invalid of ['admin','profissional','vicio doce','outro']) await assert.rejects(()=>db.query('select public.food_master_change_store_slug_v1($1,$2,$3)',[store,'vicio-docd',invalid]));
  await db.query('select public.food_master_change_store_slug_v1($1,$2,$3)',[store,'vicio-docd','vicio-doce']);
  await assert.rejects(()=>db.query('select public.food_master_change_store_slug_v1($1,$2,$3)',[store,'vicio-docd','outra-tentativa']));
  await db.exec('reset role');
  const result=(await db.query('select slug from public.food_stores where id=$1',[store])).rows[0];
  const audit=(await db.query('select actor_user_id,metadata from public.food_platform_event_log')).rows;
  assert.equal(result.slug,'vicio-doce');
  assert.equal(audit.length,1);
  assert.equal(audit[0].actor_user_id,master);
  assert.equal(audit[0].metadata.old_slug,'vicio-docd');
  assert.equal(audit[0].metadata.new_slug,'vicio-doce');
  console.log('OK: MFA, autorização, endereços reservados e duplicados, atualização concorrente e auditoria.');
} finally { await db.close(); }
