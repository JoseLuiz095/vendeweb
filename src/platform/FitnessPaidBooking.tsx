import { useState } from 'react';
import { fitnessApi, type FitnessSlot } from '../services/fitnessApi';
import { fitnessOffersApi, type FitnessOfferOrder } from '../services/fitnessOffersApi';

export const fulfillmentLabels:Record<string,string>={awaiting_payment:'Aguardando pagamento',booking_pending:'Escolha seu horário',scheduled:'Agendado',in_service:'Em atendimento',review_pending:'Aguardando revisão profissional',delivered:'Conteúdo liberado',cancelled:'Cancelado',refunded:'Reembolsado'};
const dateTime=(date:string)=>new Date(date).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'full',timeStyle:'short'});
export function FitnessPaidBooking({store,token,order,onChange}:{store:string;token:string;order:FitnessOfferOrder;onChange:()=>Promise<void>}) {
  const [slots,setSlots]=useState<FitnessSlot[]>([]),[starts,setStarts]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[searched,setSearched]=useState(false);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const [from,setFrom]=useState(today);
  const contract=order.snapshot;
  const open=order.state==='paid'&&order.fulfillment_state==='booking_pending';
  const appointment=order.appointment;
  const run=async(fn:()=>Promise<unknown>)=>{if(busy)return;setBusy(true);setError('');try{await fn();await onChange();}catch(cause){setError((cause as Error).message);}finally{setBusy(false);}};
  const load=async()=>{if(!contract?.service_id)return;await run(async()=>{const result=await fitnessApi.listSlots(store,contract.service_id!,from,14);setSlots(result.slots.filter(slot=>slot.professional_id===contract.professional_user_id&&new Date(slot.starts_at).getTime()>=Date.now()+(contract.lead_minutes??60)*60000));setSearched(true);});};
  return <div className="fitness-paid-booking">
    {order.fulfillment_state&&<strong>{fulfillmentLabels[order.fulfillment_state]}</strong>}
    {contract?.professional&&<p>{contract.professional.name} · {contract.professional.council} {contract.professional.registration}</p>}
    {contract?.location_label&&<p><strong>{contract.modality==='online'?'Online':'Local'}:</strong> {contract.location_label}</p>}
    {contract?.arrival_instructions&&<p>{contract.arrival_instructions}</p>}
    {appointment&&<p>{dateTime(appointment.starts_at)} · {appointment.status==='cancelled'?'Cancelado':appointment.status==='completed'?'Concluído':'Confirmado'}</p>}
    {(open||appointment&&['scheduled','confirmed'].includes(appointment.status))&&<>
      <label>Consultar a partir de<input type="date" value={from} min={today} onChange={e=>{setFrom(e.target.value);setSearched(false);setSlots([]);setStarts('');}}/></label>
      <button type="button" className="secondary-button" disabled={busy} onClick={()=>void load()}>{busy?'Consultando…':open?'Escolha seu horário':'Consultar reagendamento'}</button>
      {searched&&!slots.length&&<p role="status">Nenhum horário livre nesse período. Consulte outra data ou a loja.</p>}
      {slots.length>0&&<><label>Horários reais (São Paulo)<select value={starts} onChange={e=>setStarts(e.target.value)}><option value="">Selecione</option>{slots.map(slot=><option key={slot.starts_at} value={slot.starts_at}>{dateTime(slot.starts_at)}</option>)}</select></label>
        <p>Cancelamento: {contract?.terms?.cancel_policy}</p><p>Reagendamento: {contract?.terms?.reschedule_policy}</p>
        <label className="fitness-check"><input type="checkbox" checked={accepted} onChange={e=>setAccepted(e.target.checked)}/><span>Li e aceito estas condições.</span></label>
        <button type="button" className="primary-button" disabled={busy||!starts||!accepted} onClick={()=>void run(()=>appointment?fitnessApi.reschedule(appointment.id,starts,contract!.professional_user_id,token):fitnessOffersApi.book(store,order.id,starts,accepted,token))}>{appointment?'Confirmar reagendamento':'Confirmar horário pago'}</button></>}
    </>}
    {appointment&&['scheduled','confirmed'].includes(appointment.status)&&<button type="button" className="secondary-button" disabled={busy} onClick={()=>{if(window.confirm('Cancelar este horário conforme as condições aceitas? A compra paga será revisada pela loja.'))void run(()=>fitnessApi.cancel(appointment.id,token));}}>Cancelar horário</button>}
    {order.state==='pending'&&<button type="button" className="text-link" disabled={busy} onClick={()=>void run(()=>fitnessOffersApi.cancel(store,order.id,token))}>Cancelar pedido pendente</button>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}
