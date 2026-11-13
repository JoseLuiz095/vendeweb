import { getSandboxPixOrder, type ProviderTransport, type SandboxConnection } from './mercadoPagoOrdersSandbox.ts';
import { decideMercadoPagoTestPix, verifyMercadoPagoOrderSignature } from './mercadoPagoPixTest.ts';

/** Server-only, test-mode wiring contract. No default transport, storage or endpoint.
 * findBinding must resolve exactly one pre-existing provider ID, from trusted storage;
 * neither credentials nor the seller/local order are taken from the notification.
 * applyVerified is ONE database transaction: lock and revalidate all immutable
 * bindings and the pending local payment state; enforce unique payment and local
 * order constraints; atomically record the event and update only the test payment.
 * The same payment returns duplicate, any changed binding/payment returns conflict.
 * It must not update production orders. recordReview persists a deduplicated review
 * without changing payment, inventory or fulfilment. Throw on persistence failures.
 */
export type WebhookBinding = {
  storeId:string; localOrderId:string; providerOrderId:string; externalReference:string;
  sellerAccountId:string; expectedAmount:string; version:number; connection:SandboxConnection;
};
export type VerifiedTestPayment = Omit<WebhookBinding,'connection'> & {paymentId:string; idempotencyKey:string};
export type SandboxWebhookDependencies = {
  secret:string;
  findBinding:(providerOrderId:string)=>Promise<WebhookBinding|null>;
  transport:ProviderTransport;
  applyVerified:(payment:VerifiedTestPayment)=>Promise<'applied'|'duplicate'|'conflict'>;
  recordReview:(item:{providerOrderId:string; reason:string})=>Promise<void>;
};
const idPattern=/^[A-Za-z0-9_-]{1,128}$/;
const response=(status:number)=>new Response(null,{status,headers:{'Cache-Control':'no-store'}});

async function readBoundedBody(request:Request):Promise<string> {
  if (!request.body) return '';
  const reader=request.body.getReader();
  const chunks:Uint8Array[]=[]; let size=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      size+=value.byteLength;
      if(size>16384) { await reader.cancel(); throw new RangeError('body_too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size); let offset=0;
  for(const chunk of chunks) { bytes.set(chunk,offset); offset+=chunk.byteLength; }
  return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}

export function makeSandboxOrdersWebhook(deps:SandboxWebhookDependencies) {
  return async (request:Request):Promise<Response> => {
    if(request.method!=='POST') return response(405);
    let url:URL;
    try { url=new URL(request.url); } catch { return response(400); }
    const ids=url.searchParams.getAll('data.id');
    if(ids.length!==1 || !idPattern.test(ids[0])) return response(400);
    const providerOrderId=ids[0];
    let signatureOk=false;
    try { signatureOk=await verifyMercadoPagoOrderSignature({secret:deps.secret,signature:request.headers.get('x-signature')||'',requestId:request.headers.get('x-request-id')||'',resourceId:providerOrderId}); } catch { return response(401); }
    if(!signatureOk) return response(401);
    // These fields are NOT authenticated by the signature. They may only reject,
    // never establish identity or payment. The authoritative order is fetched below.
    let event:Record<string,unknown>;
    try {
      const length=request.headers.get('content-length');
      if(length && (!/^\d+$/.test(length) || Number(length)>16384)) return response(413);
      const raw=await readBoundedBody(request);
      const value=JSON.parse(raw);
      if(!value || typeof value!=='object' || Array.isArray(value)) return response(400);
      event=value;
    } catch (error) { return response(error instanceof RangeError ? 413 : 400); }
    const data=event.data;
    if(event.type!=='order' || event.live_mode!==false || !data || typeof data!=='object' || Array.isArray(data) || (data as Record<string,unknown>).id!==providerOrderId) return response(400);
    try {
      const binding=await deps.findBinding(providerOrderId);
      if(!binding) return response(404);
      if(binding.providerOrderId!==providerOrderId || binding.connection.mode!=='test' || binding.connection.provenance!=='oauth_test_token' || binding.connection.sellerId!==binding.sellerAccountId) return response(409);
      const order=await getSandboxPixOrder(binding.connection,{id:providerOrderId,externalReference:binding.externalReference,total:binding.expectedAmount},deps.transport);
      const authoritative=order.providerData as Record<string,unknown>;
      // Fail closed when the provider response cannot independently establish mode.
      if(authoritative.live_mode!==false) { await deps.recordReview({providerOrderId,reason:'provider_mode_unconfirmed'}); return response(200); }
      const decision=decideMercadoPagoTestPix({notificationLiveMode:false,signedResourceId:providerOrderId,authenticatedSellerId:binding.connection.sellerId,binding:{...binding,localPaymentStatus:'pending'},providerOrder:authoritative});
      if(decision.action==='pending') return response(200);
      if(decision.action==='review') { await deps.recordReview({providerOrderId,reason:decision.reason}); return response(200); }
      // Always delegate idempotency to the locked transaction; never assume that
      // a pre-GET read reflects concurrent processing or later local changes.
      if(decision.action!=='apply') return response(503);
      const {connection: _connection,...safeBinding}=binding;
      const result=await deps.applyVerified({...safeBinding,paymentId:decision.paymentId,idempotencyKey:decision.idempotencyKey});
      if(result==='conflict') { await deps.recordReview({providerOrderId,reason:'transaction_conflict'}); return response(200); }
      return result==='applied'||result==='duplicate' ? response(200) : response(503);
    } catch { return response(503); }
  };
}
