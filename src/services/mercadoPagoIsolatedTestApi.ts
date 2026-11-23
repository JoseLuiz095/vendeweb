import {getSupabaseClient} from '../lib/supabase';

type Method='pix'|'card';
type PixResult={id:string;status:string;statusDetail:string;qrCode:string|null};
export type TestCardToken={cardToken:string;paymentMethodId:string;paymentType:'credit_card'|'debit_card';installments:number};
async function invoke(body:{action:string;[key:string]:unknown}):Promise<unknown>{
 const {data,error}=await getSupabaseClient().functions.invoke('food-mercadopago-isolated-test',{body,timeout:20000});
 if(error)throw new Error(body.action==='pay'?'Não foi possível confirmar o resultado. Confira a tentativa antes de repetir.':'Não foi possível concluir a consulta de teste.');
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
export async function checkIsolatedPayment(storeId:string,orderId:string):Promise<'applied'|'duplicate'|'pending'|'review'>{
 const data=await invoke({action:'check',storeId,orderId});
 if(!object(data)||(data.result!=='applied'&&data.result!=='duplicate'&&data.result!=='pending'&&data.result!=='review'))throw new Error('Não foi possível consultar a confirmação do teste.');
 return data.result;
}
export async function getIsolatedCardConfig(storeId:string,orderId:string):Promise<{publicKey:string;amount:number}>{
 const data=await invoke({action:'card_config',storeId,orderId});
 if(!object(data)||typeof data.publicKey!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(data.publicKey)||data.amount!=='50.00')throw new Error('Cartão de teste indisponível. Confira a conexão da conta de teste.');
 return {publicKey:data.publicKey,amount:50};
}
export async function payIsolatedCard(storeId:string,orderId:string,card:TestCardToken):Promise<void>{
 const data=await invoke({action:'pay',storeId,orderId,card:{cardToken:card.cardToken,paymentMethodId:card.paymentMethodId,paymentType:card.paymentType,installments:card.installments}});
 if(!object(data)||typeof data.id!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(data.id))throw new Error('Não foi possível enviar o cartão de teste.');
}
