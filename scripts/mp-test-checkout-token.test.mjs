import {test} from 'node:test';
import assert from 'node:assert/strict';
import {checkoutMpTestToken} from '../supabase/functions/food-public-checkout/mpTestToken.ts';
import {openMpTestClaim,mintMpTestClaim} from '../supabase/functions/_shared/mpTestCheckoutCapability.ts';
import {mintReceiptClaim,openReceiptClaim} from '../supabase/functions/_shared/receiptCapability.ts';

const store='00000000-0000-4000-8000-000000000001',order='00000000-0000-4000-8000-000000000002',secret='s'.repeat(40);
const good={enabled:true,environment:'staging',origin:'https://sandbox.example',allowedOrigins:new Set(['https://sandbox.example']),secret,storeId:store,order:{id:order,store_id:store,total:10,payment_method:'pix',payment_status:'pending',status:'received',payment_receipt_version:0,customer_email:'payer@example.test'},eligible:async()=>true};
test('somente ambiente e pedido de teste elegível recebem capability específica',async()=>{
 const token=await checkoutMpTestToken(good);assert.ok(token);const claim=await openMpTestClaim(token,secret);assert.equal(claim.storeId,store);assert.equal(claim.orderId,order);assert.equal(claim.amount,10);
 for(const patch of [{enabled:false},{environment:'production'},{origin:'https://other.example'},{eligible:async()=>false},{eligible:async()=>{throw Error('offline')}},{order:{...good.order,customer_email:null}},{order:{...good.order,payment_status:'paid'}},{order:{...good.order,store_id:order}}])assert.equal(await checkoutMpTestToken({...good,...patch}),undefined);
});
test('capability de comprovante não autoriza criação Pix e vice-versa',async()=>{
 const data={storeId:store,orderId:order,amount:10,version:0};
 const receipt=await mintReceiptClaim(data,secret);const testToken=await mintMpTestClaim(data,secret);
 await assert.rejects(openMpTestClaim(receipt,secret));await assert.rejects(openReceiptClaim(testToken,secret));
});
test('capability test expira em uma hora',async()=>{
 const now=Date.now();const token=await mintMpTestClaim({storeId:store,orderId:order,amount:10,version:0},secret,now);await assert.rejects(openMpTestClaim(token,secret,now+3600000));
});
