import { createSandboxPixOrder, getSandboxPixOrder, SandboxOrdersError, type PixSnapshot, type ProviderTransport, type SandboxConnection } from './mercadoPagoOrdersSandbox.ts';

type ReservedAttempt = { connection:SandboxConnection; snapshot:PixSnapshot; providerOrderId:string|null };
/** All functions are server-side trusted implementations. `reserve` must lock the
 * local order, authorize it for the store, and durably persist one immutable
 * snapshot and idempotency key before returning; retries return the same one.
 * `bind` must use a conditional transactional write and reject another order ID.
 * No implementation of these dependencies or endpoint is installed here. */
export type SandboxHandlerDependencies = {
  authorize:(request:Request,storeId:string,orderId:string)=>Promise<boolean>;
  reserve:(storeId:string,orderId:string)=>Promise<ReservedAttempt>;
  find:(storeId:string,orderId:string)=>Promise<ReservedAttempt|null>;
  bind:(storeId:string,orderId:string,providerOrderId:string)=>Promise<void>;
  transport:ProviderTransport;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json=(value:unknown,status:number)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});

export function makeSandboxOrdersHandler(deps:SandboxHandlerDependencies) {
  return async (request:Request):Promise<Response> => {
    if(request.method!=='POST') return json({error:'method_not_allowed'},405);
    let input:Record<string,unknown>;
    try {
      const raw=await request.text();
      if(raw.length>2048) return json({error:'invalid_request'},400);
      const parsed=JSON.parse(raw);
      if(!parsed || typeof parsed!=='object' || Array.isArray(parsed)) return json({error:'invalid_request'},400);
      input=parsed;
    } catch { return json({error:'invalid_request'},400); }
    const {action,storeId,orderId}=input;
    if(Object.keys(input).some(key=>!['action','storeId','orderId'].includes(key)) ||
      (action!=='create'&&action!=='get') || typeof storeId!=='string' || !uuid.test(storeId) ||
      typeof orderId!=='string' || !uuid.test(orderId)) return json({error:'invalid_request'},400);
    try {
      if(!await deps.authorize(request,storeId,orderId)) return json({error:'not_authorized'},403);
      const attempt=action==='create'?await deps.reserve(storeId,orderId):await deps.find(storeId,orderId);
      if(!attempt || (action==='get'&&!attempt.providerOrderId)) return json({error:'provider_order_not_bound'},404);
      const order=attempt.providerOrderId
        ? await getSandboxPixOrder(attempt.connection,{id:attempt.providerOrderId,externalReference:attempt.snapshot.externalReference,total:attempt.snapshot.total},deps.transport)
        : await createSandboxPixOrder(attempt.connection,attempt.snapshot,deps.transport);
      if(!attempt.providerOrderId) await deps.bind(storeId,orderId,order.id);
      // Provider status is informational; this handler never marks a local order paid.
      return json({id:order.id,status:order.status,statusDetail:order.statusDetail,qrCode:order.qrCode,qrCodeBase64:order.qrCodeBase64},200);
    } catch(error) {
      if(error instanceof SandboxOrdersError) return json({error:error.code},error.status===429?429:502);
      return json({error:'sandbox_order_unavailable'},500);
    }
  };
}
