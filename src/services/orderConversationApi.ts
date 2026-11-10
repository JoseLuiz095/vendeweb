import { getSupabaseClient } from '../lib/supabase';
import { platformOrigin } from '../lib/brand';

export const orderConversationEnabled = import.meta.env.VITE_ORDER_CONVERSATION_ENABLED === 'true';
export type ConversationMessage = { id: string; sender: 'customer' | 'store' | 'system'; body: string; createdAt: string };
export type Conversation = { orderNumber?: number; messages: ConversationMessage[] };

async function invoke(body: Record<string, unknown>): Promise<unknown> {
  const {data,error}=await getSupabaseClient().functions.invoke('food-order-conversation',{body,timeout:15000});
  if(error) throw new Error('Não foi possível acessar a conversa. Confira a conexão ou solicite um novo link à loja.');
  return data;
}
function parse(value: unknown): Conversation {
  if (!value || typeof value !== 'object') throw new Error('Não foi possível carregar as mensagens.');
  const data=value as Record<string,unknown>;
  if (!Array.isArray(data.messages) || data.messages.some((item:unknown)=>{
    if (!item || typeof item !== 'object') return true;
    const m=item as Record<string,unknown>;
    return typeof m.id!=='string' || typeof m.sender!=='string' || !['customer','store','system'].includes(m.sender) || typeof m.body!=='string' || typeof m.createdAt!=='string';
  })) throw new Error('Não foi possível carregar as mensagens.');
  return {messages:data.messages as ConversationMessage[], ...(typeof data.orderNumber==='number'&&Number.isSafeInteger(data.orderNumber)?{orderNumber:data.orderNumber}:{})};
}
export async function issueConversation(storeId:string,orderId:string):Promise<{link:string;expiresAt:string}> {
  const value=await invoke({action:'staff_issue',storeId,orderId}) as {token?:unknown;expiresAt?:unknown};
  if(typeof value?.token!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value.token)||typeof value.expiresAt!=='string'||!Number.isFinite(Date.parse(value.expiresAt))) throw new Error('Não foi possível gerar o link.');
  return {link:new URL(`/conversa/pedido#${value.token}`,platformOrigin()).href,expiresAt:value.expiresAt};
}
export async function staffConversation(storeId:string,orderId:string,message?:string,requestId?:string):Promise<Conversation>{
  return parse(await invoke({action:message===undefined?'staff_list':'staff_send',storeId,orderId,...(message!==undefined?{message,requestId}:{})}));
}
export async function customerConversation(token:string,message?:string,requestId?:string):Promise<Conversation>{
  return parse(await invoke({action:message===undefined?'customer_list':'customer_send',token,...(message!==undefined?{message,requestId}:{})}));
}
