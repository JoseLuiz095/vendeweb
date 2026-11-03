import ReceiptDestination from '../../components/ReceiptDestination';
import { useCallback, useEffect, useState } from 'react';
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
  const [step,setStep]=useState<'payment'|'receipt'>('payment');
  const retry = useCallback(() => setAttempt(a => a + 1), []);
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
    void resolveOrderPayment(token).then(value => { if (active) setPayment(value); }).catch(e => { if (active) setError(e instanceof Error ? e.message : 'Pagamento indisponível.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token, attempt]);
  useEffect(() => {
    if (!payment?.pixPayload) return;
    let active = true;
    void QRCode.toDataURL(payment.pixPayload, { width: 260, margin: 2, errorCorrectionLevel: 'M' }).then(url => { if (active) setQr(url); }).catch(() => { /* Copy remains available. */ });
    return () => { active = false; };
  }, [payment?.pixPayload]);
  useEffect(() => {
    // Invalidate displayed instructions on expiry, and recheck after returning from a banking app.
    const refresh = () => { if (!document.hidden) retry(); };
    document.addEventListener('visibilitychange', refresh);
    const timer = payment?.expiresAt ? window.setTimeout(retry, Math.max(0, Date.parse(payment.expiresAt) - Date.now())) : undefined;
    return () => { document.removeEventListener('visibilitychange', refresh); if (timer !== undefined) clearTimeout(timer); };
  }, [payment?.expiresAt, retry]);
  return <main className="order-payment-page"><section className="order-payment-card" aria-busy={loading}>
    <span>VendeWeb · Pagamento</span><h1>Pagamento Pix</h1>
    {loading ? <p role="status">Conferindo pagamento…</p> : error ? <><p role="alert">{error}</p><button type="button" className="primary-button" onClick={retry}>Tentar novamente</button></> : payment && <>
      <h2>{payment.storeName}</h2><p>Pedido #{formatOrderNumber(payment.orderNumber)}</p>
      {payment.status === 'pending' ? <>
        <strong className="order-payment-total">{currency.format(payment.total!)}</strong>
        <nav className="order-payment-steps" aria-label="Etapas do pagamento PIX">{step==='receipt'?<button type="button" onClick={()=>setStep('payment')}>1. Pagar com PIX</button>:<span aria-current="step">1. Pagar com PIX</span>}<span aria-current={step==='receipt'?'step':undefined}>2. Enviar comprovante</span></nav>
        {step==='payment'?<>
          <p>Recebedor: <strong>{payment.receiver || payment.storeName}</strong>. Confira os dados no banco antes de pagar.</p>
          <PixCopyButton key={payment.pixPayload} value={payment.pixPayload!} compact/>
          {qr&&<details className="order-payment-qr"><summary>Prefiro pagar com QR Code</summary><img src={qr} alt={`QR Code Pix no valor de ${currency.format(payment.total!)}`} width="260" height="260"/></details>}
          <small>Link válido até {new Date(payment.expiresAt!).toLocaleString('pt-BR')}.</small>
          <button type="button" className="primary-button" onClick={()=>setStep('receipt')}>Já fiz o PIX · enviar comprovante</button>
        </>:<>
          <button type="button" className="secondary-button" onClick={retry}>Verificar status do pagamento</button>
        </>}
        <small role="status">Aguardando confirmação da loja. Enviar o comprovante não verifica o recebimento bancário.</small>
      </> : <p role="status">{payment.status === 'paid' ? payment.paymentReportedByCustomer?`Pago informado pelo cliente${payment.fulfillmentStatus==='picked_up'?' · retirada registrada':''}. A loja pode conferir o recebimento.`:'Pagamento confirmado pela loja. Não pague novamente.' : 'Pedido cancelado. Não efetue o pagamento.'}</p>}
      {payment.status!=='cancelled'&&(step==='receipt'||(payment.status==='paid'&&payment.receiptDestinations))&&<ReceiptDestination receiptToken={payment.receiptToken} onReported={(autoPickedUp)=>setPayment(current=>current?{...current,status:'paid',paymentReportedByCustomer:true,fulfillmentStatus:autoPickedUp?'picked_up':current.fulfillmentStatus}:current)} destinations={payment.receiptDestinations??{mode:'unavailable',contacts:[]}} message={`Olá! Vou anexar o comprovante do pedido #${formatOrderNumber(payment.orderNumber)} da ${payment.storeName}, no valor de ${currency.format(payment.total!)}.`}/>}
    </>}
  </section></main>;
}
