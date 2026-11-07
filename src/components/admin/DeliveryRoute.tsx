import type { Order } from '../../types';
import { formatOrderNumber } from '../../utils/orderConfirmation';
import { deliveryMapAddress, deliveryRouteUrl, deliveryWhatsAppUrl, MAX_ROUTE_DELIVERIES } from '../../utils/deliveryMaps';
import './delivery-route.css';

export function DeliveryRoute({ orders }: { orders: Order[]; storeId: string }) {
  const invalid = orders.filter(order => order.deliveryType !== 'delivery' || ['cancelled', 'delivered'].includes(order.status) || !deliveryMapAddress(order));
  const routeUrl = !invalid.length ? deliveryRouteUrl(orders.map(deliveryMapAddress)) : null;
  const message = `Rota de entregas:\n${orders.map(order => `Pedido #${formatOrderNumber(order.orderNumber)}: ${deliveryMapAddress(order)}${order.deliveryComplement ? ` · ${order.deliveryComplement}` : ''}${order.referencePoint ? ` · Referência: ${order.referencePoint}` : ''}`).join('\n')}\n\n${routeUrl || ''}`;
  const error = invalid.length ? `Rota indisponível: selecione somente entregas em aberto com endereço. Confira ${invalid.map(order => `#${formatOrderNumber(order.orderNumber)}`).join(', ')}.` : orders.length > MAX_ROUTE_DELIVERIES ? `Selecione até ${MAX_ROUTE_DELIVERIES} entregas por rota.` : orders.length && !routeUrl ? 'Divida os pedidos em rotas menores: o link ficou longo demais.' : '';
  return <div className="delivery-route-bar">
    {error ? <span role="status">{error}</span> : routeUrl ? <><div className="delivery-route__actions"><a className="secondary-button compact-button" href={routeUrl} target="_blank" rel="noopener noreferrer">Abrir rota no Maps</a><a className="secondary-button compact-button" href={deliveryWhatsAppUrl(message)} target="_blank" rel="noopener noreferrer">Enviar rota no WhatsApp</a></div><small>Confira e ajuste a ordem no Maps. Compartilhe pelo Maps após alterar.</small></> : null}
  </div>;
}
