import {useEffect,useRef,useState} from 'react';
import {checkIsolatedPayment,createIsolatedTestOrder,getIsolatedCardConfig,getComparisonCardConfig,payIsolatedCard} from '../../services/mercadoPagoIsolatedTestApi';
import {cardBrickErrorCategory,watchCardForm} from '../../services/mercadoPagoCardReadiness';

type BrickController={unmount:()=>Promise<void>|void};
type BrickBuilder={create:(type:'cardPayment',id:string,settings:object)=>Promise<BrickController>};
type MercadoPagoConstructor=new(key:string,options:{locale:string})=>{bricks:()=>BrickBuilder};
let sdkLoading:Promise<void>|undefined;
function sdk():Promise<void>{
 const host=window as unknown as {MercadoPago?:MercadoPagoConstructor};
 if(host.MercadoPago)return Promise.resolve();
 if(sdkLoading)return sdkLoading;
 const loading=new Promise<void>((resolve,reject)=>{
  const script=document.createElement('script');script.src='https://sdk.mercadopago.com/js/v2';script.async=true;
  script.onload=()=>host.MercadoPago?resolve():reject(new Error('Formulário de teste indisponível.'));
  script.onerror=()=>reject(new Error('Formulário de teste indisponível.'));
  document.head.appendChild(script);
 }).catch(error=>{sdkLoading=undefined;throw error;});
 sdkLoading=loading;
 return loading;
}
/** Administrative pilot only. Card fields are rendered by Mercado Pago. */
export function MercadoPagoIsolatedCardPilot({storeId}:{storeId:string}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[orderId,setOrderId]=useState('');
 const [config,setConfig]=useState<{publicKey:string;amount:number;buyerEmail?:string}|null>(null),[sent,setSent]=useState(false);
 const [confirmation,setConfirmation]=useState<'waiting'|'paid'|'review'>('waiting');
 const [comparison,setComparison]=useState(false),[ready,setReady]=useState(false);
 const running=useRef(false);const storageKey=`vendeweb.mp-test-card.${storeId}`;
 const begin=async()=>{
  if(running.current)return;running.current=true;setBusy(true);setError('');
  try{
   let id=sessionStorage.getItem(storageKey);if(!id||!/^[0-9a-f-]{36}$/i.test(id)){id=crypto.randomUUID();sessionStorage.setItem(storageKey,id);}
   const order=await createIsolatedTestOrder(storeId,id,'card');setOrderId(order);
   const next=await getIsolatedCardConfig(storeId,order);setConfig(next);
  }catch(e){setError(e instanceof Error?e.message:'Não foi possível preparar o cartão de teste.');}
  finally{running.current=false;setBusy(false);}
 };
 const compare=async()=>{
  if(running.current)return;running.current=true;setBusy(true);setError('');setReady(false);
  try{const next=await getComparisonCardConfig(storeId);setComparison(true);setOrderId('comparison');setConfig(next);}
  catch{setError('Não foi possível preparar a comparação de cartão.');}
  finally{running.current=false;setBusy(false);}
 };
 useEffect(()=>{
  if(!config||!orderId)return;
  let canceled=false;let controller:BrickController|undefined;
  const readiness=watchCardForm(()=>{if(!canceled)setError('Não foi possível carregar o formulário de teste. Atualize a página para tentar novamente.');});
  void (async()=>{try{
   await sdk();if(canceled)return;
   const ctor=(window as unknown as {MercadoPago?:MercadoPagoConstructor}).MercadoPago;if(!ctor)throw new Error('Formulário de teste indisponível.');
   const created=await new ctor(config.publicKey,{locale:'pt-BR'}).bricks().create('cardPayment','mp-isolated-card-brick',{
    initialization:{amount:config.amount,...(config.buyerEmail?{payer:{email:config.buyerEmail}}:{})},
    callbacks:{onReady:()=>{readiness.ready();if(!canceled){setReady(true);setError('');}},onError:(cause:unknown)=>{console.warn('mp_card_brick_error',cardBrickErrorCategory(cause),comparison?'comparison':'oauth');readiness.fail();},
     onSubmit:async(form:unknown,additional:unknown)=>{
      if(comparison)throw new Error('Comparação apenas de carregamento.');
      if(!form||typeof form!=='object'||!additional||typeof additional!=='object')throw new Error('Cartão de teste inválido.');
      const value=form as Record<string,unknown>,extra=additional as Record<string,unknown>;
      const payer=value.payer&&typeof value.payer==='object'&&!Array.isArray(value.payer)?value.payer as Record<string,unknown>:{};
      const buyerEmail=typeof payer.email==='string'?payer.email:config.buyerEmail;
      if(typeof value.token!=='string'||typeof value.payment_method_id!=='string'||typeof buyerEmail!=='string'||(extra.paymentTypeId!=='credit_card'&&extra.paymentTypeId!=='debit_card')||typeof value.installments!=='number'){if(!canceled)setError('Confira os dados do cartão e do comprador de teste.');throw new Error('Cartão de teste inválido.');}
      try{await payIsolatedCard(storeId,orderId,{cardToken:value.token,paymentMethodId:value.payment_method_id,paymentType:extra.paymentTypeId,installments:value.installments,buyerEmail});if(!canceled){setSent(true);setError('');}}
      catch(cause){if(!canceled)setError(cause instanceof Error&&cause.message==='Use o e-mail da conta compradora de teste configurada para o piloto.'?cause.message:'Não foi possível confirmar o resultado. Confira a tentativa antes de repetir.');throw new Error('Pagamento de teste indisponível.');}
     }},
   });
   if(canceled)await created.unmount();else controller=created;
  }catch(cause){console.warn('mp_card_brick_rejected',cardBrickErrorCategory(cause),comparison?'comparison':'oauth');readiness.fail();}})();
  return()=>{canceled=true;readiness.dispose();if(controller)void controller.unmount();};
 },[config,orderId,storeId,comparison]);
 useEffect(()=>{
  if(!sent||!orderId||confirmation!=='waiting')return;
  let canceled=false,timer:ReturnType<typeof setTimeout>|undefined,attempts=0;
  const check=async()=>{try{const result=await checkIsolatedPayment(storeId,orderId);if(canceled)return;if(result==='applied'||result==='duplicate'){setConfirmation('paid');return;}if(result==='review'){setConfirmation('review');return;}}catch{if(canceled)return;}if(++attempts<24&&!canceled)timer=setTimeout(()=>void check(),5000);};
  void check();return()=>{canceled=true;if(timer)clearTimeout(timer);};
 },[sent,orderId,storeId,confirmation]);
 const reset=()=>{try{sessionStorage.removeItem(storageKey);setConfig(null);setOrderId('');setSent(false);setComparison(false);setReady(false);setConfirmation('waiting');setError('');}catch{setError('Não foi possível preparar outro teste.');}};
 const recover=async()=>{
  if(!orderId||running.current)return;running.current=true;setBusy(true);setError('');
  try{const result=await checkIsolatedPayment(storeId,orderId);setSent(true);setConfirmation(result==='applied'||result==='duplicate'?'paid':result==='review'?'review':'waiting');}
  catch{setError('Ainda não foi possível consultar o teste de cartão.');}
  finally{running.current=false;setBusy(false);}
 };
 return <section className="admin-info-box" aria-label="Teste isolado de cartão" style={{display:'grid',gap:8,marginTop:14}}>
  <strong>Teste isolado de cartão</strong><span>Simulação de R$ 50,00. Use somente os dados de cartão de teste do Mercado Pago. O pedido e o estoque operacionais não são alterados.</span>
  {!config&&!sent&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void begin()}>{busy?'Preparando…':'Preparar cartão de teste'}</button>}
  {!config&&!sent&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void compare()}>Verificar formulário com credencial de teste</button>}
  {orderId&&!config&&!sent&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>void recover()}>Consultar tentativa anterior</button>}
  {error&&<small role="alert">{error}</small>}
  {comparison&&<><small role="status">{ready?'Formulário de teste carregado. Esta comparação não envia pagamentos.':error?'A comparação não conseguiu carregar o formulário.':'Verificando formulário de teste. Esta comparação não envia pagamentos.'}</small><button type="button" className="secondary-button" onClick={reset}>Fechar comparação</button></>}
  <div id="mp-isolated-card-brick" hidden={sent}/>
  {(sent||Boolean(orderId&&!config))&&<><small role="status">{sent?(confirmation==='paid'?'Pagamento de teste confirmado. Entrega permanece em aberto.':confirmation==='review'?'Teste em análise. Nenhum pagamento foi confirmado no pedido.':'Aguardando confirmação do pagamento de teste.'):''}</small><button type="button" className="secondary-button" disabled={busy} onClick={reset}>Preparar outro teste</button></>}
 </section>;
}
