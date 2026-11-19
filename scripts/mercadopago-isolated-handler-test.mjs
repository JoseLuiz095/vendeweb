import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeIsolatedTestHandler} from '../supabase/functions/_shared/mercadoPagoIsolatedHandler.ts';
const store='11111111-1111-4111-8111-111111111111',order='22222222-2222-4222-8222-222222222222',requestId='33333333-3333-4333-8333-333333333333';
const connection={mode:'test',provenance:'oauth_test_token',sellerId:'123',accessToken:'seller-secret'};
const snapshot={total:'50.00',externalReference:'isolated1',idempotencyKey:'c53c79c6-0453-48bb-85e9-024c5bb26463',payerEmail:'test_payer@example.com'};
const provider={id:'ORD123',user_id:'123',country_code:'BRA',external_reference:'isolated1',total_amount:'50.00',status:'action_required',status_detail:'waiting_transfer',transactions:{payments:[{id:'PAY123',amount:'50.00',payment_method:{id:'pix',type:'bank_transfer',qr_code:'000201-test'}}]}};
const req=body=>new Request('https://test.example',{method:'POST',headers:{authorization:'Bearer example'},body:JSON.stringify(body)});
function fixture(){let bound=null,calls=0;const deps={authenticate:async()=> 'actor',authorize:async(_actor,id)=>id===store,create:async()=>({orderId:order}),reserve:async()=>({connection,snapshot,method:'pix',providerOrderId:bound}),prepareCard:async()=>true,bind:async(_s,_actor,_o,id)=>{bound=id;return true;},reconcile:async()=> 'applied',transport:async()=>{calls++;return Response.json(provider)}};return{deps,calls:()=>calls};}
test('somente administrador autorizado inicia pedido isolado e forma válida',async()=>{
 const f=fixture(),handler=makeIsolatedTestHandler(f.deps);
 assert.equal((await handler(req({action:'create',storeId:store,requestId,method:'pix'}))).status,200);
 assert.equal((await handler(req({action:'create',storeId:store,requestId,method:'pix',amount:1}))).status,400);
 f.deps.authorize=async()=>false;
 assert.equal((await handler(req({action:'create',storeId:store,requestId,method:'pix'}))).status,403);
});
test('Pix usa apenas dados reservados e repetições consultam o mesmo pedido',async()=>{
 const f=fixture(),handler=makeIsolatedTestHandler(f.deps);
 const first=await handler(req({action:'pay',storeId:store,orderId:order}));assert.equal(first.status,200);
 const body=await first.json();assert.equal(body.id,'ORD123');assert.equal(JSON.stringify(body).includes('seller-secret'),false);
 assert.equal((await handler(req({action:'pay',storeId:store,orderId:order}))).status,200);
 assert.equal(f.calls(),2);
});
test('sem autenticação ou permissão não consulta provedor',async()=>{
 const f=fixture();f.deps.authenticate=async()=>null;
 assert.equal((await makeIsolatedTestHandler(f.deps)(req({action:'pay',storeId:store,orderId:order}))).status,401);assert.equal(f.calls(),0);
});
test('cartão aceita somente token do componente e não expõe dados sensíveis',async()=>{
 const f=fixture();f.deps.reserve=async()=>({connection,snapshot,method:'card',providerOrderId:null});
 f.deps.transport=async()=>Response.json({...provider,status:'processed',status_detail:'accredited',transactions:{payments:[{id:'PAY123',amount:'50.00',payment_method:{id:'visa',type:'credit_card',token:'card-secret'}}]}});
 const card={cardToken:'card-secret',paymentMethodId:'visa',paymentType:'credit_card',installments:1};
 const h=makeIsolatedTestHandler(f.deps);
 assert.equal((await h(req({action:'pay',storeId:store,orderId:order,card:{...card,number:'4111111111111111'}}))).status,400);
 const result=await h(req({action:'pay',storeId:store,orderId:order,card}));assert.equal(result.status,200);
 assert.equal(JSON.stringify(await result.json()).includes('card-secret'),false);
});
test('revogação durante chamada externa impede vínculo',async()=>{
 const f=fixture();let allowed=true,bindCalls=0;
 f.deps.authorize=async()=>allowed;
 f.deps.transport=async()=>{allowed=false;return Response.json(provider)};
 f.deps.bind=async()=>{bindCalls++;return true};
 const r=await makeIsolatedTestHandler(f.deps)(req({action:'pay',storeId:store,orderId:order}));
 assert.equal(r.status,409);assert.equal(bindCalls,0);
});
test('cartão inválido não reserva bandeira nem chama provedor',async()=>{
 const f=fixture();let prepares=0;f.deps.reserve=async()=>({connection,snapshot,method:'card',providerOrderId:null});
 f.deps.prepareCard=async()=>{prepares++;return true};
 const invalid={cardToken:'',paymentMethodId:'visa',paymentType:'credit_card',installments:1};
 const response=await makeIsolatedTestHandler(f.deps)(req({action:'pay',storeId:store,orderId:order,card:invalid}));
 assert.equal(response.status,400);assert.equal(prepares,0);assert.equal(f.calls(),0);
});
test('consulta só confirma uma cobrança já vinculada e não retorna dados privados',async()=>{
 const f=fixture(),h=makeIsolatedTestHandler(f.deps);
 assert.equal((await h(req({action:'check',storeId:store,orderId:order}))).status,409);
 assert.equal((await h(req({action:'pay',storeId:store,orderId:order}))).status,200);
 const response=await h(req({action:'check',storeId:store,orderId:order}));
 assert.deepEqual(await response.json(),{result:'applied'});
});
test('configuração de cartão retorna somente chave pública da conta autorizada',async()=>{
 const f=fixture();f.deps.reserve=async()=>({connection:{...connection,publicKey:'TEST-public-key'},snapshot,method:'card',providerOrderId:null});
 const h=makeIsolatedTestHandler(f.deps);const r=await h(req({action:'card_config',storeId:store,orderId:order}));
 assert.equal(r.status,200);assert.deepEqual(await r.json(),{publicKey:'TEST-public-key',amount:'50.00'});
});
