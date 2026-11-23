import type { RentalReservation } from './types';

export type RentalSituation = 'prepare' | 'in_use' | 'overdue' | 'return_due' | 'returned' | 'cancelled' | 'unrecorded';
export const rentalSituationLabels: Record<RentalSituation, string> = {
  prepare: 'Preparar saída', in_use: 'Em uso', overdue: 'Devolução atrasada', return_due: 'Devolução hoje',
  returned: 'Devolvida', cancelled: 'Cancelada', unrecorded: 'Saída não registrada',
};
export function rentalSituation(r: RentalReservation, now = new Date()): RentalSituation {
  if (r.returned_at) return 'returned';
  // Cancelar o pedido não comprova a devolução física.
  if (r.checked_out_at) {
    if (Date.parse(r.ends_at) < now.getTime()) return 'overdue';
    if (new Date(r.ends_at).toDateString() === now.toDateString()) return 'return_due';
    return 'in_use';
  }
  if (r.status === 'cancelled') return 'cancelled';
  if (r.status === 'returned') return 'unrecorded'; // legado sem evento comprovado
  return Date.parse(r.starts_at) < now.getTime() ? 'unrecorded' : 'prepare';
}
export function rentalInPeriod(r: RentalReservation, starts: number, ends: number, now = Date.now()): boolean {
  const effectiveEnd = r.checked_out_at && !r.returned_at ? Math.max(Date.parse(r.ends_at), now) : Date.parse(r.ends_at);
  return Date.parse(r.starts_at) < ends && effectiveEnd > starts;
}
