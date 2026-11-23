/** Provider response must identify exactly the authorized Brazilian test user. */
export function isVerifiedTestSeller(user:unknown,sellerId:string):boolean{
 if(!user||typeof user!=='object'||Array.isArray(user))return false;
 const record=user as Record<string,unknown>;
 return /^\d{1,32}$/.test(sellerId)&&String(record.id)===sellerId&&record.site_id==='MLB'&&Array.isArray(record.tags)&&record.tags.includes('test_user');
}
