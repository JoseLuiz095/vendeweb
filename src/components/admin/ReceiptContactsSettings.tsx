import {receiptPolicyApi,type ReceiptPolicy} from '../../services/receiptPolicyApi';
import {receiptContactLoadError} from '../../utils/receiptContactErrors';
import { useEffect, useRef, useState } from 'react';
import { receiptContactsApi, type ReceiptContact } from '../../services/receiptContactsApi';
import '../receipt-contacts.css';
import {receiptContactsEnabled} from '../../services/receiptContactsApi';
import PointContactsEditor from './PointContactsEditor';
const empty=():ReceiptContact[]=>[1,2].map(slot=>({slot,name:'',phone:''}));
export default function ReceiptContactsSettings({storeId,demo=false}:{storeId:string;demo?:boolean}){
 const [attempt,setAttempt]=useState(0),[state,setState]=useState({key:'',loading:true,error:'',saved:false});
 const [contacts,setContacts]=useState(empty),[points,setPoints]=useState<Array<{id:string;name:string;auto_pickup_on_receipt:boolean;autoPickupSupported:boolean}>>([]),[mapping,setMapping]=useState<Record<string,string>>({}),[saving,setSaving]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const [pickupAutomationSupported,setPickupAutomationSupported]=useState(false);
 const [confirmed,setConfirmed]=useState(false);
 const [policy,setPolicy]=useState<ReceiptPolicy>({supported:false,enabled:false,ready:false});const [autoPaid,setAutoPaid]=useState(false);
 const current=useRef(storeId);current.current=storeId;
 useEffect(()=>{let active=true;setState({key:storeId,loading:true,error:'',saved:false});setContacts(empty());setPoints([]);setMapping({});setSaving(false);setLoaded(false);setConfirmed(false);setAutoPaid(false);setPolicy({supported:false,enabled:false,ready:false});setPickupAutomationSupported(false);
  if(demo){setPickupAutomationSupported(false);setState({key:storeId,loading:false,error:'Este cadastro exige uma loja conectada. A demonstração não grava contatos.',saved:false});return;}
  void receiptContactsApi.load(storeId).then(({contacts:list,links,points:locations,policy:loadedPolicy,autoPickupSupported:supportsAutoPickup})=>{if(!active)return;setPolicy(loadedPolicy);setAutoPaid(loadedPolicy.enabled);setContacts(empty().map(c=>list.find(v=>v.slot===c.slot)||c));setMapping(Object.fromEntries(links.map(p=>[p.pickup_location_id,String(p.contact_slot)])));setPoints(locations);setPickupAutomationSupported(supportsAutoPickup);setLoaded(true);setState({key:storeId,loading:false,error:'',saved:false});}).catch((error:unknown)=>{if(active)setState({key:storeId,loading:false,error:receiptContactLoadError(error),saved:false});});return()=>{active=false;};
 },[storeId,demo,attempt]);
 const visible=state.key===storeId;
 async function save(){
  if(!loaded||saving)return;
  const id=storeId;const values=contacts.filter(c=>c.name.trim()||c.phone.trim()).map(c=>({...c,name:c.name.trim(),phone:c.phone.replace(/\D/g,'')}));
  if(values.some(c=>!c.name||c.name.length>60||!/^[1-9][0-9]{9,14}$/.test(c.phone))){setState(s=>({...s,error:'Preencha o nome e o telefone com código do país de cada contato utilizado.',saved:false}));return;}
  if((values.length||autoPaid)&&!confirmed){setState(s=>({...s,error:'Confira os números e confirme os destinos antes de salvar.',saved:false}));return;}
  if(autoPaid&&!policy.ready){setState(s=>({...s,error:'Aguarde a ativação do aviso de pagamento ou desative essa opção para salvar apenas os contatos.',saved:false}));return;}
  const links=points.flatMap(p=>values.some(c=>String(c.slot)===mapping[p.id])?[{pickup_location_id:p.id,contact_slot:Number(mapping[p.id])}]:[]);
  const autoPickupPointIds=points.filter(p=>p.auto_pickup_on_receipt).map(p=>p.id);
  if(autoPickupPointIds.length&&(!autoPaid||!policy.ready||!pickupAutomationSupported)){setState(s=>({...s,error:'A retirada automática exige o aviso de pagamento habilitado e recursos atualizados pela plataforma.',saved:false}));return;}
  setSaving(true);setState(s=>({...s,error:'',saved:false}));
  try{if(policy.supported&&pickupAutomationSupported)await receiptPolicyApi.save(id,values,links,autoPaid,autoPickupPointIds);else if(policy.supported)await receiptPolicyApi.saveLegacy(id,values,links,autoPaid);else await receiptContactsApi.save(id,values,links);if(current.current===id)setState(s=>({...s,saved:true}));}catch{if(current.current===id)setState(s=>({...s,error:'Não foi possível salvar. Seu rascunho foi mantido; tente novamente.',saved:false}));}finally{if(current.current===id)setSaving(false);}
 }
 return <section id="comprovantes" className="admin-card receipt-settings" aria-labelledby="receipt-settings-title">
  <h2 id="receipt-settings-title">Destinos dos comprovantes</h2>
  <p>Use o WhatsApp da loja acima ou cadastre um destino para cada ponto. Quando a loja não tem número, o cliente escolhe um dos pontos cadastrados. A conferência bancária continua sob responsabilidade da loja.</p>
  {!receiptContactsEnabled&&<p className="receipt-settings-notice" role="status">O envio por contato do ponto aguarda a ativação da plataforma. Os destinos abaixo só passam a valer para o cliente após essa ativação.</p>}
  {(!visible||state.loading)?<p role="status">Carregando contatos…</p>:<>
   {state.error&&<p role="alert">{state.error}</p>}
   {!demo&&<>
    {points.map(point=><div key={point.id}>
     <PointContactsEditor storeId={storeId} pointId={point.id} pointName={point.name}/>
     <fieldset className="receipt-point-policy">
      <legend>{point.name}</legend>
      <label className="receipt-settings-confirm">
       <input type="checkbox" checked={point.auto_pickup_on_receipt} disabled={saving||!loaded||!point.autoPickupSupported||!policy.supported||!policy.ready||!autoPaid} onChange={event=>{setPoints(list=>list.map(item=>item.id===point.id?{...item,auto_pickup_on_receipt:event.target.checked}:item));setState(currentState=>({...currentState,saved:false}));setConfirmed(false);}}/>
       <span>Concluir a retirada e baixar o estoque após a loja confirmar o crédito Pix no banco</span>
      </label>
      <small>Aplica-se a pedido do site para retirada imediata neste ponto, sem agendamento e com reserva válida. A confirmação do cliente não conclui a retirada nem baixa o estoque.</small>
     </fieldset>
    </div>)}
    {points.some(point=>!point.autoPickupSupported)&&<p role="status">A baixa automática por ponto ainda aguarda ativação da plataforma; os contatos podem ser configurados normalmente.</p>}
    <p>O link geral usa o WhatsApp da loja. Sem ele, o cliente escolhe um ponto com destino cadastrado. Um pedido originado em um ponto usa o contato desse ponto; se não houver, usa o WhatsApp da loja.</p>
    <div className="receipt-settings-policy">
     <label className="receipt-settings-confirm">
      <input type="checkbox" checked={autoPaid} disabled={saving||!loaded||!policy.supported||(!policy.ready&&!autoPaid)} onChange={event=>{setAutoPaid(event.target.checked);setConfirmed(false);setState(currentState=>({...currentState,saved:false}));}}/>
      <span>Permitir que o cliente informe que enviou o comprovante</span>
     </label>
     <p>O cliente anexa e envia o comprovante pelo WhatsApp e depois informa o envio nesta página. Isso cria um aviso pendente; não confirma o crédito bancário, não marca o pedido como pago e não conclui a retirada. Um administrador autorizado confere o crédito no banco e confirma com MFA.</p>
     {(!policy.supported||!policy.ready)&&<small>Esta opção aguarda a ativação segura da plataforma.</small>}
    </div>
    <label className="receipt-settings-confirm"><input type="checkbox" checked={confirmed} disabled={saving||!loaded} onChange={event=>setConfirmed(event.target.checked)}/><span>Conferi os destinos de comprovantes dos pontos.</span></label>
    <button type="button" className="primary-button" disabled={saving||!loaded} onClick={()=>void save()}>{saving?'Salvando contatos…':'Salvar regras de comprovantes'}</button>
    {state.saved&&<p role="status">Regras dos comprovantes salvas.</p>}
    <button type="button" className="text-button" disabled={saving} onClick={()=>setAttempt(value=>value+1)}>Recarregar contatos</button>
   </>}
  </>}
 </section>;
}
