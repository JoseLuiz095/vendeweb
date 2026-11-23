import {useEffect,useRef,useState} from 'react';
import PixCopyButton from '../PixCopyButton';
import {checkIsolatedPayment,createIsolatedTestOrder,payIsolatedPix} from '../../services/mercadoPagoIsolatedTestApi';

/** Administrative pilot only; do not render in public checkout. */
export function MercadoPagoIsolatedPixPilot({storeId}:{storeId:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<{id:string;status:string;qrCode:string|null}|null>(null);
 const [orderId,setOrderId]=useState(''),[confirmation,setConfirmation]=useState<'waiting'|'paid'|'review'>('waiting');
 const running=useRef(false);
 const storageKey=`vendeweb.mp-test-pix.${storeId}`;
 const getRequestId=()=>{
  try{const old=sessionStorage.getItem(storageKey);if(old&&/^[0-9a-f-]{36}$/i.test(old))return old;const id=crypto.randomUUID();sessionStorage.setItem(storageKey,id);return id;}
  catch{throw new Error('Não foi possível iniciar o teste nesta sessão do navegador.');}
 };
 const run=async()=>{
  if(running.current)return;running.current=true;setBusy(true);setError('');
  try{const order=await createIsolatedTestOrder(storeId,getRequestId(),'pix');const payment=await payIsolatedPix(storeId,order);setOrderId(order);setConfirmation('waiting');setResult({id:payment.id,status:payment.status,qrCode:payment.qrCode});}
  catch(e){setError(e instanceof Error?e.message:'Não foi possível realizar o teste.');}
  finally{running.current=false;setBusy(false);}
 };
 useEffect(()=>{
  if(!orderId||confirmation!=='waiting')return;
  let canceled=false,timer:ReturnType<typeof setTimeout>|undefined,attempts=0;
  const check=async()=>{try{const next=await checkIsolatedPayment(storeId,orderId);if(canceled)return;if(next==='applied'||next==='duplicate'){setConfirmation('paid');return;}if(next==='review'){setConfirmation('review');return;}}catch{if(canceled)return;}if(++attempts<24&&!canceled)timer=setTimeout(()=>void check(),5000);};
  void check();return()=>{canceled=true;if(timer)clearTimeout(timer);};
 },[storeId,orderId,confirmation]);
 const reset=()=>{try{sessionStorage.removeItem(storageKey);setOrderId('');setConfirmation('waiting');setResult(null);setError('');}catch{setError('Não foi possível preparar outro teste.');}};
 return <section className="admin-info-box" aria-label="Teste isolado de Pix" style={{display:'grid',gap:8,marginTop:14}}>
  <strong>Teste isolado de Pix</strong>
  <span>Simulação de R$ 50,00. Não pague o código com dinheiro real. Este teste não cria pedido de cliente nem altera o estoque da loja.</span>
  <div><button type="button" className="secondary-button" disabled={busy} onClick={()=>void run()}>{busy?'Consultando…':result?'Consultar teste novamente':'Criar Pix de teste'}</button>{result&&<button type="button" className="secondary-button" disabled={busy} onClick={reset}>Preparar outro teste</button>}</div>
  {error&&<small role="alert">{error}</small>}
  {result&&<><small role="status">{confirmation==='paid'?'Pagamento de teste confirmado. Entrega permanece em aberto.':confirmation==='review'?'Teste em análise. Nenhum pagamento foi confirmado no pedido.':'Aguardando confirmação do pagamento de teste.'}</small>{result.qrCode&&<PixCopyButton value={result.qrCode} label="Pix de teste" compact/>}</>}
 </section>;
}
