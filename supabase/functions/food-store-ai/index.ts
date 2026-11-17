import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.4';

const origins = new Set(['https://vendeweb.com.br', 'https://www.vendeweb.com.br', 'https://foodweb.joseluizacama.workers.dev']);
Deno.serve(async (request: Request) => {
  const origin = request.headers.get('Origin') || '';
  const headers = { 'Content-Type':'application/json', 'Cache-Control':'no-store', 'Vary':'Origin', 'Access-Control-Allow-Origin':origins.has(origin)?origin:'null', 'Access-Control-Allow-Headers':'authorization, apikey, x-client-info, content-type', 'Access-Control-Allow-Methods':'POST, OPTIONS' };
  const reply = (body:unknown,status=200) => new Response(JSON.stringify(body),{status,headers});
  if(request.method==='OPTIONS') return new Response(null,{status:204,headers});
  if(request.method!=='POST') return reply({error:'Método não permitido.'},405);
  const url=Deno.env.get('SUPABASE_URL')||'', anon=Deno.env.get('SUPABASE_ANON_KEY')||'', service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'', key=Deno.env.get('GEMINI_API_KEY')||'';
  if(!url||!anon||!service||!key) return reply({error:'IA indisponível no momento.'},503);
  const authorization=request.headers.get('Authorization')||'';
  if(!authorization.startsWith('Bearer ')) return reply({error:'Entre na sua conta para continuar.'},401);
  try {
    const client=createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{autoRefreshToken:false,persistSession:false}});
    const {data:{user},error:authError}=await client.auth.getUser(authorization.slice(7));
    if(authError||!user) return reply({error:'Sessão inválida.'},401);
    const input=await request.json() as {store_id?:unknown;prompt?:unknown};
    const store=typeof input.store_id==='string'?input.store_id:'';
    const prompt=typeof input.prompt==='string'?input.prompt.trim():'';
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(store)||prompt.length<3||prompt.length>700||/[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\d\s().-]{8,}\d)/i.test(prompt)) return reply({error:'Escreva de 3 a 700 caracteres sem dados pessoais.'},400);
    const admin=createClient(url,service,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data:membership,error:membershipError}=await admin.from('food_store_users').select('user_id,must_change_password').eq('store_id',store).eq('user_id',user.id).eq('active',true).in('role',['owner','admin']).maybeSingle();
    if(membershipError||!membership||membership.must_change_password) return reply({error:'Acesso indisponível para esta loja.'},403);
    const {data:activeStore,error:storeError}=await admin.from('food_stores').select('id,access_status').eq('id',store).eq('active',true).maybeSingle();
    if(storeError||!activeStore||(activeStore.access_status??'online')!=='online') return reply({error:'Acesso indisponível para esta loja.'},403);
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`store-ai:${store}:${user.id}`));
    const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    const {error:limitError}=await admin.rpc('food_modules_rate_limit',{p_key:fingerprint});
    if(limitError) return reply({error:'Limite atingido ou IA indisponível. Tente mais tarde.'},429);
    const {error:globalLimitError}=await admin.rpc('food_modules_rate_limit',{p_key:'store-ai-global'});
    if(globalLimitError) return reply({error:'Limite atingido ou IA indisponível. Tente mais tarde.'},429);
    const send=()=>fetch('https://generativelanguage.googleapis.com/v1beta/interactions',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':key,'Api-Revision':'2026-05-20'},body:JSON.stringify({model:Deno.env.get('GEMINI_MODEL')||'gemini-3.5-flash-lite',input:prompt,system_instruction:'Você auxilia lojistas do VendeWeb em português. Forneça sugestões concisas que o usuário deve revisar. Não execute ações, não peça dados pessoais, não ofereça diagnóstico ou prescrição de saúde.',store:false,generation_config:{max_output_tokens:450}}),signal:AbortSignal.timeout(12000)});
    let response=await send();
    if(response.status===503){await new Promise(resolve=>setTimeout(resolve,1000));response=await send();}
    if(!response.ok) return reply({error:response.status===429?'Limite da IA atingido. Tente mais tarde.':'IA indisponível no momento.'},response.status===429?429:502);
    const result=await response.json() as {status?:string;steps?:Array<{type?:string;content?:Array<{type?:string;text?:string}>}>};
    const text=result.steps?.filter(s=>s.type==='model_output').flatMap(s=>s.content||[]).find(c=>c.type==='text'&&typeof c.text==='string')?.text?.trim();
    if(result.status!=='completed'||!text) return reply({error:'IA indisponível no momento.'},502);
    return reply({text:text.slice(0,6000)});
  } catch { return reply({error:'IA indisponível no momento.'},502); }
});


