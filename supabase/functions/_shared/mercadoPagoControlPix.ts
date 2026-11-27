import {buildTestPixOrder} from './mercadoPagoPixCreateTest.ts';
import {brlCents} from './mercadoPagoPixTest.ts';
import {isVerifiedTestSeller} from './mercadoPagoTestSeller.ts';
import {DUOFORMA_PILOT_STORE} from './mpTestWebhookAdapter.ts';
const ACCOUNT='3835760583'; // Pilot owner confirmed this comparison account.
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
type Transport=(url:string,init:RequestInit)=>Promise<Response>;
/** Explicit control experiment: never binds a provider order or applies payment
 * to the store. Retry key derives from an existing immutable local reservation. */
type ControlInput={storeId:string;orderId:string;total:string;accessToken:string};
export async function runControlPix(input:ControlInput,transport:Transport){
 return runBoundControl(input,ACCOUNT,'control',transport);
}
/** Same fixture with the OAuth seller; separate idempotency and reference namespace. */
export async function runOAuthControlPix(input:ControlInput & {sellerId:string},transport:Transport){
 if(!/^\d{1,32}$/.test(input.sellerId))throw Error('control_unavailable');
 return runBoundControl(input,input.sellerId,'oauthcontrol',transport);
}
async function runBoundControl(input:ControlInput,account:string,prefix:string,transport:Transport){
 if(input.storeId!==DUOFORMA_PILOT_STORE||input.total!=='50.00'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.orderId)||!input.accessToken||input.accessToken.length>8192||/[\r\n]/.test(input.accessToken))throw Error('control_unavailable');
 const read=async(url:string,method:string,body?:string)=>{
  const response=await transport(url,{method,redirect:'error',signal:AbortSignal.timeout(10000),headers:{Authorization:`Bearer ${input.accessToken}`,Accept:'application/json',...(body?{'Content-Type':'application/json','X-Idempotency-Key':prefix==='control'?`control_${ACCOUNT}_${input.orderId}`:`oauthcontrol_${input.orderId}`}: {})},...(body?{body}:{})});
  const reader=response.body?.getReader();if(!reader)throw Error('control_unavailable');
  let size=0,text='';const decoder=new TextDecoder();
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>262144){await reader.cancel();throw Error('control_unavailable');}text+=decoder.decode(value,{stream:true});}
  return {status:response.status,ok:response.ok,value:JSON.parse(text+decoder.decode())};
 };
 const identity=await read('https://api.mercadolibre.com/users/me','GET');
 if(!identity.ok||!isVerifiedTestSeller(identity.value,account))throw Error('control_identity_mismatch');
 const reference=`${prefix}_${input.orderId}`;
 const spec=buildTestPixOrder({total:input.total,externalReference:reference,idempotencyKey:input.orderId,payerEmail:'test_payer@example.com'});
 const created=await read(spec.url,'POST',JSON.stringify(spec.body));
 if(!created.ok&&created.status!==402)return {result:'provider_rejected',httpStatus:created.status,category:JSON.stringify(created.value).includes('"invalid_credentials"')?'invalid_credentials':'other'};
 const envelope=obj(created.value),order=created.status===402?obj(envelope?.data):envelope;
 const validate=(o:Record<string,unknown>|null)=>{
  const payments=obj(o?.transactions)?.payments,p=Array.isArray(payments)&&payments.length===1?obj(payments[0]):null,method=obj(p?.payment_method);
  if(!o||typeof o.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(o.id)||String(o.user_id)!==account||o.external_reference!==reference||o.country_code!=='BRA'||o.live_mode===true||(o.currency!==undefined&&o.currency!=='BRL')||(o.currency_id!==undefined&&o.currency_id!=='BRL')||brlCents(o.total_amount)!==5000n||!p||brlCents(p.amount)!==5000n||method?.id!=='pix'||method?.type!=='bank_transfer')throw Error('control_binding_mismatch');
  return o;
 };
 const bound=validate(order),checked=await read(`${spec.url}/${encodeURIComponent(String(bound.id))}`,'GET');
 if(!checked.ok)throw Error('control_unavailable');
 const current=validate(obj(checked.value));if(current.id!==bound.id)throw Error('control_binding_mismatch');
 const statuses=['created','processing','action_required','processed','failed','canceled','expired'];
 return {result:'provider_order',id:String(current.id),status:statuses.includes(String(current.status))?String(current.status):'unknown',category:JSON.stringify(created.value).includes('"invalid_users_involved"')?'invalid_users_involved':'other'};
}
