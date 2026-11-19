import {decideMercadoPagoTestPix,decideMercadoPagoTestCard} from './mercadoPagoPixTest.ts';
import type {ProviderTransport,SandboxConnection} from './mercadoPagoOrdersSandbox.ts';
type Binding={storeId:string;localOrderId:string;providerOrderId:string;externalReference:string;sellerAccountId:string;expectedAmount:string;method:'pix'|'card';cardMethodId?:string;cardType?:'credit_card'|'debit_card';connection:SandboxConnection};
type Dependencies={verifyTestSeller:(token:string,sellerId:string)=>Promise<boolean>;transport:ProviderTransport;apply:(binding:Omit<Binding,'connection'>,paymentId:string)=>Promise<'applied'|'duplicate'|'conflict'>};
type ProviderOrder=Parameters<typeof decideMercadoPagoTestPix>[0]['providerOrder'];
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);

/** Caller authenticates its trigger and resolves binding from trusted storage.
 * Transport must enforce a fixed endpoint, bounded response and timeout. */
export async function reconcileIsolatedTestOrder(binding:Binding,deps:Dependencies):Promise<'applied'|'duplicate'|'pending'|'review'>{
 const c=binding.connection;
 if(!c||c.mode!=='test'||c.provenance!=='oauth_test_token'||c.sellerId!==binding.sellerAccountId||!/^\d{1,32}$/.test(c.sellerId)||!/^[A-Za-z0-9_-]{1,128}$/.test(binding.providerOrderId)||!c.accessToken)return 'review';
 try{
  if(!await deps.verifyTestSeller(c.accessToken,c.sellerId))return 'review';
  const response=await deps.transport(`https://api.mercadopago.com/v1/orders/${encodeURIComponent(binding.providerOrderId)}`,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${c.accessToken}`,Accept:'application/json'}});
  if(!response.ok)return 'review';
  const data:unknown=await response.json();if(!object(data)||String(data.user_id??'')!==c.sellerId||data.country_code!=='BRA'||(data.live_mode!==undefined&&data.live_mode!==false))return 'review';
  const input={notificationLiveMode:false,signedResourceId:binding.providerOrderId,authenticatedSellerId:c.sellerId,binding:{...binding,localPaymentStatus:'pending' as const},providerOrder:data as ProviderOrder};
  const result=binding.method==='pix'?decideMercadoPagoTestPix(input):binding.method==='card'&&binding.cardMethodId&&binding.cardType?decideMercadoPagoTestCard(input,{id:binding.cardMethodId,type:binding.cardType}):{action:'review' as const};
  if(result.action==='pending')return 'pending';
  if(result.action!=='apply')return 'review';
  const {connection:_connection,...safeBinding}=binding;
  const applied=await deps.apply(safeBinding,result.paymentId);
  return applied==='applied'||applied==='duplicate'?applied:'review';
 }catch{return 'review';}
}
