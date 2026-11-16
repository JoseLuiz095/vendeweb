import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { makeSandboxOrdersWebhook } from '../_shared/mercadoPagoOrdersWebhookSandbox.ts';
import { DUOFORMA_PILOT_STORE, makeWebhookAdapter, validWebhookEnvironment } from '../_shared/mpTestWebhookAdapter.ts';

// No browser CORS. This endpoint authenticates server notifications using HMAC.
// Disabled by default; the shared project only accepts the DuoForma test pilot.
Deno.serve(async(req:Request)=>{
 if(req.headers.has('origin'))return new Response(null,{status:403});
 const url=Deno.env.get('SUPABASE_URL')||'',service=Deno.env.get('SUPABASE_SECRET_KEY')||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 let key=new Uint8Array();try {key=Uint8Array.from(atob(Deno.env.get('MP_TEST_ENCRYPTION_KEY_BASE64')||''),c=>c.charCodeAt(0));}catch{/* disabled */}
 const secret=Deno.env.get('MP_TEST_WEBHOOK_SECRET')||'';
 if(!service||!validWebhookEnvironment({enabled:Deno.env.get('MP_TEST_WEBHOOK_ENABLED')||'',stage:Deno.env.get('MP_TEST_WEBHOOK_ENV')||'',url,projectRef:Deno.env.get('MP_TEST_SUPABASE_PROJECT_REF')||'',secret,key}))return new Response(null,{status:503});
 const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await db.rpc(name,args);if(error)throw new Error('database_unavailable');return data;};
 const handler=makeSandboxOrdersWebhook(makeWebhookAdapter({secret,key,allowedStore:Deno.env.get('MP_TEST_WEBHOOK_ENV')==='duoforma-pilot'?DUOFORMA_PILOT_STORE:undefined,repository:{
  lookup:async id=>{const {data,error}=await db.from('food_mp_test_order_attempts').select('store_id,order_id,amount,version').eq('provider_order_id',id).maybeSingle();if(error)throw new Error('database_unavailable');if(!data)return null;const amount=typeof data.amount==='number'?data.amount.toFixed(2):data.amount;return {...data,amount};},
  find:async(store,order,amount,version)=>await rpc('food_mp_test_order_find_v1',{p_store:store,p_order:order,p_amount:amount,p_version:version}),
  apply:async args=>await rpc('food_mp_test_apply_verified_pix_v1',args),
  review:async(id,store)=>{let query=db.from('food_mp_test_order_attempts').update({needs_review:true}).eq('provider_order_id',id);if(store)query=query.eq('store_id',store);const {data,error}=await query.select('provider_order_id').maybeSingle();if(error)throw new Error('database_unavailable');return !!data;},
 },transport:async(endpoint,init)=>{
  if(!/^https:\/\/api\.mercadopago\.com\/v1\/orders\/[A-Za-z0-9_-]{1,128}$/.test(endpoint)||init.method!=='GET')throw new Error('invalid_destination');
  const result=await fetch(endpoint,{...init,redirect:'error',signal:AbortSignal.timeout(10000)});const reader=result.body?.getReader();if(!reader)throw new Error('invalid_response');
  let size=0;const chunks:Uint8Array[]=[];for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw new Error('response_too_large');}chunks.push(value);}
  const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
  return new Response(all,{status:result.status,headers:result.headers});
 }}));
 return await handler(req);
});
