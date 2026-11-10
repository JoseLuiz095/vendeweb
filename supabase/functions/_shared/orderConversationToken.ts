/** Random bearer credentials for order conversations. Only the digest is stored. */
const encoder = new TextEncoder();
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function createConversationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function conversationTokenDigest(token: string): Promise<string> {
  if (!TOKEN_PATTERN.test(token)) throw new Error('INVALID_CONVERSATION_TOKEN');
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
