import { restFetch } from '../lib/supabaseRest';

export type PickupOrderSummaryOrder = {
  id: string;
  orderNumber: number;
  createdAt: string;
  status: string;
  paymentStatus: string;
  orderTotal: number;
  productValue: number;
  orderedQuantity: number;
  withdrawnQuantity: number;
};

export type PickupOrderSummaryProduct = {
  productId: string | null;
  productName: string;
  variantName: string | null;
  orderedQuantity: number;
  withdrawnQuantity: number;
  productValue: number;
};

export type PickupOrderSummaryPoint = {
  pickupLocationId: string | null;
  name: string;
  orderCount: number;
  paidOrderCount: number;
  pendingPaymentOrderCount: number;
  cancelledOrderCount: number;
  productValue: number;
  orderedQuantity: number;
  withdrawnQuantity: number;
  orders: PickupOrderSummaryOrder[];
  products: PickupOrderSummaryProduct[];
};

export type PickupOrderSummaryReport = { points: PickupOrderSummaryPoint[] };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function asNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function parsePickupOrderSummary(value: unknown): PickupOrderSummaryReport {
  const root = asRecord(value);
  if (!Array.isArray(root.points)) throw new Error('O resumo dos pontos de retirada veio em um formato inválido.');

  const points = root.points.map((entry): PickupOrderSummaryPoint => {
    const point = asRecord(entry);
    const orders = Array.isArray(point.orders) ? point.orders.map((entryOrder): PickupOrderSummaryOrder => {
      const order = asRecord(entryOrder);
      return {
        id: String(order.id ?? ''),
        orderNumber: asNumber(order.orderNumber),
        createdAt: String(order.createdAt ?? ''),
        status: String(order.status ?? ''),
        paymentStatus: String(order.paymentStatus ?? ''),
        orderTotal: asNumber(order.orderTotal),
        productValue: asNumber(order.productValue),
        orderedQuantity: asNumber(order.orderedQuantity),
        withdrawnQuantity: asNumber(order.withdrawnQuantity),
      };
    }) : [];
    const products = Array.isArray(point.products) ? point.products.map((entryProduct): PickupOrderSummaryProduct => {
      const product = asRecord(entryProduct);
      return {
        productId: asOptionalString(product.productId),
        productName: String(product.productName ?? 'Produto'),
        variantName: asOptionalString(product.variantName),
        orderedQuantity: asNumber(product.orderedQuantity),
        withdrawnQuantity: asNumber(product.withdrawnQuantity),
        productValue: asNumber(product.productValue),
      };
    }) : [];

    return {
      pickupLocationId: asOptionalString(point.pickupLocationId),
      name: String(point.name ?? 'Ponto de retirada'),
      orderCount: asNumber(point.orderCount),
      paidOrderCount: asNumber(point.paidOrderCount),
      pendingPaymentOrderCount: asNumber(point.pendingPaymentOrderCount),
      cancelledOrderCount: asNumber(point.cancelledOrderCount),
      productValue: asNumber(point.productValue),
      orderedQuantity: asNumber(point.orderedQuantity),
      withdrawnQuantity: asNumber(point.withdrawnQuantity),
      orders,
      products,
    };
  });

  return { points };
}

export async function getPickupOrderSummary(storeId: string, from: string, toExclusive: string) {
  const result = await restFetch<unknown>('rpc/food_get_pickup_order_summary_v1', {
    method: 'POST',
    body: { p_store_id: storeId, p_from: from, p_to: toExclusive },
  });
  return parsePickupOrderSummary(result);
}
