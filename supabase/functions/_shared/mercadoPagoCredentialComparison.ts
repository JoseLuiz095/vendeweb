import {isVerifiedTestSeller} from './mercadoPagoTestSeller.ts';

/** Read-only probe. Never creates payments, swaps OAuth credentials or returns
 * provider payloads. Public-key equality alone does not establish app identity. */
export async function inspectComparisonCredential(
 input:{accessToken:string;publicKey:string;oauthPublicKey?:string;sellerId:string},
 transport:(url:string,init:RequestInit)=>Promise<Response>,
) {
 const base={tokenPresent:!!input.accessToken,publicKeyPresent:!!input.publicKey,
  publicKeyMatchesOAuth:input.publicKey&&input.oauthPublicKey?input.publicKey===input.oauthPublicKey:null};
 if(!input.accessToken||!input.publicKey)return {...base,result:'not_configured'};
 if(input.accessToken.length>8192||/[\r\n]/.test(input.accessToken))return {...base,result:'invalid_configuration'};
 try {
  const response=await transport('https://api.mercadolibre.com/users/me',{
   method:'GET',redirect:'error',headers:{Authorization:`Bearer ${input.accessToken}`,Accept:'application/json'},signal:AbortSignal.timeout(10000),
  });
  if(!response.ok){await response.body?.cancel();return {...base,result:'provider_rejected',httpStatus:response.status};}
  const reader=response.body?.getReader();if(!reader)return {...base,result:'invalid_response'};
  let size=0,text='';const decoder=new TextDecoder();
  for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>32768){await reader.cancel();return {...base,result:'invalid_response'};}text+=decoder.decode(value,{stream:true});}
  const user=JSON.parse(text+decoder.decode());
  if(!user||typeof user!=='object'||Array.isArray(user)||!/^\d{1,32}$/.test(String(user.id)))return {...base,result:'invalid_response'};
  return {...base,result:'identity_checked',sameSeller:String(user.id)===input.sellerId,
   brazilianTestAccount:isVerifiedTestSeller(user,String(user.id)),
   expectedTestSeller:isVerifiedTestSeller(user,input.sellerId)};
 } catch {return {...base,result:'unavailable'};}
}
