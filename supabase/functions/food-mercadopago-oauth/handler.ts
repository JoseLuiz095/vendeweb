import {beginTestOAuth,buildTestTokenExchange,hashTestOAuthState,openTestSecret,sealTestSecret} from '../_shared/mercadoPagoOAuthTest.ts';

/** Integration contract, deliberately NOT wired to a deployed function.
 * Every persistence method runs with service credentials and never exposes tokens.
 * Authorization is independent of `storeId` supplied in the request.
 * consumeState must atomically consume an unexpired state for actor+store and return
 * an opaque claim. commitConnection must atomically verify that claim remains valid
 * the store's connection generation is unchanged, and the actor remains an active
 * owner/admin without a password-change restriction. saveState must perform the same
 * membership check atomically. disconnect must invalidate
 * pending states and all outstanding claims, preventing a delayed OAuth callback
 * from reconnecting a disconnected store. These operations require database tests.
 */
type Deps={
 enabled:boolean;allowedOrigins:Set<string>;clientId:string;clientSecret:string;redirectUri:string;key:Uint8Array;
 authenticate:(jwt:string)=>Promise<string|null>;
 authorize:(actor:string,store:string)=>Promise<boolean>;
 status:(store:string)=>Promise<{connected:boolean;sellerId?:string}>;
 saveState:(input:{storeId:string;actorId:string;stateHash:string;sealedVerifier:string;expiresAt:number})=>Promise<void>;
 consumeState:(hash:string,store:string,actor:string,now:number)=>Promise<{sealedVerifier:string;claim:string}|null>;
 commitConnection:(store:string,actor:string,claim:string,connection:{sellerId:string;sealedTokens:string;expiresAt:number})=>Promise<boolean>;
 disconnect:(store:string,actor:string)=>Promise<void>;
 exchange:(url:string,body:Record<string,unknown>)=>Promise<unknown>;
 now?:()=>number;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const obj=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);

export const createTestOAuthHandler=(deps:Deps)=>async(req:Request):Promise<Response>=>{
 const origin=req.headers.get('origin')||'';
 const headers={'Content-Type':'application/json','Cache-Control':'no-store, private','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Vary':'Origin','Access-Control-Allow-Origin':deps.allowedOrigins.has(origin)?origin:'null','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'};
 const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
 if(!origin||!deps.allowedOrigins.has(origin))return reply(403,{error:'Origem não autorizada.'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return reply(405,{error:'Método não permitido.'});
 if(!deps.enabled||!deps.clientId||!deps.clientSecret||!deps.redirectUri||deps.key.length!==32)return reply(503,{error:'Conexão de teste indisponível.'});
 try{
  const reader=req.body?.getReader(),decoder=new TextDecoder();let raw='',size=0;
  if(reader)for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();return reply(413,{error:'Solicitação muito grande.'});}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
  const body:unknown=JSON.parse(raw);if(!obj(body)||typeof body.storeId!=='string'||!uuid.test(body.storeId))return reply(400,{error:'Solicitação inválida.'});
  const store=body.storeId,jwt=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  const actor=jwt?await deps.authenticate(jwt):null;
  if(!actor)return reply(401,{error:'Entre novamente na conta da loja.'});
  if(!await deps.authorize(actor,store))return reply(403,{error:'Sem acesso à configuração desta loja.'});
  if(body.action==='status'){
   const result=await deps.status(store);
   return reply(200,{connected:result.connected,environment:'test',...(result.connected&&result.sellerId?{sellerId:result.sellerId}:{})});
  }
  if(body.action==='start'){
   const next=await beginTestOAuth({clientId:deps.clientId,redirectUri:deps.redirectUri,storeId:store,actorId:actor,now:(deps.now??Date.now)()});
   const sealedVerifier=await sealTestSecret(deps.key,store,'oauth-verifier',next.verifier);
   await deps.saveState({storeId:store,actorId:actor,stateHash:next.stateHash,sealedVerifier,expiresAt:next.expiresAt});
   return reply(200,{authorizationUrl:next.authorizationUrl});
  }
  if(body.action==='disconnect'){
   await deps.disconnect(store,actor);return reply(200,{disconnected:true});
  }
  if(body.action==='complete'){
   if(typeof body.state!=='string'||typeof body.code!=='string'||!body.code||body.code.length>2048)return reply(400,{error:'Autorização inválida ou expirada.'});
   const hash=await hashTestOAuthState(body.state),now=(deps.now??Date.now)();
   const consumed=await deps.consumeState(hash,store,actor,now);
   if(!consumed)return reply(400,{error:'Autorização inválida ou expirada.'});
   const verifier=await openTestSecret(deps.key,store,'oauth-verifier',consumed.sealedVerifier);
   const request=buildTestTokenExchange({clientId:deps.clientId,clientSecret:deps.clientSecret,redirectUri:deps.redirectUri,code:body.code,verifier});
   const result=await deps.exchange(request.url,request.body);
   if(!obj(result)||result.live_mode!==false||typeof result.access_token!=='string'||!result.access_token||result.access_token.length>8192||typeof result.refresh_token!=='string'||!result.refresh_token||result.refresh_token.length>8192||!Number.isSafeInteger(result.expires_in)||Number(result.expires_in)<=0||Number(result.expires_in)>31536000||!(typeof result.user_id==='string'&&/^\d{1,32}$/.test(result.user_id)||typeof result.user_id==='number'&&Number.isSafeInteger(result.user_id)&&result.user_id>0))return reply(502,{error:'Não foi possível concluir a conexão de teste.'});
   const sealedTokens=await sealTestSecret(deps.key,store,'seller-token',JSON.stringify({accessToken:result.access_token,refreshToken:result.refresh_token}));
   // Recheck membership after the external request; DB must also enforce the claim fence.
   if(!await deps.authorize(actor,store)||!await deps.commitConnection(store,actor,consumed.claim,{sellerId:String(result.user_id),sealedTokens,expiresAt:now+Number(result.expires_in)*1000}))return reply(409,{error:'A conexão mudou ou o acesso foi revogado. Inicie novamente.'});
   return reply(200,{connected:true,environment:'test'});
  }
  return reply(400,{error:'Solicitação inválida.'});
 }catch{return reply(400,{error:'Não foi possível concluir a operação. Tente novamente.'});}
};
