import { restFetch } from '../lib/supabaseRest';
// Os destinos por loja e ponto alimentam o botão de envio do comprovante.
export const receiptContactsEnabled = true;
export type ReceiptContact = { slot: number; name: string; phone: string; pointId?:string };
export type ReceiptDestinations = { mode:'general'|'point'|'selection'|'unassigned'|'unavailable'; contacts:ReceiptContact[] };
export function parseReceiptDestinations(value:unknown):ReceiptDestinations {
 const v=value as ReceiptDestinations;
 if(!v||!['general','point','selection','unassigned','unavailable'].includes(v.mode)||!Array.isArray(v.contacts)||v.contacts.length>100||v.contacts.some(c=>!c||![1,2].includes(c.slot)||typeof c.name!=='string'||!c.name.trim()||c.name.length>120||!/^[1-9][0-9]{9,14}$/.test(c.phone)||(v.mode==='selection'&&!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(c.pointId||'')))||new Set(v.contacts.map(c=>`${c.pointId||''}:${c.slot}`)).size!==v.contacts.length||(v.mode==='point'&&!v.contacts.length)||(['unavailable','unassigned'].includes(v.mode)&&v.contacts.length))throw new Error('Contatos indisponíveis. Tente novamente.');
 return v;
}
export async function getReceiptDestinations(storeId:string,pointId?:string){return parseReceiptDestinations(await restFetch('rpc/food_get_receipt_destinations_v2',{method:'POST',body:{p_store_id:storeId,p_pickup_location_id:pointId||null}}));}
export const receiptContactsApi={
 async load(id:string){
  const [contacts,links,points]=await Promise.all([
   restFetch<ReceiptContact[]>(`food_receipt_contacts?store_id=eq.${encodeURIComponent(id)}&select=slot,name,phone&order=slot`),
   restFetch<Array<{pickup_location_id:string;contact_slot:number}>>(`food_pickup_receipt_contacts?store_id=eq.${encodeURIComponent(id)}&select=pickup_location_id,contact_slot`),
   restFetch<Array<{id:string;name:string}>>(`food_pickup_locations?store_id=eq.${encodeURIComponent(id)}&active=eq.true&is_public=eq.true&select=id,name&order=name`),
  ]);
  return {contacts,links,points};
 },
 save:(id:string,contacts:ReceiptContact[],points:Array<{pickup_location_id:string;contact_slot:number}>)=>restFetch('rpc/food_save_receipt_contacts_v1',{method:'POST',body:{p_store_id:id,p_contacts:contacts,p_points:points}}),
};
