import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const store='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',otherActor='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const hash='a'.repeat(43),hash2='b'.repeat(43),cipher='v1.synthetic.cipher';
async function setup(){
 const db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key);create table public.food_stores(id uuid primary key,active boolean,access_status text);create table public.food_store_users(store_id uuid,user_id uuid,active boolean,role text,must_change_password boolean);grant usage on schema public,auth to service_role;grant select,update on public.food_stores,public.food_store_users to service_role;insert into auth.users values ('${actor}'),('${otherActor}');insert into public.food_stores values ('${store}',true,'online'),('${other}',true,'online');insert into public.food_store_users values ('${store}','${actor}',true,'owner',false),('${other}','${otherActor}',true,'owner',false);`);
 await db.exec(await readFile(new URL('../supabase/migrations/20261113105612_food_mp_test_oauth_persistence.sql',import.meta.url),'utf8'));await db.exec(`insert into public.food_mp_test_oauth_allowed_stores values ('${store}');`);await db.exec('set role service_role');return db;
}
const query=async(db,sql,params=[])=> (await db.query(sql,params)).rows[0]?.v;
const start=(db,hashArg=hash)=>query(db,`select public.food_mp_test_oauth_start_v1($1,$2,$3,$4,now()+interval '10 minutes') v`,[store,actor,hashArg,cipher]);
const consume=(db,hashArg=hash,storeArg=store,actorArg=actor)=>query(db,'select public.food_mp_test_oauth_consume_v1($1,$2,$3) v',[hashArg,storeArg,actorArg]);
const commit=(db,claim)=>query(db,`select public.food_mp_test_oauth_commit_v1($1,$2,$3,'123',$4,now()+interval '1 hour') v`,[store,actor,claim,cipher]);

test('state é vinculado a usuário e loja, consumido uma vez e conexão não expõe tokens no status',async()=>{
 const db=await setup();try{
 assert.equal(await start(db),true);assert.equal(await consume(db,hash,other,otherActor),null);
 const claim=await consume(db);assert.ok(claim.claim);assert.equal(await consume(db),null);
 assert.equal(await commit(db,claim.claim),true);assert.equal(await commit(db,claim.claim),false);
 assert.deepEqual(await query(db,'select public.food_mp_test_oauth_status_v1($1) v',[store]),{connected:true,seller_id:'123'});
 }finally{await db.close()}
});
test('desconexão e nova autorização invalidam claims anteriores e roles restritos não executam RPCs',async()=>{
 const db=await setup();try{
 await start(db);const claim=await consume(db);assert.equal(await query(db,'select public.food_mp_test_oauth_disconnect_v1($1,$2) v',[store,actor]),true);assert.equal(await commit(db,claim.claim),false);
 await start(db);const claim2=await consume(db);await start(db,hash2);assert.equal(await commit(db,claim2.claim),false);
 await db.exec('reset role;set role authenticated');await assert.rejects(db.query('select public.food_mp_test_oauth_status_v1($1)',[store]));
 await assert.rejects(db.query('select * from public.food_mp_test_oauth_slots'));
 }finally{await db.close()}
});
test('revogação de acesso antes da gravação impede associação',async()=>{
 const db=await setup();try{
 await start(db);const claim=await consume(db);await db.exec('reset role');await db.query('update public.food_store_users set active=false where store_id=$1 and user_id=$2',[store,actor]);await db.exec('set role service_role');assert.equal(await commit(db,claim.claim),false);
 }finally{await db.close()}
});

test('retirar loja do piloto impede novos inícios e compromissos pendentes',async()=>{
 const db=await setup();try{
 await start(db);const claim=await consume(db);await db.exec('reset role');await db.query('delete from public.food_mp_test_oauth_allowed_stores where store_id=$1',[store]);await db.exec('set role service_role');
 assert.equal(await commit(db,claim.claim),false);assert.equal(await start(db,hash2),false);
 }finally{await db.close()}
});
