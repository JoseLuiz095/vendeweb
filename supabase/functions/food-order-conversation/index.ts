import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';
import { createConversationHandler } from './handler.ts';

Deno.serve(async (req: Request) => {
  const url=Deno.env.get('SUPABASE_URL')||'';
  const secret=Deno.env.get('SUPABASE_SECRET_KEY')||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  const anon=Deno.env.get('SUPABASE_ANON_KEY')||'';
  if(!url||!secret||!anon)return new Response(JSON.stringify({error:'Conversa indisponível.'}),{status:503,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
  const options={auth:{persistSession:false,autoRefreshToken:false}};
  const admin=createClient(url,secret,options);
  const allowedOrigins=new Set((Deno.env.get('ORDER_CONVERSATION_ALLOWED_ORIGINS')||'https://www.vendeweb.com.br,https://vendeweb.com.br').split(',').map(value=>value.trim()).filter(Boolean));
  return createConversationHandler({
    enabled:Deno.env.get('ORDER_CONVERSATION_ENABLED')==='true',allowedOrigins,
    authenticate:async jwt=>{
      const {data:{user},error}=await admin.auth.getUser(jwt);
      if(error||!user||user.is_anonymous)return null;
      const client=createClient(url,anon,{...options,global:{headers:{Authorization:`Bearer ${jwt}`}}});
      const {data:assurance,error:assuranceError}=await client.auth.mfa.getAuthenticatorAssuranceLevel(jwt);
      if(assuranceError||(assurance?.nextLevel==='aal2'&&assurance.currentLevel!=='aal2'))return null;
      return user.id;
    },
    issue:async(store,order,actor,digest)=>{
      const {data,error}=await admin.rpc('food_order_conversation_issue_v1',{p_store:store,p_order:order,p_actor:actor,p_token_hash:digest});
      if(error||!data?.[0]?.expires_at)throw new Error('ISSUE_FAILED');return data[0];
    },
    staff:async(store,order,actor,action,body,requestId)=>{
      const {data,error}=await admin.rpc('food_order_conversation_staff_v1',{p_store:store,p_order:order,p_actor:actor,p_action:action,p_body:body||null,p_request_id:requestId||null});
      if(error)throw new Error('STAFF_FAILED');return data;
    },
    customer:async(digest,action,body,requestId)=>{
      const {data,error}=await admin.rpc('food_order_conversation_customer_v1',{p_token_hash:digest,p_action:action,p_body:body||null,p_request_id:requestId||null});
      if(error)throw new Error('CUSTOMER_FAILED');return data;
    },
  })(req);
});
