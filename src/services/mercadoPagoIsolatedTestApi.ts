import {getSupabaseClient} from '../lib/supabase';

type Method='pix'|'card';
type PixResult={id:string;status:string;statusDetail:string;qrCode:string|null};
export type TestCardToken={cardToken:string;paymentMethodId:string;paymentType:'credit_card'|'debit_card';installments:number;buyerEmail:string};
async function invoke(body:{action:string;[key:string]:unknown}):Promise<unknown>{
 const {data,error}=await getSupabaseClient().functions.invoke('food-mercadopago-isolated-test',{body,timeout:body.action==='compare_pix'||body.action==='compare_oauth_pix'?45000:20000});
 if(error){
  if(error.context instanceof Response){try{const detail:unknown=await error.context.clone().json();if(object(detail)&&detail.error==='test_buyer_mismatch')throw new Error('Use o e-mail da conta compradora de teste configurada para o piloto.');}catch(cause){if(cause instanceof Error&&cause.message==='Use o e-mail da conta compradora de teste configurada para o piloto.')throw cause;}}
  throw new Error(body.action==='pay'?'Não foi possível confirmar o resultado. Confira a tentativa antes de repetir.':'Não foi possível concluir a consulta de teste.');
 }
 return data;
}
function object(v:unknown):v is Record<string,unknown>{return !!v&&typeof v==='object'&&!Array.isArray(v)}
export async function createIsolatedTestOrder(storeId:string,requestId:string,method:Method):Promise<string>{
 const data=await invoke({action:'create',storeId,requestId,method});
 if(!object(data)||typeof data.orderId!=='string'||!/^[0-9a-f-]{36}$/i.test(data.orderId))throw new Error('Não foi possível criar o pedido de teste.');
 return data.orderId;
}
export async function payIsolatedPix(storeId:string,orderId:string):Promise<PixResult>{
 const data=await invoke({action:'pay',storeId,orderId});
 if(!object(data)||typeof data.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.id)||typeof data.status!=='string'||typeof data.statusDetail!=='string'||!(data.qrCode===null||typeof data.qrCode==='string'&&data.qrCode.startsWith('000201')&&data.qrCode.length<=4096))throw new Error('Não foi possível consultar o Pix de teste.');
 return {id:data.id,status:data.status,statusDetail:data.statusDetail,qrCode:data.qrCode};
}
export async function compareTestCredentialPix(storeId:string,orderId:string):Promise<string>{
 const data=await invoke({action:'compare_pix',storeId,orderId});
 if(!object(data)||!['provider_order','provider_rejected'].includes(String(data.result))||!['invalid_users_involved','invalid_credentials','other'].includes(String(data.category)))throw new Error('Não foi possível verificar o teste de comparação.');
 if(data.result==='provider_rejected')return `O provedor rejeitou a chamada de comparação (${data.category==='invalid_credentials'?'invalid_credentials':'erro de requisição'}).`;
 if(typeof data.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.id)||typeof data.status!=='string'||!['created','processing','action_required','processed','failed','canceled','expired','unknown'].includes(data.status))throw new Error('Resposta de comparação inválida.');
 return `Conta de teste 3835760583, order ${data.id}: status no provedor ${data.status}${data.category==='invalid_users_involved'?' (invalid_users_involved)':''}. Este resultado não confirma o pagamento de um pedido da loja nem valida o OAuth.`;
}
export async function compareOAuthCanonicalPix(storeId:string,orderId:string):Promise<string>{
 const data=await invoke({action:'compare_oauth_pix',storeId,orderId});
 if(!object(data)||!['provider_order','provider_rejected'].includes(String(data.result))||!['invalid_users_involved','invalid_credentials','other'].includes(String(data.category)))throw new Error('Não foi possível verificar a comparação OAuth.');
 if(data.result==='provider_rejected')return `O provedor rejeitou a comparação OAuth (${data.category==='invalid_credentials'?'invalid_credentials':'erro de requisição'}).`;
 if(typeof data.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.id)||typeof data.status!=='string'||!['created','processing','action_required','processed','failed','canceled','expired','unknown'].includes(data.status))throw new Error('Resposta de comparação inválida.');
 return `Comparação com a vendedora conectada, order ${data.id}: status ${data.status}${data.category==='invalid_users_involved'?' (invalid_users_involved)':''}. Não confirma pedidos da loja.`;
}
export async function checkIsolatedPayment(storeId:string,orderId:string):Promise<'applied'|'duplicate'|'pending'|'review'>{
 const data=await invoke({action:'check',storeId,orderId});
 if(!object(data)||(data.result!=='applied'&&data.result!=='duplicate'&&data.result!=='pending'&&data.result!=='review'))throw new Error('Não foi possível consultar a confirmação do teste.');
 return data.result;
}
export async function getIsolatedCardConfig(storeId:string,orderId:string):Promise<{publicKey:string;amount:number;buyerEmail:string}>{
 const data=await invoke({action:'card_config',storeId,orderId});
 if(!object(data)||typeof data.publicKey!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(data.publicKey)||data.amount!=='50.00'||typeof data.buyerEmail!=='string'||data.buyerEmail.length>254||!/^test_user[0-9a-z._-]*@testuser\.com$/.test(data.buyerEmail))throw new Error('Cartão de teste indisponível. Confira a conexão da conta de teste.');
 return {publicKey:data.publicKey,amount:50,buyerEmail:data.buyerEmail};
}
export async function getComparisonCardConfig(storeId:string):Promise<{publicKey:string;amount:number}>{
 const data=await invoke({action:'compare_card_config',storeId});
 if(!object(data)||typeof data.publicKey!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(data.publicKey)||data.amount!=='50.00')throw new Error('Comparação de cartão indisponível.');
 return {publicKey:data.publicKey,amount:50};
}
export async function payIsolatedCard(storeId:string,orderId:string,card:TestCardToken):Promise<'failed'|'submitted'>{
 const data=await invoke({action:'pay',storeId,orderId,card:{cardToken:card.cardToken,paymentMethodId:card.paymentMethodId,paymentType:card.paymentType,installments:card.installments,buyerEmail:card.buyerEmail}});
 if(!object(data)||typeof data.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.id))throw new Error('Não foi possível enviar o cartão de teste.');
 return data.status==='failed'?'failed':'submitted';
}
