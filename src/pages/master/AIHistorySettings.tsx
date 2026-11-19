import { useEffect, useState } from 'react';
import { getSupabaseClient } from '../../lib/supabase';

type Stats={retention_days:number;conversations:number;messages:number;expired_conversations:number;storage_bytes:number;recent_text_bytes:number};
const size=(n:number)=>n<1024?`${n} B`:n<1024**2?`${(n/1024).toFixed(1)} KB`:`${(n/1024**2).toFixed(2)} MB`;
export default function AIHistorySettings(){
  const [stats,setStats]=useState<Stats|null>(null),[days,setDays]=useState('30'),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  async function load(next?:number){
    setBusy(true);setError('');setNotice('');
    try{const {data,error:failure}=await getSupabaseClient().rpc('food_ai_history_admin',{p_retention_days:next??null});if(failure||!data||!Number.isFinite(Number(data.retention_days)))throw failure;
      const value=data as Stats;setStats(value);setDays(String(value.retention_days));if(next!==undefined)setNotice('Prazo atualizado. As conversas vencidas serão removidas pela limpeza diária.');
    }catch{setError('Não foi possível carregar ou salvar o controle de histórico. Confira a disponibilidade do recurso e a sessão do Admin Master.');}finally{setBusy(false);}
  }
  useEffect(()=>{void load()},[]);
  const candidate=Number(days),valid=Number.isInteger(candidate)&&candidate>=7&&candidate<=365;
  async function save(){if(!stats||!valid||busy)return;if(candidate<stats.retention_days&&!window.confirm(`Reduzir para ${candidate} dias? Conversas sem atividade há mais tempo poderão ser excluídas na próxima limpeza diária.`))return;await load(candidate);}
  return <><div className="admin-page-title"><div><span className="eyebrow">PLATAFORMA</span><h1>Central de IA</h1><p>Retenção de conversas e armazenamento</p></div></div><section className="admin-card"><h2>Histórico da Central de IA</h2><p>O texto é guardado por loja e usuário. O prazo começa na última mensagem de cada conversa; ao vencer, ela e suas mensagens são excluídas na limpeza diária. Anexos não são armazenados.</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}{stats&&<>
      <div className="form-grid"><label>Guardar conversas por (dias)<input type="number" min={7} max={365} value={days} onChange={event=>setDays(event.target.value)} disabled={busy}/><small>De 7 a 365 dias. Prazo atual: {stats.retention_days} dias.</small></label></div>
      <p><strong>Uso atual:</strong> {size(Number(stats.storage_bytes))} no banco, incluindo tabelas e índices · {stats.conversations} conversas · {stats.messages} mensagens.</p>
      <p><strong>Estimativa para {valid?candidate:'—'} dias:</strong> {valid?size(Math.round(Number(stats.recent_text_bytes)*candidate/30)):'informe um prazo válido'} de texto, calculada pelo volume dos últimos 30 dias. O uso real inclui índices, variações de atividade e backups; isto não é preço nem limite contratado.</p>
      <p>{stats.expired_conversations} conversa(s) já vencida(s) pelo prazo atual aguardam a limpeza.</p>
      <button className="primary-button" type="button" onClick={()=>void save()} disabled={busy||!valid||candidate===stats.retention_days}>Salvar prazo</button>
    </>}{!stats&&!error&&<p role="status">Carregando histórico…</p>}
  </section></>;
}
