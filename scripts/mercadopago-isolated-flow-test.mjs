import {test} from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {makeIsolatedTestHandler} from '../supabase/functions/_shared/mercadoPagoIsolatedHandler.ts';
import {reconcileIsolatedTestOrder} from '../supabase/functions/_shared/mercadoPagoIsolatedReconcile.ts';
const store='11111111-1111-4111-8111-111111111111',actor='44444444-4444-4444-8444-444444444444',request='33333333-3333-4333-8333-333333333333';
const call=body=>new Request('https://test.example',{method:'POST',headers:{authorization:'Bearer test'},body:JSON.stringify(body)});
const q=async(db,sql,params)=>(await db.query(sql,params)).rows[0]?.v;
for(const paymentType of ['pix','card']) test(`pedido ${paymentType} isolado: criação, cobrança, consulta, confirmação e repetição`,async()=>{
 const db=new PGlite();try{
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
   create table public.food_stores(id uuid primary key,active boolean,access_status text);
   create table public.food_store_users(store_id uuid,user_id uuid,active boolean,role text,must_change_password boolean);
   create table public.food_mp_test_oauth_allowed_stores(store_id uuid primary key);
   create table public.food_mp_test_oauth_slots(store_id uuid primary key,seller_id text,token_expires_at timestamptz,generation bigint,sealed_tokens text);
   insert into public.food_stores values ('${store}',true,'online');
   insert into public.food_store_users values ('${store}','${actor}',true,'owner',false);
   insert into public.food_mp_test_oauth_allowed_stores values ('${store}');
   insert into public.food_mp_test_oauth_slots values ('${store}','123',now()+interval '1 hour',1,'synthetic');
   grant usage on schema public to service_role;grant select,update on public.food_stores,public.food_store_users,public.food_mp_test_oauth_slots to service_role;grant select on public.food_mp_test_oauth_allowed_stores to service_role;`);
  await db.exec(await readFile(new URL('../supabase/migrations/20261119190946_food_mp_isolated_test_orders.sql',import.meta.url),'utf8'));await db.exec('set role service_role');
  let provider,posts=0;
  const transport=async(_url,init)=>{
   if(init.method==='POST'){
    posts++;const body=JSON.parse(init.body);const method=body.transactions.payments[0].payment_method;
    provider={id:'ORD123',user_id:'123',country_code:'BRA',currency:'BRL',external_reference:body.external_reference,total_amount:body.total_amount,total_paid_amount:body.total_amount,status:'processed',status_detail:'accredited',transactions:{payments:[{id:'PAY1',amount:body.total_amount,paid_amount:body.total_amount,status:'processed',status_detail:'accredited',payment_method:{...method,qr_code:'000201-example'}}]}};
   }
   return Response.json(provider);
  };
  const reserve=async(s,a,id)=>{const row=await q(db,'select public.food_mp_isolated_reserve_v1($1,$2,$3) v',[s,a,id]);if(!row)return null;return{connection:{mode:'test',provenance:'oauth_test_token',sellerId:row.seller_id,accessToken:'synthetic',publicKey:'TEST-public'},snapshot:{total:row.total,externalReference:row.external_reference,idempotencyKey:row.idempotency_key,payerEmail:row.payer_email},method:row.method,cardMethodId:row.card_method_id,cardType:row.card_type,providerOrderId:row.provider_order_id};};
  const deps={authenticate:async()=>actor,authorize:async()=>true,verifyTestSeller:async()=>true,
   create:async(s,a,r,m)=>{const v=await q(db,'select public.food_mp_isolated_create_v1($1,$2,$3,$4) v',[s,a,m,r]);return v?{orderId:v.order_id}:null},reserve,prepareCard:async(s,a,id,m,t)=>q(db,'select public.food_mp_isolated_card_method_v1($1,$2,$3,$4,$5) v',[s,a,id,m,t]),
   bind:async(s,a,id,p)=>q(db,'select public.food_mp_isolated_bind_v1($1,$2,$3,$4) v',[s,a,id,p]),transport,
   reconcile:async(s,a,id,attempt)=>reconcileIsolatedTestOrder({storeId:s,localOrderId:id,providerOrderId:attempt.providerOrderId,externalReference:attempt.snapshot.externalReference,sellerAccountId:attempt.connection.sellerId,expectedAmount:attempt.snapshot.total,method:attempt.method,cardMethodId:attempt.cardMethodId,cardType:attempt.cardType,connection:attempt.connection},{verifyTestSeller:async()=>true,transport,apply:async(b,p)=>q(db,"select public.food_mp_isolated_apply_admin_v1($1,$2,$3,$4,$5,$6,$7,'processed','accredited') v",[s,a,id,b.sellerAccountId,b.providerOrderId,p,b.expectedAmount])})};
  const h=makeIsolatedTestHandler(deps);const created=await (await h(call({action:'create',storeId:store,requestId:request,method:paymentType}))).json();
  assert.ok(created.orderId);const payload={action:'pay',storeId:store,orderId:created.orderId,...(paymentType==='card'?{card:{cardToken:'synthetic-card-token',paymentMethodId:'visa',paymentType:'credit_card',installments:1,buyerEmail:'test_payer@example.com'}}:{})};
  if(paymentType==='card')assert.equal((await h(call({action:'card_config',storeId:store,orderId:created.orderId}))).status,200);
  assert.equal((await h(call(payload))).status,200);
  assert.deepEqual(await (await h(call({action:'check',storeId:store,orderId:created.orderId}))).json(),{result:'applied'});
  assert.deepEqual(await (await h(call({action:'check',storeId:store,orderId:created.orderId}))).json(),{result:'duplicate'});
  const saved=await q(db,"select jsonb_build_object('payment',payment_status,'fulfillment',fulfillment_status,'stock',stock_remaining) v from public.food_mp_isolated_test_orders where id=$1",[created.orderId]);
  assert.deepEqual(saved,{payment:'paid',fulfillment:'open',stock:9});assert.equal(posts,1);
 }finally{await db.close()}
});
