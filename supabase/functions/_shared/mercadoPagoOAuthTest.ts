/** Sandbox-only OAuth building blocks. No routes, storage, or network calls are registered here.
 * All helpers are server-side. A consuming endpoint MUST authenticate and authorize the
 * operator for the store, and atomically consume a state before exchanging the code.
 */
const bytes=new TextEncoder();
const toBase64Url=(value:Uint8Array)=>btoa(Array.from(value,byte=>String.fromCharCode(byte)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromBase64Url=(value:string)=>{
 if(!/^[A-Za-z0-9_-]+$/.test(value)||value.length%4===1)throw new Error('Dados inválidos.');
 return Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')+'='.repeat((4-value.length%4)%4)),char=>char.charCodeAt(0));
};
const random=()=>toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
const digest=async(value:string)=>toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes.encode(value))));

/** Both random values are secrets: state goes only to the seller; verifier only to server storage. */
export async function beginTestOAuth(input:{clientId:string;redirectUri:string;storeId:string;actorId:string;now:number}) {
 if(!/^\d{1,32}$/.test(input.clientId)||!input.storeId||!input.actorId||!Number.isSafeInteger(input.now))throw new Error('Configuração inválida.');
 let redirect:URL;try{redirect=new URL(input.redirectUri);}catch{throw new Error('Configuração inválida.');}
 if(redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.hash||redirect.search)throw new Error('Configuração inválida.');
 const state=random(),verifier=random(),challenge=await digest(verifier);
 const url=new URL('https://auth.mercadopago.com/authorization');
 url.search=new URLSearchParams({client_id:input.clientId,response_type:'code',platform_id:'mp',redirect_uri:input.redirectUri,state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
 return {authorizationUrl:url.toString(),stateHash:await digest(state),verifier,storeId:input.storeId,actorId:input.actorId,expiresAt:input.now+10*60_000};
}

export async function hashTestOAuthState(state:string):Promise<string> {
 if(!/^[A-Za-z0-9_-]{43}$/.test(state))throw new Error('Estado inválido.');
 return digest(state);
}

/** AES-GCM binds ciphertext to store, account, purpose and sandbox; no credentials in error text. */
export async function sealTestSecret(rawKey:Uint8Array,storeId:string,purpose:'oauth-verifier'|'seller-token',secret:string):Promise<string>{
 if(rawKey.length!==32||!storeId||!secret||secret.length>16384)throw new Error('Dados inválidos.');
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const key=await crypto.subtle.importKey('raw',Uint8Array.from(rawKey),{name:'AES-GCM'},false,['encrypt']);
 const aad=bytes.encode(JSON.stringify(['mercadopago','test',storeId,purpose,'v1']));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},key,bytes.encode(secret));
 return `v1.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}
export async function openTestSecret(rawKey:Uint8Array,storeId:string,purpose:'oauth-verifier'|'seller-token',sealed:string):Promise<string>{
 try{
  const parts=sealed.split('.');if(rawKey.length!==32||!storeId||parts.length!==3||parts[0]!=='v1'||sealed.length>30000)throw new Error();
  const iv=fromBase64Url(parts[1]),encrypted=fromBase64Url(parts[2]);if(iv.length!==12)throw new Error();
  const key=await crypto.subtle.importKey('raw',Uint8Array.from(rawKey),{name:'AES-GCM'},false,['decrypt']);
  const aad=bytes.encode(JSON.stringify(['mercadopago','test',storeId,purpose,'v1']));
  return new TextDecoder('utf-8',{fatal:true}).decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad},key,encrypted));
 }catch{throw new Error('Não foi possível acessar a credencial.');}
}

/** Atomically consume an unexpired state tied to the authenticated actor and store.
 * The injected consume implementation must perform an atomic one-time conditional
 * delete/update and verify expiry on the server; it must never be publicly callable.
 * This helper does not exchange the authorization code or imply any privilege.
 */
export async function consumeTestOAuthState(input:{state:string;storeId:string;actorId:string;now:number},consume:(hash:string,storeId:string,actorId:string,now:number)=>Promise<{verifier:string;expiresAt:number}|null>):Promise<string>{
 if(!input.storeId||!input.actorId||!Number.isSafeInteger(input.now))throw new Error('Autorização inválida ou expirada.');
 const hash=await hashTestOAuthState(input.state);
 const result=await consume(hash,input.storeId,input.actorId,input.now);
 if(!result||!Number.isSafeInteger(result.expiresAt)||result.expiresAt<=input.now||!/^[A-Za-z0-9_-]{43}$/.test(result.verifier))throw new Error('Autorização inválida ou expirada.');
 return result.verifier;
}

/** Build ONLY a sandbox token exchange request. Calling it is a separate server action. */
export function buildTestTokenExchange(input:{clientId:string;clientSecret:string;redirectUri:string;code:string;verifier:string}){
 if(!/^\d{1,32}$/.test(input.clientId)||!input.clientSecret||!input.code||input.code.length>2048||!/^[A-Za-z0-9_-]{43}$/.test(input.verifier))throw new Error('Solicitação inválida.');
 let redirect:URL;try{redirect=new URL(input.redirectUri);}catch{throw new Error('Solicitação inválida.');}
 if(redirect.protocol!=='https:'||redirect.username||redirect.password||redirect.hash||redirect.search)throw new Error('Solicitação inválida.');
 return {url:'https://api.mercadopago.com/oauth/token',body:{client_id:input.clientId,client_secret:input.clientSecret,grant_type:'authorization_code',code:input.code,redirect_uri:input.redirectUri,code_verifier:input.verifier,test_token:true}};
}
