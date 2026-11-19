import {createSandboxPixOrder,getSandboxPixOrder,SandboxOrdersError,type ProviderTransport,type SandboxConnection,type PixSnapshot} from './mercadoPagoOrdersSandbox.ts';
import {createSandboxCardOrder} from './mercadoPagoCardSandbox.ts';

type Attempt={connection:SandboxConnection;snapshot:PixSnapshot;method:'pix'|'card';cardMethodId?:string;cardType?:'credit_card'|'debit_card';providerOrderId:string|null};
type Dependencies={authenticate:(request:Request)=>Promise<string|null>;authorize:(actor:string,store:string)=>Promise<boolean>;create:(store:string,actor:string,requestId:string,method:'pix'|'card')=>Promise<{orderId:string}|null>;reserve:(store:string,actor:string,order:string)=>Promise<Attempt|null>;prepareCard:(store:string,actor:string,order:string,methodId:string,type:'credit_card'|'debit_card')=>Promise<boolean>;bind:(store:string,actor:string,order:string,providerId:string)=>Promise<boolean>;reconcile:(store:string,actor:string,order:string,attempt:Attempt)=>Promise<'applied'|'duplicate'|'pending'|'review'>;transport:ProviderTransport};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const reply=(status:number,value:unknown)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function bounded(req:Request):Promise<unknown>{
 const reader=req.body?.getReader();if(!reader)return null;
 const decoder=new TextDecoder();let raw='',size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();throw new Error('size');}raw+=decoder.decode(value,{stream:true});}
 return JSON.parse(raw+decoder.decode());
}
/** Test-only orchestration: callers must enforce pilot-only configuration, origin,
 * authenticated administrator, durable reservation, bounded transport and stored
 * test-token provenance. This handler never records real orders or marks paid. */
export function makeIsolatedTestHandler(deps:Dependencies){return async(req:Request):Promise<Response>=>{
 if(req.method!=='POST')return reply(405,{error:'method_not_allowed'});
 try{
  const actor=await deps.authenticate(req);if(!actor)return reply(401,{error:'unauthorized'});
  const input=await bounded(req);if(!object(input)||typeof input.storeId!=='string'||!uuid.test(input.storeId))return reply(400,{error:'invalid_request'});
  const store=input.storeId;if(!await deps.authorize(actor,store))return reply(403,{error:'not_authorized'});
  if(input.action==='create'){
   if(Object.keys(input).some(k=>!['action','storeId','requestId','method'].includes(k))||typeof input.requestId!=='string'||!uuid.test(input.requestId)||(input.method!=='pix'&&input.method!=='card'))return reply(400,{error:'invalid_request'});
   const order=await deps.create(store,actor,input.requestId,input.method);return order?reply(200,order):reply(409,{error:'test_unavailable'});
  }
  if((input.action!=='pay'&&input.action!=='check'&&input.action!=='card_config')||Object.keys(input).some(k=>!['action','storeId','orderId','card'].includes(k))||typeof input.orderId!=='string'||!uuid.test(input.orderId))return reply(400,{error:'invalid_request'});
  const orderId=input.orderId,attempt=await deps.reserve(store,actor,orderId);if(!attempt)return reply(409,{error:'test_unavailable'});
  if(input.action==='card_config'){
   if(input.card!==undefined||attempt.method!=='card'||attempt.providerOrderId||typeof attempt.connection.publicKey!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(attempt.connection.publicKey))return reply(409,{error:'test_unavailable'});
   return reply(200,{publicKey:attempt.connection.publicKey,amount:attempt.snapshot.total});
  }
  if(input.action==='check'){
   if(input.card!==undefined||!attempt.providerOrderId)return reply(409,{error:'test_unavailable'});
   return reply(200,{result:await deps.reconcile(store,actor,orderId,attempt)});
  }
  if(attempt.method==='pix'){
   if(input.card!==undefined)return reply(400,{error:'invalid_request'});
   const order=attempt.providerOrderId?await getSandboxPixOrder(attempt.connection,{id:attempt.providerOrderId,externalReference:attempt.snapshot.externalReference,total:attempt.snapshot.total},deps.transport):await createSandboxPixOrder(attempt.connection,attempt.snapshot,deps.transport);
   if(!await deps.authorize(actor,store))return reply(409,{error:'test_changed'});
   if(!attempt.providerOrderId&&!await deps.bind(store,actor,orderId,order.id))return reply(409,{error:'test_changed'});
   return reply(200,{id:order.id,status:order.status,statusDetail:order.statusDetail,qrCode:order.qrCode});
  }
  if(attempt.method!=='card'||attempt.providerOrderId)return reply(409,{error:'test_already_submitted'});
  const card=input.card;if(!object(card)||Object.keys(card).some(k=>!['cardToken','paymentMethodId','paymentType','installments'].includes(k))||typeof card.cardToken!=='string'||typeof card.paymentMethodId!=='string'||(card.paymentType!=='credit_card'&&card.paymentType!=='debit_card')||typeof card.installments!=='number')return reply(400,{error:'invalid_request'});
  if(!/^[A-Za-z0-9_-]{1,512}$/.test(card.cardToken)||!/^[A-Za-z0-9_-]{1,64}$/.test(card.paymentMethodId)||!Number.isSafeInteger(card.installments)||card.installments<1||card.installments>99||(card.paymentType==='debit_card'&&card.installments!==1))return reply(400,{error:'invalid_request'});
  if(!await deps.prepareCard(store,actor,orderId,card.paymentMethodId,card.paymentType))return reply(409,{error:'test_changed'});
  const order=await createSandboxCardOrder(attempt.connection,attempt.snapshot,{cardToken:card.cardToken,paymentMethodId:card.paymentMethodId,paymentType:card.paymentType,installments:card.installments},deps.transport);
  if(!await deps.authorize(actor,store))return reply(409,{error:'test_changed'});
  if(!await deps.bind(store,actor,orderId,order.id))return reply(409,{error:'test_changed'});
  return reply(200,{id:order.id,status:order.status,statusDetail:order.statusDetail});
 }catch(error){
  // Only controlled categories and HTTP status are logged; provider bodies and credentials are never logged.
  if(error instanceof SandboxOrdersError)console.error('mp_isolated_provider_failure',error.code,error.status ?? 'none');
  else console.error('mp_isolated_unexpected_failure');
  return reply(502,{error:'test_unavailable'});
 }
};}
