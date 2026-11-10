import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mintReceiptClaim, openReceiptClaim } from '../supabase/functions/_shared/receiptCapability.ts';
import { createOrderPaymentHandler } from '../supabase/functions/food-order-payment/handler.ts';
const storeId='10000000-0000-4000-8000-000000000001',orderId='20000000-0000-4000-8000-000000000001';
const secret='synthetic-test-key-at-least-thirty-two-characters';
const origin='https://staging.example.invalid',now=1793293200000;
const input={storeId,orderId,amount:12.5,version:0};
test('capability de comprovante tem escopo, prazo e criptografia autenticada',async()=>{
 const a=await mintReceiptClaim(input,secret,now),b=await mintReceiptClaim(input,secret,now);
 assert.notEqual(a,b);assert.equal(a.includes(orderId),false);
 assert.deepEqual(await openReceiptClaim(a,secret,now),{...input,v:1,expiresAt:now+86400000});
 await assert.rejects(()=>openReceiptClaim(a,secret,now+86400000));
 await assert.rejects(()=>openReceiptClaim(a,secret+'rotated',now));
 const [iv,body]=a.split('.');await assert.rejects(()=>openReceiptClaim(iv+'.'+(body[0]==='A'?'B':'A')+body.slice(1),secret,now));
 for(const invalid of ['',orderId,'x'.repeat(2049)])await assert.rejects(()=>openReceiptClaim(invalid,secret,now));
 for(const patch of [{version:1},{amount:0},{amount:NaN},{storeId:'forged'}])await assert.rejects(()=>mintReceiptClaim({...input,...patch},secret,now));
 await assert.rejects(()=>mintReceiptClaim(input,'short',now));
});
function fixture(){
 const order={id:orderId,store_id:storeId,order_number:1,total:12.5,payment_method:'pix',payment_status:'pending',status:'received',payment_receipt_version:0};
 const store={id:storeId,name:'Loja sintética',active:true,access_status:'online',pix_enabled:true,pix_receipt_mode:'key',pix_key:'test@example.invalid',pix_holder_name:'Teste',city:'Teste',receipt_click_marks_paid:true};
 const env={ORDER_PAYMENT_LINK_ENABLED:'true',ORDER_RECEIPT_AUTOPAID_ENABLED:'true',ORDER_RECEIPT_CONTACTS_ENABLED:'true',ORDER_PAYMENT_LINK_SECRET:secret,ORDER_PAYMENT_ALLOWED_ORIGINS:origin};
 const writes=[];let fail=false;
 const handler=createOrderPaymentHandler({env:k=>env[k],now:()=>now,authorizedOrder:async()=>order,order:async()=>order,store:async()=>store,
   reportReceipt:async claim=>{writes.push(claim);if(fail)throw new Error('conflict');return{ok:true,autoPickedUp:false}},orderItems:async()=>[],receiptDestinations:async()=>({mode:'general',contacts:[]})});
 const call=async body=>{const r=await handler(new Request('https://api.example.invalid',{method:'POST',headers:{Origin:origin,Authorization:'Bearer synthetic'},body:JSON.stringify(body)}));return {status:r.status,body:await r.json()}};
 return{call,env,order,store,writes,fail:()=>{fail=true}};
}
test('capacidade anterior nunca confirma pagamento por ação do cliente',async()=>{
 const f=fixture(); const token=await mintReceiptClaim(input,secret,now);
 assert.equal((await f.call({action:'receipt_capabilities'})).body.receiptReportingConfigured,false);
 const report=await f.call({action:'report_receipt',token});
 assert.equal(report.status,503); assert.equal(report.body.status,undefined); assert.equal(f.writes.length,0);
 const issued=await f.call({action:'issue',storeId,orderId});
 const read=await f.call({action:'resolve',token:issued.body.token});
 assert.equal(read.status,200); assert.equal(read.body.status,'pending'); assert.equal(read.body.receiptToken,undefined);
});
