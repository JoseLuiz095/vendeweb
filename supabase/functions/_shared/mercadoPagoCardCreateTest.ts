import { buildTestPixOrder } from './mercadoPagoPixCreateTest.ts';

/** Inert test-only request builder. The token must come from Mercado Pago's
 * secure card component; never persist or log it. This does not send a payment.
 * Amount, reference and idempotency key must come from a server-side snapshot.
 */
export function buildTestCardOrder(input: {
  total: string; externalReference: string; idempotencyKey: string; payerEmail: string;
  cardToken: string; paymentMethodId: string; paymentType: 'credit_card' | 'debit_card'; installments: number;
}) {
  if (typeof input.cardToken !== 'string' || !/^[A-Za-z0-9_-]{1,512}$/.test(input.cardToken) ||
      typeof input.paymentMethodId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(input.paymentMethodId) ||
      !['credit_card', 'debit_card'].includes(input.paymentType) ||
      !Number.isSafeInteger(input.installments) || input.installments < 1 || input.installments > 99 ||
      (input.paymentType === 'debit_card' && input.installments !== 1)) throw new Error('Dados do cartão inválidos.');

  const pix = buildTestPixOrder(input);
  return {
    url: pix.url,
    idempotencyKey: pix.idempotencyKey,
    body: {
      ...pix.body,
      payer: { email: input.payerEmail },
      transactions: { payments: [{ amount: pix.body.total_amount, payment_method: {
        id: input.paymentMethodId, type: input.paymentType, token: input.cardToken, installments: input.installments,
      } }] },
    },
  };
}
