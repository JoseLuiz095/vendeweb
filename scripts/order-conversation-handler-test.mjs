import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConversationHandler } from '../supabase/functions/food-order-conversation/handler.ts';
const store='00000000-0000-4000-8000-000000000001', order='00000000-0000-4000-8000-000000000002', actor='00000000-0000-4000-8000-000000000003';
const origin='https://www.vendeweb.com.br';
const req=(body,jwt='')=>new Request('https://example.invalid',{method:'POST',headers:{origin,'content-type':'application/json',...(jwt?{authorization:`Bearer ${jwt}`}:{})},body:JSON.stringify(body)});
const deps=()=>({enabled:true,allowedOrigins:new Set([origin]),authenticate:async jwt=>jwt==='valid'?actor:null,issue:async (_s,_o,_a,digest)=>{assert.match(digest,/^[0-9a-f]{64}$/);return {expires_at:'2026-12-10T00:00:00Z'};},staff:async()=>({messages:[]}),customer:async()=>({messages:[]})});
test('emissão exige sessão e devolve apenas credencial opaca',async()=>{
 const d=deps(),handler=createConversationHandler(d),body={action:'staff_issue',storeId:store,orderId:order};
 assert.equal((await handler(req(body))).status,401);
 const result=await handler(req(body,'valid'));assert.equal(result.status,200);
 const data=await result.json();assert.match(data.token,/^[A-Za-z0-9_-]{43}$/);assert.equal(data.expiresAt,'2026-12-10T00:00:00Z');
 assert.match(result.headers.get('cache-control'),/no-store/);
});
test('cliente não envia mensagens sem credencial ou chave de repetição válidas',async()=>{
 let called=0;const d=deps();d.customer=async()=>{called++;return {messages:[]}};const handler=createConversationHandler(d);
 assert.equal((await handler(req({action:'customer_list',token:'invalid'}))).status,400);
 assert.equal((await handler(req({action:'customer_send',token:'a'.repeat(43),message:'ok'}))).status,400);
 assert.equal(called,0);
});
test('desativado e origem desconhecida falham fechados',async()=>{
 const d=deps();d.enabled=false;const handler=createConversationHandler(d);
 assert.equal((await handler(req({}))).status,503);
 const request=new Request('https://example.invalid',{method:'POST',headers:{origin:'https://evil.invalid'},body:'{}'});
 assert.equal((await handler(request)).status,403);
});
