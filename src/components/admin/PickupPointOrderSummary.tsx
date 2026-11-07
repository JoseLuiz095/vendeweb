import { CalendarDays, Package, PackageCheck, RefreshCw, ShoppingCart, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { currency, formatDateTimeBR } from '../../utils/format';
import {
  getPickupOrderSummary,
  type PickupOrderSummaryOrder,
  type PickupOrderSummaryPoint,
  type PickupOrderSummaryReport,
} from '../../services/pickupOrderSummaryApi';
import { restFetch } from '../../lib/supabaseRest';
import { stockLocationsApi, type ProductLocationStock } from '../../services/stockLocationsApi';
import type { Order, Product } from '../../types';
import './pickup-point-order-summary.css';

type Props = { storeId: string; orders: Order[]; products: Product[]; onOpenOrder: (id: string) => void };
type PickupPoint = { id: string; name: string; stock_location_id: string | null; active: boolean };

const quantityFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });

function localDateInputValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

function getRangeBounds(from: string, to: string) {
  const start = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  end.setDate(end.getDate() + 1);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) {
    throw new Error('Informe um período válido.');
  }
  return { from: start.toISOString(), to: end.toISOString() };
}

function quantity(value: number) {
  return quantityFormat.format(value);
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    received: 'Recebido',
    confirmed: 'Confirmado',
    preparing: 'Em preparação',
    ready: 'Pronto',
    out_for_delivery: 'Saiu para entrega',
    delivered: 'Entregue',
    picked_up: 'Retirado',
    cancelled: 'Cancelado',
  };
  return labels[status] || status.replace(/_/g, ' ');
}

function paymentLabel(status: string) {
  const labels: Record<string, string> = {
    paid: 'Pago',
    pending: 'A receber',
    failed: 'Falhou',
    refunded: 'Estornado',
  };
  return labels[status] || status.replace(/_/g, ' ');
}

function orderCaption(order: PickupOrderSummaryOrder) {
  return 'Pedido #' + order.orderNumber;
}

function PointBreakdown({ point, orders, onOpenOrder }: { point: PickupOrderSummaryPoint; orders: Order[]; onOpenOrder: (id: string) => void }) {
  return <details className="pickup-point-order-summary__breakdown">
    <summary><ShoppingCart size={17}/> {quantity(point.orderCount)} pedido(s) · {quantity(point.orderedQuantity)} produto(s) · {currency.format(point.productValue)}</summary>
    <h4>Pedidos</h4>
    {point.orders.length > 0
      ? <div className="pickup-point-order-summary__orders">
        {point.orders.map(order => <article key={order.id}>
          <header><strong>{orderCaption(order)}</strong><time>{formatDateTimeBR(order.createdAt)}</time></header>
          <p>{statusLabel(order.status)} · {paymentLabel(order.paymentStatus)}</p>
          {orders.find(item => item.id === order.id)?.items?.length ? <ul>{orders.find(item => item.id === order.id)!.items!.map(item => <li key={item.id}>{quantity(item.quantity)} × {item.productName}{item.variantName ? ` · ${item.variantName}` : ''}</li>)}</ul> : <small>Produtos disponíveis ao abrir o pedido.</small>}
          {orders.some(item => item.id === order.id) && <button type="button" className="secondary-button compact-button" onClick={() => onOpenOrder(order.id)}>Ver pedido</button>}
          <div>
            <span>Produtos <strong>{currency.format(order.productValue)}</strong></span>
            <span>Total do pedido <strong>{currency.format(order.orderTotal)}</strong></span>
            <span>Estoque baixado <strong>{quantity(order.withdrawnQuantity)}</strong></span>
          </div>
        </article>)}
      </div>
      : <p className="pickup-point-order-summary__empty">Nenhum pedido neste período.</p>}
  </details>;
}

function StockComparison({ pointId, points, balances, error, products, physical, setPhysical }: { pointId: string; points: PickupPoint[]; balances: ProductLocationStock[] | null; error: string; products: Product[]; physical: Record<string, string>; setPhysical: React.Dispatch<React.SetStateAction<Record<string, string>>> }) {
  const locationId = points.find(point => point.id === pointId)?.stock_location_id;
  if (!locationId) return <p>Este ponto não possui estoque vinculado para comparação.</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!balances) return <p role="status">Carregando estoque digital…</p>;
  const rows = balances.filter(balance => balance.location_id === locationId);
  return <details className="pickup-point-order-summary__comparison"><summary><SlidersHorizontal size={17}/> Conferir estoque</summary>
    <p>O saldo digital é atual, independentemente do período dos pedidos. Informe a contagem física; a diferença não altera o estoque.</p>
    {rows.length ? rows.map(balance => {
      const product = products.find(item => item.id === balance.product_id);
      const key = pointId + ':' + balance.product_id;
      const value = physical[key] ?? '';
      const number = Number(value);
      const valid = value.trim() !== '' && Number.isFinite(number) && number >= 0;
      return <div className="pickup-comparison-row" key={key}><strong>{product?.name || 'Produto indisponível'}</strong><span>Digital: {quantity(balance.stock_quantity)}{balance.stock_reserved_quantity ? ' · Reservado: ' + quantity(balance.stock_reserved_quantity) : ''}</span><label>Contagem física<input type="number" min="0" step="1" value={value} onChange={event => setPhysical(current => ({ ...current, [key]: event.target.value }))}/></label><span>{valid ? (number === balance.stock_quantity ? 'Quantidades iguais' : 'Diferença: ' + quantity(number - balance.stock_quantity)) : 'Aguardando contagem'}</span></div>;
    }) : <p>Não há saldos cadastrados para este estoque.</p>}
  </details>;
}

export default function PickupPointOrderSummary({ storeId, orders, products, onOpenOrder }: Props) {
  const [open, setOpen] = useState(false);
  const [stockRefresh, setStockRefresh] = useState(0);
  const [points, setPoints] = useState<PickupPoint[] | null>(null);
  const [pointsError, setPointsError] = useState('');
  const [balances, setBalances] = useState<ProductLocationStock[] | null>(null);
  const [balancesError, setBalancesError] = useState('');
  const [physical, setPhysical] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true; setPoints(null); setPointsError(''); setBalances(null); setPhysical({}); setOpen(false);
    void restFetch<PickupPoint[]>(`food_pickup_locations?store_id=eq.${encodeURIComponent(storeId)}&select=id,name,stock_location_id,active`).then(value => { if (active) setPoints(value); }).catch(() => { if (active) setPointsError('Não foi possível verificar os pontos de retirada.'); });
    return () => { active = false; };
  }, [storeId]);
  useEffect(() => {
    if (!open) return; let active = true; setBalances(null); setBalancesError('');
    void stockLocationsApi.list(storeId).then(([, values]) => { if (active) setBalances(values); }).catch(() => { if (active) setBalancesError('Não foi possível carregar o estoque digital. Atualize para tentar novamente.'); });
    return () => { active = false; };
  }, [storeId, open, stockRefresh]);
  const today = localDateInputValue();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [refreshKey, setRefreshKey] = useState(0);
  const [cleared, setCleared] = useState(false);
  const [report, setReport] = useState<PickupOrderSummaryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    if (!open) return () => { active = false; };
    if (from > to) {
      setReport(null);
      setLoading(false);
      setError('A data inicial deve ser anterior ou igual à data final.');
      return () => { active = false; };
    }

    setLoading(true);
    setError('');
    try {
      const bounds = getRangeBounds(from, to);
      void getPickupOrderSummary(storeId, bounds.from, bounds.to)
        .then(value => { if (active) setReport(value); })
        .catch(reason => {
          if (active) setError(reason instanceof Error ? reason.message : 'Não foi possível carregar o resumo dos pontos.');
        })
        .finally(() => { if (active) setLoading(false); });
    } catch (reason) {
      setLoading(false);
      setError(reason instanceof Error ? reason.message : 'Informe um período válido.');
    }
    return () => { active = false; };
  }, [storeId, from, to, refreshKey, open]);

  if (points && points.length === 0) return null;
  if (!points && !pointsError) return null;
  return <details id="pickup-point-order-summary" className="admin-card pickup-point-order-summary" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="pickup-point-order-summary__toggle"><PackageCheck size={20}/><span><strong>Conferência dos pontos de retirada</strong><small>Estoque e pedidos para revisão</small></span></summary>
    {pointsError && <p role="alert">{pointsError}</p>}
    {open && points && <>
    <div className="pickup-summary-toolbar">
      <span>{from === to ? from.split('-').reverse().join('/') : from.split('-').reverse().join('/') + ' a ' + to.split('-').reverse().join('/')}</span>
      <details className="pickup-point-order-summary__filter-toggle"><summary><CalendarDays size={16}/> Período</summary><div className="pickup-point-order-summary__filters"><label><span>De</span><input type="date" value={from} onChange={event => setFrom(event.target.value)}/></label><label><span>Até</span><input type="date" value={to} onChange={event => setTo(event.target.value)}/></label></div></details>
      <button type="button" className="pickup-toolbar-action" disabled={loading} onClick={() => { setCleared(false); setRefreshKey(value => value + 1); setStockRefresh(value => value + 1); }}><RefreshCw size={16}/> {loading ? 'Atualizando…' : 'Atualizar'}</button>
      <button type="button" className="pickup-toolbar-action" disabled={loading || cleared || !report} onClick={() => { setCleared(true); setPhysical({}); }}>Limpar visualização</button>
    </div>
    {error && <p className="pickup-point-order-summary__error" role="alert">{error}</p>}
    {loading && <p className="pickup-point-order-summary__loading" role="status">Carregando o resumo dos pontos…</p>}

    {cleared && !loading && <p role="status">Visualização limpa. Para consultar novamente, toque em Atualizar.</p>}
    {!loading && !error && report && !cleared && <>
      {report.points.length > 0
        ? <div className="pickup-point-order-summary__points">
          {report.points.map(point => <details key={point.pickupLocationId || 'no-point'} className="pickup-summary-point">
            <summary><span><strong>{point.name}</strong><small>{quantity(point.orderCount)} pedido(s) · {quantity(point.orderedQuantity)} produto(s)</small></span><b>{currency.format(point.productValue)}</b></summary>
            <div className="pickup-summary-point__body">
              {point.products.length > 0 ? <div className="pickup-summary-products" aria-label={`Produtos de ${point.name}`}>{point.products.map((product, index) => {
                const catalogProduct = products.find(item => item.id === product.productId);
                return <article key={(product.productId || product.productName) + ':' + (product.variantName || '') + ':' + index} className="pickup-summary-product">
                  {catalogProduct?.imageUrl ? <img src={catalogProduct.imageUrl} alt=""/> : <span className="pickup-summary-product__placeholder" aria-hidden="true"><Package size={22}/></span>}
                  <strong>{product.productName}</strong>{product.variantName && <small>{product.variantName}</small>}<span>{quantity(product.orderedQuantity)} unidade(s)</span><b>{currency.format(product.productValue)}</b>
                </article>;
              })}</div> : <p className="pickup-point-order-summary__empty">Nenhum produto pedido neste período.</p>}
              <p className="pickup-summary-caption">Valores e quantidades de produtos não incluem pedidos cancelados.</p>
              {point.orderCount > 0 && <PointBreakdown point={point} orders={orders} onOpenOrder={onOpenOrder}/>}
              {point.pickupLocationId && <StockComparison pointId={point.pickupLocationId} points={points} balances={balances} error={balancesError} products={products} physical={physical} setPhysical={setPhysical}/>}
            </div>
          </details>)}
        </div>
        : <p className="pickup-point-order-summary__empty">Nenhum ponto de retirada cadastrado.</p>}
    </>}
    </>}
  </details>;
}
