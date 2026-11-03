import { useEffect, useState } from 'react';
import { fitnessApi, type FitnessAppointment } from '../services/fitnessApi';

const dateTime = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'full', timeStyle: 'short', timeZone: 'America/Sao_Paulo',
});
const labels: Record<string, string> = {
  scheduled: 'Agendado', confirmed: 'Confirmado', completed: 'Concluído',
  cancelled: 'Cancelado', pending: 'Aguardando confirmação',
};

export function FitnessStudentAgenda({ store, token }: { store: string; token: string }) {
  const [appointments, setAppointments] = useState<FitnessAppointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setAppointments([]);
    void fitnessApi.myAppointments(store, token).then(result => {
      if (!Array.isArray(result.appointments)) throw new Error('Resposta inválida da agenda.');
      if (active) setAppointments(result.appointments);
    }).catch(cause => { if (active) setError((cause as Error).message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [store, token, retry]);
  return <section id="fitness-portal-agenda" className="business-card" aria-labelledby="fitness-portal-agenda-title">
    <h2 id="fitness-portal-agenda-title">Minha agenda</h2>
    {loading ? <p role="status">Consultando seus atendimentos…</p>
      : error ? <div role="alert">Não foi possível consultar a agenda: {error} <button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>Tentar novamente</button></div>
      : appointments.length ? <ul className="fitness-records">{appointments.map(item => <li key={item.id}>
        <strong>{dateTime.format(new Date(item.starts_at))}</strong>
        <span>{labels[item.status] || item.status} · Horário de Brasília</span>
        <small>Confirme local, modalidade e instruções diretamente com o profissional se ainda não aparecerem na reserva.</small>
      </li>)}</ul> : <p>Nenhum atendimento aparece para esta conta. Horários de uma oferta paga só serão exibidos após escolha e confirmação no servidor.</p>}
  </section>;
}
