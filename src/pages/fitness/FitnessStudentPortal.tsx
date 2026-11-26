import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { TurnstileWidget } from '../../components/ui/TurnstileWidget';
import { appConfig } from '../../lib/config';
import { fitnessStudentAuthMethods, fitnessStudentMfaFactor, type FitnessStudentAuthMethods } from '../../services/fitnessStudentSignIn';
import { getFitnessStudentAuthClient } from '../../lib/fitnessStudentAuth';
import { isFitnessStoreId } from '../../services/fitnessAccessApi';
import { fitnessApi, type FitnessStudentAccess } from '../../services/fitnessApi';
import { FitnessStudentWorkouts } from '../../platform/FitnessWorkouts';
import { FitnessOfferCheckout } from '../../platform/FitnessOfferCheckout';
import { FitnessStudentAgenda } from '../../platform/FitnessStudentAgenda';
import '../../platform/fitness.css';
import { FitnessStudentPreferences } from '../../platform/FitnessStudentPreferences';
import { FitnessNutrition } from '../../platform/FitnessNutrition';

const messageOf = (error: unknown) => error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.';

const toE164 = (raw: string): string | null => {
  const digits = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? '+' + digits : null;
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) return '+' + digits;
  if (digits.length === 10 || digits.length === 11) return '+55' + digits;
  return null;
};

type StudentIdentity = { client_id: string; name: string };

export default function FitnessStudentPortal() {
  const { storeId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const validStore = isFitnessStoreId(storeId);
  const auth = useMemo(() => {
    try { return getFitnessStudentAuthClient(); } catch { return null; }
  }, []);
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginMethod, setLoginMethod] = useState<'email'|'phone'>('email');
  const [methods, setMethods] = useState<FitnessStudentAuthMethods|null>(null);
  const [methodsError, setMethodsError] = useState('');
  const [methodsRetry, setMethodsRetry] = useState(0);
  const [mfaFactor, setMfaFactor] = useState<string|null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [captcha, setCaptcha] = useState('');
  const [captchaReset, setCaptchaReset] = useState(0);
  const [resendAt, setResendAt] = useState(0);
  const [clock, setClock] = useState(Date.now());
  const [profileRequired, setProfileRequired] = useState(false);
  const [student, setStudent] = useState<StudentIdentity | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [blockedReason, setBlockedReason] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [contentRevision,setContentRevision]=useState(0);

  useEffect(() => {
    if (!auth) { setInitializing(false); setError('O acesso ao Supabase não está configurado neste ambiente.'); return; }
    let alive = true;
    const { data } = auth.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setAuthorized(false);
        setStudent(null);
        setProfileRequired(false);
      }
    });
    void auth.auth.getSession().then(({ data: current, error: sessionError }) => {
      if (!alive) return;
      if (sessionError) setError(messageOf(sessionError));
      setSession(current.session);
    }).catch((cause: unknown) => {
      if (alive) setError(messageOf(cause));
    }).finally(() => {
      if (alive) setInitializing(false);
    });
    return () => { alive = false; data.subscription.unsubscribe(); };
  }, [auth]);

  useEffect(()=>{
    let alive=true;
    setMethodsError('');
    void fitnessStudentAuthMethods().then(value=>{if(alive){setMethods(value);if(!value.email&&value.phone)setLoginMethod('phone');}})
      .catch(cause=>{if(alive)setMethodsError(messageOf(cause));});
    return()=>{alive=false;};
  },[methodsRetry]);

  const currentToken = useCallback(async (): Promise<string> => {
    if (!auth) throw new Error('Supabase não configurado.');
    const { data, error: sessionError } = await auth.auth.getSession();
    if (sessionError) throw sessionError;
    if (!data.session?.access_token) throw new Error('Sua sessão expirou. Entre novamente na área do aluno.');
    return data.session.access_token;
  }, [auth]);

  const applyClaim = useCallback(async (identity: StudentIdentity, token: string) => {
    const result = await fitnessApi.studentSession(storeId, identity.client_id, 'claim', token);
    setStudent(identity);
    setProfileRequired(false);
    setAuthorized(result.authorized);
    setBlockedReason(result.authorized ? '' : result.reason || 'SESSION_REVOKED');
    if (result.authorized) setNotice('Entrada autorizada para esta loja e esta sessão Fitness.');
  }, [storeId]);

  useEffect(() => {
    if (!session || !validStore || !auth) return;
    let alive = true;
    setBusy(true);
    setError('');
    setNotice('');
    setAuthorized(false);
    setStudent(null);setProfileRequired(false);
    setBlockedReason('');
    void (async () => {
      try {
        const token = await currentToken();
        const factor=await fitnessStudentMfaFactor(auth,token);
        if(!alive)return;
        setMfaFactor(factor);
        if(factor){setProfileRequired(false);setStudent(null);return;}
        const status: FitnessStudentAccess = await fitnessApi.studentStatus(storeId, token);
        if (!alive) return;
        if (!status.registered || !status.client_id) {
          setStudent(null);
          setProfileRequired(true);
          return;
        }
        await applyClaim({ client_id: status.client_id, name: status.name || 'Aluno' }, token);
      } catch (cause) {
        if (alive) setError(messageOf(cause));
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [session?.access_token, storeId, validStore, auth, currentToken, applyClaim]);

  useEffect(() => {
    if (!session || !student || !authorized || !auth) return;
    let alive = true;
    const check = async () => {
      try {
        const token = await currentToken();
        const result = await fitnessApi.studentSession(storeId, student.client_id, 'check', token);
        if (alive && !result.authorized) {
          setAuthorized(false);
          setBlockedReason(result.reason || 'SESSION_REVOKED');
          setNotice('O acesso Fitness foi encerrado. Entre novamente após a liberação do Admin.');
        }
      } catch (cause) {
        if (alive) setError(messageOf(cause));
      }
    };
    const timer = window.setInterval(() => { void check(); }, 30_000);
    const onFocus = () => { void check(); };
    window.addEventListener('focus', onFocus);
    return () => { alive = false; window.clearInterval(timer); window.removeEventListener('focus', onFocus); };
  }, [session?.access_token, student?.client_id, authorized, storeId, auth, currentToken]);

  useEffect(() => {
    if (!codeSent || resendAt <= clock) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [codeSent, resendAt, clock]);

  const signInEmail = async (event:FormEvent) => {
    event.preventDefault();
    if(!auth||busy||!methods?.email)return;
    if(!captcha){setError('Conclua a verificação anti-robô para entrar.');return;}
    setBusy(true);setError('');setNotice('');
    try {
      const {data,error:signInError}=await auth.auth.signInWithPassword({email:email.trim(),password,options:{captchaToken:captcha}});
      if(signInError||!data.session)throw new Error('Não foi possível entrar. Confira o e-mail, a senha e a confirmação da conta. Se precisar, solicite ajuda ao responsável pela loja.');
      setSession(data.session);
    }catch(cause){setError(messageOf(cause));}
    finally{setPassword('');setCaptcha('');setCaptchaReset(value=>value+1);setBusy(false);}
  };

  const verifyMfa = async(event:FormEvent) => {
    event.preventDefault();
    if(!auth||!mfaFactor||busy)return;
    setBusy(true);setError('');
    try {
      const {error:verifyError}=await auth.auth.mfa.challengeAndVerify({factorId:mfaFactor,code:mfaCode});
      if(verifyError)throw new Error('Código do autenticador inválido ou expirado.');
      const {data,error:sessionError}=await auth.auth.getSession();
      if(sessionError||!data.session)throw new Error('Não foi possível atualizar a sessão. Entre novamente.');
      setSession(data.session);setMfaCode('');
    }catch(cause){setError(messageOf(cause));}
    finally{setBusy(false);}
  };

  const sendCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth || busy || !methods?.phone) return;
    const e164 = toE164(phone);
    if (!e164) { setError('Informe um telefone válido com DDD.'); return; }
    if (!captcha) { setError('Conclua a verificação anti-robô para receber o código.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const { error: otpError } = await auth.auth.signInWithOtp({
        phone: e164,
        options: { shouldCreateUser: true, captchaToken: captcha },
      });
      if (otpError) throw otpError;
      setPhone(e164); setCodeSent(true); setCode(''); setResendAt(Date.now() + 60_000);
      setCaptcha(''); setCaptchaReset(value => value + 1);
      setNotice('Código enviado. Confira as mensagens do telefone informado.');
    } catch (cause) { setError(messageOf(cause)); setCaptcha(''); setCaptchaReset(value => value + 1); }
    finally { setBusy(false); }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    if (!auth || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { data, error: verifyError } = await auth.auth.verifyOtp({ phone: toE164(phone) || phone, token: code, type: 'sms' });
      if (verifyError) throw verifyError;
      if (!data.session) throw new Error('O código não abriu uma sessão. Solicite outro código e tente novamente.');
      setSession(data.session);
      setCodeSent(false); setCode('');
      setNotice('Telefone confirmado.');
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  const createStudent = async (event: FormEvent) => {
    event.preventDefault();
    if (!session || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const token = await currentToken();
      const created = await fitnessApi.registerFitnessStudent(storeId, name.trim(), token);
      await applyClaim({ client_id: created.client_id, name: name.trim() }, token);
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  const signOutLocal = async (release: boolean) => {
    if (!auth || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (release && student && session) {
        try {
          const token = await currentToken();
          await fitnessApi.studentSession(storeId, student.client_id, 'release', token);
        } catch (cause) {
          setNotice('A saída local foi concluída. Se a troca ficar bloqueada, peça ao Admin para liberar a sessão.');
          setError(messageOf(cause));
        }
      }
      const { error: signOutError } = await auth.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
      setSession(null); setStudent(null); setAuthorized(false); setProfileRequired(false);
      setBlockedReason(''); setCodeSent(false); setCode(''); setName('');setMfaFactor(null);setMfaCode('');setPassword('');
    } catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  const refreshAuthorization = async () => {
    if (!session || !student || busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await applyClaim(student, await currentToken()); }
    catch (cause) { setError(messageOf(cause)); }
    finally { setBusy(false); }
  };

  const identityPhone = session?.user.phone_confirmed_at ? session.user.phone || '' : '';
  const identityEmail = session?.user.email_confirmed_at ? session.user.email || '' : '';
  const secondsToResend = Math.max(0, Math.ceil((resendAt - clock) / 1000));

  return <div className="auth-recovery-page fitness-portal-page">
    <div className="auth-recovery-brand"><img className="platform-brand-icon" src="/assets/vendeweb-mark.svg" alt=""/><strong>VendeWeb Fitness</strong></div>
    <main className="auth-recovery-card">
      <span className="eyebrow">ÁREA DO ALUNO</span>
      <h1>Meu espaço Fitness</h1>
      <p>Entre com sua conta para acessar esta loja. Cada loja possui suas próprias permissões.</p>
      {!validStore ? <div className="form-error" role="alert">O link da loja é inválido. Peça ao profissional o endereço correto.</div>
        : initializing ? <p role="status">Verificando a sessão Fitness…</p>
        : !auth ? <div className="form-error" role="alert">O acesso ao Supabase não está configurado neste ambiente.</div>
        : !session ? <>
          {methodsError?<div role="alert" className="form-error"><p>{methodsError}</p><button type="button" className="secondary-button" onClick={()=>setMethodsRetry(value=>value+1)}>Tentar novamente</button></div>:!methods?<p role="status">Consultando formas de entrada…</p>:<>
          {methods.email&&methods.phone&&<div className="business-actions" aria-label="Forma de entrada"><button type="button" className="secondary-button" aria-pressed={loginMethod==='email'} onClick={()=>{setLoginMethod('email');setCodeSent(false);setCaptcha('');setCaptchaReset(value=>value+1);}}>E-mail e senha</button><button type="button" className="secondary-button" aria-pressed={loginMethod==='phone'} onClick={()=>{setLoginMethod('phone');setCaptcha('');setCaptchaReset(value=>value+1);}}>Telefone por SMS</button></div>}
          {loginMethod==='email'&&methods.email?<form onSubmit={signInEmail}>
            <p>Use o e-mail e a senha da sua conta já confirmada.</p>
            <label className="auth-field">E-mail<div className="input-with-icon"><input required type="email" autoComplete="username" value={email} onChange={event=>setEmail(event.target.value)}/></div></label>
            <label className="auth-field">Senha<div className="input-with-icon"><input required type="password" autoComplete="current-password" value={password} onChange={event=>setPassword(event.target.value)}/></div></label>
            <TurnstileWidget siteKey={appConfig.turnstileSiteKey} action="fitness-student-login" onToken={setCaptcha} resetSignal={captchaReset}/>
            {!appConfig.turnstileSiteKey&&<p role="status">A proteção anti-robô precisa ser configurada para entrar.</p>}
            <button className="primary-button full-button" disabled={busy||!captcha||!appConfig.turnstileSiteKey}>{busy?'Entrando…':'Entrar'}</button>
            <p>Primeiro acesso? Peça ao responsável pela loja para preparar sua conta e confirmar seus dados.</p>
            <a className="text-link" href="#fitness-account-help">Esqueci minha senha</a>
          </form>:methods.phone?(codeSent?<form onSubmit={verifyCode}>
          <p>Digite o código enviado por SMS para confirmar este telefone.</p>
          <label className="auth-field">Código de acesso<div className="input-with-icon"><input required autoComplete="one-time-code" inputMode="numeric" minLength={4} maxLength={8} value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))}/></div></label>
          <button className="primary-button full-button" disabled={busy || code.trim().length < 4}>{busy ? 'Verificando…' : 'Confirmar código'}</button>
          <div className="login-help-row" style={{ flexWrap: 'wrap', gap: 16, justifyContent: 'space-between' }}>
            <button className="text-link" type="button" disabled={busy || secondsToResend > 0} onClick={() => { setCodeSent(false); setCode(''); setCaptcha(''); }}>{secondsToResend > 0 ? 'Novo código em ' + secondsToResend + 's' : 'Enviar outro código'}</button>
            <button className="text-link" type="button" disabled={busy} onClick={() => { setCodeSent(false); setCode(''); setPhone(''); setCaptcha(''); }}>Trocar telefone</button>
          </div>
        </form> : <form onSubmit={sendCode}>
          <p>Entre com o telefone confirmado por um código. Não é necessário e-mail nem senha.</p>
          <label className="auth-field">Telefone<div className="input-with-icon"><input required type="tel" inputMode="tel" autoComplete="tel" placeholder="+55 11 99999-9999" value={phone} onChange={event => setPhone(event.target.value)}/></div></label>
          <TurnstileWidget siteKey={appConfig.turnstileSiteKey} action="fitness-student-phone" onToken={setCaptcha} resetSignal={captchaReset}/>
          {!appConfig.turnstileSiteKey && <p role="status">A proteção anti-robô ainda precisa ser configurada neste ambiente para enviar códigos.</p>}
          <button className="primary-button full-button" disabled={busy || !captcha || !appConfig.turnstileSiteKey}>{busy ? 'Enviando…' : 'Receber código por SMS'}</button>
        </form>
          ):<p role="status">Nenhuma forma de entrada está habilitada. Procure o responsável pela loja.</p>}
          </>}
        </>
        : busy ? <p role="status">Confirmando sua identidade e acesso à loja…</p>
        : mfaFactor ? <form onSubmit={verifyMfa}>
          <p>Confirme o segundo fator ativado na sua conta.</p>
          <label className="auth-field">Código do autenticador<div className="input-with-icon"><input required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={mfaCode} onChange={event=>setMfaCode(event.target.value.replace(/\D/g,'').slice(0,6))}/></div></label>
          <button className="primary-button full-button" disabled={busy||mfaCode.length!==6}>Confirmar segundo fator</button>
          <button type="button" className="text-link" disabled={busy} onClick={()=>void signOutLocal(false)}>Sair e usar outra conta</button>
        </form>
        : profileRequired ? <form onSubmit={createStudent}>
          <p>Conta confirmada. Informe o nome que o profissional reconhecerá ao atribuir seus treinos.</p>
          <label className="auth-field">Seu nome<div className="input-with-icon"><input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={event => setName(event.target.value)}/></div></label>
          <button className="primary-button full-button" disabled={busy || name.trim().length < 2}>{busy ? 'Salvando…' : 'Continuar'}</button>
        </form>
        : authorized && student ? <>
          <nav className="fitness-portal-nav" aria-label="Áreas do aluno"><a href="#fitness-portal-home">Início</a><a href="#fitness-portal-workouts">Meus treinos</a><a href="#fitness-portal-nutrition">Minha alimentação</a><a href="#fitness-portal-agenda">Agenda</a><a href="#fitness-portal-messages">Mensagens</a><a href="#fitness-portal-profile">Perfil</a></nav>
          <section id="fitness-portal-home" className="fitness-portal-intro" aria-labelledby="fitness-portal-welcome"><h2 id="fitness-portal-welcome">Olá, {student.name}</h2><p>Sua conta está autorizada nesta loja. Consulte suas compras e as próximas ações abaixo.</p></section>
          <div id="fitness-portal-purchases"><FitnessOfferCheckout store={storeId} token={session.access_token} selected={searchParams.get('oferta')}/></div>
          <div id="fitness-portal-workouts"><FitnessStudentWorkouts key={contentRevision} store={storeId} accessToken={session.access_token}/></div>
          <section id="fitness-portal-nutrition" className="business-card" aria-labelledby="fitness-portal-nutrition-title"><h2 id="fitness-portal-nutrition-title">Minha alimentação</h2><FitnessNutrition key={contentRevision} store={storeId} token={session.access_token}/></section>
          <FitnessStudentAgenda store={storeId} token={session.access_token}/>
          <section id="fitness-portal-messages" className="business-card" aria-labelledby="fitness-portal-messages-title"><h2 id="fitness-portal-messages-title">Mensagens</h2><FitnessStudentPreferences store={storeId} userId={session.user.id} token={session.access_token} onAuthorizationChange={()=>setContentRevision(value=>value+1)}/></section>
          <section id="fitness-portal-profile" className="business-card" aria-labelledby="fitness-portal-profile-title"><h2 id="fitness-portal-profile-title">Perfil e segurança</h2><p>{identityEmail?'E-mail confirmado':'Telefone confirmado'}: <strong>{identityEmail||identityPhone.replace(/\d(?=\d{4})/g, '•')}</strong></p><p>A autorização vale para esta conta, aluno e loja. Ela não identifica o aparelho de forma infalível.</p><button className="secondary-button" disabled={busy} onClick={() => void signOutLocal(true)}>Sair do Fitness</button></section>
        </> : student ? <>
          <p role="alert">{blockedReason === 'SESSION_LIMIT'
            ? 'Sua conta já está em uso em outra sessão nesta loja. Se tiver acesso ao aparelho anterior, abra Perfil e segurança e toque em Sair do Fitness. Depois volte aqui e toque em Verificar liberação. Se não tiver acesso ao aparelho, procure o responsável pela loja para confirmar sua identidade e liberar a troca.'
            : 'Esta sessão foi revogada ou expirou. Entre novamente para criar uma sessão Fitness nova.'}</p>
          {blockedReason === 'SESSION_LIMIT' && <button className="secondary-button full-button" disabled={busy} onClick={() => void refreshAuthorization()}>Verificar liberação</button>}
          <button className="secondary-button full-button" disabled={busy} onClick={() => void signOutLocal(false)}>Sair e entrar novamente</button>
        </> : error ? <button type="button" className="secondary-button full-button" onClick={()=>void signOutLocal(false)}>Sair e entrar novamente</button> : <p role="status">Aguardando validação da identidade.</p>}
      {notice && <p role="status" className="auth-security-note">{notice}</p>}
      {error && <div role="alert" className="form-error">{error}</div>}
      <section id="fitness-account-help" className="auth-security-note" aria-label="Recuperação da conta Fitness">
        <strong>Precisa recuperar sua conta?</strong>
        <p>A recuperação de senha é assistida nesta etapa. Procure o responsável pela loja para encaminhar a solicitação ao suporte da plataforma, que confirmará sua identidade. A conta pode ser usada em outras lojas e serviços; seus dados e permissões precisam ser preservados. Nunca envie sua senha ou códigos de acesso em mensagens. Se precisa apenas trocar de aparelho, saia do Fitness no aparelho anterior ou solicite a liberação da sessão.</p>
      </section>
      <Link className="back-link" to="/">Voltar ao VendeWeb</Link>
    </main>
  </div>;
}
