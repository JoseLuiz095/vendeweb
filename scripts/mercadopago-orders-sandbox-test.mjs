import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSandboxPixOrder, getSandboxPixOrder } from '../supabase/functions/_shared/mercadoPagoOrdersSandbox.ts';
import { makeSandboxOrdersHandler } from '../supabase/functions/_shared/mercadoPagoOrdersSandboxHandler.ts';

const connection={mode:'test',provenance:'oauth_test_token',sellerId:'123',accessToken:'secret'};
const snapshot={total:'10.00',externalReference:'store_order_123',idempotencyKey:'c53c79c6-0453-48bb-85e9-024c5bb26463',payerEmail:'test@example.com'};
const provider={id:'ORD123',user_id:'123',external_reference:'store_order_123',total_amount:'10.00',status:'action_required',status_detail:'waiting_payment',transactions:{payments:[{payment_method:{id:'pix',type:'bank_transfer',qr_code:'pix-code',qr_code_base64:'image'}}]}};
const ok=(data=provider)=>new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
const storeId='00000000-0000-4000-8000-000000000001',orderId='00000000-0000-4000-8000-000000000002';
const req=body=>new Request('https://example.test/sandbox',{method:'POST',body:JSON.stringify(body)});

test('envia POST de teste com valor fixo e chave persistida; consulta GET pelo ID',async()=>{
  const calls=[];const transport=async(url,init)=>{calls.push({url,init});return ok()};
  const created=await createSandboxPixOrder(connection,snapshot,transport);
  assert.equal(created.qrCode,'pix-code');assert.equal(calls[0].init.headers['X-Idempotency-Key'],snapshot.idempotencyKey);
  assert.equal(JSON.parse(calls[0].init.body).transactions.payments[0].amount,'10.00');
  const fetched=await getSandboxPixOrder(connection,{id:'ORD123',externalReference:snapshot.externalReference,total:'10.00'},transport);
  assert.equal(fetched.id,'ORD123');assert.equal(calls[1].url,'https://api.mercadopago.com/v1/orders/ORD123');assert.equal(calls[1].init.method,'GET');
});
test('rejeita divergência de loja, pedido, valor, produção e dados de pagamento',async()=>{
  const binding={id:'ORD123',externalReference:snapshot.externalReference,total:'10.00'};
  for(const patch of [{user_id:'other'},{id:'another'},{total_amount:'11.00'},{external_reference:'other'},{live_mode:true},{transactions:{payments:[]}}])
    await assert.rejects(getSandboxPixOrder(connection,binding,async()=>ok({...provider,...patch})));
  await assert.rejects(createSandboxPixOrder({...connection,mode:'production'},snapshot,async()=>ok()));
});
test('erro externo não expõe corpo, token ou e-mail',async()=>{
  await assert.rejects(createSandboxPixOrder(connection,snapshot,async()=>new Response('secret '+connection.accessToken,{status:429,headers:{'retry-after':'3'}})),error=>error.code==='provider_request_failed'&&error.status===429&&error.retryAfter==='3'&&!error.message.includes('secret'));
});
test('handler exige autorização, usa snapshot do servidor e não devolve dados internos',async()=>{
  let reserve=0,bind=0,remote=0;
  const deps={authorize:async()=>true,reserve:async()=>{reserve++;return {connection,snapshot,providerOrderId:null}},find:async()=>null,bind:async()=>{bind++},transport:async()=>{remote++;return ok()}};
  const denied=makeSandboxOrdersHandler({...deps,authorize:async()=>false});
  assert.equal((await denied(req({action:'create',storeId,orderId}))).status,403);assert.equal(reserve,0);
  const handler=makeSandboxOrdersHandler(deps);
  assert.equal((await handler(req({action:'create',storeId,orderId,total:'0.01'}))).status,400);assert.equal(reserve,0);
  assert.equal((await handler(req({action:'get',storeId,orderId}))).status,404);assert.equal(reserve,0);
  const response=await handler(req({action:'create',storeId,orderId}));const body=await response.json();
  assert.equal(response.status,200);assert.deepEqual(Object.keys(body).sort(),['id','qrCode','qrCodeBase64','status','statusDetail'].sort());
  assert.equal(body.qrCode,'pix-code');assert.equal(bind,1);assert.equal(remote,1);
});
test('repetição após vincular consulta a order existente, não cria outra',async()=>{
  let requests=[];const deps={authorize:async()=>true,reserve:async()=>({connection,snapshot,providerOrderId:'ORD123'}),find:async()=>null,bind:async()=>{throw Error('unexpected')},transport:async(url,init)=>{requests.push(init.method);return ok()}};
  const result=await makeSandboxOrdersHandler(deps)(req({action:'create',storeId,orderId}));
  assert.equal(result.status,200);assert.deepEqual(requests,['GET']);
});
