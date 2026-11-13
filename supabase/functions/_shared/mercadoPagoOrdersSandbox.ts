import { buildTestPixOrder } from './mercadoPagoPixCreateTest.ts';
import { brlCents } from './mercadoPagoPixTest.ts';

/** Server-only adapter. No endpoint, default credentials or default transport.
 * `mode` and credential provenance are assertions from the trusted repository,
 * not proof supplied by a browser or inferred from a token prefix. */
export type SandboxConnection = { mode:'test'; provenance:'oauth_test_token'; sellerId:string; accessToken:string };
export type PixSnapshot = { total:string; externalReference:string; idempotencyKey:string; payerEmail:string };
export type ProviderTransport = (url:string, init:RequestInit) => Promise<Response>;
export type SandboxOrder = { id:string; externalReference:string; sellerId:string; total:string; status:string; statusDetail:string; qrCode:string|null; qrCodeBase64:string|null; providerData:unknown };

export class SandboxOrdersError extends Error {
  code:string; status?:number; retryAfter?:string;
  constructor(code:string, status?:number, retryAfter?:string) { super(code); this.code=code; this.status=status; this.retryAfter=retryAfter; }
}

const idPattern=/^[A-Za-z0-9_-]{1,128}$/;
function assertConnection(c:SandboxConnection) {
  if (!c || c.mode!=='test' || c.provenance!=='oauth_test_token' || !idPattern.test(c.sellerId) ||
      typeof c.accessToken!=='string' || !c.accessToken || /[\r\n]/.test(c.accessToken)) throw new SandboxOrdersError('invalid_test_connection');
}
function asObject(value:unknown):Record<string,unknown> | null {
  return value && typeof value==='object' && !Array.isArray(value) ? value as Record<string,unknown> : null;
}
function parseOrder(value:unknown, expected:{sellerId:string; id?:string; reference:string; total:string}):SandboxOrder {
  const o=asObject(value);
  if (!o || typeof o.id!=='string' || !idPattern.test(o.id) || (expected.id && o.id!==expected.id) ||
      String(o.user_id ?? '')!==expected.sellerId || o.external_reference!==expected.reference ||
      brlCents(o.total_amount)===null || brlCents(o.total_amount)!==brlCents(expected.total) ||
      o.live_mode===true || typeof o.status!=='string' || typeof o.status_detail!=='string') throw new SandboxOrdersError('provider_binding_mismatch');
  const transactions=asObject(o.transactions);
  const payments=Array.isArray(transactions?.payments) ? transactions.payments : [];
  const payment=payments.length===1 ? asObject(payments[0]) : null;
  const method=asObject(payment?.payment_method);
  if (!payment || method?.id!=='pix' || method?.type!=='bank_transfer') throw new SandboxOrdersError('invalid_provider_payment');
  return {id:o.id,externalReference:expected.reference,sellerId:expected.sellerId,total:expected.total,status:o.status,statusDetail:o.status_detail,
    qrCode:typeof method.qr_code==='string'?method.qr_code:null,qrCodeBase64:typeof method.qr_code_base64==='string'?method.qr_code_base64:null,providerData:value};
}
async function request(transport:ProviderTransport,url:string,init:RequestInit):Promise<unknown> {
  let response:Response;
  try { response=await transport(url,init); } catch { throw new SandboxOrdersError('provider_unavailable'); }
  if (!response.ok) {
    const raw=response.headers.get('retry-after');
    throw new SandboxOrdersError('provider_request_failed',response.status,raw && /^\d{1,6}$/.test(raw)?raw:undefined);
  }
  try { return await response.json(); } catch { throw new SandboxOrdersError('invalid_provider_response'); }
}
export async function createSandboxPixOrder(connection:SandboxConnection,snapshot:PixSnapshot,transport:ProviderTransport):Promise<SandboxOrder> {
  assertConnection(connection);
  const spec=buildTestPixOrder(snapshot);
  const body=await request(transport,spec.url,{method:'POST',redirect:'error',headers:{Authorization:`Bearer ${connection.accessToken}`,'Content-Type':'application/json',Accept:'application/json','X-Idempotency-Key':spec.idempotencyKey},body:JSON.stringify(spec.body)});
  return parseOrder(body,{sellerId:connection.sellerId,reference:snapshot.externalReference,total:snapshot.total});
}
export async function getSandboxPixOrder(connection:SandboxConnection,binding:{id:string;externalReference:string;total:string},transport:ProviderTransport):Promise<SandboxOrder> {
  assertConnection(connection);
  if (!idPattern.test(binding.id) || !/^[A-Za-z0-9_-]{1,64}$/.test(binding.externalReference) || brlCents(binding.total)===null || brlCents(binding.total)===0n) throw new SandboxOrdersError('invalid_binding');
  const body=await request(transport,`https://api.mercadopago.com/v1/orders/${encodeURIComponent(binding.id)}`,{method:'GET',redirect:'error',headers:{Authorization:`Bearer ${connection.accessToken}`,Accept:'application/json'}});
  return parseOrder(body,{sellerId:connection.sellerId,id:binding.id,reference:binding.externalReference,total:binding.total});
}
