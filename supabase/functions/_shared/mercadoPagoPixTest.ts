/**
 * Experimental, test-only decision helpers. This module does not fetch an order,
 * persist an event, change an order or expose an endpoint.
 *
 * The HMAC authenticates the manifest, not the complete JSON body. A caller must
 * fetch the order from Mercado Pago using the intended seller's server credential.
 */
const encoder = new TextEncoder();

export async function verifyMercadoPagoOrderSignature(input: {
  secret: string; signature: string; requestId: string; resourceId: string;
}): Promise<boolean> {
  const { secret, signature, requestId, resourceId } = input;
  // Require all components for this Orders integration; avoid ambiguous manifests.
  if (!secret || !/^[A-Za-z0-9_-]{1,128}$/.test(resourceId) ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(requestId) || signature.length > 512) return false;
  const fields = new Map<string,string>();
  for (const part of signature.split(',')) {
    const match = /^\s*([a-zA-Z0-9_-]+)=([^\s,]+)\s*$/.exec(part);
    if (!match || fields.has(match[1])) return false;
    fields.set(match[1],match[2]);
  }
  const ts=fields.get('ts'), hex=fields.get('v1');
  if (!ts || !/^\d{1,16}$/.test(ts) || !hex || !/^[a-f0-9]{64}$/i.test(hex)) return false;
  const manifest=`id:${resourceId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const mac=Uint8Array.from(hex.match(/../g)!, part=>parseInt(part,16));
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  return crypto.subtle.verify('HMAC',key,mac,encoder.encode(manifest));
}

/** Parse a decimal BRL amount without floats, rounding, or locale ambiguity. */
export function brlCents(value: unknown): bigint | null {
  if (typeof value!=='string' || !/^(0|[1-9]\d{0,11})(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction='']=value.split('.');
  return BigInt(whole)*100n+BigInt((fraction+'00').slice(0,2));
}

type Payment = { id?:unknown; status?:unknown; status_detail?:unknown; amount?:unknown; paid_amount?:unknown; payment_method?:{id?:unknown;type?:unknown} };
type ProviderOrder = { id?:unknown; external_reference?:unknown; currency_id?:unknown; status?:unknown; status_detail?:unknown; total_amount?:unknown; total_paid_amount?:unknown; transactions?:{payments?:Payment[]} };
type BoundOrder = {
  storeId:string; localOrderId:string; providerOrderId:string; externalReference:string;
  sellerAccountId:string; expectedAmount:string; alreadyAppliedPaymentId?:string|null;
  localPaymentStatus:'pending'|'paid'|'cancelled';
};
export type PixDecision =
  | { action:'apply'; paymentId:string; idempotencyKey:string }
  | { action:'duplicate'; paymentId:string }
  | { action:'pending' }
  | { action:'review'; reason:string };

/**
 * `providerOrder` and `authenticatedSellerId` must originate from a fresh GET
 * with a verified seller credential, never directly from webhook JSON.
 * `alreadyAppliedPaymentId` must be loaded under the same DB lock/transaction
 * as a future write; this function alone cannot provide idempotency or isolation.
 */
export function decideMercadoPagoTestPix(input:{
  notificationLiveMode:unknown; signedResourceId:string; authenticatedSellerId:string;
  binding:BoundOrder; providerOrder:ProviderOrder;
}):PixDecision {
  const {notificationLiveMode,signedResourceId,authenticatedSellerId,binding,providerOrder:o}=input;
  if(notificationLiveMode!==false) return {action:'review',reason:'not_test_event'};
  if(!binding.storeId || !binding.localOrderId || !binding.providerOrderId || !binding.externalReference ||
     !binding.sellerAccountId || binding.sellerAccountId!==authenticatedSellerId ||
     binding.providerOrderId!==signedResourceId || o.id!==binding.providerOrderId ||
     o.external_reference!==binding.externalReference || o.currency_id!=='BRL') return {action:'review',reason:'binding_mismatch'};
  const amount=brlCents(binding.expectedAmount), total=brlCents(o.total_amount);
  if(amount===null || amount<=0n || total!==amount) return {action:'review',reason:'amount_mismatch'};
  if(o.status==='processed' && o.status_detail==='partially_refunded' || ['refunded','charged_back'].includes(String(o.status))) return {action:'review',reason:'refund_or_chargeback'};
  if(o.status!=='processed' || o.status_detail!=='accredited') return {action:'pending'};
  const payments=o.transactions?.payments;
  if(!Array.isArray(payments) || payments.length!==1) return {action:'review',reason:'unexpected_payments'};
  const payment=payments[0];
  if(typeof payment.id!=='string' || !/^[A-Za-z0-9_-]{1,128}$/.test(payment.id) ||
     payment.payment_method?.id!=='pix' || payment.payment_method?.type!=='bank_transfer' ||
     payment.status!=='processed' || payment.status_detail!=='accredited' ||
     brlCents(payment.amount)!==amount || brlCents(payment.paid_amount)!==amount || brlCents(o.total_paid_amount)!==amount) return {action:'review',reason:'payment_mismatch'};
  if(binding.alreadyAppliedPaymentId) return binding.alreadyAppliedPaymentId===payment.id
    ? {action:'duplicate',paymentId:payment.id} : {action:'review',reason:'another_payment_applied'};
  if(binding.localPaymentStatus!=='pending') return {action:'review',reason:'local_state_conflict'};
  // Restrict identifiers before composing the key so delimiters cannot collide.
  if(!/^[A-Za-z0-9_-]{1,128}$/.test(binding.sellerAccountId)) return {action:'review',reason:'invalid_account'};
  return {action:'apply',paymentId:payment.id,idempotencyKey:`mp:test:${binding.sellerAccountId}:${payment.id}`};
}
