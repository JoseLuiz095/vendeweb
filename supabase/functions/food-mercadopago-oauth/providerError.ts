// Never return provider messages or unrecognized values: they may contain secrets.
export function providerErrorCategory(body: string): string {
 try {
  const value: unknown = JSON.parse(body);
  const code = value && typeof value === 'object' && 'error' in value ? value.error : null;
  switch (code) {
   case 'invalid_client': case 'invalid_grant': case 'invalid_scope':
   case 'invalid_request': case 'unsupported_grant_type':
   case 'forbidden': case 'unauthorized_client': return code;
   default: return 'other';
  }
 } catch { return 'other'; }
}
export function isVerifiedTestSeller(user:unknown, sellerId:string):boolean {
 if(!user||typeof user!=='object'||Array.isArray(user))return false;
 const record=user as Record<string,unknown>;
 return String(record.id)===sellerId&&record.site_id==='MLB'&&Array.isArray(record.tags)&&record.tags.includes('test_user');
}
