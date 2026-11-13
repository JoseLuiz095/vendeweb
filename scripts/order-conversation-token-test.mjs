import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createConversationToken, conversationTokenDigest } from '../supabase/functions/_shared/orderConversationToken.ts';

test('gera uma credencial aleatória opaca e armazena apenas seu resumo', async () => {
  const token = createConversationToken();
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, createConversationToken());
  assert.equal(await conversationTokenDigest(token), createHash('sha256').update(token).digest('hex'));
});

test('recusa credenciais malformadas antes de consultar dados', async () => {
  for (const value of ['', 'x'.repeat(42), 'x'.repeat(44), '../' + 'x'.repeat(40), 'é'.repeat(43)]) {
    await assert.rejects(conversationTokenDigest(value), /INVALID_CONVERSATION_TOKEN/);
  }
});
