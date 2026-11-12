import { brlCents } from './mercadoPagoPixTest.ts';

/** Builds an inert request description, never sends it. Inputs must come from a
 * server-validated order snapshot and a seller connection explicitly segregated
 * as sandbox; token prefixes alone do not establish a test environment.
 * Persist the request and idempotency key atomically before the first attempt.
 */
export function buildTestPixOrder(input:{total:string;externalReference:string;idempotencyKey:string;payerEmail:string}) {
 const amount=brlCents(input.total);
 if(amount===null||amount<=0n||!/^[A-Za-z0-9_-]{1,64}$/.test(input.externalReference)||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotencyKey)||
    input.payerEmail.length>254||!/^\S+@\S+\.\S+$/.test(input.payerEmail))throw new Error('Dados da cobrança inválidos.');
 const canonical=`${amount/100n}.${String(amount%100n).padStart(2,'0')}`;
 return {url:'https://api.mercadopago.com/v1/orders',idempotencyKey:input.idempotencyKey,
  body:{type:'online',processing_mode:'automatic',total_amount:canonical,external_reference:input.externalReference,
   transactions:{payments:[{amount:canonical,payment_method:{id:'pix',type:'bank_transfer'}}]},payer:{email:input.payerEmail}}};
}
