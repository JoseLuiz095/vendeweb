import { CalendarDays, PackageCheck, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { currency, formatDateTimeBR } from '../../utils/format';
import {
  getPickupOrderSummary,
  type PickupOrderSummaryOrder,
  type PickupOrderSummaryPoint,
  type PickupOrderSummaryReport,
} from '../../services/pickupOrderSummaryApi';
import './pickup-point-order-summary.css';

type Props = { storeId: string };

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

function PointBreakdown({ point }: { point: PickupOrderSummaryPoint }) {
  return <details className="pickup-point-order-summary__breakdown">
    <summary>Ver os {point.orderCount} pedidos e os produtos do ponto</summary>
    {point.products.length > 0 && <>
      <h4>Produtos</h4>
      <div className="pickup-point-order-summary__products">
        {point.products.map((product, index) => <article key={(product.productId || product.productName) + ':' + (product.variantName || '') + ':' + index}>
          <div className="pickup-point-order-summary__product-name">
            <strong>{product.productName}</strong>
            {product.variantName && <span>{product.variantName}</span>}
          </div>
          <span>Pedidos <strong>{quantity(product.orderedQuantity)}</strong></span>
          <span>Baixados <strong>{quantity(product.withdrawnQuantity)}</strong></span>
          <strong>{currency.format(product.productValue)}</strong>
        </article>)}
      </div>
    </>}
    <h4>Pedidos</h4>
    {point.orders.length > 0
      ? <div className="pickup-point-order-summary__orders">
        {point.orders.map(order => <article key={order.id}>
          <header><strong>{orderCaption(order)}</strong><time>{formatDateTimeBR(order.createdAt)}</time></header>
          <p>{statusLabel(order.status)} · {paymentLabel(order.paymentStatus)}</p>
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

export default function PickupPointOrderSummary({ storeId }: Props) {
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
  }, [storeId, from, to, refreshKey]);

  const totals = useMemo(() => (report?.points || []).reduce((total, point) => ({
    orders: total.orders + point.orderCount,
    productValue: total.productValue + point.productValue,
    ordered: total.ordered + point.orderedQuantity,
    withdrawn: total.withdrawn + point.withdrawnQuantity,
  }), { orders: 0, productValue: 0, ordered: 0, withdrawn: 0 }), [report]);

  return <section id="pickup-point-order-summary" className="admin-card pickup-point-order-summary" aria-labelledby="pickup-point-order-summary-title">
    <header className="pickup-point-order-summary__header">
      <div>
        <span className="eyebrow">RETIRADAS</span>
        <h2 id="pickup-point-order-summary-title"><PackageCheck size={20}/>Resumo por ponto de retirada</h2>
        <p>Confira os pedidos, o valor dos produtos e as quantidades baixadas em cada ponto.</p>
      </div>
      <button type="button" className="secondary-button compact-button" disabled={loading} onClick={() => { setCleared(false); setRefreshKey(value => value + 1); }}>
        <RefreshCw size={15}/>{loading ? 'Atualizando…' : 'Atualizar'}
      </button>
      <button type="button" className="secondary-button compact-button" disabled={loading || cleared || !report} onClick={() => setCleared(true)}>Limpar visualização</button>
    </header>

    <div className="pickup-point-order-summary__filters">
      <label><span><CalendarDays size={15}/>De</span><input type="date" value={from} onChange={event => setFrom(event.target.value)}/></label>
      <label><span><CalendarDays size={15}/>Até</span><input type="date" value={to} onChange={event => setTo(event.target.value)}/></label>
    </div>

    <p className="pickup-point-order-summary__note">Por data do pedido. Baixas descontam devoluções. Limpar afeta apenas esta tela; atualizar recupera o histórico.</p>

    {error && <p className="pickup-point-order-summary__error" role="alert">{error}</p>}
    {loading && <p className="pickup-point-order-summary__loading" role="status">Carregando o resumo dos pontos…</p>}

    {cleared && !loading && <p role="status">Visualização limpa. Para consultar novamente, toque em Atualizar.</p>}
    {!loading && !error && report && !cleared && <>
      <div className="pickup-point-order-summary__totals" aria-label="Totais do período">
        <article><span>Pedidos</span><strong>{quantity(totals.orders)}</strong></article>
        <article><span>Valor dos produtos</span><strong>{currency.format(totals.productValue)}</strong></article>
        <article><span>Unidades pedidas</span><strong>{quantity(totals.ordered)}</strong></article>
        <article><span>Estoque retirado líquido</span><strong>{quantity(totals.withdrawn)}</strong></article>
      </div>

      {report.points.length > 0
        ? <div className="pickup-point-order-summary__points">
          {report.points.map(point => <article key={point.pickupLocationId || 'no-point'} className="pickup-point-order-summary__point">
            <header><h3>{point.name}</h3><span>{quantity(point.orderCount)} pedido(s) · {quantity(point.paidOrderCount)} pago(s) · {quantity(point.pendingPaymentOrderCount)} pendente(s)</span></header>
            <div className="pickup-point-order-summary__point-totals">
              <span>Produtos <strong>{currency.format(point.productValue)}</strong></span>
              <span>Unidades pedidas <strong>{quantity(point.orderedQuantity)}</strong></span>
              <span>Estoque retirado <strong>{quantity(point.withdrawnQuantity)}</strong></span>
              {point.cancelledOrderCount > 0 && <span>Cancelados <strong>{quantity(point.cancelledOrderCount)}</strong></span>}
            </div>
            {point.orderCount > 0
              ? <PointBreakdown point={point}/>
              : <p className="pickup-point-order-summary__empty">Sem pedidos neste período.</p>}
          </article>)}
        </div>
        : <p className="pickup-point-order-summary__empty">Nenhum ponto de retirada cadastrado.</p>}
    </>}
  </section>;
}
