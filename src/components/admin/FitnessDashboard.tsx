import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, ClipboardList, Dumbbell, Salad, ShoppingBag, Users } from 'lucide-react';
import { moduleIsActive, type BusinessStatus } from '../../platform/api';
import { fitnessApi, type FitnessAppointment } from '../../services/fitnessApi';
import type { DashboardMetrics } from '../../services/dashboardApi';
import './fitness-dashboard.css';

type Props = { storeId: string; storeName: string; timezone: string; business: BusinessStatus; limited: boolean; metrics: DashboardMetrics | null; metricsLoading: boolean; metricsError: string };
const statuses: Record<string,string> = { scheduled:'Agendado', confirmed:'Confirmado', completed:'Concluído', cancelled:'Cancelado' };

export default function FitnessDashboard({storeId,storeName,timezone,business,limited,metrics,metricsLoading,metricsError}: Props) {
  const hasAgenda = !limited && moduleIsActive(business,'appointments');
  const [agenda,setAgenda] = useState<{store:string; loading:boolean; error:boolean; items:FitnessAppointment[]}>({store:'',loading:true,error:false,items:[]});
  const [retry,setRetry] = useState(0);
  useEffect(()=>{
    let current=true;
    if (!hasAgenda || !storeId) return ()=>{current=false;};
    setAgenda({store:storeId,loading:true,error:false,items:[]});
    void fitnessApi.status(storeId).then(result=>{
      if (!Array.isArray(result.appointments)) throw new Error('Agenda inválida');
      if(current)setAgenda({store:storeId,loading:false,error:false,items:result.appointments});
    }).catch(()=>{if(current)setAgenda({store:storeId,loading:false,error:true,items:[]});});
    return ()=>{current=false;};
  },[storeId,hasAgenda,retry]);
  useEffect(()=>{
    const refresh=()=>{if(!document.hidden)setRetry(v=>v+1);};
    window.addEventListener('focus',refresh);
    return ()=>window.removeEventListener('focus',refresh);
  },[]);
  const upcoming = agenda.store===storeId ? agenda.items.filter(item=>['scheduled','confirmed'].includes(item.status) && Number.isFinite(Date.parse(item.starts_at)) && Date.parse(item.starts_at)>=Date.now()).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at)).slice(0,2) : [];
  const formatDate=(value:string)=>{try{return new Intl.DateTimeFormat('pt-BR',{timeZone:timezone,dateStyle:'short',timeStyle:'short'}).format(new Date(value));}catch{return new Date(value).toLocaleString('pt-BR');}};
  const links=[
    ...(!limited&&moduleIsActive(business,'clients')?[{label:'Alunos',detail:'Cadastros e atendimentos',to:'/admin/operacao?tab=clients',icon:Users}]:[]),
    ...(!limited&&moduleIsActive(business,'training')?[{label:'Fichas de treino',detail:'Modelos e fichas',to:'/admin/fitness#treinos',icon:Dumbbell}]:[]),
    ...(!limited&&moduleIsActive(business,'nutrition')?[{label:'Nutrição',detail:'Planos alimentares',to:'/admin/fitness#nutricao',icon:Salad}]:[]),
    ...(!limited&&moduleIsActive(business,'appointments')?[{label:'Serviços e ofertas',detail:'Gerenciar serviços',to:'/admin/operacao?tab=services',icon:ShoppingBag}]:[{label:'Catálogo',detail:'Produtos e ofertas',to:'/admin/produtos',icon:ShoppingBag}]),
  ];
  return <section className="fitness-home" aria-label="Início Fitness">
    <header><span className="eyebrow">VISÃO GERAL</span><h1>{storeName}</h1><p>Sua rotina em um só lugar.</p></header>
    <div className="fitness-home__overview">
      {!limited&&<section className="admin-card fitness-home__card"><h2><ClipboardList size={21}/>Precisa de atenção</h2><p>Consulte os pedidos e confira os pagamentos informados.</p><Link className="fitness-home__row" to="/admin/pedidos?queue=payment"><span>Pedidos para conferir</span><strong>{metricsLoading?'Consultando…':metricsError||!metrics?'Indisponível':`${metrics.pendingPayments} aguardando`}</strong></Link><Link className="text-link" to="/admin/pedidos">Ver pedidos →</Link></section>}
      {hasAgenda&&<section className="admin-card fitness-home__card"><h2><CalendarDays size={21}/>Próximos atendimentos</h2>{agenda.store!==storeId||agenda.loading?<p role="status">Consultando agenda…</p>:agenda.error?<p role="alert">Não foi possível consultar a agenda. <button className="text-button" type="button" onClick={()=>setRetry(v=>v+1)}>Tentar novamente</button></p>:upcoming.length?<ul className="fitness-home__appointments">{upcoming.map(item=><li key={item.id}><span>{formatDate(item.starts_at)} </span><strong>{statuses[item.status]||item.status}</strong></li>)}</ul>:<p>Nenhum próximo atendimento encontrado.</p>}<Link className="text-link" to="/admin/fitness#agenda-fitness">Ver agenda →</Link></section>}
    </div>
    <section className="admin-card fitness-home__card"><h2>Acessos rápidos</h2><p>Escolha uma área para continuar.</p><div className="fitness-home__links">{links.map(({label,detail,to,icon:Icon})=><Link key={to} to={to}><Icon size={21}/><strong>{label}</strong><span>{detail}</span></Link>)}</div></section>
  </section>;
}
