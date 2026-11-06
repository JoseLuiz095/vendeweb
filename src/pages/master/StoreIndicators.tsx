import { useEffect, useState } from 'react';
import { platformApi } from '../../services/platformApi';
import { loadAnalyticsReport } from '../../services/analyticsApi';
import { restFetch } from '../../lib/supabaseRest';
import type { AnalyticsReport, PlatformStoreSummary } from '../../types';
import { currency } from '../../utils/format';
import './store-indicators.css';

type Paid = { paidOrders: number; paidValue: number; cancelledOrders: number };

export default function StoreIndicators() {
  const [stores, setStores] = useState<PlatformStoreSummary[]>([]);
  const [store, setStore] = useState('');
  const [days, setDays] = useState(30);
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [paid, setPaid] = useState<Paid | null>(null);
  const [error, setError] = useState('');
  const [paidError, setPaidError] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => { let active = true; platformApi.listStores().then(items => { if (active) setStores(items); }).catch(() => { if (active) setError('Não foi possível carregar as lojas.'); }); return () => { active = false; }; }, []);
  const load = async () => {
    if (!store || loading) return;
    setLoading(true); setError(''); setReport(null); setPaid(null); setPaidError(false);
    const to = new Date().toISOString(), from = new Date(Date.now() - days * 86400000).toISOString();
    try {
      const [analytics, summary] = await Promise.all([loadAnalyticsReport(store, from, to), restFetch<Paid>('rpc/food_master_store_order_summary_v1', { method:'POST', body:{ p_store:store, p_from:from, p_to:to } }).catch(() => null)]);
      setReport(analytics); setPaid(summary); setPaidError(!summary);
    } catch { setError('Não foi possível carregar os indicadores desta loja.'); }
    finally { setLoading(false); }
  };
  const funnel = report ? [['Visitas', report.storefrontSessions], ['Carrinho', report.addToCartSessions], ['Checkout', report.checkoutSessions], ['Pedidos do funil', report.orderSessions]] as const : [];
  const max = Math.max(1, ...funnel.map(([, value]) => value));
  return <div className="master-indicators"><header><h1>Indicadores das lojas</h1><p>Selecione uma loja para acompanhar seus pedidos e a jornada dos clientes.</p></header>
    <section className="admin-card master-indicators-filter"><label>Loja<select value={store} disabled={loading} onChange={event => { setStore(event.target.value); setReport(null); setPaid(null); setPaidError(false); }}><option value="">Selecione uma loja</option>{stores.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Período<select value={days} disabled={loading} onChange={event => { setDays(Number(event.target.value)); setReport(null); setPaid(null); setPaidError(false); }}><option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option></select></label><button type="button" className="primary-button" disabled={!store || loading} onClick={() => void load()}>{loading ? 'Consultando…' : 'Consultar indicadores'}</button></section>
    {error && <p role="alert">{error}</p>}{paidError && <p role="alert">Resumo de pagamentos indisponível para esta consulta.</p>}
    {report && <div aria-live="polite"><div className="master-indicator-cards"><article><span>Pedidos não cancelados</span><strong>{report.orders}</strong></article><article><span>Valor dos pedidos</span><strong>{currency.format(report.revenue)}</strong></article><article><span>Ticket médio</span><strong>{currency.format(report.averageTicket)}</strong></article><article><span>Conversão de visitas</span><strong>{report.conversionRate}%</strong></article></div><p>Os valores dos pedidos registrados não confirmam recebimento.</p>
      <section className="admin-card"><h2>Jornada dos clientes</h2><p>Quantidade de sessões em cada etapa.</p><div className="master-funnel">{funnel.map(([label, value]) => <div key={label}><span>{label}</span><div className="master-funnel-track"><div style={{width:`${value / max * 100}%`}} /></div><strong>{value}</strong></div>)}</div><p>Abandono no checkout: {report.checkoutAbandonmentRate}%</p></section>
      <section className="admin-card"><h2>Produtos com mais interesse</h2><p>Visualizações por produto no período.</p>{report.topProducts.length ? <div className="master-funnel">{report.topProducts.slice(0, 5).map(item => <div key={item.productId}><span>{item.name}</span><div className="master-funnel-track"><div style={{width:`${item.views / Math.max(1, ...report.topProducts.map(product => product.views)) * 100}%`}} /></div><strong>{item.views}</strong></div>)}</div> : <p>Sem dados de produtos no período.</p>}</section>
      {paid && <section className="admin-card"><h2>Pedidos marcados como pagos</h2><p><strong>{paid.paidOrders}</strong> pedidos · {currency.format(paid.paidValue)} · {paid.cancelledOrders} cancelados</p><p>A marcação pode incluir declarações do cliente; confira comprovantes e recebimento bancário.</p></section>}
      <details className="admin-card"><summary>Produtos com mais interesse</summary>{report.topProducts.length ? <ul>{report.topProducts.map(item => <li key={item.productId}>{item.name}: {item.views} visualizações · {item.soldUnits} unidades vendidas</li>)}</ul> : <p>Sem dados no período.</p>}</details><details className="admin-card"><summary>Produtos vistos sem venda</summary>{report.viewedNotSold.length ? <ul>{report.viewedNotSold.map(item => <li key={item.productId}>{item.name}: {item.views} visualizações</li>)}</ul> : <p>Sem produtos nessa situação no período.</p>}</details></div>}
  </div>;
}
