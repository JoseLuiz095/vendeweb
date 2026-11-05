import { useEffect, useState } from 'react';
import { restFetch } from '../../lib/supabaseRest';
import { loadAnalyticsReport } from '../../services/analyticsApi';
import type { AnalyticsReport, PlatformStoreSummary } from '../../types';
import { currency, slugify } from '../../utils/format';

export function MasterStoreTools({store, locked, onSlugChanged}:{store:PlatformStoreSummary; locked:boolean; onSlugChanged:(slug:string)=>Promise<void>}) {
  const [slug,setSlug]=useState(store.slug);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [days,setDays]=useState(30);
  const [report,setReport]=useState<AnalyticsReport|null>(null);
  const [paid,setPaid]=useState<{paidOrders:number;paidValue:number;cancelledOrders:number}|null>(null);
  const [paidError,setPaidError]=useState('');
  const [reportError,setReportError]=useState('');
  const [loading,setLoading]=useState(false);
  useEffect(()=>{setSlug(store.slug);},[store.id,store.slug]);
  useEffect(()=>{setError('');setNotice('');setReport(null);setPaid(null);setReportError('');setPaidError('');},[store.id]);
  const saveSlug=async()=>{
    if(busy||locked||slug===store.slug)return;
    if(slug.length<3||slug.length>80){setError('Informe entre 3 e 80 caracteres.');return;}
    if(!window.confirm('Alterar o endereço da loja? Links antigos deixarão de funcionar e precisarão ser atualizados.'))return;
    setBusy(true);setError('');setNotice('');
    try {
      await restFetch('rpc/food_master_change_store_slug_v1',{method:'POST',body:{p_store:store.id,p_old_slug:store.slug,p_slug:slug}});
      await onSlugChanged(slug);
      setNotice('Endereço atualizado. Atualize os links divulgados pela loja.');
    } catch(cause) { setError(cause instanceof Error?cause.message:'Não foi possível alterar o endereço.'); }
    finally {setBusy(false);}
  };
  const load=async()=>{
    setLoading(true);setReportError('');setPaidError('');setReport(null);setPaid(null);
    const to=new Date().toISOString(), from=new Date(Date.now()-days*86400000).toISOString();
    try {
      const [analytics,summary]=await Promise.all([
        loadAnalyticsReport(store.id,from,to),
        restFetch<{paidOrders:number;paidValue:number;cancelledOrders:number}>('rpc/food_master_store_order_summary_v1',{method:'POST',body:{p_store:store.id,p_from:from,p_to:to}}).catch(()=>null),
      ]);
      setReport(analytics);setPaid(summary);
      if(!summary)setPaidError('O resumo de pagamentos está indisponível. Verifique a atualização do banco.');
    }
    catch(cause){setReportError(cause instanceof Error?cause.message:'Não foi possível carregar os indicadores.');}
    finally{setLoading(false);}
  };
  return <>
    <details className="operational-details"><summary>Endereço da loja</summary>
      <p>O endereço padrão é usado nos links da VendeWeb. A troca não altera o domínio próprio.</p>
      <label>Novo endereço da loja<input value={slug} maxLength={80} onChange={event=>setSlug(slugify(event.target.value))}/></label>
      <p>Atual: /{store.slug} · Novo: /{slug || 'nome-da-loja'}</p>
      <p>Links antigos deixam de funcionar após a alteração. Atualize os endereços divulgados pela loja.</p>
      <button type="button" className="secondary-button" disabled={busy||locked||slug===store.slug||!slug} onClick={()=>void saveSlug()}>{busy?'Salvando endereço…':'Alterar endereço'}</button>
      {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    </details>
    <details className="operational-details"><summary>Indicadores de vendas da loja</summary>
      <p>Confira pedidos criados no período e etapas da visita para identificar onde os clientes encontram dificuldades.</p>
      <label>Período<select value={days} disabled={loading} onChange={event=>{setDays(Number(event.target.value));setReport(null);setPaid(null);}}><option value={7}>Últimos 7 dias</option><option value={30}>Últimos 30 dias</option><option value={90}>Últimos 90 dias</option></select></label>
      <button type="button" className="secondary-button" disabled={loading} onClick={()=>void load()}>{loading?'Carregando…':'Consultar indicadores'}</button>
      {reportError&&<p role="alert">{reportError}</p>}
      {paidError&&<p role="alert">{paidError}</p>}
      {report&&<div aria-live="polite">
        <p>Pedidos não cancelados: <strong>{report.orders}</strong> · Valor dos pedidos: <strong>{currency.format(report.revenue)}</strong> · Ticket médio: <strong>{currency.format(report.averageTicket)}</strong></p>
        <p>O valor representa pedidos registrados não cancelados; não confirma o recebimento do pagamento.</p>
        {paid&&<><p>Pedidos marcados como pagos: <strong>{paid.paidOrders}</strong> · Valor: <strong>{currency.format(paid.paidValue)}</strong> · Cancelados: <strong>{paid.cancelledOrders}</strong></p><p>A marcação de pagamento pode incluir declarações do cliente; confira os comprovantes e o recebimento bancário.</p></>}
        <p>Visitas: {report.storefrontSessions} · Carrinho: {report.addToCartSessions} · Checkout: {report.checkoutSessions} · Pedidos originados no funil: {report.orderSessions}</p>
        <p>Conversão de visitas em pedidos: {report.conversionRate}% · Abandono no checkout: {report.checkoutAbandonmentRate}%</p>
        <h4>Produtos com mais interesse</h4>
        {report.topProducts.length?<ul>{report.topProducts.map(product=><li key={product.productId}>{product.name}: {product.views} visualizações · {product.soldUnits} unidades vendidas</li>)}</ul>:<p>Sem dados de produtos no período.</p>}
        <h4>Produtos vistos sem venda</h4>
        {report.viewedNotSold.length?<ul>{report.viewedNotSold.map(product=><li key={product.productId}>{product.name}: {product.views} visualizações</li>)}</ul>:<p>Sem produtos nessa situação no período.</p>}
      </div>}
    </details>
  </>;
}
