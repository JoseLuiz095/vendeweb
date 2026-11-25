import {createClient} from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import {makeIsolatedTestHandler} from '../_shared/mercadoPagoIsolatedHandler.ts';
import {openTestSecret} from '../_shared/mercadoPagoOAuthTest.ts';
import {DUOFORMA_PILOT_STORE} from '../_shared/mpTestWebhookAdapter.ts';
import {reconcileIsolatedTestOrder} from '../_shared/mercadoPagoIsolatedReconcile.ts';
import {isVerifiedTestSeller} from '../_shared/mercadoPagoTestSeller.ts';
import {testOrigins} from '../_shared/mpTestPreviewOrigin.ts';
import {testBuyerEmail} from '../_shared/mercadoPagoTestBuyer.ts';

// Disabled by default. Experimental local adapter: do not deploy until the
// isolated schema, concurrency and provider verification have been reviewed.
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const allowed=testOrigins(Deno.env.get('MP_TEST_ALLOWED_ORIGINS')||'',Deno.env.get('MP_TEST_ISOLATED_PREVIEW_ORIGIN')||'');
 const headers={'Content-Type':'application/json','Cache-Control':'no-store, private','Vary':'Origin','Access-Control-Allow-Origin':allowed.has(origin)?origin:'null','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
 const error=(status:number)=>new Response(JSON.stringify({error:'test_unavailable'}),{status,headers});
 if(!origin||!allowed.has(origin))return error(403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 const url=Deno.env.get('SUPABASE_URL')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||'',service=Deno.env.get('SUPABASE_SECRET_KEY')||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 const buyerEmail=testBuyerEmail(Deno.env.get('MP_TEST_BUYER_EMAIL')||'');
 let key=new Uint8Array();try{key=Uint8Array.from(atob(Deno.env.get('MP_TEST_ENCRYPTION_KEY_BASE64')||''),x=>x.charCodeAt(0));}catch{/* disabled */}
 if(Deno.env.get('MP_TEST_ISOLATED_PILOT_ENABLED')!=='true'||Deno.env.get('MP_TEST_ISOLATED_PILOT_ENV')!=='duoforma-pilot'||!url||!anon||!service||!buyerEmail||key.length!==32)return error(503);
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const admin=createClient(url,service,options);
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error('unavailable');return data;};
 const transport=async(endpoint:string,init:RequestInit)=>{
  if(!/^https:\/\/api\.mercadopago\.com\/v1\/orders(?:\/[A-Za-z0-9_-]{1,128})?$/.test(endpoint))throw new Error('destination');
  const response=await fetch(endpoint,{...init,redirect:'error',signal:AbortSignal.timeout(10000)});
  const reader=response.body?.getReader();if(!reader)throw new Error('response');
  let size=0;const chunks:Uint8Array[]=[];
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw new Error('size');}chunks.push(value);}
  const all=new Uint8Array(size);let at=0;for(const part of chunks){all.set(part,at);at+=part.length;}
  return new Response(all,{status:response.status,headers:response.headers});
 };
 const verifyTestSeller=async(token:string,seller:string)=>{
  const response=await fetch('https://api.mercadolibre.com/users/me',{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok||Number(response.headers.get('content-length')||0)>32768)return false;
  const reader=response.body?.getReader();if(!reader)return false;let size=0,text='';const decoder=new TextDecoder();
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();return false;}text+=decoder.decode(value,{stream:true});}
  return isVerifiedTestSeller(JSON.parse(text+decoder.decode()),seller);
 };
 const handler=makeIsolatedTestHandler({
  verifyTestSeller,
  authenticate:async request=>{
   const jwt=request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];if(!jwt)return null;
   const {data:{user},error}=await admin.auth.getUser(jwt);if(error||!user||user.is_anonymous)return null;
   const client=createClient(url,anon,{...options,global:{headers:{Authorization:`Bearer ${jwt}`}}});
   const {data:aal,error:aalError}=await client.auth.mfa.getAuthenticatorAssuranceLevel(jwt);
   if(aalError||(aal?.nextLevel==='aal2'&&aal.currentLevel!=='aal2'))return null;
   return user.id;
  },
  authorize:async(actor,store)=>store===DUOFORMA_PILOT_STORE&&await rpc('food_mp_test_oauth_authorize_v1',{p_actor:actor,p_store:store})===true,
  create:async(store,actor,requestId,method)=>{
   const row=await rpc('food_mp_isolated_create_v1',{p_store:store,p_actor:actor,p_method:method,p_request:requestId});
   return row&&typeof row.order_id==='string'?{orderId:row.order_id}:null;
  },
  reserve:async(store,actor,order)=>{
   const row=await rpc('food_mp_isolated_reserve_v1',{p_store:store,p_actor:actor,p_order:order});
   if(!row||typeof row.seller_id!=='string'||typeof row.sealed_tokens!=='string'||typeof row.expires_at!=='string'||!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=Date.now()||typeof row.total!=='string'||typeof row.external_reference!=='string'||typeof row.idempotency_key!=='string'||typeof row.payer_email!=='string'||(row.method!=='pix'&&row.method!=='card')||!(row.provider_order_id===null||typeof row.provider_order_id==='string'))return null;
   const tokens=JSON.parse(await openTestSecret(key,store,'seller-token',row.sealed_tokens));
   if(!tokens||typeof tokens.accessToken!=='string'||!tokens.accessToken)return null;
   return {connection:{mode:'test' as const,provenance:'oauth_test_token' as const,sellerId:row.seller_id,accessToken:tokens.accessToken,...(typeof tokens.publicKey==='string'&&/^[A-Za-z0-9_-]{1,256}$/.test(tokens.publicKey)?{publicKey:tokens.publicKey}:{})},snapshot:{total:row.total,externalReference:row.external_reference,idempotencyKey:row.idempotency_key,payerEmail:buyerEmail},method:row.method,cardMethodId:typeof row.card_method_id==='string'?row.card_method_id:undefined,cardType:row.card_type==='credit_card'||row.card_type==='debit_card'?row.card_type:undefined,providerOrderId:row.provider_order_id};
  },
  prepareCard:async(store,actor,order,methodId,type)=>await rpc('food_mp_isolated_card_method_v1',{p_store:store,p_actor:actor,p_order:order,p_method:methodId,p_type:type})===true,
  bind:async(store,actor,order,id)=>await rpc('food_mp_isolated_bind_v1',{p_store:store,p_actor:actor,p_order:order,p_provider:id})===true,
  reconcile:async(store,actor,order,attempt)=>{
   if(!attempt.providerOrderId)return 'review';
   return await reconcileIsolatedTestOrder({storeId:store,localOrderId:order,providerOrderId:attempt.providerOrderId,externalReference:attempt.snapshot.externalReference,sellerAccountId:attempt.connection.sellerId,expectedAmount:attempt.snapshot.total,method:attempt.method,cardMethodId:attempt.cardMethodId,cardType:attempt.cardType,connection:attempt.connection},{
    verifyTestSeller,transport,
    recordFailure:async binding=>await rpc('food_mp_isolated_record_failure_v1',{p_store:binding.storeId,p_actor:actor,p_order:binding.localOrderId,p_seller:binding.sellerAccountId,p_provider:binding.providerOrderId,p_reference:binding.externalReference,p_amount:binding.expectedAmount}),
    apply:async(binding,paymentId)=>await rpc('food_mp_isolated_apply_admin_v1',{p_store:binding.storeId,p_actor:actor,p_order:binding.localOrderId,p_seller:binding.sellerAccountId,p_provider:binding.providerOrderId,p_payment:paymentId,p_amount:binding.expectedAmount,p_status:'processed',p_detail:'accredited'}),
   });
  },
  transport,
 });
 const out=await handler(req),combined=new Headers(out.headers);for(const [name,value] of Object.entries(headers))combined.set(name,value);
 return new Response(out.body,{status:out.status,headers:combined});
});
