import { openTestSecret } from './mercadoPagoOAuthTest.ts';
import { brlCents } from './mercadoPagoPixTest.ts';
import type { SandboxWebhookDependencies, VerifiedTestPayment, WebhookBinding } from './mercadoPagoOrdersWebhookSandbox.ts';
import type { ProviderTransport } from './mercadoPagoOrdersSandbox.ts';

export const DUOFORMA_PILOT_STORE = '3659d8c9-0e68-4c86-9e0d-779c36ff28a9';
const SHARED_PROJECT = 'elttryavkeartoxgdgse';

// Minimal service-only adapter; repository is injected for deterministic tests.
export type WebhookRepository = {
  lookup:(id:string)=>Promise<{store_id:string;order_id:string;amount:string;version:number}|null>;
  find:(store:string,order:string,amount:string,version:number)=>Promise<Record<string,unknown>|null>;
  apply:(args:Record<string,unknown>)=>Promise<unknown>;
  review:(id:string,store?:string)=>Promise<boolean>;
};
export function validWebhookEnvironment(env:{enabled:string;stage:string;url:string;projectRef:string;secret:string;key:Uint8Array}):boolean {
  if(env.enabled!=='true'||!/^([a-z0-9]{20})$/.test(env.projectRef)||env.secret.length<32||env.key.length!==32) return false;
  if(env.projectRef===SHARED_PROJECT ? env.stage!=='duoforma-pilot' : env.stage!=='staging') return false;
  try { const u=new URL(env.url);return u.protocol==='https:'&&u.hostname===`${env.projectRef}.supabase.co`&&!u.port&&u.pathname==='/'&&!u.search&&!u.hash&&!u.username&&!u.password; } catch { return false; }
}
export function makeWebhookAdapter(input:{secret:string;key:Uint8Array;repository:WebhookRepository;transport:ProviderTransport;allowedStore?:string}):SandboxWebhookDependencies {
  const {repository,key}=input;
  return {
    secret:input.secret,transport:input.transport,
    findBinding:async id=>{
      const attempt=await repository.lookup(id);if(!attempt || (input.allowedStore && attempt.store_id!==input.allowedStore))return null;
      if(!Number.isSafeInteger(attempt.version)||attempt.version<0||brlCents(attempt.amount)===null||brlCents(attempt.amount)===0n)throw new Error('invalid_attempt');
      const row=await repository.find(attempt.store_id,attempt.order_id,attempt.amount,attempt.version);
      if(!row)return null;
      if(row.mode!=='test'||row.provenance!=='oauth_test_token'||row.provider_order_id!==id||typeof row.seller_id!=='string'||!/^\d{1,32}$/.test(row.seller_id)||typeof row.sealed_tokens!=='string'||typeof row.expires_at!=='string'||!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=Date.now()||typeof row.total!=='string'||brlCents(row.total)!==brlCents(attempt.amount)||typeof row.external_reference!=='string')throw new Error('invalid_binding');
      const tokens=JSON.parse(await openTestSecret(key,attempt.store_id,'seller-token',row.sealed_tokens));
      if(!tokens||typeof tokens.accessToken!=='string'||!tokens.accessToken)throw new Error('invalid_token');
      const binding:WebhookBinding={storeId:attempt.store_id,localOrderId:attempt.order_id,providerOrderId:id,externalReference:row.external_reference,sellerAccountId:row.seller_id,expectedAmount:row.total,version:attempt.version,connection:{mode:'test',provenance:'oauth_test_token',sellerId:row.seller_id,accessToken:tokens.accessToken}};
      return binding;
    },
    applyVerified:async(p:VerifiedTestPayment)=>{
      if(input.allowedStore && p.storeId!==input.allowedStore)throw new Error('store_not_allowed');
      const result=await repository.apply({p_store:p.storeId,p_order:p.localOrderId,p_seller:p.sellerAccountId,p_provider_order:p.providerOrderId,p_payment:p.paymentId,p_reference:p.externalReference,p_amount:p.expectedAmount,p_version:p.version,p_key:p.idempotencyKey,p_status:'processed',p_detail:'accredited'});
      if(result!=='applied'&&result!=='duplicate'&&result!=='conflict')throw new Error('invalid_transaction_result');return result;
    },
    // Current schema persists the review flag, not the reason or notification body.
    recordReview:async({providerOrderId})=>{
      if(input.allowedStore) { const attempt=await repository.lookup(providerOrderId); if(!attempt || attempt.store_id!==input.allowedStore) throw new Error('store_not_allowed'); }
      if(!await repository.review(providerOrderId,input.allowedStore))throw new Error('review_unavailable');
    },
  };
}
