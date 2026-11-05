import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutReceiptToken } from '../supabase/functions/food-public-checkout/receipt.ts';
import { openReceiptClaim } from '../supabase/functions/_shared/receiptCapability.ts';

const storeId='10000000-0000-4000-8000-000000000001';
const orderId='20000000-0000-4000-8000-000000000001';
const secret='synthetic-secret-longer-than-thirty-two-characters';
const saved={id:orderId,store_id:storeId,total:'12.50',payment_method:'pix',payment_status:'pending',status:'received',payment_receipt_version:0};

test('checkout gera autorização limitada ao pedido Pix efetivamente gravado',async()=>{
  const token=await checkoutReceiptToken(saved,storeId,secret);
  assert.ok(token);
  const claim=await openReceiptClaim(token,secret);
  assert.equal(claim.storeId,storeId);
  assert.equal(claim.orderId,orderId);
  assert.equal(claim.amount,12.5);
  assert.equal(claim.version,0);
  await assert.rejects(()=>openReceiptClaim(token,'outra-chave-ficticia-longa-o-suficiente'));
});

test('checkout não emite autorização para loja, valor, estado ou versão incompatível',async()=>{
  for(const patch of [
    {store_id:'30000000-0000-4000-8000-000000000001'},
    {total:0},{total:'inválido'},{payment_method:'cash'},{payment_status:'paid'},
    {status:'cancelled'},{status:'delivered'},{status:'picked_up'},
    {payment_receipt_version:1},{payment_receipt_version:null},
  ]) assert.equal(await checkoutReceiptToken({...saved,...patch},storeId,secret),undefined);
  assert.equal(await checkoutReceiptToken(null,storeId,secret),undefined);
  assert.equal(await checkoutReceiptToken(saved,storeId,'short'),undefined);
});
