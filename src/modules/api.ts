import { restFetch } from '../lib/supabaseRest';
import { getSupabaseClient } from '../lib/supabase';
import { appConfig } from '../lib/config';
import { disabledModules } from './types';
import type { ModuleSettings, Offer, ComboItem, ComboVersion, ModuleOrder, ModuleOrderItem, OrderPart,
  Receivable, Refund, CustomRequest, CustomFile, RentalAsset, RentalReservation, RentalEvent, RentalAvailability, PublicCatalog, CustomerOrder } from './types';

const rows = <T,>(table: string, storeId: string, column = 'store_id') =>
  restFetch<T[]>(`${table}?select=*&${column}=eq.${encodeURIComponent(storeId)}&limit=200`);

// Paginação estável: reservas ativas não desaparecem após 200 registros históricos.
async function rentalRows<T>(table: string, storeId: string, key: string): Promise<T[]> {
  const result: T[] = []; let after = '';
  for (;;) {
    const page = await restFetch<(T & Record<string, unknown>)[]>(`${table}?select=*&store_id=eq.${encodeURIComponent(storeId)}&order=${key}.asc&limit=200${after ? `&${key}=gt.${encodeURIComponent(after)}` : ''}`);
    result.push(...page);
    if (page.length < 200) return result;
    after = String(page[page.length - 1][key]);
  }
}

export const modulesApi = {
  async settings(storeId: string): Promise<ModuleSettings> {
    const data = await rows<ModuleSettings>('food_module_settings', storeId);
    return data[0] || disabledModules(storeId);
  },
  command: (storeId: string, action: string, data: unknown) => restFetch<{ id: string; already_paid?: boolean }>(action.startsWith('rental_') ? 'rpc/food_rental_command_v1' : 'rpc/food_modules_command',
    { method: 'POST', body: { p_store: storeId, p_action: action, p_data: data } }),
  offers: (storeId: string) => rows<Offer>('food_module_offers', storeId),
  versions: (storeId: string) => rows<ComboVersion>('food_combo_versions', storeId, 'seller_store_id'),
  approvals: (storeId: string) => rows<ComboItem>('food_combo_items', storeId),
  directory: () => restFetch<Offer[]>('rpc/food_modules_directory', { method: 'POST', body: {} }),
  parts: (storeId: string) => rows<OrderPart>('food_module_order_parts', storeId),
  orders: (storeId: string) => rows<ModuleOrder>('food_module_orders', storeId, 'seller_store_id'),
  orderItems: (storeId: string) => rows<ModuleOrderItem>('food_module_order_items', storeId),
  receivables: (storeId: string) => rows<Receivable>('food_module_receivables', storeId),
  refunds: (storeId: string) => rows<Refund>('food_module_refunds', storeId),
  customs: (storeId: string) => rows<CustomRequest>('food_custom_requests', storeId),
  files: (storeId: string) => rows<CustomFile>('food_custom_files', storeId),
  assets: (storeId: string) => rentalRows<RentalAsset>('food_rental_asset_rows', storeId, 'offer_id'),
  reservations: (storeId: string) => rentalRows<RentalReservation>('food_rental_operation_rows', storeId, 'id'),
  rentalAvailability: (storeId: string, starts: string, ends: string) => restFetch<RentalAvailability>('rpc/food_rental_availability_v1',
    { method: 'POST', body: { p_store: storeId, p_starts: starts, p_ends: ends } }),
  rentalHistory: (storeId: string, offerId: string, before?: number) => restFetch<RentalEvent[]>(`food_rental_events?select=*&store_id=eq.${encodeURIComponent(storeId)}&offer_id=eq.${encodeURIComponent(offerId)}&order=id.desc&limit=50${before ? `&id=lt.${before}` : ''}`),
  async masterParents(ids: string[]) {
    const batches: string[][] = [];
    for (let offset = 0; offset < ids.length; offset += 50) batches.push(ids.slice(offset, offset + 50));
    return (await Promise.all(batches.map(batch => restFetch<ModuleOrder[]>(`food_module_orders?select=*&id=in.(${batch.join(',')})&limit=50`)))).flat();
  },
  async masterDetail(orderId: string) {
    const filter = `order_id=eq.${encodeURIComponent(orderId)}&limit=200`;
    const [parts,items,refunds] = await Promise.all([
      restFetch<OrderPart[]>(`food_module_order_parts?select=*&${filter}`),
      restFetch<ModuleOrderItem[]>(`food_module_order_items?select=*&${filter}`),
      restFetch<Refund[]>(`food_module_refunds?select=*&${filter}`),
    ]);
    // Pedido tem no máximo 50 itens/fornecedores; consulta nunca trunca sua composição.
    const receivables = parts.length ? await restFetch<Receivable[]>(`food_module_receivables?select=*&part_id=in.(${parts.map(p => p.id).join(',')})&limit=200`) : [];
    return { parts, items, refunds, receivables };
  },
  async upload(request: CustomRequest, file: File) {
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!extension || !['png','jpg','jpeg','webp','pdf','stl','obj','3mf'].includes(extension)) throw new Error('Use foto, PDF, STL, OBJ ou 3MF.');
    if (file.size < 1 || file.size > 25 * 1024 * 1024) throw new Error('O arquivo deve ter até 25 MiB.');
    const path = `${request.organization_id}/${request.store_id}/${request.id}/${crypto.randomUUID()}.${extension}`;
    const { error } = await getSupabaseClient().storage.from('food-custom-files').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
    if (error) throw error;
    await this.command(request.store_id, 'file_register', { request_id: request.id, storage_path: path, name: file.name, size_bytes: file.size });
  },
  async fileUrl(path: string) {
    const { data, error } = await getSupabaseClient().storage.from('food-custom-files').createSignedUrl(path, 60);
    if (error) throw error;
    return data.signedUrl;
  },
  catalog: (sellerId: string) => restFetch<PublicCatalog>('rpc/food_modules_catalog', { method: 'POST', body: { p_seller: sellerId } }),
  async customer(action: 'create' | 'get' | 'remove' | 'freeze', data: unknown, turnstileToken?: string): Promise<CustomerOrder> {
    const response = await fetch(`${appConfig.supabaseUrl}/functions/v1/food-modules-public`, {
      method: 'POST', headers: { apikey: appConfig.supabaseAnonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data, turnstileToken }),
    });
    const result = await response.json() as CustomerOrder & { error?: string };
    if (!response.ok) throw new Error(result.error || 'Não foi possível processar a solicitação.');
    return result;
  },
};
