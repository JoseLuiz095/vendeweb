import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const store='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
async function setup(){
 const db=new PGlite();
 await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create table public.food_stores(id uuid primary key,active boolean,access_status text);create table public.food_store_users(store_id uuid,user_id uuid,active boolean,role text,must_change_password boolean);create table public.food_mp_test_oauth_allowed_stores(store_id uuid primary key);
 create table public.food_mp_test_oauth_slots(store_id uuid primary key,seller_id text,token_expires_at timestamptz,generation bigint,sealed_tokens text);
 insert into public.food_stores values ('${store}',true,'online'),('${other}',true,'online');
 insert into public.food_store_users values ('${store}','44444444-4444-4444-8444-444444444444',true,'owner',false);
 insert into public.food_mp_test_oauth_allowed_stores values ('${store}');
 insert into public.food_mp_test_oauth_slots values ('${store}','123',now()+interval '1 hour',1,'sealed-test');
 grant usage on schema public to service_role; grant select,update on public.food_stores,public.food_store_users to service_role;grant select on public.food_mp_test_oauth_allowed_stores to service_role; grant select,update on public.food_mp_test_oauth_slots to service_role;`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261119190946_food_mp_isolated_test_orders.sql',import.meta.url),'utf8'));
 await db.exec(await readFile(new URL('../supabase/migrations/20261125172859_food_mp_isolated_record_failure.sql',import.meta.url),'utf8'));
 return db;
}
const q=async(db,sql,params=[]) => (await db.query(sql,params)).rows[0].v;
test('registra apenas recusa vinculada à loja, sem marcar pago ou mexer no estoque',async()=>{
 const db=await setup();try{
  await db.exec('set role service_role');const actor='44444444-4444-4444-8444-444444444444';
  const o=await q(db,"select public.food_mp_isolated_create_v1($1,$2,'pix',gen_random_uuid()) v",[store,actor]);
  const snapshot=await q(db,'select public.food_mp_isolated_reserve_v1($1,$2,$3) v',[store,actor,o.order_id]);
  assert.equal(await q(db,"select public.food_mp_isolated_bind_v1($1,$2,$3,'ORD123') v",[store,actor,o.order_id]),true);
  const fail=(s,seller,ref,amount)=>q(db,"select public.food_mp_isolated_record_failure_v1($1,$2,$3,$4,'ORD123',$5,$6) v",[s,actor,o.order_id,seller,ref,amount]);
  assert.equal(await fail(other,'123',snapshot.external_reference,50),'conflict');
  assert.equal(await fail(store,'999',snapshot.external_reference,50),'conflict');
  assert.equal(await fail(store,'123','other',50),'conflict');
  assert.equal(await fail(store,'123',snapshot.external_reference,51),'conflict');
  assert.equal(await fail(store,'123',snapshot.external_reference,50),'recorded');
  assert.equal(await fail(store,'123',snapshot.external_reference,50),'duplicate');
  const saved=await q(db,"select jsonb_build_object('payment',payment_status,'stock',stock_remaining,'fulfillment',fulfillment_status) v from public.food_mp_isolated_test_orders where id=$1",[o.order_id]);
  assert.deepEqual(saved,{payment:'failed',stock:10,fulfillment:'open'});
  await db.exec('reset role;set role anon');
  await assert.rejects(db.query("select public.food_mp_isolated_record_failure_v1($1,$2,$3,'123','ORD123',$4,50)",[store,actor,o.order_id,snapshot.external_reference]));
 }finally{await db.close()}
});
test('recusa não substitui pagamento já confirmado',async()=>{
 const db=await setup();try{
  await db.exec('set role service_role');const actor='44444444-4444-4444-8444-444444444444';
  const o=await q(db,"select public.food_mp_isolated_create_v1($1,$2,'pix',gen_random_uuid()) v",[store,actor]);
  const snapshot=await q(db,'select public.food_mp_isolated_reserve_v1($1,$2,$3) v',[store,actor,o.order_id]);
  await q(db,"select public.food_mp_isolated_bind_v1($1,$2,$3,'ORD123') v",[store,actor,o.order_id]);
  assert.equal(await q(db,"select public.food_mp_isolated_apply_admin_v1($1,$2,$3,'123','ORD123','PAY1',50,'processed','accredited') v",[store,actor,o.order_id]),'applied');
  assert.equal(await q(db,"select public.food_mp_isolated_record_failure_v1($1,$2,$3,'123','ORD123',$4,50) v",[store,actor,o.order_id,snapshot.external_reference]),'conflict');
 }finally{await db.close()}
});
test('pedido e estoque de teste são isolados, por loja, e começam pendentes',async()=>{
 const db=await setup();try{
  await db.exec('set role service_role');
  const order=await q(db,"select public.food_mp_isolated_create_v1($1,'44444444-4444-4444-8444-444444444444','pix',gen_random_uuid()) v",[store]);
  assert.equal(order.payment_status,'pending');assert.equal(order.fulfillment_status,'open');assert.equal(order.stock_remaining,10);
  assert.equal(await q(db,"select public.food_mp_isolated_create_v1($1,'44444444-4444-4444-8444-444444444444','pix',gen_random_uuid()) v",[other]),null);
  await db.exec('reset role;set role anon');
  await assert.rejects(db.query('select * from public.food_mp_isolated_test_orders'));
 }finally{await db.close()}
});
test('somente confirmação vinculada credita uma vez e não conclui a entrega',async()=>{
 const db=await setup();try{
  await db.exec('set role service_role');
  const o=await q(db,"select public.food_mp_isolated_create_v1($1,'44444444-4444-4444-8444-444444444444','card',gen_random_uuid()) v",[store]);
  const bind=await q(db,"select public.food_mp_isolated_bind_v1($1,'44444444-4444-4444-8444-444444444444',$2,'ORD123') v",[store,o.order_id]);assert.equal(bind,true);
  const apply=(seller,amount,payment,status,detail)=>q(db,'select public.food_mp_isolated_apply_v1($1,$2,$3,$4,$5,$6,$7,$8) v',[store,o.order_id,seller,'ORD123',payment,amount,status,detail]);
  assert.equal(await apply('456',50,'PAY1','processed','accredited'),'conflict');
  assert.equal(await apply('123',51,'PAY1','processed','accredited'),'conflict');
  assert.equal(await apply('123',50,'PAY1','processing','in_process'),'conflict');
  assert.equal(await apply('123',50,'PAY1','processed','accredited'),'applied');
  assert.equal(await apply('123',50,'PAY1','processed','accredited'),'duplicate');
  assert.equal(await apply('123',50,'PAY2','processed','accredited'),'conflict');
  const saved=await q(db,'select jsonb_build_object(\'payment\',payment_status,\'fulfillment\',fulfillment_status,\'stock\',stock_remaining) v from public.food_mp_isolated_test_orders where id=$1',[o.order_id]);
  assert.deepEqual(saved,{payment:'paid',fulfillment:'open',stock:9});
 }finally{await db.close()}
});
test('impede reaproveitar cobrança ou pagamento, e invalida conexão alterada',async()=>{
 const db=await setup();try{
  await db.exec('set role service_role');
  const first=await q(db,"select public.food_mp_isolated_create_v1($1,'44444444-4444-4444-8444-444444444444','pix',gen_random_uuid()) v",[store]);
  const second=await q(db,"select public.food_mp_isolated_create_v1($1,'44444444-4444-4444-8444-444444444444','pix',gen_random_uuid()) v",[store]);
  assert.equal(await q(db,"select public.food_mp_isolated_bind_v1($1,'44444444-4444-4444-8444-444444444444',$2,'ORD123') v",[store,first.order_id]),true);
  assert.equal(await q(db,"select public.food_mp_isolated_bind_v1($1,'44444444-4444-4444-8444-444444444444',$2,'ORD123') v",[store,second.order_id]),false);
  assert.equal(await q(db,"select public.food_mp_isolated_bind_v1($1,'44444444-4444-4444-8444-444444444444',$2,'ORD456') v",[store,second.order_id]),true);
  const apply=(id,provider,payment)=>q(db,"select public.food_mp_isolated_apply_v1($1,$2,'123',$3,$4,50,'processed','accredited') v",[store,id,provider,payment]);
  assert.equal(await apply(first.order_id,'ORD123','PAY1'),'applied');
  assert.equal(await apply(second.order_id,'ORD456','PAY1'),'conflict');
  await db.exec('update public.food_mp_test_oauth_slots set generation=2');
  assert.equal(await apply(second.order_id,'ORD456','PAY2'),'conflict');
 }finally{await db.close()}
});
test('repetição de criação devolve o mesmo pedido e recusa mudar a forma',async()=>{
 const db=await setup();try{
  await db.exec('set role service_role');
  const request='33333333-3333-4333-8333-333333333333';
  const first=await q(db,"select public.food_mp_isolated_create_v1($1,'44444444-4444-4444-8444-444444444444','pix',$2) v",[store,request]);
  const again=await q(db,"select public.food_mp_isolated_create_v1($1,'44444444-4444-4444-8444-444444444444','pix',$2) v",[store,request]);
  assert.equal(first.order_id,again.order_id);
  assert.equal(await q(db,"select public.food_mp_isolated_create_v1($1,'44444444-4444-4444-8444-444444444444','card',$2) v",[store,request]),null);
 }finally{await db.close()}
});
test('reserva sempre usa valores imutáveis do servidor e não atravessa lojas',async()=>{
 const db=await setup();try{
  await db.exec('set role service_role');
  const o=await q(db,"select public.food_mp_isolated_create_v1($1,'44444444-4444-4444-8444-444444444444','pix',gen_random_uuid()) v",[store]);
  const a=await q(db,"select public.food_mp_isolated_reserve_v1($1,'44444444-4444-4444-8444-444444444444',$2) v",[store,o.order_id]);
  const b=await q(db,"select public.food_mp_isolated_reserve_v1($1,'44444444-4444-4444-8444-444444444444',$2) v",[store,o.order_id]);
  assert.equal(a.total,'50.00');assert.equal(a.idempotency_key,b.idempotency_key);assert.equal(a.sealed_tokens,'sealed-test');
  assert.equal(await q(db,"select public.food_mp_isolated_reserve_v1($1,'44444444-4444-4444-8444-444444444444',$2) v",[other,o.order_id]),null);
  await db.exec('update public.food_mp_test_oauth_slots set generation=2');
  assert.equal(await q(db,"select public.food_mp_isolated_reserve_v1($1,'44444444-4444-4444-8444-444444444444',$2) v",[store,o.order_id]),null);
 }finally{await db.close()}
});
test('revogar administrador impede criar, reservar e vincular na transação',async()=>{
 const db=await setup();try{
  await db.exec('set role service_role');
  const actor='44444444-4444-4444-8444-444444444444';
  const o=await q(db,"select public.food_mp_isolated_create_v1($1,$2,'pix',gen_random_uuid()) v",[store,actor]);
  await db.exec('update public.food_store_users set active=false');
  assert.equal(await q(db,"select public.food_mp_isolated_create_v1($1,$2,'pix',gen_random_uuid()) v",[store,actor]),null);
  assert.equal(await q(db,'select public.food_mp_isolated_reserve_v1($1,$2,$3) v',[store,actor,o.order_id]),null);
  assert.equal(await q(db,"select public.food_mp_isolated_bind_v1($1,$2,$3,'ORD123') v",[store,actor,o.order_id]),false);
 }finally{await db.close()}
});
test('tipo e bandeira de cartão ficam vinculados ao pedido sem guardar token',async()=>{
 const db=await setup();try{
  await db.exec('set role service_role');const actor='44444444-4444-4444-8444-444444444444';
  const o=await q(db,"select public.food_mp_isolated_create_v1($1,$2,'card',gen_random_uuid()) v",[store,actor]);
  const claim=(method,type)=>q(db,'select public.food_mp_isolated_card_method_v1($1,$2,$3,$4,$5) v',[store,actor,o.order_id,method,type]);
  assert.equal(await claim('visa','credit_card'),true);
  assert.equal(await claim('visa','credit_card'),true);
  assert.equal(await claim('master','credit_card'),false);
  assert.equal(await claim('visa','debit_card'),false);
  const snapshot=await q(db,'select public.food_mp_isolated_reserve_v1($1,$2,$3) v',[store,actor,o.order_id]);
  assert.equal(snapshot.card_method_id,'visa');assert.equal(snapshot.card_type,'credit_card');
  assert.equal(JSON.stringify(snapshot).includes('card_token'),false);
 }finally{await db.close()}
});
test('consulta administrativa não confirma após revogação do acesso',async()=>{
 const db=await setup();try{
  await db.exec('set role service_role');const actor='44444444-4444-4444-8444-444444444444';
  const o=await q(db,"select public.food_mp_isolated_create_v1($1,$2,'pix',gen_random_uuid()) v",[store,actor]);
  assert.equal(await q(db,"select public.food_mp_isolated_bind_v1($1,$2,$3,'ORD123') v",[store,actor,o.order_id]),true);
  await db.exec('update public.food_store_users set active=false');
  assert.equal(await q(db,"select public.food_mp_isolated_apply_admin_v1($1,$2,$3,'123','ORD123','PAY1',50,'processed','accredited') v",[store,actor,o.order_id]),'conflict');
 }finally{await db.close()}
});
