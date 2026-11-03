import {reportOrderReceipt} from '../services/orderPaymentApi';
import { useEffect, useRef, useState } from 'react';
import { getReceiptDestinations, receiptContactsEnabled, type ReceiptDestinations } from '../services/receiptContactsApi';
import { getWhatsAppUrl } from '../utils/whatsapp';
import './receipt-contacts.css';
/** Encaminha comprovantes e registra apenas que o cliente informou o envio. */
export default function ReceiptDestination({storeId,pointId,destinations,legacyPhone='',message,onOpen,receiptToken,onReported}:{storeId?:string;pointId?:string;destinations?:ReceiptDestinations;legacyPhone?:string;message:string;onOpen?:()=>void;receiptToken?:string;onReported?:()=>void}){
 const [reporting,setReporting]=useState(false),[reported,setReported]=useState(false),[localOpened,setLocalOpened]=useState(false),[reportError,setReportError]=useState('');const inFlight=useRef(false);
 const isOpened=localOpened;
 const key=`${storeId||''}:${pointId||''}:${receiptToken||''}`;
 const activeKey=useRef(key);activeKey.current=key;
 const [attempt,setAttempt]=useState(0),[choice,setChoice]=useState({key:'',id:''});
 const [state,setState]=useState<{key:string;data?:ReceiptDestinations;loading:boolean;error:string}>({key:'',loading:true,error:''});
 useEffect(()=>{setReported(false);setLocalOpened(false);setReportError('');},[key]);
 useEffect(()=>{let active=true;setChoice({key,id:''});
  if(destinations){setState({key,data:destinations,loading:false,error:''});return;}
  if(!storeId||!receiptContactsEnabled){setState({key,data:{mode:'general',contacts:[]},loading:false,error:''});return;}
  setState({key,loading:true,error:''});
  void getReceiptDestinations(storeId,pointId).then(data=>{if(active)setState({key,data,loading:false,error:''});}).catch(()=>{if(active)setState({key,loading:false,error:'Não foi possível consultar o destino do comprovante. Tente novamente antes de enviar.'});});return()=>{active=false;};
 },[key,storeId,pointId,destinations,attempt]);
 const data=state.key===key?state.data:undefined;
 const contacts=data?.contacts||[];
 const contactId=(c:(typeof contacts)[number])=>`${c.pointId||''}:${c.slot}`;
 const selected=contacts.length===1?contacts[0]:contacts.find(c=>choice.key===key&&choice.id===contactId(c));
 const fallback=(data?.mode==='general'||data?.mode==='unassigned')&&contacts.length===0&&/^[1-9][0-9]{9,14}$/.test(legacyPhone.replace(/\D/g,''))?legacyPhone:'';
 const phone=selected?.phone||fallback;
 const openReceipt=()=>{setLocalOpened(true);onOpen?.();};
 const confirmReceiptSent=async()=>{
  if(!receiptToken||inFlight.current||!phone)return;inFlight.current=true;setReporting(true);setReportError('');
  const requestKey=key;
  try{await reportOrderReceipt(receiptToken);if(activeKey.current!==requestKey)return;setReported(true);onReported?.();}
  catch(error){if(activeKey.current===requestKey)setReportError(error instanceof Error?error.message:'Não foi possível registrar o aviso. Tente novamente.');}
  finally{inFlight.current=false;if(activeKey.current===requestKey)setReporting(false);}
 };
 return <section className="receipt-destination" aria-label="Enviar comprovante"><h2>Envie o comprovante à loja</h2>
 {state.key!==key||state.loading?<p role="status">Consultando contato…</p>:state.error?<><p role="alert">{state.error}</p><button type="button" className="secondary-button" onClick={()=>setAttempt(x=>x+1)}>Tentar consultar contatos</button></>:<>
 {data?.mode==='unavailable'?<p>O destino do comprovante não está disponível. Fale com a loja para conferir o número antes de enviar.</p>:<>
 {data?.mode==='unassigned'&&<p>{fallback?'Este ponto não tem WhatsApp exclusivo. O comprovante será enviado ao WhatsApp da loja.':'Este ponto ainda não tem contato definido. Solicite o número correto ao local antes de enviar o comprovante.'}</p>}
 {data?.mode==='selection'&&contacts.length>0&&<p>A loja não cadastrou WhatsApp próprio. Escolha o ponto que receberá o comprovante.</p>}
 {contacts.length>1&&<label>{data?.mode==='selection'?'Para qual ponto deseja enviar?':'Para qual contato deseja enviar?'}<select value={selected?contactId(selected):''} onChange={e=>{setChoice({key,id:e.target.value});setLocalOpened(false);}}><option value="">Selecione um destino</option>{contacts.map(c=><option key={contactId(c)} value={contactId(c)}>{c.name}</option>)}</select></label>}
 {selected&&<p>Destino: <strong>{selected.name}</strong> · +{selected.phone}</p>}
 {phone?<a href={getWhatsAppUrl(phone,message)} target="_blank" rel="noopener noreferrer" onClick={openReceipt}>Abrir WhatsApp e enviar comprovante</a>:contacts.length>1?<button type="button" disabled>Selecione um destino para enviar o comprovante</button>:data?.mode!=='unassigned'&&<p>A loja ainda não cadastrou um destino para comprovantes.</p>}
 {receiptToken&&phone&&isOpened&&!reported&&<button type="button" className="primary-button" disabled={reporting} onClick={()=>void confirmReceiptSent()}>{reporting?'Registrando…':'Já enviei o comprovante'}</button>}
 </>}
 </>}
 {reportError&&<><p role="alert">{reportError}</p>{phone&&<a href={getWhatsAppUrl(phone,message)} target="_blank" rel="noopener noreferrer">Abrir o WhatsApp novamente</a>}</>}{reported&&<p role="status">Comprovante informado. O pedido continua aguardando a conferência do crédito pela loja; ainda não está pago nem retirado.</p>}
 {receiptToken&&<p>{isOpened&&!reported?'Depois de anexar e enviar o comprovante, volte aqui e confirme o envio.':''} Essa confirmação só avisa a loja. Ela não verifica o crédito, não marca o pedido como pago e não conclui a retirada.</p>}
 {!receiptToken&&<p>Após pagar, anexe o comprovante na conversa. A loja confere o recebimento; a cópia ou abertura do WhatsApp não confirma o pagamento.</p>}</section>;
}
