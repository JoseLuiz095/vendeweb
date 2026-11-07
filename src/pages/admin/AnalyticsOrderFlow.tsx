import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Order, OrderStatus } from '../../types';
import { formatOrderNumber } from '../../utils/orderConfirmation';
import './analytics-order-flow.css';
import { summarizeRecentOrders } from '../../utils/analyticsOrderFlow';

const labels: Record<OrderStatus, string> = {
  received: 'Recebido', confirmed: 'Confirmado', preparing: 'Em preparação', ready: 'Pronto',
  out_for_delivery: 'Saiu para entrega', delivered: 'Entregue', picked_up: 'Retirado', cancelled: 'Cancelado',
};

export default function AnalyticsOrderFlow({ orders, refresh }: { orders: Order[]; refresh: () => Promise<void> }) {
  const [now, setNow] = useState(Date.now());
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 60_000); return () => window.clearInterval(timer); }, []);
  const { activeCount, pastScheduleCount, sorted } = summarizeRecentOrders(orders, now);
  async function update() { setUpdating(true); setError(''); try { await refresh(); setNow(Date.now()); } catch { setError('Não foi possível atualizar os pedidos. Tente novamente.'); } finally { setUpdating(false); } }
  return <details className="admin-card analytics-flow">
    <summary><span><strong>Pedidos em andamento</strong><small>Pedidos recentes · {activeCount} em andamento{orders.length >= 100 ? ' nos 100 carregados' : ''}</small></span><span aria-hidden="true">⌄</span></summary>
    <div className="analytics-flow__body">
      <p>Entre os {orders.length} pedidos recentes carregados, {pastScheduleCount} {pastScheduleCount === 1 ? 'passou' : 'passaram'} do horário agendado. A lista pode não incluir pedidos mais antigos.</p>
      {sorted.length ? <ul>{sorted.slice(0, 3).map(order => {
        const created = Date.parse(order.createdAt); const minutes = Number.isFinite(created) ? Math.max(0, Math.floor((now - created) / 60_000)) : null;
        const scheduled = order.scheduledFor ? Date.parse(order.scheduledFor) : NaN;
        const elapsed = minutes === null ? 'Horário de criação indisponível' : minutes < 60 ? `Criado há ${minutes} min` : `Criado há ${Math.floor(minutes / 60)} h`;
        return <li key={order.id}><span><strong>#{formatOrderNumber(order.orderNumber)} · {labels[order.status]}</strong><small>{elapsed}{Number.isFinite(scheduled) && scheduled <= now ? ' · Horário agendado passou' : ''}</small></span><Link to={`/admin/pedidos?highlight=${encodeURIComponent(order.id)}`} aria-label={`Ver pedido ${formatOrderNumber(order.orderNumber)}`}>Ver pedido →</Link></li>;
      })}</ul> : <p>Nenhum pedido em andamento entre os pedidos carregados.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="analytics-flow__actions"><button type="button" onClick={() => void update()} disabled={updating}>{updating ? 'Atualizando…' : 'Atualizar'}</button><Link to="/admin/pedidos">Ver todos os pedidos →</Link></div>
    </div>
  </details>;
}
