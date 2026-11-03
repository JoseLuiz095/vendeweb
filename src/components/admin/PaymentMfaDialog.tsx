import { KeyRound, LockKeyhole, ShieldCheck, Smartphone, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getSupabaseClient } from '../../lib/supabase';
import { useModalAccessibility } from '../useModalAccessibility';
import './payment-mfa-dialog.css';

type Props = { onClose: () => void; onVerified: () => Promise<void> };

export default function PaymentMfaDialog({ onClose, onVerified }: Props) {
  const dialogRef = useRef<HTMLElement>(null);
  const [mode, setMode] = useState<'loading' | 'setup' | 'code'>('loading');
  const [factorId, setFactorId] = useState('');
  const [qrCode, setQrCode] = useState('');
  const [secret, setSecret] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const callbacks = useRef({ onClose, onVerified });
  callbacks.current = { onClose, onVerified };
  useModalAccessibility(true, dialogRef, onClose, !busy);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const auth = getSupabaseClient().auth;
        const { data, error: levelError } = await auth.mfa.getAuthenticatorAssuranceLevel();
        if (levelError) throw levelError;
        if (data?.currentLevel === 'aal2') {
          await callbacks.current.onVerified();
          if (active) callbacks.current.onClose();
          return;
        }
        const { data: factors, error: factorsError } = await auth.mfa.listFactors();
        if (factorsError) throw factorsError;
        const verified = factors.totp.find((factor) => factor.status === 'verified');
        if (!active) return;
        if (verified) {
          setFactorId(verified.id);
          setMode('code');
        } else setMode('setup');
      } catch (cause) {
        if (active) { setMode('setup'); setError(cause instanceof Error ? cause.message : 'Não foi possível consultar o autenticador.'); }
      }
    })();
    return () => { active = false; };
  }, []);

  const startEnrollment = async () => {
    setBusy(true); setError('');
    try {
      const { data, error: enrollError } = await getSupabaseClient().auth.mfa.enroll({ factorType: 'totp', friendlyName: 'VendeWeb · confirmação de pagamentos' });
      if (enrollError) throw enrollError;
      setFactorId(data.id); setQrCode(data.totp.qr_code); setSecret(data.totp.secret); setMode('code');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível configurar o autenticador.');
    } finally { setBusy(false); }
  };

  const verify = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || !factorId || code.length !== 6) return;
    setBusy(true); setError('');
    try {
      const auth = getSupabaseClient().auth;
      const { error: verifyError } = await auth.mfa.challengeAndVerify({ factorId, code });
      if (verifyError) throw verifyError;
      let aal2 = false;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        const { data, error: levelError } = await auth.mfa.getAuthenticatorAssuranceLevel();
        if (levelError) throw levelError;
        if (data?.currentLevel === 'aal2') { aal2 = true; break; }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 150));
      }
      if (!aal2) throw new Error('O código foi validado, mas a sessão ainda não atingiu AAL2. Tente novamente.');
      await callbacks.current.onVerified();
      callbacks.current.onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Código inválido ou confirmação indisponível.');
    } finally { setBusy(false); }
  };

  return <div className="modal-overlay" onPointerDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="master-modal payment-mfa-dialog" role="dialog" aria-modal="true" aria-labelledby="payment-mfa-title">
      <button type="button" className="modal-close" onClick={onClose} disabled={busy} aria-label="Fechar"><X size={18}/></button>
      <div className="mfa-icon"><ShieldCheck size={25}/></div>
      <span className="eyebrow">CONFERÊNCIA DE PAGAMENTO · MFA</span>
      <h2 id="payment-mfa-title">Confirme o crédito Pix</h2>
      <p>Confira o crédito no extrato bancário e valide seu segundo fator. O comprovante enviado pelo cliente, sozinho, não confirma o pagamento.</p>
      {mode === 'loading' ? <p role="status">Consultando o autenticador…</p> : mode === 'setup' ? <div className="payment-mfa-setup">
        <Smartphone size={22}/><div><strong>Configure um aplicativo autenticador</strong><p>É necessário um autenticador TOTP para confirmar pagamentos Pix.</p></div>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void startEnrollment()}>{busy ? 'Configurando…' : 'Gerar QR Code'}</button>
      </div> : <>
        {qrCode && <div className="payment-mfa-qr"><img src={qrCode} alt="QR Code para configurar o autenticador"/><div><strong>Chave de configuração</strong><code>{secret}</code><small>Guarde-a somente no aplicativo autenticador.</small></div></div>}
        <form onSubmit={(event) => void verify(event)} className="payment-mfa-form">
          <label>Código de 6 dígitos<div className="input-with-icon"><KeyRound size={18}/><input required inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000"/></div></label>
          {error && <div className="form-error" role="alert">{error}</div>}
          <button type="submit" className="primary-button" disabled={busy || code.length !== 6}><LockKeyhole size={16}/>{busy ? 'Validando…' : 'Validar e confirmar crédito'}</button>
        </form>
      </>}
      {mode === 'setup' && error && <div className="form-error" role="alert">{error}</div>}
      <div className="master-modal-actions"><button type="button" className="secondary-button" onClick={onClose} disabled={busy}>Cancelar</button></div>
    </section>
  </div>;
}
