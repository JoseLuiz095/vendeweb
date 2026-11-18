import { StrictMode, Suspense, lazy, useEffect, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App, { CanonicalPlatformBoundary } from './App';
import { AuthProvider } from './contexts/AuthContext';
import { CartProvider } from './contexts/CartContext';
import { StoreProvider } from './contexts/StoreContext';
import { ToastProvider } from './contexts/ToastContext';
import { installGlobalInteractionTelemetry } from './services/interactionTelemetry';
import { startInstallCapture } from './services/pwaInstall';
import './styles.css';
import './segments/doce-lua-accessibility.css';
import './layouts/mobile-workspace.css';
import './storefront-refresh.css';
import './storefront-reference.css';

const OrderPayment = lazy(() => import('./pages/store/OrderPayment'));
const isPaymentPage = /^\/pagamento\/pix\/?$/.test(window.location.pathname);
if (!isPaymentPage) installGlobalInteractionTelemetry();
startInstallCapture();

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js?v=20261022-pwa2', { scope: '/', updateViaCache: 'none' }).catch(() => {
      // O app continua funcionando normalmente mesmo sem o modo instalável.
    });
  });
}

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root não encontrado.');

function OpeningReady({ children }: { children: ReactNode }) {
  useEffect(() => {
    const splash = document.getElementById('foodweb-splash-screen');
    if (!splash) return;
    splash.classList.add('is-ready');
    const timer = window.setTimeout(() => splash.remove(), window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
    return () => window.clearTimeout(timer);
  }, []);
  return children;
}

createRoot(root).render(
  <StrictMode>
    <OpeningReady><BrowserRouter>
      {isPaymentPage ? <Suspense fallback={<main role="status">Conferindo pagamento…</main>}><OrderPayment/></Suspense> : <CanonicalPlatformBoundary>
        <ToastProvider>
          <AuthProvider>
            <StoreProvider>
              <CartProvider>
                <App />
              </CartProvider>
            </StoreProvider>
          </AuthProvider>
        </ToastProvider>
      </CanonicalPlatformBoundary>}
    </BrowserRouter></OpeningReady>
  </StrictMode>,
);


