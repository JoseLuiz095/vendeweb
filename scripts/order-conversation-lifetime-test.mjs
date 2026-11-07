import test from 'node:test';
import assert from 'node:assert/strict';
import { initialConversationExpiry, extendConversationExpiry, terminalConversationExpiry } from '../supabase/functions/_shared/orderConversationLifetime.ts';

const day = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 7);

test('scheduled orders stay accessible through the date and follow-up', () => {
  assert.equal(initialConversationExpiry(now, now + 90 * day), now + 97 * day);
  assert.equal(initialConversationExpiry(now, now + day), now + 30 * day);
  assert.equal(initialConversationExpiry(now), now + 30 * day);
});

test('rescheduling extends an active link but never reactivates an expired or revoked one', () => {
  const base = { now, expiresAt: now + day, revoked: false };
  assert.equal(extendConversationExpiry({ ...base, scheduledAt: now + 60 * day }), now + 67 * day);
  assert.equal(extendConversationExpiry({ ...base, expiresAt: now + 100 * day, scheduledAt: now + day }), now + 100 * day);
  assert.equal(extendConversationExpiry({ ...base, revoked: true, scheduledAt: now + 60 * day }), null);
  assert.equal(extendConversationExpiry({ ...base, expiresAt: now, scheduledAt: now + 60 * day }), null);
});

test('completion allows a follow-up and invalid dates fail closed', () => {
  assert.equal(terminalConversationExpiry(now), now + 7 * day);
  for (const bad of [NaN, Infinity, -1, 1.5]) assert.throws(() => initialConversationExpiry(now, bad), /INVALID_TIMESTAMP/);
  assert.throws(() => terminalConversationExpiry(Number.MAX_SAFE_INTEGER), /INVALID_TIMESTAMP/);
});
