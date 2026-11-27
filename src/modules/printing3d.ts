import { restFetch } from '../lib/supabaseRest';
import { inventoryApi } from '../services/inventoryApi';
import type { InventoryUnit } from '../types';

export type PrintMaterial = { inventory_item_id: string; quantity: number; unit: InventoryUnit; basis: 'piece' | 'batch' };
export type PrintPlan = { materials: PrintMaterial[]; hours: number; time_basis: 'piece' | 'batch'; description?: string; order_id?: string | null };
export type PrintClassification = 'unclassified' | 'catalog' | 'private' | 'custom';
export type PrintSource = { sha256: string; plate: string; filename: string; format: string; printer: string; filaments: import('./printImport').ImportedFilament[]; estimated_hours?: number|null; estimated_grams?: number|null };
export type PrintJob = { id: string; request_id: string | null; order_id: string | null; retry_of: string | null;
  classification?: PrintClassification; product_id?: string | null; source_fingerprint?: string | null; imported_metadata?: PrintSource | null;
  description: string; quantity: number; plan: PrintPlan; status: 'waiting' | 'printing' | 'completed' | 'interrupted';
  revision: number; agreed_total_cents: number | null; quote_snapshot: { base_cents?: number; suggested_cents?: number } | null };
export type PrintActual = { inventory_item_id: string; name?: string; quantity: number; unit: InventoryUnit; origin: 'estimated_confirmed' | 'measured_manual' };
export type PrintRecord = { id: string; job_id: string; revision: number; kind: 'finish' | 'correction'; outcome: 'completed' | 'interrupted';
  pieces: number; hours: number; materials: PrintActual[]; reason: string; created_at: string; material_cost_cents?: number | null };
export type PrintPurchase = { id: string; supplier: string | null; status: 'draft' | 'received' | 'cancelled';
  total_amount: number; print_procurement_stage: 'planned' | 'ordered' };
export type PrintPurchaseItem = { id: string; purchase_id: string; inventory_item_id: string; quantity: number; unit_cost: number };
export type PrintOrder = { id: string; order_number: number; status: string };
export const emptyPrintPlan = (): PrintPlan => ({ hours: 0, time_basis: 'batch', materials: [] });
export const materialTotal = (line: PrintMaterial, quantity: number) => line.quantity * (line.basis === 'piece' ? quantity : 1);
export const hoursTotal = (plan: PrintPlan, quantity: number) => plan.hours * (plan.time_basis === 'piece' ? quantity : 1);
export const convertPrintQuantity = (q: number, from: InventoryUnit, to: InventoryUnit): number | null => {
  if (from === to) return q;
  const factor: Record<string, number> = { 'g:kg': .001, 'kg:g': 1000, 'ml:l': .001, 'l:ml': 1000 };
  return factor[`${from}:${to}`] ? q * factor[`${from}:${to}`] : null;
};
export const printingApi = {
  command: (store: string, action: string, data: unknown, key: string) => restFetch<{ id: string; duplicate?: boolean }>('rpc/food_printing3d_command_v1',
    { method: 'POST', body: { p_store: store, p_action: action, p_data: data, p_key: key } }),
  async load(store: string) {
    const filter = `store_id=eq.${encodeURIComponent(store)}`;
    // Paginação explícita: nenhuma impressão aguardando fica oculta por limite de 200.
    const all = async <T,>(table: string, suffix: string) => {
      const result: T[] = [];
      for (let offset = 0; ; offset += 200) {
        const page = await restFetch<T[]>(`${table}?select=*&${filter}&${suffix}&limit=200&offset=${offset}`);
        result.push(...page); if (page.length < 200) return result;
      }
    };
    const [items, jobs, purchases, orders, products, settings] = await Promise.all([
      inventoryApi.listItems(store), all<PrintJob>('food_print_jobs','order=created_at.desc,id.asc'),
      all<PrintPurchase>('food_inventory_purchases','print_procurement_stage=not.is.null&order=created_at.desc,id.asc'),
      restFetch<PrintOrder[]>(`food_orders?select=id,order_number,status&${filter}&status=neq.cancelled&order=created_at.desc&limit=200`),
      all<{id:string;name:string}>('food_products','order=name.asc,id.asc'),
      restFetch<{print_cost_defaults?:import('./types').PrintCosts|null}[]>(`food_module_settings?select=*&${filter}&limit=1`),
    ]);
    const purchaseItems: PrintPurchaseItem[] = [];
    const pending = purchases.filter(p=>p.status==='draft').map(p=>p.id);
    for (let n=0; n<pending.length; n+=30) purchaseItems.push(...await all<PrintPurchaseItem>('food_inventory_purchase_items',`purchase_id=in.(${pending.slice(n,n+30).join(',')})&order=id.asc`));
    return { items, jobs, purchases, orders, purchaseItems, products, costDefaults: settings[0]?.print_cost_defaults || undefined, workflowAvailable: Boolean(settings[0] && Object.hasOwn(settings[0],'print_cost_defaults')) };
  },
  records: (store: string, job: string) => restFetch<PrintRecord[]>(`food_print_records?select=*&store_id=eq.${encodeURIComponent(store)}&job_id=eq.${encodeURIComponent(job)}&order=revision.desc`),
};
