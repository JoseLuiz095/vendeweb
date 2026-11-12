import test from 'node:test';
import assert from 'node:assert/strict';
import { confirmPasswordChange } from '../src/utils/confirmPasswordChange.ts';

test('only a confirmed update of the intended membership refreshes access', async () => {
  let refreshes = 0;
  await confirmPasswordChange('a', async () => [{ id: 'a', must_change_password: false }], async () => { refreshes++; });
  assert.equal(refreshes, 1);
  for (const rows of [[], null, [{ id: 'other', must_change_password: false }], [{ id: 'a', must_change_password: true }]]) {
    await assert.rejects(confirmPasswordChange('a', async () => rows, async () => { refreshes++; }), /nova senha foi salva/);
  }
  assert.equal(refreshes, 1);
});

test('failed write or refresh explains the password was already changed', async () => {
  await assert.rejects(confirmPasswordChange('a', async () => { throw new Error('denied'); }, async () => {}), /nova senha foi salva/);
  await assert.rejects(confirmPasswordChange('a', async () => [{ id: 'a', must_change_password: false }], async () => { throw new Error('offline'); }), /nova senha foi salva/);
});
