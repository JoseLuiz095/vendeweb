import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTestCardOrder } from '../supabase/functions/_shared/mercadoPagoCardCreateTest.ts';

const input = { total: '10.1', externalReference: 'order_123', idempotencyKey: 'c53c79c6-0453-48bb-85e9-024c5bb26463', payerEmail: 'person@example.test', cardToken: 'token_exemplo', paymentMethodId: 'visa', paymentType: 'credit_card', installments: 2 };
test('monta cobrança de teste com valor e chave do servidor', () => {
  const request = buildTestCardOrder(input);
  assert.equal(request.url, 'https://api.mercadopago.com/v1/orders');
  assert.equal(request.idempotencyKey, input.idempotencyKey);
  assert.equal(request.body.total_amount, '10.10');
  assert.equal('first_name' in request.body.payer, false);
  assert.deepEqual(request.body.transactions.payments[0], { amount: '10.10', payment_method: { id: 'visa', type: 'credit_card', token: 'token_exemplo', installments: 2 } });
});
test('rejeita dados inválidos sem incluir token na mensagem de erro', () => {
  for (const patch of [{ total: '0' }, { cardToken: '' }, { cardToken: 'segredo com espaço' }, { paymentMethodId: '' }, { paymentType: 'pix' }, { installments: 0 }, { paymentType: 'debit_card', installments: 2 }]) {
    assert.throws(() => buildTestCardOrder({ ...input, ...patch }), error => !error.message.includes('segredo'));
  }
});
