import type { Order } from '../types';

export const MAX_ROUTE_DELIVERIES = 4;
type DeliveryAddress = Pick<Order, 'deliveryStreet' | 'deliveryNumber' | 'deliveryNeighborhood' | 'deliveryCity' | 'deliveryState' | 'deliveryZipCode' | 'deliveryAddress'>;

export function deliveryMapAddress(order: DeliveryAddress): string {
  const street = [order.deliveryStreet?.trim(), order.deliveryNumber?.trim()].filter(Boolean).join(', ');
  if (!street) return order.deliveryAddress?.trim() || '';
  return [street, order.deliveryNeighborhood?.trim(), [order.deliveryCity?.trim(), order.deliveryState?.trim()].filter(Boolean).join(' - '), order.deliveryZipCode?.trim()].filter(Boolean).join(', ');
}

export function deliverySearchUrl(address: string): string {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', address);
  return url.toString();
}

export function deliveryRouteUrl(addresses: string[]): string | null {
  if (!addresses.length || addresses.length > MAX_ROUTE_DELIVERIES || addresses.some(address => !address.trim())) return null;
  const url = new URL('https://www.google.com/maps/dir/');
  url.searchParams.set('api', '1');
  url.searchParams.set('destination', addresses[addresses.length - 1]);
  if (addresses.length > 1) url.searchParams.set('waypoints', addresses.slice(0, -1).join('|'));
  url.searchParams.set('travelmode', 'driving');
  const result = url.toString();
  return result.length <= 2048 ? result : null;
}

export function deliveryWhatsAppUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}
