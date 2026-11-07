import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
const db = new PGlite();
const a='10000000-0000-4000-8000-000000000001', b='10000000-0000-4000-8000-000000000002', p='20000000-0000-4000-8000-000000000001', l='30000000-0000-4000-8000-000000000001', other='30000000-0000-4000-8000-000000000002';
const query=async(sql,params=[]) => (await db.query(sql,params)).rows;
try {
 await db.exec(`create role anon; create role authenticated; create role service_role;
 create table food_pickup_locations(id uuid,store_id uuid,stock_location_id uuid);
 create table food_stock_locations(id uuid,store_id uuid);
 create table food_orders(id uuid,store_id uuid,total numeric,payment_receipt_version int default 0,status text default 'received',payment_method text default 'pix',payment_status text default 'pending',payment_reported_by_customer boolean default false,payment_reported_at timestamptz,payment_received_at timestamptz,payment_confirmed_by uuid,updated_at timestamptz,delivery_type text default 'pickup',pickup_location_id uuid,stock_location_id uuid);
 create table food_order_receipt_sources(order_id uuid,store_id uuid,pickup_location_id uuid);
 create table food_order_stock_movements(order_id uuid,location_id uuid);
 create table food_platform_event_log(store_id uuid,kind text,action text,result text,route text,metadata jsonb);
 create function food_commit_order_inventory(uuid) returns void language sql as $$ select $$;
 create function food_declare_order_receipt_v1(uuid,uuid,numeric,integer) returns jsonb language sql as $$ select '{}'::jsonb $$;
 create function test_fulfill() returns trigger language plpgsql as $$begin if new.status='delivered' and old.status is distinct from new.status then if new.stock_location_id='${other}' then raise exception 'Estoque insuficiente'; end if; insert into public.food_order_stock_movements values(new.id,new.stock_location_id);end if;return new;end$$;
 create trigger fulfillment before update of status on food_orders for each row execute function test_fulfill();
 insert into food_stock_locations values('${l}','${a}'),('${other}','${a}');insert into food_pickup_locations values('${p}','${a}','${l}');`);
 await db.exec(readFileSync('supabase/migrations/20261107134658_food_receipt_selected_pickup.sql','utf8'));
 const order='40000000-0000-4000-8000-000000000001';
 const insert=async(point,location,status='received')=>{await query('delete from food_orders');await query('delete from food_order_stock_movements');await query('delete from food_platform_event_log');await query('insert into food_orders(id,store_id,total,pickup_location_id,stock_location_id,status) values($1,$2,12.5,$3,$4,$5)',[order,a,point,location,status]);};
 const declare=(store=a)=>query('select food_declare_order_receipt_v1($1,$2,12.5,0) result',[store,order]);
 for(const origin of [null,p]) {await insert(p,l);await query('delete from food_order_receipt_sources');await query('insert into food_order_receipt_sources values($1,$2,$3)',[order,a,origin]);assert.equal((await declare())[0].result.autoPickedUp,true);await declare();assert.equal((await query('select * from food_order_stock_movements')).length,1);assert.equal((await query('select location_id from food_order_stock_movements'))[0].location_id,l);}
 await insert(null,null);assert.equal((await declare())[0].result.autoPickedUp,false);let row=(await query('select * from food_orders'))[0];assert.equal(row.status,'received');assert.equal(row.payment_status,'paid');assert.equal(row.payment_reported_by_customer,true);assert.equal((await query('select * from food_order_stock_movements')).length,0);
 await insert(p,other);await assert.rejects(declare);assert.equal((await query('select payment_status from food_orders'))[0].payment_status,'pending');
 await insert(p,l,'cancelled');await assert.rejects(declare);await insert(p,l);await assert.rejects(()=>declare(b));
 await db.exec(`create or replace function test_fulfill() returns trigger language plpgsql as $$begin raise exception 'Estoque insuficiente';end$$`);await assert.rejects(declare);assert.equal((await query('select payment_status from food_orders'))[0].payment_status,'pending');
 console.log('Cenários sintéticos de ponto, origem, estoque principal, repetição, falha e isolamento passaram. A baixa usa um trigger simulado.');
} finally {await db.close()}
