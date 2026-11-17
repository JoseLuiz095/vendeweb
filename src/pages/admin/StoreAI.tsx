import { ArrowUp, FileText, MessageSquarePlus, Paperclip, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { getSupabaseClient } from '../../lib/supabase';
import './store-ai.css';

type Message={role:'user'|'assistant';text:string;fileName?:string};
const formats=['image/jpeg','image/png','image/webp','application/pdf'];
const suggestions=['Crie ideias para divulgar meus produtos','Ajude a escrever uma mensagem para clientes','Sugira ações para organizar meu negócio'];

export default function StoreAI() {
  const {membership}=useAuth();
  const [prompt,setPrompt]=useState('');
  const [messages,setMessages]=useState<Message[]>([]);
  const [attachment,setAttachment]=useState<File|null>(null);
  const [preview,setPreview]=useState('');
  const [approved,setApproved]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const fileInput=useRef<HTMLInputElement>(null);
  const end=useRef<HTMLDivElement>(null);
  useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[messages,busy]);
  useEffect(()=>{if(!attachment||!attachment.type.startsWith('image/')){setPreview('');return;}const url=URL.createObjectURL(attachment);setPreview(url);return()=>URL.revokeObjectURL(url);},[attachment]);
  const canUse=membership?.role==='owner'||membership?.role==='admin';

  function chooseFile(file?:File) {
    setError('');setApproved(false);
    if(!file)return;
    if(!formats.includes(file.type)||file.size>3_000_000||!file.size){setAttachment(null);setError('Use uma imagem JPG, PNG, WEBP ou um PDF de até 3 MB.');return;}
    setAttachment(file);
  }
  function clearFile(){setAttachment(null);setApproved(false);if(fileInput.current)fileInput.current.value='';}
  function reset(){setMessages([]);setPrompt('');setError('');clearFile();}
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text=prompt.trim();
    if(!membership?.storeId||busy||text.length<3)return;
    if(/[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\d\s().-]{8,}\d)/i.test(text)){setError('Remova e-mails, telefones e outros dados pessoais da mensagem.');return;}
    if(attachment&&!approved){setError('Confirme que você pode enviar o arquivo antes de continuar.');return;}
    setBusy(true);setError('');
    try {
      const file=attachment?await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>typeof reader.result==='string'?resolve(reader.result.split(',')[1]):reject(new Error('Arquivo inválido'));reader.onerror=()=>reject(new Error('Falha ao ler arquivo'));reader.readAsDataURL(attachment);}):null;
      const history=messages.slice(-6).map(message=>({role:message.role,text:message.text.slice(0,1200)}));
      const {data,error:invokeError}=await getSupabaseClient().functions.invoke('food-store-ai',{body:{store_id:membership.storeId,prompt:text,history,...(attachment&&file?{attachment:{mime:attachment.type,data:file,approved:true}}:{})}});
      if(invokeError||typeof data?.text!=='string')throw new Error('indisponível');
      setMessages(current=>[...current,{role:'user',text,fileName:attachment?.name},{role:'assistant',text:data.text}]);
      setPrompt('');clearFile();
    } catch {setError('Não foi possível obter uma resposta. Confira sua mensagem e tente novamente.');}
    finally {setBusy(false);}
  }
  function onKeyDown(event:KeyboardEvent<HTMLTextAreaElement>){if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit();}}
  if(!canUse)return <div className="access-denied"><h1>Central de IA</h1><p>Disponível para administradores da loja.</p></div>;
  return <div className="store-ai">
    <header className="store-ai__header"><div className="store-ai__brand"><span className="store-ai__brand-icon"><Sparkles size={19}/></span><div><h1>Central de IA</h1><p>Seu assistente para o dia a dia</p></div></div><button type="button" className="store-ai__new" disabled={busy} onClick={reset}><MessageSquarePlus size={17}/><span>Nova conversa</span></button></header>
    <div className="store-ai__body"><section className={`store-ai__conversation ${messages.length?'has-messages':''}`} aria-label="Conversa">
      {!messages.length&&<div className="store-ai__welcome"><span className="store-ai__welcome-icon"><Sparkles size={27}/></span><h2>Como posso ajudar seu negócio?</h2><p>Converse, organize ideias ou envie uma imagem ou PDF para analisar.</p><div className="store-ai__suggestions">{suggestions.map(suggestion=><button key={suggestion} type="button" onClick={()=>setPrompt(suggestion)}>{suggestion}<span aria-hidden="true">↗</span></button>)}</div></div>}
      {messages.map((message,index)=><article key={index} className={`store-ai__message is-${message.role}`}><span className="store-ai__avatar" aria-hidden="true">{message.role==='assistant'?<Sparkles size={16}/>: 'Você'}</span><div><strong>{message.role==='assistant'?'Central de IA':'Você'}</strong>{message.fileName&&<div className="store-ai__message-file"><FileText size={15}/>{message.fileName}</div>}<p>{message.text}</p></div></article>)}
      {busy&&<div className="store-ai__thinking" role="status"><span className="store-ai__avatar"><Sparkles size={16}/></span>Preparando resposta…</div>}<div ref={end}/>
    </section></div>
    <div className="store-ai__bottom"><form className="store-ai__composer" onSubmit={event=>void submit(event)}>
      {attachment&&<div className="store-ai__file">{preview?<img src={preview} alt="Prévia do anexo"/>:<FileText size={17}/>}<span>{attachment.name}</span><button type="button" onClick={clearFile} disabled={busy} aria-label="Remover anexo"><X size={16}/></button></div>}
      <label className="store-ai__sr-only" htmlFor="store-ai-prompt">Sua mensagem</label><textarea id="store-ai-prompt" value={prompt} onChange={event=>setPrompt(event.target.value)} onKeyDown={onKeyDown} maxLength={2000} rows={3} disabled={busy} placeholder="Pergunte algo sobre seu negócio..."/>
      <div className="store-ai__composer-actions"><div><input ref={fileInput} id="store-ai-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={event=>chooseFile(event.target.files?.[0])}/><button type="button" className="store-ai__attach" onClick={()=>fileInput.current?.click()} disabled={busy} aria-label="Anexar imagem ou PDF"><Paperclip size={19}/><span>Anexar</span></button><span className="store-ai__format">Imagem ou PDF · até 3 MB</span></div><button className="store-ai__send" type="submit" disabled={busy||prompt.trim().length<3} aria-label="Enviar mensagem"><ArrowUp size={20}/></button></div>
      {attachment&&<label className="store-ai__consent"><input type="checkbox" checked={approved} disabled={busy} onChange={event=>setApproved(event.target.checked)}/><span>Tenho autorização para enviar este arquivo ao Google e confirmei que ele não contém dados pessoais, de saúde ou sigilosos.</span></label>}
    </form>{error&&<p className="store-ai__error" role="alert">{error}</p>}<p className="store-ai__notice">As mensagens e anexos são enviados ao Google Gemini. Não inclua dados pessoais, de saúde, senhas ou informações confidenciais. A conversa não é salva ao sair; anexos são enviados apenas na mensagem atual. Revise as respostas antes de usá-las.</p></div>
  </div>;
}

