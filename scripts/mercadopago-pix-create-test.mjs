import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildTestPixOrder} from '../supabase/functions/_shared/mercadoPagoPixCreateTest.ts';
const input={total:'10.1',externalReference:'order_123',idempotencyKey:'c53c79c6-0453-48bb-85e9-024c5bb26463',payerEmail:'person@example.test'};
test('payload Pix é limitado ao valor validado e preserva chave de repetição',()=>{
 const a=buildTestPixOrder(input),b=buildTestPixOrder(input);
 assert.deepEqual(a,b);assert.equal(a.url,'https://api.mercadopago.com/v1/orders');
 assert.equal(a.body.total_amount,'10.10');assert.equal(a.body.transactions.payments[0].amount,'10.10');
 assert.equal(a.body.transactions.payments[0].payment_method.id,'pix');assert.equal(a.idempotencyKey,input.idempotencyKey);
});
test('recusa valores inválidos e dados que impedem rastrear operação',()=>{
 for(const patch of [{total:'0.00'},{total:'1.001'},{total:'1e3'},{externalReference:'a:b'},{idempotencyKey:'bad'},{payerEmail:'abc'}])assert.throws(()=>buildTestPixOrder({...input,...patch}));
});
