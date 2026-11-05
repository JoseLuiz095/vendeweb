import { mintReceiptClaim } from '../_shared/receiptCapability.ts';

type StoredOrder = {
  id: string; store_id: string; total: number | string; payment_method: string;
  payment_status: string; status: string; payment_receipt_version: number | null;
};

/** The signed authorization is derived only from the order saved by the server. */
export async function checkoutReceiptToken(order: StoredOrder | null, storeId: string, secret: string): Promise<string | undefined> {
  if (!order || order.store_id !== storeId || secret.length < 32 || order.payment_method !== 'pix'
      || order.payment_status !== 'pending' || ['cancelled','delivered','picked_up'].includes(order.status)
      || order.payment_receipt_version !== 0 || !Number.isFinite(Number(order.total)) || Number(order.total) <= 0) return undefined;
  return mintReceiptClaim({storeId,orderId:order.id,amount:Number(order.total),version:0},secret);
}
