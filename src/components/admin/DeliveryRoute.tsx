import { useEffect, useState } from 'react';
import type { Order } from '../../types';
import { formatOrderNumber } from '../../utils/orderConfirmation';
import { deliveryMapAddress, deliveryRouteUrl, deliveryWhatsAppUrl, MAX_ROUTE_DELIVERIES, reconcileRouteOrder } from '../../utils/deliveryMaps';
import './delivery-route.css';

export function DeliveryRoute({ orders }: { orders: Order[]; storeId: string }) {
  const [chosenOrder, setChosenOrder] = useState<string[]>([]);
  const selectionKey = JSON.stringify(orders.map(order => order.id));
  useEffect(() => {
    const selected: string[] = JSON.parse(selectionKey);
    setChosenOrder(current => reconcileRouteOrder(current, selected));
  }, [selectionKey]);
  const orderById = new Map(orders.map(order => [order.id, order]));
  const ids = reconcileRouteOrder(chosenOrder, orders.map(order => order.id));
  const ordered = ids.map(id => orderById.get(id)).filter((order): order is Order => Boolean(order));
  const invalid = ordered.filter(order => order.deliveryType !== 'delivery' || ['cancelled', 'delivered', 'picked_up'].includes(order.status) || !deliveryMapAddress(order));
  const routeUrl = !invalid.length ? deliveryRouteUrl(ordered.map(deliveryMapAddress)) : null;
  const message = `Rota de entregas:\n${ordered.map(order => `Pedido #${formatOrderNumber(order.orderNumber)}: ${deliveryMapAddress(order)}${order.deliveryComplement ? ` · ${order.deliveryComplement}` : ''}${order.referencePoint ? ` · Referência: ${order.referencePoint}` : ''}`).join('\n')}\n\n${routeUrl || ''}`;
  const error = invalid.length ? `Rota indisponível: selecione somente entregas em aberto com endereço. Confira ${invalid.map(order => `#${formatOrderNumber(order.orderNumber)}`).join(', ')}.` : ordered.length > MAX_ROUTE_DELIVERIES ? `Selecione até ${MAX_ROUTE_DELIVERIES} entregas por rota: três paradas e o destino final. Divida os demais pedidos em outra rota.` : ordered.length && !routeUrl ? 'Divida os pedidos em rotas menores: o link ficou longo demais.' : '';
  const move = (index: number, direction: -1 | 1) => {
    const next = [...ids];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setChosenOrder(next);
  };
  return <div className="delivery-route-bar">
    {error ? <span role="status">{error}</span> : routeUrl ? <>
      <details className="delivery-route__stops"><summary>Conferir e ordenar {ordered.length === 1 ? 'entrega' : 'entregas'}</summary>
        <p>O Maps usa a localização atual quando disponível ou solicita o ponto de partida.</p>
        <ol>{ordered.map((order, index) => <li key={order.id}><span><strong>#{formatOrderNumber(order.orderNumber)}</strong> · {deliveryMapAddress(order)}</span><div>
          <button type="button" aria-label={`Mover pedido ${formatOrderNumber(order.orderNumber)} para cima`} disabled={index===0} onClick={()=>move(index,-1)}>↑</button>
          <button type="button" aria-label={`Mover pedido ${formatOrderNumber(order.orderNumber)} para baixo`} disabled={index===ordered.length-1} onClick={()=>move(index,1)}>↓</button>
        </div></li>)}</ol>
      </details>
      <div className="delivery-route__actions"><a className="secondary-button compact-button" href={routeUrl} target="_blank" rel="noopener noreferrer">Abrir rota no Maps</a><a className="secondary-button compact-button" href={deliveryWhatsAppUrl(message)} target="_blank" rel="noopener noreferrer">Enviar rota no WhatsApp</a></div><small>Confira os endereços e a ordem antes de sair.</small>
    </> : null}
  </div>;
}
