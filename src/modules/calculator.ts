import type { PrintCosts } from './types';

/** Valores em centavos; margem sobre venda, antes da taxa de urgência. Por unidade. */
export function calculatePrintPrice(costs: PrintCosts, urgencyBps = 0) {
  for (const value of Object.values(costs)) {
    if (!Number.isFinite(value) || value < 0 || value > 100_000_000) throw new Error('Informe custos válidos e não negativos.');
  }
  if (!Number.isFinite(urgencyBps) || urgencyBps < 0 || urgencyBps > 10_000) throw new Error('Urgência deve ficar entre 0 e 100%.');
  const feesBps = (costs.payment_fee_bps || 0) + (costs.tax_bps || 0);
  if (costs.margin_bps + feesBps >= 10_000) throw new Error('Margem, taxas e impostos devem somar menos de 100%.');
  if ((costs.loss_bps || 0) > 10_000) throw new Error('Perdas devem ficar entre 0 e 100%.');
  const filamentCents = costs.grams * costs.cents_per_gram;
  const energyCents = costs.hours * costs.watts / 1000 * costs.energy_cents_kwh;
  const machineCents = costs.hours * costs.machine_cents_hour;
  const lossCents = (filamentCents + energyCents + machineCents) * (costs.loss_bps || 0) / 10_000;
  const packagingCents=costs.packaging_cents || 0, otherCents=costs.other_cents || 0, fixedFeeCents=costs.fixed_fee_cents || 0;
  const baseCents = Math.round(filamentCents + energyCents + machineCents + lossCents + costs.labor_cents + costs.finishing_cents + packagingCents + otherCents + fixedFeeCents);
  const suggestedCents = Math.round(baseCents * 10_000 / (10_000 - costs.margin_bps - feesBps) * (10_000 + urgencyBps) / 10_000);
  if (!Number.isSafeInteger(suggestedCents)) throw new Error('O preço excede o limite de cálculo.');
  return { filamentCents, energyCents, machineCents, lossCents, packagingCents, otherCents, fixedFeeCents, baseCents, suggestedCents, feesBps };
}

export function printProfit(costs: PrintCosts, saleCents: number) {
  if (!Number.isSafeInteger(saleCents) || saleCents < 0) throw new Error('Preço de venda inválido.');
  const result=calculatePrintPrice(costs), feesCents=Math.round(saleCents*result.feesBps/10_000);
  const profitCents=saleCents-result.baseCents-feesCents;
  return {feesCents,profitCents,marginBps:saleCents ? profitCents/saleCents*10_000 : null};
}

export const defaultPrintCosts: PrintCosts = { grams: 20, cents_per_gram: 12, watts: 200, energy_cents_kwh: 100,
  hours: 2, machine_cents_hour: 200, labor_cents: 500, finishing_cents: 100, margin_bps: 3000 };
export const moduleMoney = (cents: number) => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
