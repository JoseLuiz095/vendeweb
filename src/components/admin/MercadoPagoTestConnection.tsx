import { useEffect, useRef, useState } from 'react';
import { completeMercadoPagoTest, disconnectMercadoPagoTest, mercadoPagoTestStatus, startMercadoPagoTest, type MercadoPagoCallback } from '../../services/mercadoPagoTestApi';

export function MercadoPagoTestConnection({ storeId, canManage, callback }: { storeId: string; canManage: boolean; callback: MercadoPagoCallback | null }) {
  const [status, setStatus] = useState<'loading' | 'connected' | 'disconnected' | 'unavailable'>('loading');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const scope = useRef(storeId);
  scope.current = storeId;
  const completion = useRef<{ storeId: string; promise: Promise<void> } | null>(null);
  useEffect(() => { scope.current = storeId; return () => { scope.current = ''; }; }, [storeId]);

  useEffect(() => {
    let active = true;
    setStatus('loading'); setMessage('');
    if (!canManage || !storeId) { setStatus('unavailable'); return () => { active = false; }; }
    void (async () => {
      try {
        if (callback) {
          if ('error' in callback) throw new Error('Autorização não concluída. Inicie a conexão novamente.');
          if (!completion.current) completion.current = { storeId, promise: completeMercadoPagoTest(storeId, callback) };
          if (completion.current.storeId !== storeId) throw new Error('A loja selecionada mudou.');
          await completion.current.promise;
          if (active) setMessage('Conta de teste conectada. Isso ainda não habilita pagamentos reais.');
        }
        const result = await mercadoPagoTestStatus(storeId);
        if (active) setStatus(result.connected ? 'connected' : 'disconnected');
      } catch {
        if (active) { setStatus('unavailable'); setMessage('Não foi possível confirmar a conexão de teste. Tente novamente.'); }
      }
    })();
    return () => { active = false; };
  }, [storeId, canManage, callback]);

  const act = async (action: 'connect' | 'disconnect' | 'retry') => {
    if (busy) return;
    if (action === 'disconnect' && !window.confirm('Desconectar esta conta de teste?')) return;
    const requestedStore = storeId;
    setBusy(true); setMessage('');
    try {
      if (action === 'connect') {
        const url = await startMercadoPagoTest(requestedStore);
        if (scope.current === requestedStore) window.location.assign(url);
        return;
      }
      if (action === 'disconnect') await disconnectMercadoPagoTest(requestedStore);
      const result = await mercadoPagoTestStatus(requestedStore);
      if (scope.current === requestedStore) { setStatus(result.connected ? 'connected' : 'disconnected'); if (action === 'disconnect') setMessage('Conta de teste desconectada.'); }
    } catch { if (scope.current === requestedStore) { setStatus('unavailable'); setMessage('Conexão de teste indisponível. Tente novamente.'); } }
    finally { if (scope.current === requestedStore) setBusy(false); }
  };

  return <div className="admin-info-box" style={{ display: 'grid', gap: 8, marginTop: 14 }}>
    <strong>Mercado Pago · ambiente de teste</strong>
    <span>Conecte uma conta de teste da própria loja. Esta etapa não cria cobranças nem ativa pagamentos reais.</span>
    {!canManage ? <small>Somente proprietário ou administrador pode gerenciar a conexão.</small> : <>
      <span role="status">{status === 'loading' ? 'Consultando conexão…' : status === 'connected' ? 'Conta de teste conectada' : status === 'disconnected' ? 'Conta de teste não conectada' : 'Não foi possível verificar a conexão'}</span>
      {message && <small role="status">{message}</small>}
      {status !== 'loading' && <div>{status === 'connected' ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void act('disconnect')}>Desconectar conta de teste</button> : status === 'disconnected' ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void act('connect')}>Conectar conta de teste</button> : <button type="button" className="secondary-button" disabled={busy} onClick={() => void act('retry')}>Tentar novamente</button>}</div>}
    </>}
  </div>;
}
