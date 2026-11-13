import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { makeSandboxOrdersHandler } from '../_shared/mercadoPagoOrdersSandboxHandler.ts';
import { openMpTestClaim, type MpTestClaim } from '../_shared/mpTestCheckoutCapability.ts';
import { openTestSecret } from '../_shared/mercadoPagoOAuthTest.ts';
import { brlCents } from '../_shared/mercadoPagoPixTest.ts';

// This endpoint is disabled by default. Its service-only RPCs, data model and
// test-only gate must be installed and verified in staging before enabling it.
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin')||'';
 const allowed=new Set((Deno.env.get('MP_TEST_ALLOWED_ORIGINS')||'').split(',').map(v=>v.trim()).filter(Boolean));
 const headers={'Content-Type':'application/json','Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Vary':'Origin','Access-Control-Allow-Origin':allowed.has(origin)?origin:'null','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info, x-mp-test-capability','Access-Control-Allow-Methods':'POST,OPTIONS'};
 const reply=(status:number,error:string)=>new Response(JSON.stringify({error}),{status,headers});
 if(!origin||!allowed.has(origin))return reply(403,'Origem não autorizada.');
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,'Método não permitido.');
 const secret=Deno.env.get('MP_TEST_CHECKOUT_CAPABILITY_SECRET')||'',url=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SECRET_KEY')||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 let key=new Uint8Array();try{key=Uint8Array.from(atob(Deno.env.get('MP_TEST_ENCRYPTION_KEY_BASE64')||''),c=>c.charCodeAt(0));}catch{/* fail closed */}
 if(Deno.env.get('MP_TEST_CHECKOUT_ENABLED')!=='true'||Deno.env.get('MP_TEST_CHECKOUT_ENV')!=='staging'||!url||!service||secret.length<32||key.length!==32)return reply(503,'Pix de teste indisponível.');
 let claim:MpTestClaim;try{claim=await openMpTestClaim(req.headers.get('x-mp-test-capability')||'',secret);}catch{return reply(403,'Autorização de teste inválida ou expirada.');}
 const admin=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error('UNAVAILABLE');return data;};
 const args=(store:string,order:string)=>({p_store:store,p_order:order,p_amount:claim.amount,p_version:claim.version});
 const parse=async(row:Record<string,unknown>|null)=>{
  if(!row)return null;
  if(row.mode!=='test'||row.provenance!=='oauth_test_token'||typeof row.seller_id!=='string'||typeof row.sealed_tokens!=='string'||typeof row.expires_at!=='string'||!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=Date.now()||typeof row.total!=='string'||typeof row.external_reference!=='string'||typeof row.idempotency_key!=='string'||typeof row.payer_email!=='string'||!(row.provider_order_id===null||typeof row.provider_order_id==='string'))throw new Error('INVALID_TEST_ATTEMPT');
  if(brlCents(row.total)===null||brlCents(row.total)!==brlCents(claim.amount.toFixed(2)))throw new Error('INVALID_TEST_AMOUNT');
  const tokens=JSON.parse(await openTestSecret(key,claim.storeId,'seller-token',row.sealed_tokens));
  if(!tokens||typeof tokens.accessToken!=='string'||!tokens.accessToken)throw new Error('INVALID_TEST_CONNECTION');
  return {connection:{mode:'test' as const,provenance:'oauth_test_token' as const,sellerId:row.seller_id,accessToken:tokens.accessToken},snapshot:{total:row.total,externalReference:row.external_reference,idempotencyKey:row.idempotency_key,payerEmail:row.payer_email},providerOrderId:row.provider_order_id as string|null};
 };
 const handler=makeSandboxOrdersHandler({
  authorize:async(_request,store,order)=>store===claim.storeId&&order===claim.orderId&&await rpc('food_mp_test_checkout_eligible_v1',{p_store:store})===true,
  reserve:async(store,order)=>{const row=await parse(await rpc('food_mp_test_order_reserve_v1',args(store,order)));if(!row)throw new Error('UNAVAILABLE');return row;},
  find:async(store,order)=>await parse(await rpc('food_mp_test_order_find_v1',args(store,order))),
  bind:async(store,order,id)=>{if(await rpc('food_mp_test_order_bind_v1',{...args(store,order),p_provider_order_id:id})!==true)throw new Error('BIND_FAILED');},
  transport:async(endpoint,init)=>{
   if(!/^https:\/\/api\.mercadopago\.com\/v1\/orders(?:\/[A-Za-z0-9_-]{1,128})?$/.test(endpoint))throw new Error('INVALID_DESTINATION');
   const response=await fetch(endpoint,{...init,redirect:'error',signal:AbortSignal.timeout(10000)});
   const reader=response.body?.getReader();if(!reader)throw new Error('INVALID_RESPONSE');
   let size=0;const chunks:Uint8Array[]=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw new Error('RESPONSE_TOO_LARGE');}chunks.push(value);}
   const combined=new Uint8Array(size);let offset=0;for(const part of chunks){combined.set(part,offset);offset+=part.length;}
   return new Response(combined,{status:response.status,headers:response.headers});
  },
 });
 const result=await handler(req);const out=new Headers(result.headers);for(const [name,value] of Object.entries(headers))out.set(name,value);
 return new Response(result.body,{status:result.status,headers:out});
});
