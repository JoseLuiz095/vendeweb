import {receiptContactLoadError} from '../../utils/receiptContactErrors';
import { useEffect, useRef, useState } from 'react';
import { receiptContactsApi, type ReceiptContact } from '../../services/receiptContactsApi';
import '../receipt-contacts.css';
import PointContactsEditor from './PointContactsEditor';
const empty=():ReceiptContact[]=>[1,2].map(slot=>({slot,name:'',phone:''}));
export default function ReceiptContactsSettings({storeId,demo=false}:{storeId:string;demo?:boolean}){
 const [attempt,setAttempt]=useState(0),[state,setState]=useState({key:'',loading:true,error:'',saved:false});
 const [contacts,setContacts]=useState(empty),[points,setPoints]=useState<Array<{id:string;name:string}>>([]),[mapping,setMapping]=useState<Record<string,string>>({}),[saving,setSaving]=useState(false),[loaded,setLoaded]=useState(false),[confirmed,setConfirmed]=useState(false);
 const current=useRef(storeId);current.current=storeId;
 useEffect(()=>{let active=true;setState({key:storeId,loading:true,error:'',saved:false});setContacts(empty());setPoints([]);setMapping({});setSaving(false);setLoaded(false);setConfirmed(false);
  if(demo){setState({key:storeId,loading:false,error:'Este cadastro exige uma loja conectada. A demonstração não grava contatos.',saved:false});return;}
  void receiptContactsApi.load(storeId).then(({contacts:list,links,points:locations})=>{if(!active)return;setContacts(empty().map(contact=>list.find(value=>value.slot===contact.slot)||contact));setMapping(Object.fromEntries(links.map(point=>[point.pickup_location_id,String(point.contact_slot)])));setPoints(locations);setLoaded(true);setState({key:storeId,loading:false,error:'',saved:false});}).catch((error:unknown)=>{if(active)setState({key:storeId,loading:false,error:receiptContactLoadError(error),saved:false});});return()=>{active=false;};
 },[storeId,demo,attempt]);
 const visible=state.key===storeId;
 async function save(){
  if(!loaded||saving)return;
  const id=storeId;const values=contacts.filter(contact=>contact.name.trim()||contact.phone.trim()).map(contact=>({...contact,name:contact.name.trim(),phone:contact.phone.replace(/\D/g,'')}));
  if(values.some(contact=>!contact.name||contact.name.length>60||!/^[1-9][0-9]{9,14}$/.test(contact.phone))){setState(currentState=>({...currentState,error:'Preencha o nome e o telefone com código do país de cada contato utilizado.',saved:false}));return;}
  const links=points.flatMap(point=>values.some(contact=>String(contact.slot)===mapping[point.id])?[{pickup_location_id:point.id,contact_slot:Number(mapping[point.id])}]:[]);
  if((values.length||links.length)&&!confirmed){setState(currentState=>({...currentState,error:'Confira os números e confirme os destinos antes de salvar.',saved:false}));return;}
  setSaving(true);setState(currentState=>({...currentState,error:'',saved:false}));
  try{await receiptContactsApi.save(id,values,links);if(current.current===id)setState(currentState=>({...currentState,saved:true}));}catch{if(current.current===id)setState(currentState=>({...currentState,error:'Não foi possível salvar os destinos. Seu rascunho foi mantido; tente novamente.',saved:false}));}finally{if(current.current===id)setSaving(false);}
 }
 return <section id="comprovantes" className="admin-card receipt-settings" aria-labelledby="receipt-settings-title">
  <h2 id="receipt-settings-title">Destinos dos comprovantes</h2>
  <p>Configure o WhatsApp da loja e os contatos dos pontos. A loja deve conferir o recebimento e confirmar o pagamento; abrir o WhatsApp não altera o pagamento nem conclui a retirada.</p>
  {(!visible||state.loading)?<p role="status">Carregando contatos…</p>:<>{state.error&&<p role="alert">{state.error}</p>}{!demo&&<>
   {points.map(point=><div key={point.id}><PointContactsEditor storeId={storeId} pointId={point.id} pointName={point.name}/></div>)}
   <p>O link geral usa o WhatsApp da loja. Sem ele, o cliente escolhe um dos pontos com destino cadastrado. Um pedido originado em um ponto usa o contato desse ponto; se não houver, usa o WhatsApp da loja.</p>
   <label className="receipt-settings-confirm"><input type="checkbox" checked={confirmed} disabled={saving||!loaded} onChange={event=>{setConfirmed(event.target.checked);setState(currentState=>({...currentState,saved:false}));}}/><span>Conferi os destinos de comprovantes cadastrados.</span></label>
   <button type="button" className="primary-button" disabled={saving||!loaded} onClick={()=>void save()}>{saving?'Salvando destinos…':'Salvar destinos dos comprovantes'}</button>
   {state.saved&&<p role="status">Destinos dos comprovantes salvos.</p>}
   <button type="button" className="text-button" disabled={saving} onClick={()=>setAttempt(value=>value+1)}>Recarregar contatos</button>
  </>}</>}
 </section>;
}
