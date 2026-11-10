import { useCallback, useState } from 'react';
import { copyText } from '../../utils/clipboard';
import { issueConversation, staffConversation } from '../../services/orderConversationApi';
import { ConversationThread } from './ConversationThread';

export function StaffConversation({storeId,orderId}:{storeId:string;orderId:string}) {
  const [link,setLink]=useState('');const [notice,setNotice]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [issued,setIssued]=useState(false);
  const load=useCallback(()=>staffConversation(storeId,orderId),[storeId,orderId]);
  const send=useCallback((message:string,requestId:string)=>staffConversation(storeId,orderId,message,requestId),[storeId,orderId]);
  const issue=async()=>{setBusy(true);setError('');setNotice('');setLink('');try{const next=await issueConversation(storeId,orderId);setLink(next.link);setIssued(true);setNotice(`Link válido até ${new Date(next.expiresAt).toLocaleString('pt-BR')}.`);}catch{setError('Não foi possível gerar o link. Confira o acesso e tente novamente.');}finally{setBusy(false);}};
  return <section className="order-details-modal__section"><h3>Conversa com cliente</h3><p>Confirme a identidade do cliente antes de enviar o link. Um novo link invalida o anterior.</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={()=>void issue()}>{busy?'Gerando…':'Gerar novo link'}</button>
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
    {link&&<><label>Link privado<input readOnly value={link} onFocus={event=>event.currentTarget.select()}/></label><button type="button" className="secondary-button" onClick={()=>void copyText(link).then(()=>setNotice('Link copiado. Compartilhe somente com o cliente.')).catch(()=>setError('Não foi possível copiar. Selecione o link e copie manualmente.'))}>Copiar link</button></>}
    <ConversationThread key={`${orderId}:${issued}`} load={load} send={send} refreshKey={orderId}/>
  </section>;
}
