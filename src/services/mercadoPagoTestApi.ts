import { getSupabaseClient } from '../lib/supabase';

export type MercadoPagoTestStatus = { connected: boolean; environment: 'test' };
export type MercadoPagoCallback = { code: string; state: string } | { error: true };
export const showMercadoPagoPilot = (enabled: boolean, pilotStoreId: string, selectedStoreId: string): boolean =>
  enabled && Boolean(pilotStoreId) && pilotStoreId.toLowerCase() === selectedStoreId.toLowerCase();

export function readMercadoPagoCallback(): MercadoPagoCallback | null {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('state') || (!url.searchParams.has('code') && !url.searchParams.has('error'))) return null;
  const code = url.searchParams.get('code') || '';
  const state = url.searchParams.get('state') || '';
  const denied = url.searchParams.has('error');
  return !denied && code && state && code.length <= 2048 && state.length <= 1024 ? { code, state } : { error: true };
}
/** Limpa dados transitórios antes de iniciar a troca no servidor. */
export function clearMercadoPagoCallback(): void {
  const url = new URL(window.location.href);
  for (const key of ['mp_oauth', 'code', 'state', 'error', 'error_description']) url.searchParams.delete(key);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

async function invoke(action: string, storeId: string, data: object = {}): Promise<any> {
  const { data: result, error } = await getSupabaseClient().functions.invoke('food-mercadopago-oauth', { body: { action, storeId, ...data }, timeout: 15000 });
  if (error) throw new Error('Conexão de teste indisponível. Tente novamente mais tarde.');
  return result;
}

export async function mercadoPagoTestStatus(storeId: string): Promise<MercadoPagoTestStatus> {
  const data = await invoke('status', storeId);
  if (typeof data?.connected !== 'boolean' || data.environment !== 'test') throw new Error('Não foi possível verificar a conexão de teste.');
  return { connected: data.connected, environment: 'test' };
}
export async function startMercadoPagoTest(storeId: string): Promise<string> {
  const data = await invoke('start', storeId);
  let url: URL;
  try { url = new URL(data?.authorizationUrl); } catch { throw new Error('Endereço de autorização inválido.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'auth.mercadopago.com' || url.port || url.username || url.password || url.pathname !== '/authorization') throw new Error('Endereço de autorização inválido.');
  return url.href;
}
export async function completeMercadoPagoTest(storeId: string, callback: { code: string; state: string }): Promise<void> {
  const data = await invoke('complete', storeId, callback);
  if (data?.connected !== true || data.environment !== 'test') throw new Error('Não foi possível confirmar a conexão de teste.');
}
export async function disconnectMercadoPagoTest(storeId: string): Promise<void> {
  const data = await invoke('disconnect', storeId);
  if (data?.disconnected !== true) throw new Error('Não foi possível desconectar a conta de teste.');
}
