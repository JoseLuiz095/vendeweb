import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { financeApi } from '../../services/financeApi';
import type { FinancialEntry } from '../../types';
import { currency } from '../../utils/format';

export default function AnalyticsFinanceSummary({ storeId }: { storeId: string }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ storeId: string; entries: FinancialEntry[]; loading: boolean; error: boolean }>({ storeId: '', entries: [], loading: false, error: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!open || !storeId) return;
    let active = true;
    setState({ storeId, entries: [], loading: true, error: false });
    void financeApi.listAllEntries(storeId).then(entries => { if (active) setState({ storeId, entries, loading: false, error: false }); })
      .catch(() => { if (active) setState({ storeId, entries: [], loading: false, error: true }); });
    return () => { active = false; };
  }, [open, storeId, attempt]);
  const entries = state.storeId === storeId ? state.entries : [];
  const total = (direction: 'income' | 'expense', status: 'paid' | 'pending') => entries.filter(e => e.direction === direction && e.status === status).reduce((sum, e) => sum + e.amount, 0);
  return <details className="admin-card admin-secondary-details" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Resumo financeiro</summary>
    {state.storeId !== storeId || state.loading ? <p role="status">Carregando financeiro…</p> : state.error ? <p role="alert">Não foi possível carregar os lançamentos. <button type="button" onClick={() => setAttempt(x => x + 1)}>Tentar novamente</button></p> : <>
      <p>Histórico de lançamentos, independente do período de conversão. “Realizado” corresponde ao status registrado no Financeiro.</p>
      <div className="analytics-commercial-grid"><article className="admin-card analytics-commercial-kpi"><span>Entradas realizadas</span><strong>{currency.format(total('income', 'paid'))}</strong></article><article className="admin-card analytics-commercial-kpi"><span>Saídas realizadas</span><strong>{currency.format(total('expense', 'paid'))}</strong></article><article className="admin-card analytics-commercial-kpi"><span>A receber</span><strong>{currency.format(total('income', 'pending'))}</strong></article></div>
      <p><Link to="/admin/financeiro">Abrir financeiro →</Link></p>
    </>}
  </details>;
}
