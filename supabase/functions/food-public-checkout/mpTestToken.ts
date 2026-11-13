import { mintMpTestClaim } from '../_shared/mpTestCheckoutCapability.ts';

type TestOrder={id:string;store_id:string;total:number|string;payment_method:string;payment_status:string;status:string;payment_receipt_version:number|null;customer_email:string|null};
/** No token is minted unless a server-validated test-only policy explicitly allows it. */
export async function checkoutMpTestToken(input:{enabled:boolean;environment:string;origin:string;allowedOrigins:Set<string>;secret:string;storeId:string;order:TestOrder|null;eligible:()=>Promise<boolean>}):Promise<string|undefined>{
 const {order,storeId}=input;
 if(!input.enabled||input.environment!=='staging'||!input.allowedOrigins.has(input.origin)||input.secret.length<32||!order||order.store_id!==storeId||order.payment_method!=='pix'||order.payment_status!=='pending'||['cancelled','delivered','picked_up'].includes(order.status)||order.payment_receipt_version!==0||!Number.isFinite(Number(order.total))||Number(order.total)<=0||!order.customer_email||!/^\S+@\S+\.\S+$/.test(order.customer_email))return undefined;
 try { if(!await input.eligible())return undefined; return await mintMpTestClaim({storeId,orderId:order.id,amount:Number(order.total),version:0},input.secret); } catch { return undefined; }
}
