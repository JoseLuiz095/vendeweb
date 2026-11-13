import {test} from 'node:test';import assert from 'node:assert/strict';
import {DUOFORMA_PILOT_STORE,makeWebhookAdapter,validWebhookEnvironment} from '../supabase/functions/_shared/mpTestWebhookAdapter.ts';
import {sealTestSecret} from '../supabase/functions/_shared/mercadoPagoOAuthTest.ts';
const key=new Uint8Array(32).fill(7),ref='abcdefghijklmnopqrst';
const env={enabled:'true',stage:'staging',url:`https://${ref}.supabase.co`,projectRef:ref,secret:'x'.repeat(32),key};
test('ambiente exige staging isolado, chave, segredo e recusa projeto compartilhado',()=>{assert.equal(validWebhookEnvironment(env),true);for(const p of [{enabled:'false'},{stage:'production'},{secret:'x'},{key:new Uint8Array()},{url:'https://evil.test'},{url:'https://elttryavkeartoxgdgse.supabase.co',projectRef:'elttryavkeartoxgdgse'}])assert.equal(validWebhookEnvironment({...env,...p}),false)});
test('vínculo e RPC preservam versão e dados autoritativos',async()=>{const sealed=await sealTestSecret(key,'store','seller-token',JSON.stringify({accessToken:'private-token'}));let applied;const repo={lookup:async()=>({store_id:'store',order_id:'order',amount:'10.00',version:3}),find:async()=>({mode:'test',provenance:'oauth_test_token',seller_id:'123',sealed_tokens:sealed,expires_at:'2099-01-01T00:00:00Z',total:'10.00',external_reference:'ref',provider_order_id:'ORD1'}),apply:async args=>{applied=args;return 'duplicate'},review:async()=>true};const adapter=makeWebhookAdapter({secret:'s',key,repository:repo,transport:async()=>{throw Error()}});const b=await adapter.findBinding('ORD1');assert.equal(b.connection.accessToken,'private-token');const {connection,...safe}=b;assert.equal(await adapter.applyVerified({...safe,paymentId:'PAY1',idempotencyKey:'mp:test:123:PAY1'}),'duplicate');assert.equal(applied.p_version,3);assert.equal(applied.p_status,'processed');assert.equal(applied.p_detail,'accredited');assert.equal(JSON.stringify(applied).includes('private-token'),false);await adapter.recordReview({providerOrderId:'ORD1',reason:'refund'});});
test('vínculo divergente, token vencido ou revisão não persistida falham fechados',async()=>{const repo={lookup:async()=>({store_id:'store',order_id:'order',amount:'10.00',version:3}),find:async()=>({mode:'test',provenance:'oauth_test_token',seller_id:'123',sealed_tokens:'x',expires_at:'2000-01-01',total:'10.00',external_reference:'ref',provider_order_id:'ORD1'}),apply:async()=> 'bad',review:async()=>false};const a=makeWebhookAdapter({secret:'s',key,repository:repo,transport:async()=>{throw Error()}});await assert.rejects(a.findBinding('ORD1'));await assert.rejects(a.recordReview({providerOrderId:'ORD1',reason:'x'}));await assert.rejects(a.applyVerified({storeId:'s',localOrderId:'o',sellerAccountId:'1',providerOrderId:'ORD1',paymentId:'PAY1',externalReference:'r',expectedAmount:'1.00',version:1,idempotencyKey:'x'}));});

test('projeto compartilhado só aceita modo explícito do piloto',()=>{
 const shared={...env,url:'https://elttryavkeartoxgdgse.supabase.co',projectRef:'elttryavkeartoxgdgse'};
 assert.equal(validWebhookEnvironment(shared),false);
 assert.equal(validWebhookEnvironment({...shared,stage:'duoforma-pilot'}),true);
 assert.equal(validWebhookEnvironment({...shared,stage:'duoforma-pilot',enabled:'false'}),false);
 assert.equal(validWebhookEnvironment({...env,stage:'duoforma-pilot'}),false);
});

test('piloto recusa consulta, aplicação e revisão de outra loja',async()=>{
 let find=0,apply=0,review=0;
 const repo={lookup:async()=>({store_id:'other',order_id:'order',amount:'10.00',version:1}),find:async()=>{find++;return null},apply:async()=>{apply++;return 'applied'},review:async()=>{review++;return true}};
 const adapter=makeWebhookAdapter({secret:'s',key,repository:repo,transport:async()=>{throw Error()},allowedStore:DUOFORMA_PILOT_STORE});
 assert.equal(await adapter.findBinding('ORD1'),null);
 await assert.rejects(adapter.applyVerified({storeId:'other',localOrderId:'o',sellerAccountId:'1',providerOrderId:'ORD1',paymentId:'PAY1',externalReference:'r',expectedAmount:'1.00',version:1,idempotencyKey:'x'}));
 await assert.rejects(adapter.recordReview({providerOrderId:'ORD1',reason:'x'}));
 assert.deepEqual({find,apply,review},{find:0,apply:0,review:0});
});

test('revisão do piloto inclui a loja na operação de escrita',async()=>{
 let seen;
 const repo={lookup:async()=>({store_id:DUOFORMA_PILOT_STORE,order_id:'order',amount:'10.00',version:1}),find:async()=>null,apply:async()=> 'applied',review:async(id,store)=>{seen={id,store};return true}};
 const adapter=makeWebhookAdapter({secret:'s',key,repository:repo,transport:async()=>{throw Error()},allowedStore:DUOFORMA_PILOT_STORE});
 await adapter.recordReview({providerOrderId:'ORD1',reason:'x'});
 assert.deepEqual(seen,{id:'ORD1',store:DUOFORMA_PILOT_STORE});
});
