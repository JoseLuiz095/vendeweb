import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { createTestOAuthHandler } from './handler.ts';

// Disabled unless explicitly enabled. This adapter also requires the service-only
// RPCs described in README.md; missing RPCs fail closed. No secret is logged.
Deno.serve(async(req:Request)=>{
 const url=Deno.env.get('SUPABASE_URL')||'',anon=Deno.env.get('SUPABASE_ANON_KEY')||'';
 const service=Deno.env.get('SUPABASE_SECRET_KEY')||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 let key=new Uint8Array();try{key=Uint8Array.from(atob(Deno.env.get('MP_TEST_ENCRYPTION_KEY_BASE64')||''),c=>c.charCodeAt(0));}catch{/* fail closed */}
 if(!url||!anon||!service)return new Response(JSON.stringify({error:'Conexão de teste indisponível.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
 const options={auth:{persistSession:false,autoRefreshToken:false}};
 const admin=createClient(url,service,options);
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error('STORE_UNAVAILABLE');return data;};
 return createTestOAuthHandler({
  enabled:Deno.env.get('MP_TEST_OAUTH_ENABLED')==='true',
  allowedOrigins:new Set((Deno.env.get('MP_TEST_ALLOWED_ORIGINS')||'').split(',').map(x=>x.trim()).filter(Boolean)),
  clientId:Deno.env.get('MP_TEST_CLIENT_ID')||'',clientSecret:Deno.env.get('MP_TEST_CLIENT_SECRET')||'',redirectUri:Deno.env.get('MP_TEST_REDIRECT_URI')||'',key,
  authenticate:async(jwt)=>{
   const {data:{user},error}=await admin.auth.getUser(jwt);if(error||!user||user.is_anonymous)return null;
   const client=createClient(url,anon,{...options,global:{headers:{Authorization:`Bearer ${jwt}`}}});
   const {data:aal,error:aalError}=await client.auth.mfa.getAuthenticatorAssuranceLevel(jwt);
   if(aalError||(aal?.nextLevel==='aal2'&&aal.currentLevel!=='aal2'))return null;
   return user.id;
  },
  authorize:async(actor,store)=>await rpc('food_mp_test_oauth_authorize_v1',{p_actor:actor,p_store:store})===true,
  status:async(store)=>{
   const row=await rpc('food_mp_test_oauth_status_v1',{p_store:store});
   if(!row||typeof row!=='object'||typeof row.connected!=='boolean')throw new Error('INVALID_STATUS');
   return {connected:row.connected,...(typeof row.seller_id==='string'?{sellerId:row.seller_id}:{})};
  },
  saveState:async(input)=>{const ok=await rpc('food_mp_test_oauth_start_v1',{p_store:input.storeId,p_actor:input.actorId,p_state_hash:input.stateHash,p_verifier:input.sealedVerifier,p_expires_at:new Date(input.expiresAt).toISOString()});if(ok!==true)throw new Error('START_DENIED');},
  consumeState:async(hash,store,actor)=>{
   const row=await rpc('food_mp_test_oauth_consume_v1',{p_state_hash:hash,p_store:store,p_actor:actor});
   if(row===null)return null;
   if(!row||typeof row.sealed_verifier!=='string'||typeof row.claim!=='string')throw new Error('INVALID_CLAIM');
   return {sealedVerifier:row.sealed_verifier,claim:row.claim};
  },
  commitConnection:async(store,actor,claim,connection)=>await rpc('food_mp_test_oauth_commit_v1',{p_store:store,p_actor:actor,p_claim:claim,p_seller_id:connection.sellerId,p_sealed_tokens:connection.sealedTokens,p_expires_at:new Date(connection.expiresAt).toISOString()})===true,
  disconnect:async(store,actor)=>{if(await rpc('food_mp_test_oauth_disconnect_v1',{p_store:store,p_actor:actor})!==true)throw new Error('DISCONNECT_DENIED');},
  exchange:async(endpoint,body)=>{
   if(endpoint!=='https://api.mercadopago.com/oauth/token')throw new Error('INVALID_DESTINATION');
   const response=await fetch(endpoint,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','Accept':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw new Error('OAUTH_FAILED');
   const length=Number(response.headers.get('content-length')||0);if(length>32768)throw new Error('OAUTH_INVALID');
   const reader=response.body?.getReader();if(!reader)throw new Error('OAUTH_INVALID');
   let total=0,text='';const decoder=new TextDecoder();
   for(;;){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>32768){await reader.cancel();throw new Error('OAUTH_INVALID');}text+=decoder.decode(value,{stream:true});}
   return JSON.parse(text+decoder.decode());
  },
 })(req);
});
