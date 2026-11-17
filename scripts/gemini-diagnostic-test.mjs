import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source=readFileSync(new URL('../supabase/functions/food-gemini-diagnostic/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
async function run({user=true,aal='aal2',master=true,limited=false,status=200,statuses=[],configured=true,providerResponse={status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'Teste concluído.'}]}]}}={}) {
  let handler, calls=0, payload, sentHeaders;
  const Deno={serve:f=>handler=f,env:{get:k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',GEMINI_API_KEY:configured?'fake-key':''})[k]}};
  const createClient=(_url,key)=>key==='anon'?{auth:{getUser:async()=>({data:{user:user?{id:'user-1'}:null},error:null}),mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:aal},error:null})}}}:{from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:master?{id:'admin'}:null,error:null})};return q},rpc:async()=>({error:limited?new Error('limit'):null})};
  const mockFetch=async(_url,init)=>{calls++;payload=JSON.parse(init.body);sentHeaders=init.headers;return new Response(JSON.stringify(providerResponse),{status:statuses[calls-1]??status,headers:{'Content-Type':'application/json'}})};
  new Function('Deno','createClient','fetch',compiled)(Deno,createClient,mockFetch);
  const response=await handler(new Request('https://example.invalid',{method:'POST',headers:{Authorization:'Bearer test-user'}}));
  return {status:response.status,body:await response.json(),calls,payload,sentHeaders};
}
test('restricts diagnostics to authenticated MFA master and fails closed on rate limit',async()=>{
 for (const [opts,expected] of [[{user:false},401],[{aal:'aal1'},403],[{master:false},403],[{limited:true},429],[{configured:false},503]]) {const r=await run(opts);assert.equal(r.status,expected);assert.equal(r.calls,0)}
});
test('retries a temporary provider failure once',async()=>{const r=await run({statuses:[503,200]});assert.equal(r.status,200);assert.equal(r.calls,2)});
test('sends only a fixed test and does not reveal key',async()=>{
 const r=await run();assert.equal(r.status,200);assert.equal(r.calls,1);assert.equal(r.payload.model,'gemini-3.5-flash-lite');assert.equal(r.payload.store,false);assert.equal(r.payload.generation_config.max_output_tokens,256);assert.equal(r.sentHeaders['x-goog-api-key'],'fake-key');assert.ok(!JSON.stringify(r.body).includes('fake-key'));
});
test('rejects incomplete and failed provider replies',async()=>{
 for(const opts of [{status:429},{status:500},{providerResponse:{status:'incomplete',steps:[]}}, {providerResponse:{status:'completed',steps:[]}}]) {const r=await run(opts);assert.notEqual(r.status,200);assert.ok(!JSON.stringify(r.body).includes('fake-key'))}
});

