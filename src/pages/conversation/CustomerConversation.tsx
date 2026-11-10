import { useCallback, useState } from 'react';
import { ConversationThread } from '../../components/conversation/ConversationThread';
import { customerConversation, orderConversationEnabled } from '../../services/orderConversationApi';
import '../../pages/store/order-payment.css';

const storageKey='food_order_conversation_capability_v1';
let inMemoryToken='';
function takeToken():string {
  const token=window.location.hash.slice(1);
  if(token){
    // Fragments are not sent to the server. Remove them before further interaction.
    window.history.replaceState(window.history.state,'',window.location.pathname);
    if(!/^[A-Za-z0-9_-]{43}$/.test(token)){inMemoryToken='';try{sessionStorage.removeItem(storageKey);}catch{}return '';}
    inMemoryToken=token;
    try{sessionStorage.setItem(storageKey,token);}catch{/* a conversa continua nesta aba */}
    return token;
  }
  if(inMemoryToken)return inMemoryToken;
  try{return sessionStorage.getItem(storageKey)||'';}catch{return '';}
}
export default function CustomerConversation(){
  const [token]=useState(takeToken);
  const load=useCallback(()=>customerConversation(token),[token]);
  const send=useCallback((message:string,requestId:string)=>customerConversation(token,message,requestId),[token]);
  return <main className="order-payment-page"><section className="order-payment-card"><span>VendeWeb · Conversa</span><h1>Conversa com a loja</h1>
    {!orderConversationEnabled?<p role="status">Conversa indisponível nesta instalação.</p>:!token?<p role="alert">Link incompleto. Solicite um novo link à loja.</p>:<><p>Este link é pessoal. Não compartilhe com outras pessoas.</p><ConversationThread load={load} send={send} refreshKey={token}/></>}
  </section></main>;
}
