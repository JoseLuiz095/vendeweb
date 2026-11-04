import { restFetch } from '../lib/supabaseRest';

export type FitnessOfferKind = 'workout' | 'assessment' | 'combo' | 'nutrition_consult' | 'nutrition_plan';
export type FitnessOrderNotification = {
  id: string; order_id: string; event_kind: 'paid' | 'refunded' | 'scheduled' | 'delivered'; created_at: string; offer_name: string;
};
export type FitnessOffer = {
  id: string; kind: FitnessOfferKind; name: string; description: string; price_cents: number;
  workout_id: string | null; service_id: string | null; professional_user_id: string;
  professional_name: string; professional_council: string; published: boolean;
  professional_registration?:string; delivery_mode?:'ready'|'personalized'; delivery_terms?:string; location_label?:string; modality?:'onsite'|'online'; arrival_instructions?:string; lead_minutes?:number;
};
export type FitnessOfferOrder = {
  id: string; offer_id?: string; offer_name: string; price_cents: number;
  state: 'pending' | 'paid' | 'cancelled' | 'refunded'; created_at?: string;
  client_id?: string; student_name?: string;
  fulfillment_state?:'awaiting_payment'|'booking_pending'|'scheduled'|'in_service'|'review_pending'|'delivered'|'cancelled'|'refunded';
  snapshot?:FitnessOffer & {duration_minutes?:number;professional?:{name:string;council:string;registration:string};terms?:{cancel_policy:string;reschedule_policy:string}};
  appointment?:{id:string;starts_at:string;ends_at:string;status:string}|null;
};
export type FitnessOfferInput = Omit<FitnessOffer, 'id' | 'professional_name' | 'professional_council'> & { id?: string | null };

export const fitnessOffersApi = {
  delivery:(store:string,offer:string,item:FitnessOfferInput)=>restFetch<unknown>('rpc/food_fitness_offer_delivery_v1',{method:'POST',body:{p_store:store,p_offer:offer,p_mode:item.delivery_mode||'ready',p_terms:item.delivery_terms||'',p_location:item.location_label||'',p_modality:item.modality||'onsite',p_instructions:item.arrival_instructions||'',p_lead:item.lead_minutes??60}}),
  book:(store:string,order:string,starts:string,accepted:boolean,token:string)=>restFetch<unknown>('rpc/food_fitness_paid_book_v1',{method:'POST',token,body:{p_store:store,p_order:order,p_starts:starts,p_terms_accepted:accepted}}),
  cancel:(store:string,order:string,token:string)=>restFetch<unknown>('rpc/food_fitness_order_cancel_v1',{method:'POST',token,body:{p_store:store,p_order:order}}),
  list: (store: string, admin = false) => restFetch<FitnessOffer[]>('rpc/food_fitness_offers_v1', {
    method: 'POST', body: { p_store: store, p_admin: admin },
  }),
  save: (store: string, item: FitnessOfferInput) => restFetch<{ id: string; published: boolean }>('rpc/food_fitness_offer_save_v1', {
    method: 'POST', body: {
      p_store: store, p_id: item.id || null, p_kind: item.kind, p_name: item.name,
      p_description: item.description, p_price_cents: item.price_cents,
      p_workout: item.workout_id, p_service: item.service_id,
      p_professional: item.professional_user_id, p_published: item.published,
    },
  }),
  buy: (store: string, offer: string, request: string, token: string) => restFetch<FitnessOfferOrder>('rpc/food_fitness_order_v1', {
    method: 'POST', body: { p_store: store, p_offer: offer, p_request: request }, token,
  }),
  mine: (store: string, token: string) => restFetch<FitnessOfferOrder[]>('rpc/food_fitness_my_orders_v1', {
    method: 'POST', body: { p_store: store }, token,
  }),
  notifications: (store: string, token: string) => restFetch<FitnessOrderNotification[]>('rpc/food_fitness_order_notifications_v1', {
    method: 'POST', body: { p_store: store }, token,
  }),
  adminOrders: (store: string) => restFetch<FitnessOfferOrder[]>('rpc/food_fitness_admin_orders_v1', {
    method: 'POST', body: { p_store: store },
  }),
  confirm: (store: string, order: string, action: 'confirm' | 'refund') => restFetch<{ id: string; state: string }>('rpc/food_fitness_confirm_order_v1', {
    method: 'POST', body: { p_store: store, p_order: order, p_action: action },
  }),
  authorize: (store: string, professional: string, purpose: 'training' | 'nutrition', token: string) =>
    restFetch<{ active: boolean }>('rpc/food_fitness_student_authorize_professional', {
      method: 'POST', body: { p_store: store, p_professional: professional, p_purpose: purpose, p_enabled: true }, token,
    }),
};
