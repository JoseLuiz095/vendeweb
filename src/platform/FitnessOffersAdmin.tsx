import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { restFetch } from '../lib/supabaseRest';
import { businessApi, type BusinessRecord } from './api';
import { fitnessApi, type FitnessWorkout } from '../services/fitnessApi';
import { fitnessOffersApi, type FitnessOffer, type FitnessOfferInput, type FitnessOfferKind, type FitnessOfferOrder } from '../services/fitnessOffersApi';

const kindLabels: Record<FitnessOfferKind, string> = {
  workout: 'Ficha digital', assessment: 'Avaliação física', combo: 'Avaliação + ficha',
  nutrition_consult: 'Consulta nutricional', nutrition_plan: 'Plano alimentar personalizado',
};
type Staff = { user_id: string; name: string | null; kind: string | null; council: string | null; professional_active: boolean };
const blank: FitnessOfferInput = {
  kind: 'workout', name: '', description: '', price_cents: 0, workout_id: null,
  service_id: null, professional_user_id: '', published: false,
};
const money = (cents: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100);
const cents = (value: string) => Math.round(Number(value.replace(',', '.')) * 100);

export function FitnessOffersAdmin({ store }: { store: string }) {
  const [offers, setOffers] = useState<FitnessOffer[]>([]);
  const [orders, setOrders] = useState<FitnessOfferOrder[]>([]);
  const [workouts, setWorkouts] = useState<FitnessWorkout[]>([]);
  const [services, setServices] = useState<BusinessRecord[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [draft, setDraft] = useState<FitnessOfferInput>(blank);
  const [price, setPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [orderFilter, setOrderFilter] = useState<'pending' | 'all'>('pending');

  const reload = useCallback(async () => {
    const [nextOffers, nextOrders, nextWorkouts, nextServices, nextStaff] = await Promise.all([
      fitnessOffersApi.list(store, true), fitnessOffersApi.adminOrders(store), fitnessApi.listWorkouts(store),
      businessApi.operate(store, 'services.list'),
      restFetch<Staff[]>('rpc/food_service_professional_staff', { method: 'POST', body: { p_store: store } }),
    ]);
    setOffers(nextOffers); setOrders(nextOrders); setWorkouts(nextWorkouts);
    setServices(nextServices.items || []); setStaff(nextStaff.filter(item => item.professional_active));
    setLoaded(true);
  }, [store]);
  useEffect(() => {
    let active = true;
    setOffers([]); setOrders([]); setDraft(blank); setError(''); setLoaded(false);
    void reload().catch(() => { if (active) setError('Não foi possível carregar ofertas e profissionais. Verifique a configuração do serviço e tente novamente.'); });
    return () => { active = false; };
  }, [reload]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (draft.published && !reviewing) {
      setReviewing(true);
      return;
    }
    setBusy(true); setError(''); setNotice('');
    let savedId: string | undefined;
    try {
      const item={...draft,price_cents:cents(price)};
      const result=await fitnessOffersApi.save(store,{...item,published:false});
      savedId=result.id;
      setDraft(current => ({...current, id: result.id, published: false}));
      const original=offers.find(offer=>offer.id===draft.id);
      const fields=['delivery_mode','delivery_terms','location_label','modality','arrival_instructions','lead_minutes'] as const;
      if(!original||fields.some(key=>original[key]!==item[key]))await fitnessOffersApi.delivery(store,result.id,item);
      if(item.published)await fitnessOffersApi.save(store,{...item,id:result.id});
      try { await reload(); } catch { setError('A operação foi concluída, mas a lista não atualizou. Recarregue antes de repetir.'); setReviewing(false); return; }
      setNotice(draft.published ? 'Oferta publicada. Confira a situação na lista de ofertas da loja.' : 'Oferta salva em rascunho.');
      setDraft(blank); setPrice(''); setReviewing(false);
    } catch (cause) {
      setReviewing(false);
      setError(savedId ? `A oferta foi salva como rascunho, mas uma etapa posterior falhou. Confira a lista antes de tentar novamente. ${(cause as Error).message}` : (cause as Error).message);
    }
    finally { setBusy(false); }
  };
  const confirm = async (order: FitnessOfferOrder, action: 'confirm' | 'refund') => {
    if (busy || !window.confirm(action === 'confirm'
      ? 'Você conferiu o crédito no extrato da loja? Confirmar libera o direito desta compra.'
      : 'Confirmar reembolso e revogar o acesso desta compra?')) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await fitnessOffersApi.confirm(store, order.id, action);
      await reload();
      setNotice(action === 'confirm' ? 'Pagamento confirmado e direito do aluno liberado.' : 'Compra reembolsada e acesso revisto.');
    } catch (cause) { setError((cause as Error).message); }
    finally { setBusy(false); }
  };
  const needsWorkout = draft.kind === 'workout' || draft.kind === 'combo';
  const needsService = draft.kind !== 'workout';
  const professionalKind = draft.kind.startsWith('nutrition') ? 'nutrition' : 'training';
  const availableStaff = staff.filter(item => item.kind === professionalKind && item.council === (professionalKind === 'nutrition' ? 'CRN' : 'CREF'));
  const approvedWorkouts = workouts.filter(item => item.status === 'approved' && item.professional?.user_id === draft.professional_user_id);
  const serviceKind = professionalKind;
  const activeServices = services.filter(item => item.active && item.kind === serviceKind && item.professional_user_id === draft.professional_user_id);
  const pendingOrders = orders.filter(order => order.state === 'pending');
  const visibleOrders = orderFilter === 'pending' ? pendingOrders : orders;

  return <section className="business-card fitness-workouts" aria-label="Ofertas e pedidos Fitness">
    <h2>Ofertas e pedidos Fitness</h2>
    <p>Cadastre a oferta que o aluno compra na loja. A ficha deve ser aprovada pelo profissional antes da publicação. O pedido só concede acesso após conferência do Pix no extrato e confirmação com MFA.</p>
    {error && <p role="alert" className="business-message business-message--error">{error}</p>}
    {!loaded && error && <button type="button" className="secondary-button" onClick={() => { setError(''); void reload().catch(() => setError('Não foi possível carregar ofertas e profissionais. Verifique a configuração do serviço e tente novamente.')); }}>Tentar novamente</button>}
    {!loaded && !error && <p role="status" className="business-muted">Carregando ofertas e profissionais…</p>}
    {notice && <p role="status" className="business-message">{notice}</p>}
    {loaded && <><p>Para vender uma ficha: crie e aprove a ficha, escolha o responsável e a ficha aprovada, preencha a oferta e revise antes de publicar. Aprovar não publica nem atribui a ficha.</p><form className="business-form-grid" onSubmit={save} onChange={() => setReviewing(false)}>
      <label>Tipo de oferta<select value={draft.kind} onChange={e => setDraft({ ...blank, kind: e.target.value as FitnessOfferKind })}>{Object.entries(kindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Nome *<input required minLength={3} maxLength={120} value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })}/></label>
      <label>Preço em R$ *<input required inputMode="decimal" type="number" step="0.01" min="0.01" value={price} onChange={e => setPrice(e.target.value)}/></label>
      <label>Responsável *<select required value={draft.professional_user_id} onChange={e => setDraft({ ...draft, professional_user_id: e.target.value, service_id: null, workout_id: null })}><option value="">Selecione</option>{availableStaff.map(item => <option key={item.user_id} value={item.user_id}>{item.name} · {item.council}</option>)}</select></label>
      {availableStaff.length === 0 && <p className="fitness-wide business-message">Nenhum profissional ativo com {professionalKind === 'nutrition' ? 'CRN' : 'CREF'} foi encontrado para esta oferta. Confira o perfil profissional e o cadastro da equipe. <a href="/admin/operacao?tab=services">Gerenciar serviços</a></p>}
      {needsWorkout && draft.professional_user_id && approvedWorkouts.length === 0 && <p className="fitness-wide business-message">Este responsável ainda não possui ficha aprovada. Crie e revise uma ficha antes de continuar. <a href="#treinos">Ir para fichas</a></p>}
      {needsService && draft.professional_user_id && activeServices.length === 0 && <p className="fitness-wide business-message">Nenhum serviço ativo foi encontrado para este responsável. <a href="/admin/operacao?tab=services">Gerenciar serviços</a></p>}
      {needsWorkout && <label>Ficha aprovada *<select required value={draft.workout_id || ''} onChange={e => setDraft({ ...draft, workout_id: e.target.value || null })}><option value="">Selecione</option>{approvedWorkouts.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
      {needsService && <label>Serviço da agenda *<select required value={draft.service_id || ''} onChange={e => setDraft({ ...draft, service_id: e.target.value || null })}><option value="">Selecione</option>{activeServices.map(item => <option key={item.id} value={item.id}>{String(item.name)}</option>)}</select></label>}
      <label className="fitness-wide">Descrição *<textarea required minLength={10} maxLength={2000} rows={3} value={draft.description} onChange={e => setDraft({ ...draft, description: e.target.value })}/></label>
      <p className="fitness-wide business-muted">Campos com * são obrigatórios. O servidor também confere os requisitos de publicação, como módulo, profissional e condições do serviço.</p>
      <label>Entrega<select value={draft.delivery_mode||'ready'} onChange={e=>setDraft({...draft,delivery_mode:e.target.value as 'ready'|'personalized'})}><option value="ready">Ficha pronta aprovada</option><option value="personalized">Revisão individual após compra/atendimento</option></select></label>
      <label>Condições e prazo de entrega<textarea maxLength={2000} value={draft.delivery_terms||''} onChange={e=>setDraft({...draft,delivery_terms:e.target.value})}/></label>
      <details className="fitness-wide"><summary>Detalhes de modalidade, local e agendamento</summary><div className="business-form-grid">
      <label>Modalidade<select value={draft.modality||'onsite'} onChange={e=>setDraft({...draft,modality:e.target.value as 'onsite'|'online'})}><option value="onsite">Presencial</option><option value="online">Online</option></select></label>
      <label>Unidade/endereço ou instrução de acesso online<input maxLength={500} value={draft.location_label||''} onChange={e=>setDraft({...draft,location_label:e.target.value})}/></label>
      <label>Instruções de chegada<textarea maxLength={1000} value={draft.arrival_instructions||''} onChange={e=>setDraft({...draft,arrival_instructions:e.target.value})}/></label>
      <label>Antecedência mínima (minutos)<input type="number" min="0" max="10080" value={draft.lead_minutes??60} onChange={e=>setDraft({...draft,lead_minutes:Number(e.target.value)})}/></label>
      </div></details>
      <label className="fitness-check"><input type="checkbox" checked={draft.published} onChange={e => setDraft({ ...draft, published: e.target.checked })}/><span>Revisar e publicar a oferta. Sem marcar, ela será salva como rascunho.</span></label>
      {reviewing && draft.published && <section className="fitness-wide business-message" aria-live="polite" aria-label="Revisão da oferta"><h3>Revise antes de publicar</h3><p><strong>{draft.name}</strong> · {kindLabels[draft.kind]} · {money(cents(price))}</p><p>Responsável: {availableStaff.find(person => person.user_id === draft.professional_user_id)?.name || 'Não selecionado'}</p>{needsWorkout && <p>Ficha: {approvedWorkouts.find(item => item.id === draft.workout_id)?.title || 'Não selecionada'}</p>}{needsService && <p>Serviço: {String(activeServices.find(item => item.id === draft.service_id)?.name || 'Não selecionado')}</p>}<p>Entrega: {draft.delivery_mode === 'personalized' ? 'Revisão individual após compra/atendimento' : 'Ficha pronta aprovada'}. {draft.delivery_terms || 'Condições de entrega não informadas.'}</p><p>Modalidade: {draft.modality === 'online' ? 'Online' : 'Presencial'} · Local/acesso: {draft.location_label || 'Não informado'} · Antecedência: {draft.lead_minutes ?? 60} minutos</p><p>Chegada: {draft.arrival_instructions || 'Não informada'}</p><p>{draft.description}</p><p>Confira os dados. O servidor verificará se a oferta pode ser publicada.</p><button type="button" className="secondary-button" onClick={() => setReviewing(false)}>Voltar à edição</button></section>}
      <div className="business-actions"><button className="primary-button" disabled={busy}>{busy ? 'Salvando…' : draft.published ? reviewing ? 'Confirmar publicação' : 'Revisar oferta' : draft.id ? 'Salvar alterações' : 'Salvar rascunho'}</button>{draft.id && <button type="button" className="secondary-button" onClick={() => { setDraft(blank); setPrice(''); setReviewing(false); }}>Cancelar edição</button>}</div>
    </form>
    <h3>Ofertas da loja</h3>
    {offers.length === 0 ? <p className="business-muted">Nenhuma oferta cadastrada.</p> : <div className="fitness-workout-list">{offers.map(item => <article className="fitness-workout-card" key={item.id}>
      <div className="business-card-heading"><h4>{item.name}</h4><span className="business-badge">{item.published ? 'Publicada' : 'Rascunho'}</span></div>
      <p>{kindLabels[item.kind]} · {money(item.price_cents)} · {item.professional_name}</p>
      <button type="button" className="secondary-button" onClick={() => { setDraft({ ...item }); setPrice(String(item.price_cents / 100)); setReviewing(false); }}>Editar</button>
    </article>)}</div>}
    <div className="business-card-heading"><h3>Pagamentos a conferir</h3><span className="business-badge">{pendingOrders.length} pendente{pendingOrders.length === 1 ? '' : 's'}</span></div>
    <p>A conferência exige crédito identificado no extrato e sessão Admin com MFA. O envio de comprovante pelo aluno não confirma pagamento.</p>
    <div className="fitness-catalog-filters" role="group" aria-label="Filtrar pedidos"><button type="button" aria-pressed={orderFilter === 'pending'} onClick={() => setOrderFilter('pending')}>Pendentes ({pendingOrders.length})</button><button type="button" aria-pressed={orderFilter === 'all'} onClick={() => setOrderFilter('all')}>Todos ({orders.length})</button></div>
    {visibleOrders.length === 0 ? <p className="business-muted">{orderFilter === 'pending' ? 'Nenhum pagamento aguardando conferência.' : 'Nenhum pedido recebido.'}</p> : <div className="fitness-workout-list">{visibleOrders.map(order => <article className="fitness-workout-card" key={order.id}>
      <div className="business-card-heading"><h4>{order.offer_name}</h4><span className="business-badge">{order.state}</span></div>
      <p>{order.student_name} · {money(order.price_cents)} · Ref. {order.id}</p>
      {order.state === 'pending' && <button className="primary-button" disabled={busy} onClick={() => void confirm(order, 'confirm')}>Conferi o Pix: liberar acesso</button>}
      {order.state === 'paid' && <button className="secondary-button" disabled={busy} onClick={() => void confirm(order, 'refund')}>Registrar reembolso e revogar</button>}
    </article>)}</div>}</>}
  </section>;
}
