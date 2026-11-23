import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSandboxCardOrder} from '../supabase/functions/_shared/mercadoPagoCardSandbox.ts';

const connection={mode:'test',provenance:'oauth_test_token',sellerId:'123',accessToken:'seller-secret'};
const snapshot={total:'10.00',externalReference:'isolated_test_1',idempotencyKey:'c53c79c6-0453-48bb-85e9-024c5bb26463',payerEmail:'buyer@example.test'};
const card={cardToken:'sensitive-token',paymentMethodId:'visa',paymentType:'credit_card',installments:1};
const result={id:'ORD123',user_id:'123',country_code:'BRA',external_reference:'isolated_test_1',total_amount:'10.00',status:'processed',status_detail:'accredited',transactions:{payments:[{id:'PAY123',amount:'10.00',status:'processed',status_detail:'accredited',payment_method:{id:'visa',type:'credit_card',token:'sensitive-token'}}]}};

test('envia token apenas ao provedor e retorna dados sem segredos',async()=>{
 let calls=0;
 const out=await createSandboxCardOrder(connection,snapshot,card,async(url,init)=>{
  calls++;assert.equal(url,'https://api.mercadopago.com/v1/orders');
  assert.equal(init.headers['X-Idempotency-Key'],snapshot.idempotencyKey);
  assert.equal(JSON.parse(init.body).transactions.payments[0].payment_method.token,card.cardToken);
  return Response.json(result);
 });
 assert.equal(calls,1);assert.deepEqual(out,{id:'ORD123',paymentId:'PAY123',status:'processed',statusDetail:'accredited'});
 assert.equal(JSON.stringify(out).includes('sensitive-token'),false);
});
test('rejeita divergência de ambiente, recebedor, pedido, valor e cartão',async()=>{
 for(const patch of [{user_id:'456'},{country_code:'ARG'},{country_code:null},{total_amount:'11.00'},{external_reference:'outro'},{live_mode:true},{transactions:{payments:[]}}]){
  await assert.rejects(createSandboxCardOrder(connection,snapshot,card,async()=>Response.json({...result,...patch})));
 }
 await assert.rejects(createSandboxCardOrder({...connection,mode:'production'},snapshot,card,async()=>Response.json(result)));
});
test('erro do provedor não revela token ou corpo',async()=>{
 await assert.rejects(createSandboxCardOrder(connection,snapshot,card,async()=>new Response('sensitive-token',{status:400})),e=>!e.message.includes('sensitive-token'));
});
test('order de cartão recusada em 402 permite vínculo sem expor dados',async()=>{
 const failed={...result,status:'failed',status_detail:'failed'};
 const response=data=>new Response(JSON.stringify({data}),{status:402});
 const output=await createSandboxCardOrder(connection,snapshot,card,async()=>response(failed));
 assert.equal(output.status,'failed');assert.equal(JSON.stringify(output).includes('sensitive-token'),false);
 await assert.rejects(createSandboxCardOrder(connection,snapshot,card,async()=>response({...failed,user_id:'456'})));
 await assert.rejects(createSandboxCardOrder(connection,snapshot,card,async()=>response({...failed,status:'processed'})));
});
test('status inesperado não expõe informação não confiável do provedor',async()=>{
 const out=await createSandboxCardOrder(connection,snapshot,card,async()=>Response.json({...result,status:'sensitive-token',status_detail:'sensitive-token'}));
 assert.equal(out.status,'unknown');assert.equal(out.statusDetail,'unknown');
});
