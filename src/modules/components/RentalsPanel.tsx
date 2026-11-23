import { InfoHint } from '../../components/ui/InfoHint';
import { useEffect, useRef, useState } from 'react';
import { moduleMoney } from '../calculator';
import { modulesApi } from '../api';
import { rentalInPeriod, rentalSituation, rentalSituationLabels } from '../rentals';
import type { RentalSituation } from '../rentals';
import type { Offer, RentalAsset, RentalAvailability, RentalEvent, RentalReservation } from '../types';
import type { ModuleCommand } from './OffersPanel';

const date = (value: string) => new Date(value).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
const templates = { assembly_checklist: ['Local e piso verificados', 'Equipamento fixado', 'Energia e proteção verificadas', 'Responsável orientado'], return_checklist: ['Equipamento desligado', 'Inspeção de danos', 'Limpeza e secagem', 'Retirada confirmada'] };
const actionLabels: Record<string, string> = { checked_out: 'Saída registrada', returned: 'Devolução registrada', status_changed: 'Situação alterada', reservation_updated: 'Dados e checklists atualizados', maintenance_started: 'Manutenção iniciada', maintenance_finished: 'Manutenção concluída', maintenance_notes: 'Observações de manutenção', followup: 'Acompanhamento registrado' };

function History({ storeId, offerId }: { storeId: string; offerId: string }) {
  const [rows, setRows] = useState<RentalEvent[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [more, setMore] = useState(false);
  const load = async (before?: number) => {
    setLoading(true); setError('');
    try { const value = await modulesApi.rentalHistory(storeId, offerId, before); setRows(current => before ? [...current, ...value] : value); setMore(value.length === 50); }
    catch (e) { setError((e as Error).message); } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [storeId, offerId]);
  return <section aria-label="Histórico do equipamento"><h4>Histórico do equipamento</h4>
    {error && <p role="alert">{error}<button type="button" className="button" onClick={() => void load()}>Tentar novamente</button></p>}
    <ol className="rental-history">{rows.map(event => <li key={event.id}>
      <strong>{actionLabels[event.action] || event.action}</strong> · {date(event.occurred_at)}
      <p>Responsável: {event.actor_id || 'Rotina do sistema'}{event.reservation_id ? ` · Reserva ${event.reservation_id.slice(0, 8)}` : ''}</p>
      {event.details.notes && <p>{event.details.notes}</p>}
      {event.action === 'reservation_updated' && event.details.before?.deposit_cents !== event.details.after?.deposit_cents && <p>Sinal manual: {moduleMoney(Number(event.details.before?.deposit_cents || 0))} → {moduleMoney(Number(event.details.after?.deposit_cents || 0))}</p>}
      {typeof event.details.after?.return_notes === 'string' && event.action === 'returned' && <p>{event.details.after.return_notes}</p>}
      {typeof event.details.after?.notes === 'string' && event.details.after.notes && <p>{event.details.after.notes}</p>}
    </li>)}</ol>
    {loading && <p role="status">Carregando histórico...</p>}{!loading && !error && !rows.length && <p>Sem eventos registrados desde a implantação deste histórico.</p>}
    {more && <button className="button" type="button" disabled={loading} onClick={() => void load(rows.at(-1)?.id)}>Carregar eventos anteriores</button>}
  </section>;
}

function ReservationForm({ reservation: r, command, busy, storeId, onOrder }: { reservation: RentalReservation; command: ModuleCommand; busy: boolean; storeId: string; onOrder: () => void }) {
  const [form, setForm] = useState(r);
  const [method, setMethod] = useState('pickup');
  const [notes, setNotes] = useState('');
  const [maintenance, setMaintenance] = useState(false);
  const [followup, setFollowup] = useState('');
  const [event, setEvent] = useState<'checkout' | 'return' | ''>('');
  const [history, setHistory] = useState(false);
  const situation = rentalSituation(r);
  return <div className="rental-detail">
    <div className="rental-values"><p>Preço reservado: <strong>{r.total_cents == null ? 'Consulte o pedido' : moduleMoney(r.total_cents)}</strong></p>
      <p>Sinal manual: <strong>{moduleMoney(r.deposit_cents)}</strong></p>
      <p>{r.billing_status === 'paid' ? 'Pedido consta pago. Confira a composição em Pedidos e valores.' : r.total_cents == null ? 'Saldo: consulte o pedido.' : `Saldo estimado após sinal: ${moduleMoney(Math.max(0, r.total_cents - r.deposit_cents))}`}</p>
      {r.total_cents != null && r.deposit_cents > r.total_cents && <p role="status">Sinal superior ao preço reservado: confira os valores registrados.</p>}
      <p>Cobrança: {({ paid: 'pedido pago', draft: 'em revisão', payment_pending: 'aguardando conferência', cancelled: 'pedido cancelado' } as Record<string, string>)[r.billing_status || ''] || 'consulte a loja vendedora'}.</p>
      <p className="module-caption">O sinal não é caução nem validação bancária automática. Confira os recebimentos antes de cobrar o saldo; o sistema de cobrança mantém os valores existentes.</p>
      <button type="button" className="button" onClick={onOrder}>Abrir pedidos e valores · FW-E{r.order_code || '—'}</button>
    </div>
    {r.checked_out_at && <p>Saída: {date(r.checked_out_at)} · {r.handover_method === 'delivery' ? 'Entrega' : 'Retirada'} · Responsável: {r.checked_out_by || 'não informado'}</p>}
    {r.returned_at && <p>Devolução: {date(r.returned_at)} · Responsável: {r.returned_by || 'não informado'}<br />{r.return_notes}</p>}
    {r.status === 'cancelled' && r.checked_out_at && !r.returned_at && <p className="module-message module-error">Pedido cancelado com equipamento fora da loja. A devolução continua pendente.</p>}
    {r.status === 'returned' && !r.returned_at && <p>Registro anterior sem data de devolução comprovada. Consulte o histórico antes de operar.</p>}
    <form onSubmit={e => { e.preventDefault(); void command('rental_update', { id: r.id, deposit_cents: form.deposit_cents, deposit_reference: form.deposit_reference, contract: form.contract, assembly_checklist: form.assembly_checklist, return_checklist: form.return_checklist }); }}>
      <fieldset disabled={busy}><legend>Dados da reserva e checklists</legend>
        <div className="module-grid"><label>Sinal recebido manualmente (R$)<input type="number" min="0" step="0.01" required value={form.deposit_cents / 100} onChange={e => setForm({ ...form, deposit_cents: Math.round(Number(e.target.value) * 100) })} /></label>
          <label>Referência do sinal<input value={form.deposit_reference || ''} maxLength={200} required={form.deposit_cents > 0} onChange={e => setForm({ ...form, deposit_reference: e.target.value })} /></label></div>
        <details><summary>Contrato e condições</summary><label>Condições registradas<textarea value={form.contract} maxLength={20000} onChange={e => setForm({ ...form, contract: e.target.value })} /></label></details>
        <div className="module-grid">{(['assembly_checklist', 'return_checklist'] as const).map(key => <fieldset key={key}><legend>{key === 'assembly_checklist' ? 'Checklist de montagem / saída' : 'Checklist de devolução / retirada'}</legend>
          {(form[key].length ? form[key] : templates[key].map(label => ({ label, checked: false }))).map((c, i, checklist) => <label key={`${i}:${c.label}`} className="module-check"><input type="checkbox" checked={c.checked} onChange={e => setForm({ ...form, [key]: checklist.map((entry, index) => index === i ? { ...entry, checked: e.target.checked } : entry) })} />{c.label}</label>)}
        </fieldset>)}</div>
        <p className="module-caption">Marcar o checklist não confirma saída ou devolução. Use a ação correspondente para registrar o evento real.</p>
        <button className="button" disabled={busy}>Salvar dados e checklists</button>
      </fieldset>
    </form>
    <div className="module-actions">
      {!r.checked_out_at && r.status === 'reserved' && <button className="button button-primary" disabled={busy} onClick={() => setEvent(event === 'checkout' ? '' : 'checkout')}>Registrar retirada ou entrega</button>}
      {r.checked_out_at && !r.returned_at && <button className="button button-primary" disabled={busy} onClick={() => setEvent(event === 'return' ? '' : 'return')}>Registrar devolução</button>}
    </div>
    {event && <form className="module-card" onSubmit={e => { e.preventDefault(); void command(event === 'checkout' ? 'rental_checkout' : 'rental_return', { id: r.id, method, notes, maintenance, [event === 'checkout' ? 'assembly_checklist' : 'return_checklist']: form[event === 'checkout' ? 'assembly_checklist' : 'return_checklist'] }).then(ok => { if (ok) setEvent(''); }); }}>
      <h4>{event === 'checkout' ? 'Confirmar saída realizada' : 'Confirmar devolução realizada'}</h4>
      {event === 'checkout' ? <label>Forma da saída<select value={method} onChange={e => setMethod(e.target.value)}><option value="pickup">Cliente retirou</option><option value="delivery">Loja entregou</option></select></label> : <><label>Condições observadas na devolução<textarea required maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></label><label className="module-check"><input type="checkbox" checked={maintenance} onChange={e => setMaintenance(e.target.checked)} />Encaminhar equipamento para manutenção</label></>}
      <p>Data e responsável serão registrados agora, junto com este checklist. Preço e sinal são preservados.</p>
      <button className="button button-primary" disabled={busy}>Confirmar {event === 'checkout' ? 'saída' : 'devolução'}</button>
    </form>}
    {['overdue', 'unrecorded', 'return_due'].includes(situation) && <form className="module-card" onSubmit={e => { e.preventDefault(); void command('rental_followup', { id: r.id, notes: followup }).then(ok => { if (ok) setFollowup(''); }); }}>
      <h4>Acompanhar pendência</h4><label>Observação do acompanhamento<textarea required maxLength={2000} value={followup} onChange={e => setFollowup(e.target.value)} /></label><p>Nenhuma mensagem será enviada. Registre o contato ou a providência tomada.</p><button className="button" disabled={busy}>Registrar acompanhamento</button>
    </form>}
    <button type="button" className="button" aria-expanded={history} onClick={() => setHistory(!history)}>Histórico do equipamento</button>
    {history && <History storeId={storeId} offerId={r.offer_id} />}
  </div>;
}

function AssetForm({ asset: a, name, storeId, command, busy }: { asset: RentalAsset; name: string; storeId: string; command: ModuleCommand; busy: boolean }) {
  const [notes, setNotes] = useState(a.maintenance_notes);
  const [history, setHistory] = useState(false);
  return <details className="rental-asset"><summary>{name} · {a.maintenance ? 'Em manutenção' : 'Fora de manutenção'}</summary>
    <form onSubmit={e => { e.preventDefault(); void command('rental_asset', { offer_id: a.offer_id, maintenance: !a.maintenance, notes }); }}>
      <label>Observações de manutenção<textarea value={notes} maxLength={2000} onChange={e => setNotes(e.target.value)} /></label>
      <p>Concluir manutenção mantém os bloqueios das reservas e os registros de saída.</p><div className="module-actions"><button className="button" disabled={busy}>{a.maintenance ? 'Concluir manutenção' : 'Colocar em manutenção'}</button>
        <button type="button" className="button" disabled={busy} onClick={() => void command('rental_asset', { offer_id: a.offer_id, maintenance: a.maintenance, notes })}>Salvar observações</button></div>
    </form><button className="button" type="button" aria-expanded={history} onClick={() => setHistory(!history)}>Ver histórico</button>{history && <History storeId={storeId} offerId={a.offer_id} />}
  </details>;
}

export default function RentalsPanel({ assets, offers, reservations, command, busy, storeId, refresh, onOrder }: { assets: RentalAsset[]; offers: Offer[]; reservations: RentalReservation[]; command: ModuleCommand; busy: boolean; storeId: string; refresh: () => Promise<void>; onOrder: () => void }) {
  const [search, setSearch] = useState(''); const [equipment, setEquipment] = useState(''); const [situation, setSituation] = useState('');
  const [period, setPeriod] = useState({ starts: '', ends: '' });
  const [availability, setAvailability] = useState<RentalAvailability>();
  const [checking, setChecking] = useState(false); const [error, setError] = useState(''); const [selected, setSelected] = useState('');
  const [now, setNow] = useState(() => new Date());
  const detailRef = useRef<HTMLDivElement>(null);
  const request = useRef(0);
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60000); return () => window.clearInterval(timer); }, []);
  useEffect(() => { request.current++; setAvailability(undefined); }, [assets, reservations]);
  const name = (id: string) => assets.find(a => a.offer_id === id)?.equipment_name || offers.find(o => o.id === id)?.name || reservations.find(r => r.offer_id === id)?.equipment_name || 'Equipamento';
  const validPeriod = !!period.starts && !!period.ends && Date.parse(period.ends) > Date.parse(period.starts);
  const periodError = (!!period.starts || !!period.ends) && !validPeriod;
  const filtered = reservations.filter(r => (!equipment || r.offer_id === equipment) && (!situation || (situation === 'maintenance' ? assets.find(a => a.offer_id === r.offer_id)?.maintenance : situation === 'in_use' ? !!r.checked_out_at && !r.returned_at : rentalSituation(r, now) === situation))
    && (!search || `${name(r.offer_id)} ${r.order_code || ''} ${r.id}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))
    && (!validPeriod || rentalInPeriod(r, Date.parse(period.starts), Date.parse(period.ends), now.getTime())))
    .sort((a, b) => { const rank = (r: RentalReservation) => r.checked_out_at && !r.returned_at ? 0 : r.status === 'reserved' ? 1 : 2; return rank(a) - rank(b) || Date.parse(a.starts_at) - Date.parse(b.starts_at); });
  const current = reservations.find(r => r.id === selected);
  const openReservation = (id: string) => { setSelected(id); window.setTimeout(() => { detailRef.current?.focus(); detailRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); }, 0); };
  const check = async () => {
    const version = ++request.current; setChecking(true); setError(''); setAvailability(undefined);
    try { const result = await modulesApi.rentalAvailability(storeId, new Date(period.starts).toISOString(), new Date(period.ends).toISOString()); if (request.current === version) setAvailability(result); }
    catch (e) { if (request.current === version) setError((e as Error).message); } finally { setChecking(false); }
  };
  const changePeriod = (value: typeof period) => { request.current++; setPeriod(value); setAvailability(undefined); };
  const upcoming = reservations.filter(r => !r.checked_out_at && r.status === 'reserved' && Date.parse(r.starts_at) >= now.getTime() && Date.parse(r.starts_at) < now.getTime() + 7 * 86400000).length;
  return <section className="module-card rental-workspace"><header className="module-row"><div><h2>Operação de aluguel</h2><p>Prepare as próximas saídas e acompanhe cada devolução.</p></div><button type="button" className="button" disabled={busy || checking} onClick={() => { setError(''); void refresh().catch(e => setError((e as Error).message)); }}>Atualizar operação</button></header>
    <InfoHint label="Sobre a operação de aluguel">Cada oferta representa um equipamento físico. Só um registro de saída ou devolução altera sua situação operacional. Reservas usam os períodos existentes, sem intervalos extras de limpeza ou montagem.</InfoHint>
    <div className="rental-summary" aria-label="Resumo atual de toda a operação">
      <div><strong>{upcoming}</strong><span>Saídas nos próximos 7 dias</span></div><div><strong>{reservations.filter(r => ['in_use', 'return_due', 'overdue'].includes(rentalSituation(r, now))).length}</strong><span>Equipamentos em uso</span></div>
      <div><strong>{reservations.filter(r => rentalSituation(r, now) === 'overdue').length}</strong><span>Devoluções atrasadas</span></div><div><strong>{assets.filter(a => a.maintenance).length}</strong><span>Em manutenção</span></div>
    </div>
    <div className="module-grid"><label>Buscar equipamento ou reserva<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
      <label>Equipamento<select value={equipment} onChange={e => setEquipment(e.target.value)}><option value="">Todos os equipamentos</option>{assets.map(a => <option key={a.offer_id} value={a.offer_id}>{name(a.offer_id)}</option>)}</select></label>
      <label>Situação operacional<select value={situation} onChange={e => setSituation(e.target.value)}><option value="">Todas as situações</option><option value="maintenance">Equipamento em manutenção</option>{Object.entries(rentalSituationLabels).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    </div>
    <form className="rental-period" onSubmit={e => { e.preventDefault(); void check(); }}><h3>Consultar disponibilidade por período</h3><div className="module-grid"><label>Início do período<input type="datetime-local" required value={period.starts} onChange={e => changePeriod({ ...period, starts: e.target.value })} /></label><label>Término do período<input type="datetime-local" required value={period.ends} onChange={e => changePeriod({ ...period, ends: e.target.value })} /></label></div>
      {periodError && <p role="status">Preencha início e término, com o término após o início.</p>}
      <div className="module-actions"><button className="button" disabled={!validPeriod || checking || busy}>{checking ? 'Consultando...' : 'Consultar no servidor'}</button><button className="button" type="button" onClick={() => { changePeriod({ starts: '', ends: '' }); setSituation(''); setEquipment(''); setSearch(''); }}>Limpar filtros</button></div>
    </form>
    {error && <p className="module-message module-error" role="alert">{error}</p>}
    {availability && <section aria-label="Disponibilidade consultada"><h3>Disponibilidade de {date(period.starts)} até {date(period.ends)}</h3><p>Consulta em {date(availability.checked_at)}. A reserva será validada novamente ao salvar.</p>
      {availability.assets.filter(a => (!equipment || a.offer_id === equipment) && (!search || a.equipment_name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')))).map(a => <article className="module-row" key={a.offer_id}><div><strong>{a.equipment_name}</strong><p>{a.status === 'maintenance' ? 'Em manutenção' : a.status === 'reserved' ? 'Indisponível no período' : 'Disponível no período'}{a.in_use ? ' · Em uso agora: devolução ainda não registrada' : ''}</p></div><div className="module-actions">{a.reservation_ids.map(id => <button key={id} className="button" type="button" onClick={() => openReservation(id)}>Abrir reserva {id.slice(0, 8)}</button>)}</div></article>)}
      {!availability.assets.length && <p>Nenhum equipamento ativo cadastrado.</p>}
    </section>}
    <h3>Reservas e pendências <span className="module-caption">({filtered.length})</span></h3>
    {!filtered.length && <p>Nenhuma reserva para estes filtros. Reservas começam pelo catálogo da loja.</p>}
    <div className="rental-reservations">{filtered.map(r => { const state: RentalSituation = rentalSituation(r, now); return <article key={r.id} className={`rental-reservation ${state === 'overdue' ? 'rental-overdue' : ''}`}>
      <div><span className="rental-status">{rentalSituationLabels[state]}</span><h4>{name(r.offer_id)}</h4><p>Início: {date(r.starts_at)}<br />Término: {date(r.ends_at)}</p><p>Pedido FW-E{r.order_code || '—'} · Reserva {r.id.slice(0, 8)}</p></div>
      <button type="button" className="button" aria-expanded={selected === r.id} aria-controls="rental-reservation-detail" onClick={() => openReservation(r.id)}>Abrir reserva</button>
    </article>; })}</div>
    {current && <div id="rental-reservation-detail" className="module-card" ref={detailRef} tabIndex={-1}><div className="module-row"><div><h3>{name(current.offer_id)} · Reserva {current.id.slice(0, 8)}</h3><p>{date(current.starts_at)} até {date(current.ends_at)} · {rentalSituationLabels[rentalSituation(current, now)]}</p></div><button type="button" className="button" onClick={() => setSelected('')}>Fechar detalhes</button></div>
      <ReservationForm key={JSON.stringify(current)} reservation={current} command={command} busy={busy} storeId={storeId} onOrder={onOrder} />
    </div>}
    <details className="rental-maintenance"><summary>Equipamentos e manutenção ({assets.length})</summary><p>Um cadastro por equipamento físico. Unidades iguais precisam de ofertas separadas.</p>{assets.map(a => <AssetForm key={`${a.offer_id}:${a.maintenance}:${a.maintenance_notes}`} asset={a} name={name(a.offer_id)} storeId={storeId} command={command} busy={busy} />)}{!assets.length && <p>Cadastre uma oferta de aluguel na aba Catálogo para começar.</p>}</details>
  </section>;
}
