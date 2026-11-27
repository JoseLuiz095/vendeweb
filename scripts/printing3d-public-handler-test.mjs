import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const compiled=ts.transpileModule(readFileSync('supabase/functions/_shared/printing3dPublicHandler.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const {createPrinting3dPublicHandler,validPrintAttachment}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const store='10000000-0000-4000-8000-000000000001',id='20000000-0000-4000-8000-000000000001',origin='https://www.vendeweb.com.br';
const payload={action:'assist',store_id:store,description:'Uma caixinha azul com tampa de encaixe',consent:true,turnstileToken:'test-captcha'};
function setup({enabled=true,captcha=true,gate=true,limit=false,ai=true,model=true,registerError=false}={}){
  const calls=[],rpc=[],storage=[];
  const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({data:{store_id:store}})};
  const client={from:()=>query,rpc:async(name,args)=>{rpc.push({name,args});return name==='food_modules_rate_limit'?{error:limit?{message:'limit'}:null}:name==='food_printing3d_public_available_v1'?{data:gate}:args.p_action==='authorize_upload'?{data:{prefix:`org/${store}/${id}/`}}:args.p_action==='file_register'&&registerError?{error:{code:'P0001'}}:{data:{id}};},storage:{from:()=>({upload:async(path,data,options)=>{storage.push({action:'upload',path,data,options});return{error:null};},remove:async paths=>{storage.push({action:'remove',paths});return{error:null};}})}};
  const handler=createPrinting3dPublicHandler({env:key=>({PRINTING3D_PUBLIC_ENABLED:String(enabled),SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'private-service-secret',TURNSTILE_SECRET_KEY:'private-turnstile',OPENAI_API_KEY:ai?'private-ai-secret':'',OPENAI_MODEL:model?'configured-vision-model':''})[key],client:()=>client,fetch:async(url,init)=>{calls.push({url,body:init?.body&&typeof init.body==='string'?JSON.parse(init.body):init?.body});return new Response(JSON.stringify(String(url).includes('siteverify')?{success:captcha,hostname:'www.vendeweb.com.br',action:'print3d'}:{output_text:'Objeto: caixa azul. Medidas e modelagem precisam de revisão.'}),{status:200});}});
  const request=async(body=payload,headers={})=>{const response=await handler(new Request('https://edge.example.invalid',{method:'POST',headers:{Origin:origin,...(body instanceof FormData?{}:{'Content-Type':'application/json'}),...headers},body:body instanceof FormData?body:JSON.stringify(body)}));return{status:response.status,body:await response.json()};};return{request,calls,rpc,storage};
}
test('public endpoint is gated and verifies origin, rate, store, captcha and consent before AI',async()=>{
  for(const options of [{enabled:false},{gate:false},{limit:true},{captcha:false}]){const s=setup(options);const result=await s.request();assert.ok(result.status>=400);assert.equal(s.calls.filter(c=>c.url.includes('openai')).length,0);}
  const s=setup();assert.equal((await s.request(payload,{Origin:'https://attacker.invalid'})).status,403);assert.equal((await s.request({...payload,consent:false})).status,400);assert.equal(s.calls.filter(c=>c.url.includes('openai')).length,0);
});
test('AI reuses configured model, stores no conversation and receives no contact data',async()=>{
  const s=setup();const result=await s.request({...payload,customer_phone:'11999999999',customer_name:'Should not be sent'});
  assert.equal(result.status,200);assert.equal(result.body.model_generated,false);assert.equal(result.body.review_required,true);
  const body=s.calls.find(c=>c.url.includes('openai')).body;assert.equal(body.model,'configured-vision-model');assert.equal(body.store,false);assert.doesNotMatch(JSON.stringify(body),/Should not be sent|11999999999/);assert.match(body.input[0].content[0].text,/Não gere código/);
  assert.equal((await s.request({...payload,description:'Fale com 11999999999 sobre a peça'})).status,400);
});
test('AI absence fails usefully while regular quote creation does not depend on AI',async()=>{
  const s=setup({ai:false});assert.equal((await s.request()).status,503);
  const result=await s.request({action:'create',store_id:store,request_id:id,token:'c'.repeat(64),data:{description:'A peça'},turnstileToken:'test-captcha'});assert.equal(result.status,200);
  const call=s.rpc.find(c=>c.name==='food_printing3d_public_v1');assert.match(call.args.p_token_hash,/^[a-f0-9]{64}$/);assert.notEqual(call.args.p_token_hash,'c'.repeat(64));
});
test('uploads use a capability, deterministic content hash, private bucket and safe content type',async()=>{
  const s=setup(),form=new FormData();for(const [key,value]of Object.entries({action:'upload',store_id:store,request_id:id,token:'d'.repeat(64)}))form.set(key,value);form.set('file',new File(['solid test\nfacet normal 0 0 1\nendsolid test'],'part.stl'));
  assert.equal((await s.request(form)).status,200);assert.equal(s.calls.length,0);assert.equal(s.rpc.find(c=>c.name==='food_printing3d_public_v1').args.p_action,'authorize_upload');assert.match(s.storage[0].path,/[a-f0-9]{64}\.stl$/);assert.equal(s.storage[0].options.upsert,false);assert.equal(s.storage[0].options.contentType,'application/octet-stream');
  const failure=setup({registerError:true});assert.equal((await failure.request(form)).status,400);assert.equal(failure.storage[1].action,'remove');
});
test('rejects script payloads disguised as models or images',async()=>{
  for(const extension of ['stl','obj','png','3mf','pdf','exe'])assert.equal(validPrintAttachment(new TextEncoder().encode('<html><script>bad()</script></html>'),extension),false);
  const s=setup();const r=await s.request({...payload,photo:{mime:'image/png',data:btoa('not a png')}});assert.equal(r.status,400);assert.equal(s.calls.filter(c=>c.url.includes('openai')).length,0);
});
