import ReceiptDestination from '../../components/ReceiptDestination';
import { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { resolveOrderPayment, type OrderPayment as Payment } from '../../services/orderPaymentApi';
import PixCopyButton from '../../components/PixCopyButton';
import { currency } from '../../utils/format';
import { formatOrderNumber } from '../../utils/orderConfirmation';
import './order-payment.css';

export default function OrderPayment() {
  const [token] = useState(() => window.location.hash.slice(1));
  const [payment, setPayment] = useState<Payment | null>(null);
  const [error, setError] = useState('');
  const [qr, setQr] = useState('');
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    document.title = 'Pagamento Pix · VendeWeb';
    const meta = document.createElement('meta'); meta.name = 'robots'; meta.content = 'noindex,nofollow,noarchive'; document.head.append(meta);
    const referrer = document.createElement('meta'); referrer.name = 'referrer'; referrer.content = 'no-referrer'; document.head.append(referrer);
    return () => { meta.remove(); referrer.remove(); };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setPayment(null); setError(''); setQr('');
    if (!token) { setError('Link incompleto. Solicite o link de pagamento à loja.'); setLoading(false); return; }
    void resolveOrderPayment(token).then(value => { if (active) setPayment(value); }).catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'Pagamento indisponível.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, attempt]);
  useEffect(() => {
    if (!payment?.pixPayload) return;
    let active = true;
    void QRCode.toDataURL(payment.pixPayload, { width: 260, margin: 2, errorCorrectionLevel: 'M' }).then(url => { if (active) setQr(url); }).catch(() => { /* Copy remains available. */ });
    return () => { active = false; };
  }, [payment?.pixPayload]);
  useEffect(() => {
    const refresh = () => { if (!document.hidden) retry(); };
    document.addEventListener('visibilitychange', refresh);
    const timer = payment?.expiresAt ? window.setTimeout(retry, Math.max(0, Date.parse(payment.expiresAt) - Date.now())) : undefined;
    return () => { document.removeEventListener('visibilitychange', refresh); if (timer !== undefined) clearTimeout(timer); };
  }, [payment?.expiresAt, retry]);
  const receiptMessage = useMemo(() => {
    if (!payment) return '';
    const products = (payment.items||[]).map(item => '• '+item.quantity+'x '+item.productName+(item.variantName?' ('+item.variantName+')':'')).join('\n') || '• Itens do pedido #'+formatOrderNumber(payment.orderNumber);
    return 'Olá! Segue o comprovante do pedido #'+formatOrderNumber(payment.orderNumber)+' da '+payment.storeName+'.\n\nProdutos:\n'+products+'\n\nValor total: '+currency.format(payment.total||0)+'.';
  }, [payment]);
  return <main className="order-payment-page"><section className="order-payment-card" aria-busy={loading}>
    <span>VendeWeb · Pagamento</span><h1>Pagamento Pix</h1>
    {loading ? <p role="status">Conferindo pagamento…</p> : error ? <><p role="alert">{error}</p><button type="button" className="primary-button" onClick={retry}>Tentar novamente</button></> : payment && <>
      <h2>{payment.storeName}</h2><p>Pedido #{formatOrderNumber(payment.orderNumber)}</p>
      {payment.status === 'pending' ? <>
        <strong className="order-payment-total">{currency.format(payment.total!)}</strong>
        <p>Recebedor: <strong>{payment.receiver || payment.storeName}</strong>. Confira os dados no banco antes de pagar.</p>
        <PixCopyButton key={payment.pixPayload} value={payment.pixPayload!} compact/>
        {qr&&<details className="order-payment-qr"><summary>Prefiro pagar com QR Code</summary><img src={qr} alt={'QR Code Pix no valor de '+currency.format(payment.total!)} width="260" height="260"/></details>}
        <small>Link válido até {new Date(payment.expiresAt!).toLocaleString('pt-BR')}.</small>
        <small role="status">Depois de pagar, toque no botão para enviar o comprovante pelo WhatsApp. Esse clique marca o pedido como pago e, na retirada, conclui a entrega.</small>
        {payment.receiptToken?<ReceiptDestination receiptToken={payment.receiptToken} destinations={payment.receiptDestinations??{mode:'unavailable',contacts:[]}} message={receiptMessage} onReported={autoPickedUp=>setPayment(current=>current?{...current,status:'paid',paymentReportedByCustomer:true,fulfillmentStatus:autoPickedUp?'delivered':current.fulfillmentStatus}:current)}/>:<p role="status">O envio do comprovante ainda não está disponível. Fale com a loja.</p>}
      </> : <p role="status">{payment.status === 'paid' ? payment.paymentReportedByCustomer
        ? 'Pagamento marcado como pago ao abrir o WhatsApp.'+(payment.fulfillmentStatus==='delivered'||payment.fulfillmentStatus==='picked_up'?' Retirada concluída.':'')
        : 'Pagamento confirmado. Não pague novamente.'
        : 'Pedido cancelado. Não efetue o pagamento.'}</p>}
    </>}
  </section></main>;
}
