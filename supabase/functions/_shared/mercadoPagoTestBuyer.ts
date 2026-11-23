/** The value is configured from an existing Mercado Pago buyer test account. */
export function testBuyerEmail(value:string):string|null{
 const email=value.trim().toLowerCase();
 return email.length<=254&&/^test_user[0-9a-z._-]*@testuser\.com$/.test(email)?email:null;
}
