import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { Conversation } from '../../services/orderConversationApi';
import './order-conversation.css';

type Props = { load: () => Promise<Conversation>; send: (message: string, requestId: string) => Promise<Conversation>; refreshKey: string };
export function ConversationThread({load,send,refreshKey}:Props){
  const [thread,setThread]=useState<Conversation|null>(null);
  const [text,setText]=useState(''); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  const pending=useRef<{text:string;id:string}|null>(null);
  const revision=useRef(0);
  const refresh=useCallback(async()=>{const request=++revision.current;try{const next=await load();if(request===revision.current){setThread(next);setError('');}}catch{if(request===revision.current)setError('Não foi possível atualizar a conversa. Tente novamente.');}},[load]);
  useEffect(()=>{setThread(null);setText('');setBusy(false);pending.current=null;void refresh();return()=>{revision.current++;};},[refresh,refreshKey]);
  const submit=async(event:FormEvent)=>{
    event.preventDefault();const message=text.trim();if(!message||busy)return;
    if(!pending.current||pending.current.text!==message)pending.current={text:message,id:crypto.randomUUID()};
    const request=++revision.current;setBusy(true);setError('');
    try{const next=await send(message,pending.current.id);if(request===revision.current){setThread(next);pending.current=null;setText(current=>current.trim()===message?'':current);}}
    catch{if(request===revision.current)setError('A mensagem não foi confirmada. Tente novamente sem alterar o texto para evitar duplicação.');}
    finally{if(request===revision.current)setBusy(false);}
  };
  return <div className="order-conversation-thread">
    <div className="order-conversation-heading"><strong>Mensagens</strong><button type="button" onClick={()=>void refresh()} disabled={busy}>Atualizar</button></div>
    {error&&<p role="alert">{error}</p>}
    {!thread&&!error?<p role="status">Carregando conversa…</p>:thread?.messages.length?<ol className="order-conversation-list">{thread.messages.map(message=><li key={message.id} className={`order-conversation-message is-${message.sender}`}><strong>{message.sender==='customer'?'Cliente':message.sender==='store'?'Loja':'Sistema'}</strong><p>{message.body}</p><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('pt-BR')}</time></li>)}</ol>:thread?<p>Nenhuma mensagem ainda.</p>:null}
    <form onSubmit={submit}><label>Escreva uma mensagem<textarea value={text} maxLength={2000} rows={3} onChange={event=>setText(event.target.value)} /></label><button type="submit" className="primary-button" disabled={!thread||!text.trim()||busy}>{busy?'Enviando…':'Enviar mensagem'}</button></form>
  </div>;
}
