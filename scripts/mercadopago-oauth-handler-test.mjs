import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createTestOAuthHandler,tokenResponseIssue} from '../supabase/functions/food-mercadopago-oauth/handler.ts';
import {isVerifiedTestSeller,providerErrorCategory} from '../supabase/functions/food-mercadopago-oauth/providerError.ts';
import {openTestSecret} from '../supabase/functions/_shared/mercadoPagoOAuthTest.ts';
const store='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',origin='https://app.example.test';
test('diagnóstico do provedor aceita apenas categorias conhecidas',()=>{
 assert.equal(providerErrorCategory('{"error":"invalid_client","message":"secret"}'),'invalid_client');
 assert.equal(providerErrorCategory('{"error":"secret"}'),'other');
 assert.equal(providerErrorCategory('secret'),'other');
});
test('confirma usuário brasileiro de teste com a identidade recebida',()=>{
 const user={id:123,site_id:'MLB',tags:['test_user']};
 assert.equal(isVerifiedTestSeller(user,'123'),true);
 assert.equal(isVerifiedTestSeller(user,'124'),false);
 assert.equal(isVerifiedTestSeller({...user,site_id:'MLA'},'123'),false);
 assert.equal(isVerifiedTestSeller({...user,tags:[]},'123'),false);
});
test('diagnóstico da resposta não revela conteúdo e não aceita ambiente real',()=>{
 const valid={live_mode:false,access_token:'secret',refresh_token:'secret',expires_in:3600,user_id:123};
 assert.equal(tokenResponseIssue(valid),null);
 assert.equal(tokenResponseIssue({...valid,live_mode:true}),'environment_true');
 assert.equal(tokenResponseIssue({...valid,live_mode:undefined}),'environment_missing');
 assert.equal(tokenResponseIssue({...valid,live_mode:'secret'}),'environment_other');
 assert.equal(tokenResponseIssue({...valid,refresh_token:'secret'.repeat(2000)}),'refresh_token');
});
function fixture(){
 let states=new Map(),generation=0,connection=null,calls=0;const key=crypto.getRandomValues(new Uint8Array(32));
 const deps={enabled:true,allowedOrigins:new Set([origin]),clientId:'123',clientSecret:'server-secret',redirectUri:'https://app.example.test/admin/configuracoes',key,now:()=>100000,
  authenticate:async jwt=>jwt==='valid'?'actor':jwt==='other'?'other':null,authorize:async(actor,id)=>actor==='actor'&&id===store,
  status:async()=>connection?{connected:true,sellerId:connection.sellerId}:{connected:false},
  saveState:async state=>states.set(state.stateHash,{...state,generation}),
  consumeState:async(hash,id,actor,now)=>{const s=states.get(hash);if(!s||s.storeId!==id||s.actorId!==actor||s.expiresAt<=now)return null;states.delete(hash);return{sealedVerifier:s.sealedVerifier,claim:String(s.generation)};},
  commitConnection:async(id,actor,claim,c)=>{if(claim!==String(generation))return false;connection=c;return true;},
  disconnect:async()=>{generation++;states.clear();connection=null;},
  exchange:async(url,body)=>{calls++;assert.equal(url,'https://api.mercadopago.com/oauth/token');assert.equal(body.test_token,true);return {live_mode:false,access_token:'synthetic-access',refresh_token:'synthetic-refresh',user_id:123,expires_in:3600};},
  verifyTestSeller:async(token,id)=>token==='synthetic-access'&&id==='123',
 };
 const call=async(body,{token='valid',requestOrigin=origin}={})=>{const r=await createTestOAuthHandler(deps)(new Request('https://app.example.test/function',{method:'POST',headers:{origin:requestOrigin,authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};};
 return {deps,call,getConnection:()=>connection,getCalls:()=>calls};
}
async function start(f){const r=await f.call({action:'start',storeId:store});assert.equal(r.status,200);return new URL(r.body.authorizationUrl).searchParams.get('state');}
test('fluxo teste autentica e vincula somente a loja e usuário autorizados sem expor tokens',async()=>{
 const f=fixture(),state=await start(f);
 const bad=await f.call({action:'complete',storeId:other,state,code:'code'});assert.equal(bad.status,403);assert.equal(f.getCalls(),0);
 const wrong=await f.call({action:'complete',storeId:store,state,code:'code'},{token:'other'});assert.equal(wrong.status,403);
 const ok=await f.call({action:'complete',storeId:store,state,code:'code'});assert.deepEqual(ok.body,{connected:true,environment:'test'});
 assert.equal(f.getConnection().sealedTokens.includes('synthetic'),false);
 const status=await f.call({action:'status',storeId:store});assert.deepEqual(status.body,{connected:true,environment:'test',sellerId:'123'});
 assert.equal(JSON.stringify(status).includes('synthetic'),false);
 const replay=await f.call({action:'complete',storeId:store,state,code:'code'});assert.equal(replay.status,400);assert.equal(f.getCalls(),1);
});
test('chave pública de teste retornada pelo provedor é preservada cifrada',async()=>{
 const f=fixture(),state=await start(f);
 f.deps.exchange=async()=>({live_mode:false,access_token:'synthetic-access',refresh_token:'synthetic-refresh',public_key:'TEST-synthetic-public',user_id:123,expires_in:3600});
 assert.equal((await f.call({action:'complete',storeId:store,state,code:'code'})).status,200);
 const plain=JSON.parse(await openTestSecret(f.deps.key,store,'seller-token',f.getConnection().sealedTokens));
 assert.equal(plain.publicKey,'TEST-synthetic-public');
});
test('falha fechada para credencial real e invalida estado após desconexão',async()=>{
 const f=fixture(),state=await start(f);f.deps.exchange=async()=>({live_mode:true,access_token:'real',refresh_token:'real',expires_in:100,user_id:5});
 assert.equal((await f.call({action:'complete',storeId:store,state,code:'x'})).status,502);assert.equal(f.getConnection(),null);
 const second=await start(f);await f.call({action:'disconnect',storeId:store});
 assert.equal((await f.call({action:'complete',storeId:store,state:second,code:'x'})).status,400);
});
test('resposta sem ambiente exige conta de teste verificada e identidade correspondente',async()=>{
 const response={access_token:'synthetic-access',refresh_token:'synthetic-refresh',user_id:123,expires_in:3600};
 const f=fixture(),state=await start(f);f.deps.exchange=async()=>response;
 assert.equal((await f.call({action:'complete',storeId:store,state,code:'code'})).status,200);
 const g=fixture(),state2=await start(g);g.deps.exchange=async()=>response;g.deps.verifyTestSeller=async()=>false;
 assert.equal((await g.call({action:'complete',storeId:store,state:state2,code:'code'})).status,502);
 assert.equal(g.getConnection(),null);
});
test('desconexão concorrente impede callback tardio de reconectar',async()=>{
 const f=fixture(),state=await start(f);let resolve,startExchange;const started=new Promise(r=>startExchange=r);
 f.deps.exchange=async()=>{startExchange();return await new Promise(r=>resolve=r);};
 const completion=f.call({action:'complete',storeId:store,state,code:'x'});await started;
 await f.call({action:'disconnect',storeId:store});resolve({live_mode:false,access_token:'test',refresh_token:'test',expires_in:100,user_id:5});
 assert.equal((await completion).status,409);assert.equal(f.getConnection(),null);
});
test('origem, login, configuração e tamanho são validados antes da ação',async()=>{
 const f=fixture();assert.equal((await f.call({action:'start',storeId:store},{requestOrigin:'https://evil.test'})).status,403);
 assert.equal((await f.call({action:'start',storeId:store},{token:'bad'})).status,401);
 f.deps.enabled=false;assert.equal((await f.call({action:'status',storeId:store})).status,503);
 f.deps.enabled=true;assert.equal((await f.call({action:'complete',storeId:store,code:'a'.repeat(9000),state:'b'})).status,413);
});
test('falha ao iniciar registra somente a etapa, sem dados sensíveis',async()=>{
 const f=fixture(), captured=[];const original=console.error;
 console.error=(...values)=>captured.push(values);
 try{
  f.deps.clientId='invalid-sensitive-value';
  assert.equal((await f.call({action:'start',storeId:store})).status,400);
  assert.deepEqual(captured,[['mp_test_oauth_failure','start_config']]);
  captured.length=0;f.deps.clientId='123';
  f.deps.saveState=async()=>{throw new Error('sensitive-do-not-log')};
  assert.equal((await f.call({action:'start',storeId:store})).status,400);
  assert.deepEqual(captured,[['mp_test_oauth_failure','start_persistence']]);
 }finally{console.error=original;}
});
test('falha na troca de autorização registra somente etapa segura',async()=>{
 const f=fixture(),state=await start(f),captured=[];const original=console.error;
 console.error=(...values)=>captured.push(values);
 try{
  f.deps.exchange=async()=>{throw new Error('sensitive-do-not-log')};
  assert.equal((await f.call({action:'complete',storeId:store,state,code:'sensitive-code'})).status,400);
  assert.deepEqual(captured,[['mp_test_oauth_failure','complete_exchange']]);
  assert.equal(f.getConnection(),null);
 }finally{console.error=original;}
});
test('diagnóstico do status identifica formato inválido sem registrar valores',async()=>{
 const f=fixture(),captured=[];const original=console.error;console.error=(...values)=>captured.push(values);
 try{
  f.deps.clientId='not-a-valid-id';f.deps.redirectUri='https://app.example.test/admin/configuracoes?secret=synthetic';
  assert.equal((await f.call({action:'status',storeId:store})).status,200);
  assert.deepEqual(captured,[['mp_test_oauth_config','client_id_format'],['mp_test_oauth_config','redirect_format']]);
 }finally{console.error=original;}
});
