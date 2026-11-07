/**
 * Policy for an order-conversation capability. This module only calculates
 * deadlines; callers must authenticate, enforce revocation and persist changes
 * transactionally on the server before accepting a capability.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_MS = 30 * DAY_MS;
const FOLLOW_UP_MS = 7 * DAY_MS;

function timestamp(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_TIMESTAMP');
  return value;
}

/** Initial access covers at least 30 days and seven days after an appointment. */
export function initialConversationExpiry(issuedAt: number, scheduledAt?: number | null): number {
  timestamp(issuedAt);
  if (scheduledAt != null) timestamp(scheduledAt);
  return timestamp(Math.max(issuedAt + ACTIVE_WINDOW_MS, scheduledAt == null ? 0 : scheduledAt + FOLLOW_UP_MS));
}

/**
 * Only a currently valid, non-revoked capability can be extended. Rescheduling
 * earlier does not shorten access already granted. Revoked or expired links
 * require a newly issued capability after identity verification.
 */
export function extendConversationExpiry(input: {
  now: number;
  expiresAt: number;
  revoked: boolean;
  scheduledAt?: number | null;
}): number | null {
  const { now, expiresAt, revoked, scheduledAt } = input;
  timestamp(now);
  timestamp(expiresAt);
  if (scheduledAt != null) timestamp(scheduledAt);
  if (revoked || expiresAt <= now) return null;
  return timestamp(Math.max(expiresAt, now + ACTIVE_WINDOW_MS, scheduledAt == null ? 0 : scheduledAt + FOLLOW_UP_MS));
}

/** At completion or cancellation, retain access for seven more days. */
export function terminalConversationExpiry(now: number): number {
  return timestamp(timestamp(now) + FOLLOW_UP_MS);
}
