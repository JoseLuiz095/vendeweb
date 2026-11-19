import { ArrowUp, FileText, MessageSquarePlus, Paperclip, Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { getSupabaseClient } from '../../lib/supabase';
import { loadAdminSupportContact } from '../../services/supportApi';
import './store-ai.css';

type Message={role:'user'|'assistant';text:string;fileName?:string;actions?:{label:string;href:string}[];source?:'consulta'|'orientacao'};
const formats=['image/jpeg','image/png','image/webp','application/pdf'];
const suggestions=['Quantos pedidos aguardam conferência?','Quais formas de pagamento estão habilitadas?','Quais módulos minha loja possui?'];
const allowedLinks=new Set(['/admin/pedidos?queue=payment','/admin/pedidos','/admin/configuracoes','/admin/configuracoes#settings-pedidos-fora-horario','/admin/produtos','/admin/negocio','/admin/estoque','/admin/primeiros-passos','/admin/categorias','/admin/entregas','/admin/plano']);

function safeActions(value:unknown):{label:string;href:string}[]{
  return (Array.isArray(value)?value:[]).filter((item:unknown):item is {label:string;href:string}=>!!item&&typeof item==='object'&&typeof (item as {label?:unknown}).label==='string'&&typeof (item as {href?:unknown}).href==='string'&&allowedLinks.has((item as {href:string}).href)).slice(0,6).map(item=>({label:item.label.slice(0,80),href:item.href}));
}

export default function StoreAI() {
  const {membership,user}=useAuth();
  const canUse=membership?.role==='owner'||membership?.role==='admin';
  if(!canUse||!membership?.storeId||!user?.id)return <div className="access-denied"><h1>Central de IA</h1><p>Disponível para administradores da loja.</p></div>;
  return <StoreAIConversation key={`${membership.storeId}:${user.id}`} storeId={membership.storeId}/>;
}

function StoreAIConversation({storeId}:{storeId:string}) {
  const [prompt,setPrompt]=useState('');
  const [messages,setMessages]=useState<Message[]>([]);
  const [conversationId,setConversationId]=useState<string|null>(null);
  const [conversations,setConversations]=useState<Array<{id:string;title:string}>>([]);
  const [historyError,setHistoryError]=useState('');
  const pendingTurns=useRef<Array<{p_turn:string;p_prompt:string;p_reply:string;p_source:string|null;p_actions:{label:string;href:string}[]}>>([]);
  const [historyLoading,setHistoryLoading]=useState(true);
  const [attachment,setAttachment]=useState<File|null>(null);
  const [preview,setPreview]=useState('');
  const [approved,setApproved]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [supportPhone,setSupportPhone]=useState('');
  const fileInput=useRef<HTMLInputElement>(null);
  const end=useRef<HTMLDivElement>(null);
  useEffect(()=>{end.current?.scrollIntoView({behavior:'smooth',block:'nearest'});},[messages,busy]);
  useEffect(()=>{let active=true;void loadAdminSupportContact().then(phone=>{if(active)setSupportPhone(phone);}).catch(()=>undefined);return()=>{active=false;};},[]);
  useEffect(()=>{if(!attachment||!attachment.type.startsWith('image/')){setPreview('');return;}const url=URL.createObjectURL(attachment);setPreview(url);return()=>URL.revokeObjectURL(url);},[attachment]);
  useEffect(()=>{let active=true;setHistoryLoading(true);void getSupabaseClient().from('food_ai_conversations').select('id,title').eq('store_id',storeId).order('updated_at',{ascending:false}).limit(50).then(({data,error})=>{if(!active)return;if(error)setHistoryError('Histórico indisponível. Suas novas mensagens podem não ser salvas.');else setConversations(data||[]);setHistoryLoading(false);});return()=>{active=false;};},[storeId]);

  async function openConversation(id:string){
    if(busy)return;if(pendingTurns.current.length&&!window.confirm('Há mensagens que não foram salvas. Ao trocar de conversa, elas serão perdidas. Continuar?'))return;pendingTurns.current=[];setBusy(true);setError('');
    try {const {data,error}=await getSupabaseClient().from('food_ai_messages').select('role,content,source,actions').eq('conversation_id',id).order('id',{ascending:false}).limit(500);if(error)throw error;
      setMessages((data||[]).reverse().map(row=>({role:row.role==='assistant'?'assistant':'user',text:row.content,source:row.source==='consulta'||row.source==='orientacao'?row.source:undefined,actions:safeActions(row.actions)})));setConversationId(id);clearFile();
    }catch{setError('Não foi possível abrir esta conversa. Tente novamente.');}finally{setBusy(false);}
  }

  function chooseFile(file?:File) {
    setError('');setApproved(false);
    if(!file)return;
    if(!formats.includes(file.type)||file.size>3_000_000||!file.size){setAttachment(null);setError('Use uma imagem JPG, PNG, WEBP ou um PDF de até 3 MB.');return;}
    setAttachment(file);
  }
  function clearFile(){setAttachment(null);setApproved(false);if(fileInput.current)fileInput.current.value='';}
  function reset(){if(pendingTurns.current.length&&!window.confirm('Há mensagens que não foram salvas. Ao começar outra conversa, elas serão perdidas. Continuar?'))return;pendingTurns.current=[];setHistoryError('');setConversationId(null);setMessages([]);setPrompt('');setError('');clearFile();}
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text=prompt.trim();
    if(busy||historyLoading||text.length<3)return;
    if(/[\w.+-]+@[\w.-]+\.[a-z]{2,}|(?:\+?\d[\d\s().-]{8,}\d)/i.test(text)){setError('Remova e-mails, telefones e outros dados pessoais da mensagem.');return;}
    if(attachment&&!approved){setError('Confirme que você pode enviar o arquivo antes de continuar.');return;}
    setBusy(true);setError('');
    try {
      const file=attachment?await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>typeof reader.result==='string'?resolve(reader.result.split(',')[1]):reject(new Error('Arquivo inválido'));reader.onerror=()=>reject(new Error('Falha ao ler arquivo'));reader.readAsDataURL(attachment);}):null;
      const history=messages.filter(message=>message.source!=='consulta').slice(-6).map(message=>({role:message.role,text:message.text.slice(0,1200)}));
      const {data,error:invokeError}=await getSupabaseClient().functions.invoke('food-store-ai',{body:{store_id:storeId,prompt:text,history,...(attachment&&file?{attachment:{mime:attachment.type,data:file,approved:true}}:{})}});
      if(invokeError||typeof data?.text!=='string')throw new Error('indisponível');
      const rawActions=Array.isArray(data.actions)?data.actions:data.action?[data.action]:[];
      const actions=safeActions(rawActions);
      const source=data.source==='consulta'||data.source==='orientacao'?data.source:undefined;
      setMessages(current=>[...current,{role:'user',text,fileName:attachment?.name},{role:'assistant',text:data.text,actions,source}]);
      setPrompt('');clearFile();
      const id=conversationId||crypto.randomUUID();setConversationId(id);
      pendingTurns.current.push({p_turn:crypto.randomUUID(),p_prompt:text,p_reply:data.text,p_source:source||null,p_actions:actions});
      try{while(pendingTurns.current.length){const turn=pendingTurns.current[0];const {error:saveError}=await getSupabaseClient().rpc('food_ai_append_turn',{p_store:storeId,p_conversation:id,...turn});if(saveError)break;pendingTurns.current.shift();}}catch{/* O aviso abaixo mantém as mensagens pendentes para retry. */}
      if(pendingTurns.current.length){setHistoryError('Algumas mensagens não foram salvas. Elas serão reenviadas ao continuar a conversa; se você sair agora, serão perdidas.');}
      else {setHistoryError('');setConversations(current=>[{id,title:current.find(item=>item.id===id)?.title||text.slice(0,100)},...current.filter(item=>item.id!==id)].slice(0,50));}
    } catch {setError('Não foi possível obter uma resposta. Confira sua mensagem e tente novamente.');}
    finally {setBusy(false);}
  }
  function onKeyDown(event:KeyboardEvent<HTMLTextAreaElement>){if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit();}}
  return <div className="store-ai">
    <header className="store-ai__header"><div className="store-ai__brand"><span className="store-ai__brand-icon"><Sparkles size={19}/></span><div><h1>Central de IA</h1><p>Seu assistente para o dia a dia</p></div></div><button type="button" className="store-ai__new" disabled={busy} onClick={reset}><MessageSquarePlus size={17}/><span>Nova conversa</span></button></header>
    <details className="store-ai__history"><summary>Histórico de conversas {historyLoading?'· carregando':`· ${conversations.length}`}</summary>{!historyLoading&&!conversations.length&&<p>Nenhuma conversa salva ainda.</p>}<div>{conversations.map(item=><button type="button" key={item.id} disabled={busy} aria-pressed={conversationId===item.id} onClick={()=>void openConversation(item.id)}>{item.title}</button>)}</div></details>
    {historyError&&<p className="store-ai__error" role="alert">{historyError}</p>}
    <div className="store-ai__body"><section className={`store-ai__conversation ${messages.length?'has-messages':''}`} aria-label="Conversa">
      {!messages.length&&<div className="store-ai__welcome"><span className="store-ai__welcome-icon"><Sparkles size={27}/></span><h2>Como posso ajudar seu negócio?</h2><p>Converse, organize ideias ou envie uma imagem ou PDF para analisar.</p><p className="store-ai__capabilities">Posso consultar pedidos para conferência, configurações, catálogo, módulos e alertas de estoque. Para outras dúvidas, ajudo a encontrar a tela ou o suporte.</p><div className="store-ai__suggestions">{suggestions.map(suggestion=><button key={suggestion} type="button" onClick={()=>setPrompt(suggestion)}>{suggestion}<span aria-hidden="true">↗</span></button>)}</div></div>}
      {messages.map((message,index)=><article key={index} className={`store-ai__message is-${message.role}`}><span className="store-ai__avatar" aria-hidden="true">{message.role==='assistant'?<Sparkles size={16}/>: 'Você'}</span><div><strong>{message.role==='assistant'?'Central de IA':'Você'}</strong>{message.source&&<small className="store-ai__source">{message.source==='consulta'?'Consulta ao sistema':'Orientação'}</small>}{message.fileName&&<div className="store-ai__message-file"><FileText size={15}/>{message.fileName}</div>}<p>{message.text}</p>{message.actions?.map(action=><Link key={action.href} className="store-ai__action" to={action.href}>{action.label} →</Link>)}</div></article>)}
      {busy&&<div className="store-ai__thinking" role="status"><span className="store-ai__avatar"><Sparkles size={16}/></span>Preparando resposta…</div>}<div ref={end}/>
    </section></div>
    <div className="store-ai__bottom"><form className="store-ai__composer" onSubmit={event=>void submit(event)}>
      {attachment&&<div className="store-ai__file">{preview?<img src={preview} alt="Prévia do anexo"/>:<FileText size={17}/>}<span>{attachment.name}</span><button type="button" onClick={clearFile} disabled={busy} aria-label="Remover anexo"><X size={16}/></button></div>}
      <label className="store-ai__sr-only" htmlFor="store-ai-prompt">Sua mensagem</label><textarea id="store-ai-prompt" value={prompt} onChange={event=>setPrompt(event.target.value)} onKeyDown={onKeyDown} maxLength={2000} rows={3} disabled={busy} placeholder="Pergunte algo sobre seu negócio..."/>
      <div className="store-ai__composer-actions"><div><input ref={fileInput} id="store-ai-file" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden onChange={event=>chooseFile(event.target.files?.[0])}/><button type="button" className="store-ai__attach" onClick={()=>fileInput.current?.click()} disabled={busy} aria-label="Anexar imagem ou PDF"><Paperclip size={19}/><span>Anexar</span></button><span className="store-ai__format">Imagem ou PDF · até 3 MB</span></div><button className="store-ai__send" type="submit" disabled={busy||historyLoading||prompt.trim().length<3} aria-label="Enviar mensagem"><ArrowUp size={20}/></button></div>
      {attachment&&<label className="store-ai__consent"><input type="checkbox" checked={approved} disabled={busy} onChange={event=>setApproved(event.target.checked)}/><span>Tenho autorização para enviar este arquivo ao Google e confirmei que ele não contém dados pessoais, de saúde ou sigilosos.</span></label>}
    </form>{error&&<p className="store-ai__error" role="alert">{error}</p>}<p className="store-ai__notice">As mensagens, anexos e o ramo da loja são enviados ao Google Gemini. Os dados consultados da loja são apresentados diretamente na conversa. Não inclua dados pessoais, de saúde, senhas ou informações confidenciais. O texto das conversas é salvo por loja e usuário pelo prazo definido pela plataforma, contado desde a última mensagem; anexos não são salvos e são enviados apenas na mensagem atual. Para responder, a IA recebe até seis mensagens recentes da conversa escolhida; resultados de consultas à loja não são reenviados. Revise as respostas antes de usá-las.</p>
    <aside className="store-ai__support"><div><strong>Precisa de ajuda com o sistema?</strong><p>Se a resposta não resolver, fale com o suporte para relatar um problema ou sugerir uma melhoria.</p></div>{supportPhone?<a href={`https://wa.me/${(supportPhone.length===10||supportPhone.length===11)&&!supportPhone.startsWith('55')?`55${supportPhone}`:supportPhone}?text=${encodeURIComponent('Olá! Sou lojista e preciso de suporte com a VendeWeb.')}`} target="_blank" rel="noreferrer">Entrar em contato ↗</a>:<span>Contato de suporte indisponível no momento.</span>}</aside></div>
  </div>;
}

