import {buildTestCardOrder} from './mercadoPagoCardCreateTest.ts';
import {brlCents} from './mercadoPagoPixTest.ts';
import {SandboxOrdersError, type ProviderTransport, type SandboxConnection} from './mercadoPagoOrdersSandbox.ts';

type CardSnapshot={total:string;externalReference:string;idempotencyKey:string;payerEmail:string};
type CardInput={cardToken:string;paymentMethodId:string;paymentType:'credit_card'|'debit_card';installments:number};
const idPattern=/^[A-Za-z0-9_-]{1,128}$/;
const obj=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const statuses=new Set(['created','processed','processing','action_required','canceled','charged_back','failed','refunded']);
const details=new Set(['created','accredited','partially_refunded','in_process','waiting_payment','waiting_capture','waiting_transfer','waiting_retry','canceled','expired','settled','reimbursed','failed','refunded']);

/** Server-only transport; no token, PAN, provider body or payer data is returned.
 * A caller must durably reserve the immutable snapshot and idempotency key first,
 * and revalidate store, seller, amount and connection before binding the order.
 * This adapter alone does not authorize requests or confirm a local order. */
export async function createSandboxCardOrder(connection:SandboxConnection,snapshot:CardSnapshot,card:CardInput,transport:ProviderTransport){
 if(!connection||connection.mode!=='test'||connection.provenance!=='oauth_test_token'||!/^\d{1,32}$/.test(connection.sellerId)||typeof connection.accessToken!=='string'||!connection.accessToken||/[\r\n]/.test(connection.accessToken))throw new SandboxOrdersError('invalid_test_connection');
 const request=buildTestCardOrder({...snapshot,...card});
 let response:Response;
 try{response=await transport(request.url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${connection.accessToken}`,'Content-Type':'application/json',Accept:'application/json','X-Idempotency-Key':request.idempotencyKey},body:JSON.stringify(request.body)});}catch{throw new SandboxOrdersError('provider_unavailable');}
 if(!response.ok)throw new SandboxOrdersError('provider_request_failed',response.status);
 let raw:unknown;try{raw=await response.json();}catch{throw new SandboxOrdersError('invalid_provider_response');}
 const order=obj(raw),transactions=obj(order?.transactions),payments=Array.isArray(transactions?.payments)?transactions.payments:[];
 const payment=payments.length===1?obj(payments[0]):null,method=obj(payment?.payment_method);
 const amount=brlCents(snapshot.total);
 if(!order||typeof order.id!=='string'||!idPattern.test(order.id)||String(order.user_id??'')!==connection.sellerId||order.country_code!=='BRA'||order.external_reference!==snapshot.externalReference||order.live_mode===true||amount===null||amount<=0n||brlCents(order.total_amount)!==amount||!payment||brlCents(payment.amount)!==amount||typeof payment.id!=='string'||!idPattern.test(payment.id)||method?.id!==card.paymentMethodId||method?.type!==card.paymentType||typeof order.status!=='string'||typeof order.status_detail!=='string')throw new SandboxOrdersError('provider_binding_mismatch');
 return {id:order.id,paymentId:payment.id,status:statuses.has(order.status)?order.status:'unknown',statusDetail:details.has(order.status_detail)?order.status_detail:'unknown'};
}
