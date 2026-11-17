import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source=readFileSync(new URL('../supabase/functions/food-store-ai/index.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText;
async function run({user=true,member=true,store=true,limited=false,status=200,statuses=[],answer={status:'completed',steps:[{type:'model_output',content:[{type:'text',text:'Uma sugestão.'}]}]},prompt='Como divulgar meu negócio?',attachment,history}={}) {
 let handler,calls=0,payload;
 const Deno={serve:f=>handler=f,env:{get:k=>({SUPABASE_URL:'https://test.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'service',GEMINI_API_KEY:'secret'})[k]}};
 const createClient=(_url,key)=>key==='anon'?{auth:{getUser:async()=>({data:{user:user?{id:'user-1'}:null},error:null})}}:{from:table=>{const q={select:()=>q,eq:()=>q,in:()=>q,maybeSingle:async()=>({data:table==='food_stores'?(store?{id:'store'}:null):(member?{user_id:'user-1'}:null),error:null})};return q},rpc:async()=>({error:limited?new Error('limit'):null})};
 const fetch=async(_url,init)=>{calls++;payload=JSON.parse(init.body);return new Response(JSON.stringify(answer),{status:statuses[calls-1]??status,headers:{'Content-Type':'application/json'}})};
 new Function('Deno','createClient','fetch',compiled)(Deno,createClient,fetch);
 const response=await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer token','Content-Type':'application/json'},body:JSON.stringify({store_id:'3659d8c9-0e68-4c86-9e0d-779c36ff28a9',prompt,attachment,history})}));
 return {status:response.status,body:await response.json(),calls,payload};
}
test('requires active membership and store and enforces server limit',async()=>{for(const [options,status] of [[{user:false},401],[{member:false},403],[{store:false},403],[{limited:true},429]]) {const r=await run(options);assert.equal(r.status,status);assert.equal(r.calls,0)}});
test('returns suggestions and safely handles provider failure',async()=>{let r=await run();assert.equal(r.status,200);assert.equal(r.body.text,'Uma sugestão.');r=await run({status:500});assert.equal(r.status,502);assert.ok(!JSON.stringify(r.body).includes('secret'));});
test('retries temporary unavailability once',async()=>{const r=await run({statuses:[503,200]});assert.equal(r.status,200);assert.equal(r.calls,2)});
test('rejects invalid and identifying content before provider',async()=>{for(const prompt of ['a','contato pessoa@example.com']) {const r=await run({prompt});assert.equal(r.status,400);assert.equal(r.calls,0)}});
test('sends a verified image and bounded conversation without storing it',async()=>{const r=await run({history:[{role:'user',text:'Quero ideias para o catálogo'},{role:'assistant',text:'Conte mais sobre seus produtos'}],attachment:{mime:'image/png',data:'iVBORw0KGgoAAAAA',approved:true}});assert.equal(r.status,200);assert.equal(r.payload.store,false);assert.equal(r.payload.input[1].type,'image');assert.equal(r.payload.input[1].mime_type,'image/png');assert.match(r.payload.input[0].text,/catálogo/)});
test('rejects unsupported, malformed and mislabeled attachments',async()=>{for(const attachment of [{mime:'text/html',data:'PGh0bWw+'},{mime:'image/png',data:'bm90LWltYWdl'},{mime:'application/pdf',data:'@@@'}]){const r=await run({attachment});assert.equal(r.status,400);assert.equal(r.calls,0)}});
test('requires permission and rejects excessive history',async()=>{for(const opts of [{attachment:{mime:'image/png',data:'iVBORw0KGgoAAAAA'}},{history:Array.from({length:7},()=>({role:'user',text:'Olá'}))}]){const r=await run(opts);assert.equal(r.status,400);assert.equal(r.calls,0)}});
test('supports a PDF document',async()=>{const r=await run({attachment:{mime:'application/pdf',data:'JVBERi0xLjcK',approved:true}});assert.equal(r.status,200);assert.equal(r.payload.input[1].type,'document')});



