import { test } from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyMercadoPagoOrderSignature,brlCents,decideMercadoPagoTestPix} from '../supabase/functions/_shared/mercadoPagoPixTest.ts';

test('webhook exige HMAC correto, normaliza id alfanumérico e rejeita ambiguidades',async()=>{
 const secret='only-synthetic-secret',resourceId='ORD123ABC',requestId='request-123',ts='1742505638683';
 const mac=createHmac('sha256',secret).update(`id:${resourceId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
 const input={secret,resourceId,requestId,signature:`ts=${ts},v1=${mac}`};
 assert.equal(await verifyMercadoPagoOrderSignature(input),true);
 for(const bad of [{signature:`ts=${ts},v1=${'0'.repeat(64)}`},{resourceId:'ORD123ABD'},{requestId:'other'},{signature:`ts=${ts},ts=${ts},v1=${mac}`},{secret:''},{signature:`ts=${ts},v1=not-hex`}]) assert.equal(await verifyMercadoPagoOrderSignature({...input,...bad}),false);
});
test('valores BRL não utilizam arredondamento nem números binários',()=>{
 assert.equal(brlCents('100.10'),10010n);assert.equal(brlCents('0.1'),10n);
 for(const value of [100.1,'1.001','1,00','-1.00','01.00','1e2',''])assert.equal(brlCents(value),null);
});
const good=()=>({notificationLiveMode:false,signedResourceId:'ORD123',authenticatedSellerId:'seller1',binding:{storeId:'store1',localOrderId:'local1',providerOrderId:'ORD123',externalReference:'store1:local1',sellerAccountId:'seller1',expectedAmount:'10.00',localPaymentStatus:'pending'},providerOrder:{id:'ORD123',external_reference:'store1:local1',currency_id:'BRL',status:'processed',status_detail:'accredited',total_amount:'10.00',total_paid_amount:'10.00',transactions:{payments:[{id:'PAY123',status:'processed',status_detail:'accredited',amount:'10.00',paid_amount:'10.00',payment_method:{id:'pix',type:'bank_transfer'}}]}}});
test('concilia somente order Pix integral, creditada e vinculada',()=>{
 assert.deepEqual(decideMercadoPagoTestPix(good()),{action:'apply',paymentId:'PAY123',idempotencyKey:'mp:test:seller1:PAY123'});
 for(const mutate of [x=>x.notificationLiveMode=true,x=>x.notificationLiveMode=undefined,x=>x.authenticatedSellerId='other',x=>x.signedResourceId='other',x=>x.providerOrder.external_reference='other',x=>x.providerOrder.currency_id='USD',x=>x.binding.expectedAmount='9.99',x=>x.providerOrder.transactions.payments[0].paid_amount='9.99',x=>x.providerOrder.transactions.payments[0].payment_method.id='card',x=>x.binding.localPaymentStatus='cancelled',x=>x.providerOrder.transactions.payments.push(x.providerOrder.transactions.payments[0])]){const x=good();mutate(x);assert.equal(decideMercadoPagoTestPix(x).action,'review');}
});
test('repetição, não creditados e reembolso não geram segundo crédito',()=>{
 let x=good();x.binding.alreadyAppliedPaymentId='PAY123';assert.equal(decideMercadoPagoTestPix(x).action,'duplicate');
 x=good();x.binding.alreadyAppliedPaymentId='PAY-other';assert.equal(decideMercadoPagoTestPix(x).action,'review');
 x=good();x.providerOrder.status='action_required';x.providerOrder.status_detail='waiting_transfer';assert.equal(decideMercadoPagoTestPix(x).action,'pending');
 x=good();x.providerOrder.status_detail='partially_refunded';assert.equal(decideMercadoPagoTestPix(x).action,'review');
 x=good();x.providerOrder.status='refunded';assert.equal(decideMercadoPagoTestPix(x).action,'review');
});
