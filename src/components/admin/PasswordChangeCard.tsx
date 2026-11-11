import { CheckCircle2, Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { updateAuthenticatedPassword } from '../../lib/supabaseRest';
import { temporaryPasswordValidationMessage } from '../../utils/email';
import { TurnstileWidget } from '../ui/TurnstileWidget';
import { appConfig } from '../../lib/config';

export function PasswordChangeCard() {
  const { mode } = useAuth();
  const { showToast } = useToast();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [captchaToken, setCaptchaToken] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);
  const matches = Boolean(newPassword && confirmPassword && newPassword === confirmPassword);

  const submit = async () => {
    if (saving) return;
    if (!appConfig.turnstileSiteKey || !captchaToken) { showToast('Conclua a verificação de segurança antes de continuar.', 'error'); return; }
    if (mode === 'demo') {
      showToast('A alteração real de senha fica disponível com Supabase Auth ativo.', 'error');
      return;
    }
    const passwordError = temporaryPasswordValidationMessage(newPassword);
    if (passwordError) { showToast(passwordError, 'error'); return; }
    if (newPassword !== confirmPassword) { showToast('A confirmação da nova senha não confere.', 'error'); return; }
    if (currentPassword === newPassword) { showToast('A nova senha deve ser diferente da senha atual.', 'error'); return; }
    setSaving(true);
    try {
      await updateAuthenticatedPassword(currentPassword, newPassword, captchaToken);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      showToast('Senha alterada com sucesso.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Não foi possível alterar a senha.', 'error');
    } finally { setCaptchaToken(''); setCaptchaReset(value=>value+1); setSaving(false); }
  };

  return <section className="admin-card password-change-card">
    <div className="password-change-heading"><div className="password-change-icon"><ShieldCheck size={23}/></div><div><span className="eyebrow">SEGURANÇA DA CONTA</span><h2>Alterar minha senha</h2><p>Confirme sua senha atual antes de definir a nova credencial.</p></div></div>
    <div className="password-change-grid">
      <label>Senha atual<div className="input-with-icon"><KeyRound size={17}/><input value={currentPassword} onChange={(e)=>setCurrentPassword(e.target.value)} type={show?'text':'password'} autoComplete="current-password" placeholder="Sua senha atual"/></div></label>
      <label>Nova senha<div className="input-with-icon"><KeyRound size={17}/><input minLength={10} value={newPassword} onChange={(e)=>setNewPassword(e.target.value)} type={show?'text':'password'} autoComplete="new-password" placeholder="Mínimo de 10 caracteres"/></div></label>
      <label>Confirmar nova senha<div className={`input-with-icon ${matches?'is-valid':''}`}><KeyRound size={17}/><input minLength={10} value={confirmPassword} onChange={(e)=>setConfirmPassword(e.target.value)} type={show?'text':'password'} autoComplete="new-password" placeholder="Repita a nova senha"/>{matches&&<CheckCircle2 size={17} className="password-match-icon"/>}</div></label>
    </div>
    {appConfig.turnstileSiteKey ? <TurnstileWidget siteKey={appConfig.turnstileSiteKey} action="login" onToken={setCaptchaToken} resetSignal={captchaReset}/> : <p role="alert">A verificação de segurança está indisponível. Contate a administração da plataforma.</p>}
    <div className="password-change-footer"><button type="button" className="password-visibility-button" onClick={()=>setShow((value)=>!value)}>{show?<EyeOff size={17}/>:<Eye size={17}/>} {show?'Ocultar senhas':'Mostrar senhas'}</button><span>Evite reutilizar senhas de e-mail, banco ou redes sociais.</span><button type="button" className="primary-button" disabled={saving||!captchaToken||!currentPassword||!newPassword||!confirmPassword} onClick={()=>void submit()}>{saving?'Alterando...':'Atualizar senha'}</button></div>
  </section>;
}
