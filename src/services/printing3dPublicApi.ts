import { appConfig } from '../lib/config';
export async function printing3dPublicCall(body:Record<string,unknown>|FormData):Promise<{id?:string;text?:string;duplicate?:boolean}> {
  const response=await fetch(`${appConfig.supabaseUrl}/functions/v1/food-printing3d-public`,{method:'POST',headers:{apikey:appConfig.supabaseAnonKey,...(body instanceof FormData?{}:{'Content-Type':'application/json'})},body:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
  const result=await response.json().catch(()=>({error:'Não foi possível ler a resposta.'}));
  if(!response.ok)throw new Error(result.error||'Não foi possível concluir a solicitação.');
  return result;
}
