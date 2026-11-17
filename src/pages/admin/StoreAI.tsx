import { useState, type FormEvent } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getSupabaseClient } from '../../lib/supabase';

export default function StoreAI() {
  const { membership } = useAuth();
  const [prompt,setPrompt]=useState('');
  const [answer,setAnswer]=useState('');
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const canUse=membership?.role==='owner'||membership?.role==='admin';
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if(!membership?.storeId||busy) return;
    if(/[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\d\s().-]{8,}\d)/i.test(prompt)) {setAnswer('');setError('Remova e-mails, telefones e outros dados pessoais da mensagem.');return;}
    setBusy(true); setAnswer(''); setError('');
    try {
      const {data,error:invokeError}=await getSupabaseClient().functions.invoke('food-store-ai',{body:{store_id:membership.storeId,prompt:prompt.trim()}});
      if(invokeError||typeof data?.text!=='string') {setError('IA indisponível no momento. Verifique sua mensagem e tente novamente mais tarde.');return;}
      setAnswer(data.text);
    } catch { setError('IA indisponível no momento. Tente novamente mais tarde.'); }
    finally { setBusy(false); }
  }
  if(!canUse) return <div className="access-denied"><h1>Central de IA</h1><p>Disponível para administradores da loja.</p></div>;
  return <div className="business-page"><h1>Central de IA</h1><section className="business-card"><p>Peça ideias para seu negócio e revise as sugestões antes de usá-las. A IA não altera dados nem envia mensagens.</p><p>Seu texto será enviado ao Google Gemini para gerar a resposta. Não inclua dados pessoais, de saúde, senhas ou informações confidenciais.</p><form className="business-form-grid" onSubmit={event=>void submit(event)}><label>Como posso ajudar?<textarea value={prompt} onChange={event=>setPrompt(event.target.value)} minLength={3} maxLength={700} required placeholder="Por exemplo: ideias para apresentar meus produtos" /></label><button className="primary-button" type="submit" disabled={busy}>{busy?'Preparando resposta…':'Enviar para a IA'}</button></form>{error&&<p role="alert">{error}</p>}{answer&&<div role="status"><h2>Sugestão para revisão</h2><p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{answer}</p></div>}</section></div>;
}

