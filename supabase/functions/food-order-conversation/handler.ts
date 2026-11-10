import { createConversationToken, conversationTokenDigest } from '../_shared/orderConversationToken.ts';

type Dependencies = {
  enabled: boolean;
  allowedOrigins: Set<string>;
  authenticate: (jwt: string) => Promise<string | null>;
  issue: (store: string, order: string, actor: string, digest: string) => Promise<{ expires_at: string }>;
  staff: (store: string, order: string, actor: string, action: string, body?: string, requestId?: string) => Promise<unknown>;
  customer: (digest: string, action: string, body?: string, requestId?: string) => Promise<unknown>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** All staff identity verification and database privileges remain server-side. */
export const createConversationHandler = (deps: Dependencies) => async (req: Request): Promise<Response> => {
  const origin = req.headers.get('origin') || '';
  const headers = { 'Content-Type':'application/json', 'Cache-Control':'no-store, private', 'Referrer-Policy':'no-referrer', 'X-Content-Type-Options':'nosniff', 'Vary':'Origin', 'Access-Control-Allow-Origin':deps.allowedOrigins.has(origin)?origin:'null', 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods':'POST,OPTIONS' };
  const respond = (status:number, value:unknown) => new Response(JSON.stringify(value), { status, headers });
  if (origin && !deps.allowedOrigins.has(origin)) return respond(403,{error:'Origem não autorizada.'});
  if (req.method==='OPTIONS') return new Response(null,{status:204,headers});
  if (req.method!=='POST') return respond(405,{error:'Método não permitido.'});
  if (!deps.enabled) return respond(503,{error:'Conversa indisponível nesta instalação.'});
  try {
    const reader=req.body?.getReader(); const decoder=new TextDecoder(); let raw=''; let size=0;
    if(reader) for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();return respond(413,{error:'Mensagem muito grande.'});}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
    const body=JSON.parse(raw);
    const action=body?.action;
    if(action==='customer_list'||action==='customer_send'){
      const digest=await conversationTokenDigest(body.token);
      const send=action==='customer_send';
      if(send&&(typeof body.message!=='string'||!body.message.trim()||body.message.length>2000||!uuid.test(body.requestId||'')))return respond(400,{error:'Confira a mensagem e tente novamente.'});
      return respond(200,await deps.customer(digest,send?'send':'list',send?body.message:undefined,send?body.requestId:undefined));
    }
    if(action==='staff_issue'||action==='staff_list'||action==='staff_send'){
      if(!uuid.test(body.storeId||'')||!uuid.test(body.orderId||''))return respond(400,{error:'Pedido inválido.'});
      const jwt=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
      const actor=jwt?await deps.authenticate(jwt):null;
      if(!actor)return respond(401,{error:'Entre novamente na conta da loja.'});
      if(action==='staff_issue'){
        const token=createConversationToken();
        const result=await deps.issue(body.storeId,body.orderId,actor,await conversationTokenDigest(token));
        return respond(200,{token,expiresAt:result.expires_at});
      }
      const send=action==='staff_send';
      if(send&&(typeof body.message!=='string'||!body.message.trim()||body.message.length>2000||!uuid.test(body.requestId||'')))return respond(400,{error:'Confira a mensagem e tente novamente.'});
      return respond(200,await deps.staff(body.storeId,body.orderId,actor,send?'send':'list',send?body.message:undefined,send?body.requestId:undefined));
    }
    return respond(400,{error:'Solicitação inválida.'});
  }catch{return respond(400,{error:'Não foi possível acessar a conversa. Confira o link ou entre em contato com a loja.'});}
};
