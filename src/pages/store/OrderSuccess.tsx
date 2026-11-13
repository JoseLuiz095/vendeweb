import ReceiptDestination from '../../components/ReceiptDestination';
import { ArrowLeft, Banknote, Bell, CheckCircle2, CreditCard, MessageCircle, QrCode, Share2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import QRCode from 'qrcode';
import PixCopyButton from '../../components/PixCopyButton';
import { MpSandboxCheckout } from '../../components/MpSandboxCheckout';
import './order-payment.css';
import { useStore } from '../../contexts/StoreContext';
import { useToast } from '../../contexts/ToastContext';
import type { OrderConfirmation } from '../../types';
import { copyText } from '../../utils/clipboard';
import { currency } from '../../utils/format';
import { sharePixQrImage } from '../../utils/pixShare';
import { formatOrderNumber, readOrderConfirmation } from '../../utils/orderConfirmation';
import { buildPostOrderWhatsAppMessage, getWhatsAppUrl } from '../../utils/whatsapp';
import { storefrontPath } from '../../utils/storefrontRoute';
import { getStorefrontThemeStyle } from '../../utils/storeVisualTheme';
import { customerOrderNotificationStatus, enableCustomerOrderNotifications, type CustomerOrderNotificationStatus } from '../../services/pwaNotifications';

export default function OrderSuccess() {
  const { orderId = '' } = useParams();
  const location = useLocation();
  const { markOrderWhatsAppClicked, settings, storeBasePath } = useStore();
  const { showToast } = useToast();
  const [sharingPix, setSharingPix] = useState(false);
  const [pixQrCode, setPixQrCode] = useState('');
  const [whatsappMarkState, setWhatsappMarkState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [customerNotificationState, setCustomerNotificationState] = useState<CustomerOrderNotificationStatus>('unsupported');
  const [customerNotificationBusy, setCustomerNotificationBusy] = useState(false);
  const [pixStep, setPixStep] = useState<'payment' | 'receipt'>('payment');
  const storefrontThemeStyle = getStorefrontThemeStyle(settings.visualTheme);

  const confirmation = useMemo(() => {
    const fromState = location.state as OrderConfirmation | null;
    if (fromState?.orderId === orderId) return fromState;
    return readOrderConfirmation(orderId);
  }, [location.state, orderId]);

  useEffect(() => {
    let cancelled = false;
    const payload = confirmation?.pixPayload || '';
    if (!payload) {
      setPixQrCode('');
      return () => { cancelled = true; };
    }
    void QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 2, width: 260 })
      .then((dataUrl) => { if (!cancelled) setPixQrCode(dataUrl); })
      .catch(() => { if (!cancelled) setPixQrCode(''); });
    return () => { cancelled = true; };
  }, [confirmation?.pixPayload]);

  useEffect(() => {
    if (!confirmation) return;
    setCustomerNotificationState(customerOrderNotificationStatus(confirmation.orderId));
    setPixStep('payment');
  }, [confirmation]);

  if (!confirmation) {
    return (
      <main data-visual-preset={settings.visualTheme.preset} className="order-success-page food-storefront-theme" style={storefrontThemeStyle}>
        <section className="order-success-card order-success-card--missing">
          <div className="success-icon"><CheckCircle2 size={50} /></div>
          <h1>Pedido não disponível nesta sessão</h1>
          <p>Por segurança, os dados de confirmação ficam somente nesta sessão do navegador.</p>
          <Link className="primary-button" to={storefrontPath(storeBasePath)}><ArrowLeft size={18} />Voltar para o cardápio</Link>
        </section>
      </main>
    );
  }

  if (confirmation.mpTestMode) return <main data-visual-preset={settings.visualTheme.preset} className="order-success-page food-storefront-theme" style={storefrontThemeStyle}><MpSandboxCheckout storeId={confirmation.storeId || ''} orderId={confirmation.orderId} capability={confirmation.mpTestCapability}/></main>;

  const isPix = confirmation.paymentMethod === 'pix' && confirmation.pixEnabled;
  const isPixCopyPaste = isPix && (Boolean(confirmation.pixPayload?.trim()) || (confirmation.pixReceiptMode === 'copy_paste' && Boolean(confirmation.pixCopyPaste.trim())));
  const isPixKey = isPix && confirmation.pixReceiptMode === 'key' && Boolean(confirmation.pixKey.trim());
  const hasPixPayload = isPix && Boolean(confirmation.pixPayload?.trim());
  const isCard = confirmation.paymentMethod === 'card';
  const isCash = confirmation.paymentMethod === 'cash';
  const hasWhatsApp = Boolean(confirmation.storeWhatsapp?.trim()) && (isPix || settings.showWhatsApp !== false);
  const whatsappMessage = buildPostOrderWhatsAppMessage(confirmation);
  const whatsappUrl = hasWhatsApp ? getWhatsAppUrl(confirmation.storeWhatsapp, whatsappMessage) : '';
  const pixValue = isPixCopyPaste ? (confirmation.pixPayload || confirmation.pixCopyPaste) : confirmation.pixKey;
  const confirmationStatus = isPix ? 'Aguardando confirmação do PIX pela loja' : isCard ? 'Aguardando recebimento na entrega ou retirada' : isCash ? 'Aguardando recebimento em dinheiro' : 'Aguardando confirmação da loja';

  const handleSharePix = async () => {
    if (!pixQrCode || sharingPix) return;
    setSharingPix(true);
    const text = `PIX do pedido #${formatOrderNumber(confirmation.orderNumber)}\nValor: ${currency.format(confirmation.total)}\n\nPIX Copia e Cola:\n${pixValue}`;
    try {
      const result = await sharePixQrImage({
        dataUrl: pixQrCode,
        title: `PIX do pedido #${formatOrderNumber(confirmation.orderNumber)}`,
        text,
        fileName: `pix-pedido-${formatOrderNumber(confirmation.orderNumber)}.png`,
      });
      if (result === 'image') showToast('QR Code e instruções prontos para compartilhar.', 'success');
      else if (result === 'text') showToast('Compartilhamento de texto aberto; este aparelho não aceita imagem.', 'success');
      else {
        await copyText(text);
        showToast('PIX Copia e Cola copiado.', 'success');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      showToast('Não foi possível compartilhar o QR Code.', 'error');
    } finally {
      setSharingPix(false);
    }
  };

  const handleWhatsAppClick = () => {
    setWhatsappMarkState('sending');
    void markOrderWhatsAppClicked(confirmation.orderId)
      .then(() => setWhatsappMarkState('done'))
      .catch((error) => {
        console.error('Não foi possível atualizar o status do WhatsApp:', error);
        setWhatsappMarkState('error');
        showToast('O pedido está registrado, mas não foi possível marcar a abertura do WhatsApp. Você pode tentar o botão novamente.', 'error');
      });
  };

  const enableOrderNotifications = async () => {
    if (!confirmation) return;
    setCustomerNotificationBusy(true);
    try {
      const status = await enableCustomerOrderNotifications({
        orderId: confirmation.orderId,
        orderNumber: confirmation.orderNumber,
        url: location.pathname,
      });
      setCustomerNotificationState(status);
      if (status === 'enabled') showToast('Notificações autorizadas neste aparelho.', 'success');
      else if (status === 'blocked') showToast('As notificações estão bloqueadas nas configurações do navegador.', 'error');
      else if (status === 'unsupported') showToast('Este navegador não oferece notificações para este app.', 'error');
    } catch {
      showToast('Não foi possível ativar as notificações neste aparelho.', 'error');
    } finally {
      setCustomerNotificationBusy(false);
    }
  };

  return (
    <main data-visual-preset={settings.visualTheme.preset} className="order-success-page food-storefront-theme" style={storefrontThemeStyle}>
      <section className="order-success-card">
        {!isPix && <div className="success-icon"><CheckCircle2 size={38} strokeWidth={2.2} /></div>}

        <h1>Pedido recebido</h1>
        <p className="order-success-number">Pedido <strong>#{formatOrderNumber(confirmation.orderNumber)}</strong></p>
        {!isPix && <div className="order-success-status" role="status"><span className="order-success-status__dot" />{confirmationStatus}</div>}
        {(!isPix || pixStep === 'payment') && <div className="store-checkout-context store-checkout-context--success"><strong>{confirmation.storeName}</strong><span>{confirmation.fulfillment === 'pickup' ? confirmation.pickupPointName ? `Retirada em ${confirmation.pickupPointName}${confirmation.pickupPointAddress ? ` · ${confirmation.pickupPointAddress}` : ''}` : 'Local de retirada: confira as orientações da loja' : 'Entrega no endereço informado no pedido'}</span></div>}

        {isPix ? <p className="order-success-saved"><CheckCircle2 size={16} />Pedido salvo no sistema</p> : <div className="order-registration-proof" role="status"><CheckCircle2 size={20} /><div><strong>Pedido salvo no sistema</strong><span>{hasWhatsApp ? 'O pedido já existe e pode ser acompanhado pela loja. O WhatsApp é apenas um canal adicional de contato.' : 'O pedido já existe e será acompanhado pela loja diretamente no painel, sem depender de WhatsApp.'}</span></div></div>}

        {isPix && <nav className="order-success-steps" aria-label="Etapas do pagamento PIX">{pixStep === 'receipt' ? <button type="button" className="is-done" onClick={() => setPixStep('payment')} aria-label="Voltar para os dados do PIX">1. Pagar com PIX</button> : <span className="is-current" aria-current="step">1. Pagar com PIX</span>}<span className={pixStep === 'receipt' ? 'is-current' : ''} aria-current={pixStep === 'receipt' ? 'step' : undefined}>2. Enviar comprovante</span></nav>}

        {(!isPix || pixStep === 'payment') && <>

        <div className="order-success-payment">
          <div className="order-success-payment__title">
            {isCash ? <Banknote size={22} /> : isCard ? <CreditCard size={22} /> : isPixCopyPaste ? <QrCode size={22} /> : <CreditCard size={22} />}
            <strong>{isCash ? 'Pagamento em dinheiro' : isCard ? 'Pagamento por cartão' : isPix ? 'PIX' : 'Aguardando confirmação'}</strong>
          </div>

          {isPix ? (
            <>
              <strong className="order-success-total">Total: {currency.format(confirmation.total)}</strong>
            </>
          ) : isCard ? (
            <>
              <p>Seu pedido foi registrado para pagamento por cartão na entrega ou retirada. A cobrança será realizada pela loja no momento combinado.</p>
              <strong className="order-success-total">Total: {currency.format(confirmation.total)}</strong>
            </>
          ) : isCash ? (
            <>
              <p>Seu pedido foi registrado para pagamento em dinheiro. Se houver troco solicitado, o valor já ficou registrado no pedido.</p>
              <strong className="order-success-total">Total: {currency.format(confirmation.total)}</strong>
            </>
          ) : (
            <>
              <p>{hasWhatsApp ? 'Seu pedido foi registrado. Use o WhatsApp apenas se quiser falar diretamente com a loja.' : 'Seu pedido foi registrado. A loja acompanhará a confirmação pelo sistema.'}</p>
              <strong className="order-success-total">Total: {currency.format(confirmation.total)}</strong>
            </>
          )}
        </div>

        {(isPixCopyPaste || isPixKey) && (
          <div className="pix-confirmation-box">
            <span className="pix-key-label">{isPixCopyPaste ? 'PIX Copia e Cola · valor automático' : `Chave PIX · ${confirmation.pixKeyType || 'Chave cadastrada'}`}</span>
            <PixCopyButton key={pixValue} value={pixValue} label={isPixCopyPaste ? 'Código Pix' : 'Chave Pix'} compact/>
          {hasPixPayload && <details className="order-success-qr"><summary>Prefiro pagar com QR Code</summary><div className="pix-qr-code"><span className="pix-key-label">QR Code PIX · valor preenchido</span>{pixQrCode ? <img src={pixQrCode} alt={`QR Code PIX no valor de ${currency.format(confirmation.total)}`} /> : <small>Gerando QR Code…</small>}<small>Escaneie com o aplicativo do banco.</small>{pixQrCode && <button type="button" className="secondary-button pix-share-button" disabled={sharingPix} onClick={() => void handleSharePix()}><Share2 size={16}/>{sharingPix ? 'Preparando...' : 'Compartilhar QR Code + texto'}</button>}</div></details>}
            {confirmation.pixReceiver && <small>Recebedor: {confirmation.pixReceiver}</small>}
          </div>
        )}
        {isPix && confirmation.pixGenerationError && !hasPixPayload && !isPixKey && !isPixCopyPaste && (
          <div className="pix-generation-warning" role="alert">
            <strong>PIX com valor não gerado</strong>
            <span>{confirmation.pixGenerationError} A loja precisa revisar a chave PIX, o titular e a cidade nas configurações.</span>
          </div>
        )}

        {isCard && (
          <div className="card-link-info-box">
            <CreditCard size={24} />
            <div><strong>Pagamento na entrega ou retirada.</strong><span>O pedido já está salvo. A loja realizará a cobrança por cartão quando você receber ou retirar o pedido.</span></div>
          </div>
        )}

        {isPix && <button type="button" className="primary-button order-success-next" onClick={() => setPixStep('receipt')}>Já fiz o PIX · enviar comprovante</button>}
        </>}

        {isPix && pixStep === 'receipt' && <section className="order-success-receipt-step" aria-label="Etapa de envio do comprovante"><ReceiptDestination requireReceiptToken receiptToken={confirmation.receiptToken} key={confirmation.orderId} storeId={confirmation.storeId} pointId={confirmation.receiptPickupLocationId} legacyPhone={confirmation.storeWhatsapp} message={whatsappMessage} onOpen={handleWhatsAppClick}/><div className={`whatsapp-sync-state is-${whatsappMarkState}`} aria-live="polite">{whatsappMarkState === 'sending' && <span>Registrando a abertura do WhatsApp…</span>}{whatsappMarkState === 'done' && <span>A abertura do WhatsApp foi registrada no pedido.</span>}{whatsappMarkState === 'error' && <span>O pedido está salvo, mas não foi possível registrar a abertura da conversa.</span>}</div></section>}

        {(!isPix || pixStep === 'receipt') && customerNotificationState !== 'unsupported' && (
          <details className={`customer-order-notifications order-success-notifications is-${customerNotificationState}`}>
            <summary><Bell size={18} /><strong>{customerNotificationState === 'enabled' ? 'Notificações autorizadas' : 'Receber avisos deste pedido'}</strong></summary>
            {customerNotificationState === 'enabled' ? (
              <p>Este aparelho está pronto para receber os avisos do pedido quando a loja disponibilizar o acompanhamento por notificações.</p>
            ) : customerNotificationState === 'blocked' ? (
              <p>As notificações foram bloqueadas. Libere-as nas configurações do navegador para ativar este recurso.</p>
            ) : (
              <>
                <p>A permissão é solicitada somente agora, depois de o pedido ter sido registrado.</p>
                <button type="button" className="secondary-button" disabled={customerNotificationBusy} onClick={() => void enableOrderNotifications()}>
                  <Bell size={17} />{customerNotificationBusy ? 'Ativando...' : 'Permitir notificações'}
                </button>
                <small>O aviso automático de mudanças de status ainda depende da ativação desse acompanhamento pela loja.</small>
              </>
            )}
          </details>
        )}

        {hasWhatsApp && !isPix && <a
          className="whatsapp-confirmation-button"
          href={whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={handleWhatsAppClick}
        >
          <MessageCircle size={21} />
          Abrir WhatsApp
        </a>}
        {hasWhatsApp && !isPix && <div className={`whatsapp-sync-state is-${whatsappMarkState}`} aria-live="polite">
          {whatsappMarkState === 'sending' && <span>Registrando a abertura do WhatsApp no pedido...</span>}
          {whatsappMarkState === 'done' && <span>A abertura do WhatsApp foi vinculada ao pedido #{formatOrderNumber(confirmation.orderNumber)}.</span>}
          {whatsappMarkState === 'error' && <span>O pedido continua salvo; apenas o status do WhatsApp não foi atualizado. Toque no botão novamente quando voltar.</span>}
        </div>}

        {isCard && <p className="order-success-hint">A loja fará a cobrança por cartão na entrega ou retirada. Nunca envie número completo do cartão, CVV ou senha pelo WhatsApp.</p>}
        {isCash && <p className="order-success-hint">{confirmation.changeAmount != null ? `Troco previsto: ${currency.format(confirmation.changeAmount)}.` : 'Pagamento em dinheiro sem troco solicitado.'}</p>}

        {(!isPix || pixStep === 'receipt') && <Link className="order-success-back" to={storefrontPath(storeBasePath)}><ArrowLeft size={19} />Voltar para o cardápio</Link>}
      </section>
    </main>
  );
}
