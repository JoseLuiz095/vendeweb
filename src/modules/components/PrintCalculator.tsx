import { InfoHint } from '../../components/ui/InfoHint';
import { useMemo, useState } from 'react';
import { calculatePrintPrice, defaultPrintCosts, moduleMoney, printProfit } from '../calculator';
import type { PrintCosts } from '../types';

const fields: { key: keyof PrintCosts; label: string; factor?: number }[] = [
  { key: 'grams', label: 'Filamento (g)' }, { key: 'cents_per_gram', label: 'Preço por grama (R$)', factor: 100 },
  { key: 'watts', label: 'Potência (W)' }, { key: 'energy_cents_kwh', label: 'Energia (R$/kWh)', factor: 100 },
  { key: 'hours', label: 'Tempo de máquina (h)' }, { key: 'machine_cents_hour', label: 'Máquina (R$/h)', factor: 100 },
  { key: 'labor_cents', label: 'Mão de obra por unidade (R$)', factor: 100 }, { key: 'finishing_cents', label: 'Acabamento (R$)', factor: 100 },
  { key: 'loss_bps', label: 'Risco adicional de perdas (%)', factor: 100 },
  { key: 'packaging_cents', label: 'Embalagem por unidade (R$)', factor: 100 }, { key: 'other_cents', label: 'Outros custos por unidade (R$)', factor: 100 },
  { key: 'fixed_fee_cents', label: 'Taxa fixa alocada por unidade (R$)', factor: 100 },
  { key: 'payment_fee_bps', label: 'Taxa do pagamento (%)', factor: 100 }, { key: 'tax_bps', label: 'Impostos sobre venda (%)', factor: 100 },
  { key: 'margin_bps', label: 'Margem sobre venda (%)', factor: 100 },
];

const extraFields = new Set(['loss_bps','packaging_cents','other_cents','fixed_fee_cents','payment_fee_bps','tax_bps']);
export default function PrintCalculator({ urgencyBps, onApply, initialCosts, onSaveDefaults, extended=false }: { urgencyBps: number; initialCosts?: PrintCosts; extended?:boolean; onSaveDefaults?: (costs: PrintCosts) => Promise<boolean>; onApply: (costs: PrintCosts, finalCents: number, urgent: boolean) => void }) {
  const [costs, setCosts] = useState({...defaultPrintCosts,...initialCosts});
  const [saved,setSaved]=useState('');
  const [saving,setSaving]=useState(false);
  const [urgent, setUrgent] = useState(false);
  const [final, setFinal] = useState('');
  const result = useMemo(() => {
    try { return { price: calculatePrintPrice(costs, urgent ? urgencyBps : 0), error: '' }; }
    catch (error) { return { price: null, error: (error as Error).message }; }
  }, [costs, urgent, urgencyBps]);
  return <section className="module-card"><h2>Calculadora de impressão 3D</h2><InfoHint label="Sobre Calculadora de impressão 3D">Custos por unidade. Margem sobre o preço de venda. A urgência depende de aceite da loja.</InfoHint>
    <p>Estimativa por unidade. Inclua suportes e purga nos gramas. Perdas adicionais incidem sobre filamento, energia e máquina. Rateie custos fixos do pedido pela quantidade. Os valores iniciais são exemplos: confira os custos da sua operação.</p>
    <div className="module-grid">{fields.filter(f=>extended||!extraFields.has(f.key)).map(({ key, label, factor = 1 }) => <label key={key}>{label}<input type="number" min="0" step="0.01" value={(costs[key] ?? 0) / factor}
      onChange={e => setCosts({ ...costs, [key]: Number(e.target.value) * factor })} /></label>)}</div>
    <label className="module-check"><input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} />Urgência ({urgencyBps / 100}%)</label>
    {result.error && <p role="alert">{result.error}</p>}
    {result.price && <><p>Custo: <strong>{moduleMoney(result.price.baseCents)}</strong> · Preço sugerido por unidade: <strong>{moduleMoney(result.price.suggestedCents)}</strong></p><details><summary>Composição do custo e do preço</summary><dl className="print-cost-breakdown">{[['Filamento',result.price.filamentCents],['Energia',result.price.energyCents],['Máquina: depreciação e manutenção',result.price.machineCents],['Perdas adicionais',result.price.lossCents],['Mão de obra',costs.labor_cents],['Acabamento',costs.finishing_cents],['Embalagem',result.price.packagingCents],['Outros',result.price.otherCents],['Taxa fixa alocada',result.price.fixedFeeCents]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{moduleMoney(Number(value))}</dd></div>)}</dl><p>Preço = custo ÷ (1 − margem − taxas − impostos), com adicional de urgência quando escolhido. Margem sobre venda difere de acréscimo sobre custo. Evite incluir energia duas vezes na hora de máquina.</p></details></>}
    <label>Preço final por unidade (R$)<input type="number" min="0" step="0.01" placeholder={result.price ? (result.price.suggestedCents / 100).toFixed(2) : ''} value={final} onChange={e => setFinal(e.target.value)} /></label>
    {result.price && (final === '' || Number.isFinite(Number(final)) && Number(final)>=0) && (()=>{const sale=final===''?result.price.suggestedCents:Math.round(Number(final)*100);const profit=printProfit(costs,sale);return <p aria-label="Resultado estimado">Taxas e impostos estimados: {moduleMoney(profit.feesCents)} · Resultado estimado por unidade: <strong>{moduleMoney(profit.profitCents)}</strong>{profit.marginBps!==null&&` (${(profit.marginBps/100).toLocaleString('pt-BR',{maximumFractionDigits:2})}% da venda)`}. Depende dos custos informados; não comprova lucro real.</p>;})()}
    {onSaveDefaults&&<><button type="button" className="button" disabled={!result.price||saving} onClick={async()=>{setSaving(true);setSaved('');try{if(await onSaveDefaults(costs))setSaved('Padrões salvos nesta loja para os próximos orçamentos.');}finally{setSaving(false);}}}>Salvar padrões de custo da loja</button>{saved&&<p role="status">{saved}</p>}</>}
    <button type="button" className="button button-primary" disabled={!result.price || (final !== '' && (!Number.isFinite(Number(final)) || Number(final) < 0))}
      onClick={() => result.price && onApply(costs, final === '' ? result.price.suggestedCents : Math.round(Number(final) * 100), urgent)}>Usar no orçamento</button>
  </section>;
}
