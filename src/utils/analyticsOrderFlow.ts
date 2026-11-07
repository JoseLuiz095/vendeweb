import type { Order } from '../types';

export function summarizeRecentOrders(orders: Order[], now: number) {
  const active = orders.filter(order => !['cancelled', 'delivered', 'picked_up'].includes(order.status));
  const pastSchedule = (order: Order) => {
    const value = order.scheduledFor ? Date.parse(order.scheduledFor) : NaN;
    return Number.isFinite(value) && value <= now;
  };
  const sorted = [...active].sort((a, b) => Number(pastSchedule(b)) - Number(pastSchedule(a)) || (Date.parse(a.createdAt) || now) - (Date.parse(b.createdAt) || now));
  return { activeCount: active.length, pastScheduleCount: active.filter(pastSchedule).length, sorted };
}
