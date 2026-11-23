import type { InventoryItem, InventoryUnit } from '../../types';
import { hoursTotal, materialTotal, type PrintPlan, type PrintOrder } from '../printing3d';

export function PrintOrderField({ value, onChange, orders }: { value: string; onChange: (value: string) => void; orders: PrintOrder[] }) {
  return <label>Pedido relacionado (opcional)<select value={value} onChange={e => onChange(e.target.value)}><option value="">Sem pedido · produção interna ou protótipo</option>{value && !orders.some(o => o.id === value) && <option value={value}>Pedido vinculado</option>}{orders.map(o => <option key={o.id} value={o.id}>Pedido #{o.order_number}</option>)}</select><small>Pedidos com baixa por ficha técnica não podem ser vinculados.</small></label>;
}

export default function PrintPlanFields({ plan, onChange, quantity, items }: { plan: PrintPlan; onChange: (plan: PrintPlan) => void; quantity: number; items: InventoryItem[] }) {
  const update = (index: number, value: Partial<PrintPlan['materials'][number]>) => onChange({ ...plan, materials: plan.materials.map((l, n) => n === index ? { ...l, ...value } : l) });
  return <fieldset className="print-plan"><legend>Previsão de produção</legend><p>Não movimenta o estoque. Cada trabalho representa um lote / tentativa de impressão.</p>
    {plan.materials.map((line, n) => <div className="print-material" key={n}><div className="module-grid">
      <label>Material {n + 1}<select value={line.inventory_item_id} onChange={e => update(n, { inventory_item_id: e.target.value })}><option value="">Associar insumo depois</option>{items.map(i => <option key={i.id} value={i.id}>{i.name} · saldo estimado {i.currentQuantity} {i.unit}</option>)}</select></label>
      <label>Quantidade prevista<input required type="number" min="0" step="any" value={line.quantity} onChange={e => update(n, { quantity: Number(e.target.value) })}/></label>
      <label>Unidade<select value={line.unit} onChange={e => update(n, { unit: e.target.value as InventoryUnit })}>{['g','kg','ml','l','un','pack'].map(u => <option key={u}>{u}</option>)}</select></label>
      <label>Base do material<select value={line.basis} onChange={e => update(n, { basis: e.target.value as 'piece' | 'batch' })}><option value="piece">Por peça</option><option value="batch">Lote inteiro</option></select></label>
    </div><div className="module-row"><strong>Total previsto: {materialTotal(line, quantity).toLocaleString('pt-BR')} {line.unit} para {quantity} peças</strong><button type="button" className="button" onClick={() => onChange({ ...plan, materials: plan.materials.filter((_, i) => i !== n) })}>Remover material {n + 1}</button></div></div>)}
    <button type="button" className="button" disabled={plan.materials.length >= 30} onClick={() => onChange({ ...plan, materials: [...plan.materials, { inventory_item_id: '', quantity: 0, unit: 'g', basis: 'piece' }] })}>Adicionar material</button>
    <div className="module-grid"><label>Tempo previsto (h)<input required type="number" min="0" max="1000000" step="any" value={plan.hours} onChange={e => onChange({ ...plan, hours: Number(e.target.value) })}/></label><label>Base do tempo<select value={plan.time_basis} onChange={e => onChange({ ...plan, time_basis: e.target.value as 'piece' | 'batch' })}><option value="piece">Por peça</option><option value="batch">Lote inteiro</option></select></label></div>
    <p>Tempo total previsto: <strong>{hoursTotal(plan, quantity).toLocaleString('pt-BR')} h</strong>. Não há leitura automática de impressora ou balança. Massa e volume não são intercambiáveis.</p>
  </fieldset>;
}
