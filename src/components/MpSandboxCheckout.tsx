import { useState } from 'react';
import { getSupabaseClient } from '../lib/supabase';
import PixCopyButton from './PixCopyButton';

/** Rendered only with a test-only capability minted by the checkout backend. */
export function MpSandboxCheckout({storeId,orderId,capability}:{storeId:string;orderId:string;capability?:string}) {
 const [busy,setBusy]=useState(false),[code,setCode]=useState(''),[error,setError]=useState('');
 const generate=async()=>{
  if(busy||!capability)return;setBusy(true);setError('');
  try{
   const {data,error:failure}=await getSupabaseClient().functions.invoke('food-mercadopago-checkout-test',{body:{action:'create',storeId,orderId},headers:{'x-mp-test-capability':capability},timeout:15000});
   if(failure||!data||typeof data.qrCode!=='string'||!data.qrCode.startsWith('000201'))throw new Error('Não foi possível gerar o Pix de teste. Tente novamente.');
   setCode(data.qrCode);
  }catch(e){setError(e instanceof Error?e.message:'Pix de teste indisponível.');}finally{setBusy(false);}
 };
 return <section className="container" aria-label="Pagamento de teste"><div className="order-success-card"><h1>Ambiente de teste</h1><p><strong>Pix de teste: não faça pagamento real.</strong> Esta tela é exclusiva para homologação e não confirma um recebimento.</p>{!capability?<p role="alert">Pix de teste indisponível. O pedido precisa ter e-mail válido e a configuração de teste deve estar ativa.</p>:<button type="button" className="primary-button" disabled={busy} onClick={()=>void generate()}>{busy?'Gerando…':code?'Consultar Pix de teste novamente':'Gerar Pix de teste'}</button>}{error&&<p role="alert">{error}</p>}{code&&<><p>Código de teste:</p><PixCopyButton value={code} label="Pix de teste" compact/></>}</div></section>;
}
