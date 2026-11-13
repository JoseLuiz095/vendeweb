/** Dedicated short-lived capability for the isolated Pix test checkout. */
export type MpTestClaim={v:1;storeId:string;orderId:string;amount:number;version:number;expiresAt:number};
const encoder=new TextEncoder();
const uuid=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const b64=(b:Uint8Array)=>btoa(String.fromCharCode(...b)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64=(s:string)=>Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
const aad=encoder.encode('vendeweb-mp-test-checkout-v1');
async function key(secret:string){if(secret.length<32)throw new Error('KEY_UNAVAILABLE');return crypto.subtle.importKey('raw',await crypto.subtle.digest('SHA-256',encoder.encode(secret)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
function valid(c:MpTestClaim,now:number){return c?.v===1&&uuid.test(c.storeId)&&uuid.test(c.orderId)&&Number.isFinite(c.amount)&&c.amount>0&&Number.isSafeInteger(c.version)&&c.version===0&&Number.isFinite(c.expiresAt)&&c.expiresAt>now&&c.expiresAt<=now+3600000;}
export async function mintMpTestClaim(input:Omit<MpTestClaim,'v'|'expiresAt'>,secret:string,now=Date.now()):Promise<string>{const c:MpTestClaim={...input,v:1,expiresAt:now+3600000};if(!valid(c,now))throw new Error('INVALID_CLAIM');const iv=crypto.getRandomValues(new Uint8Array(12));const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await key(secret),encoder.encode(JSON.stringify(c)));return `${b64(iv)}.${b64(new Uint8Array(data))}`;}
export async function openMpTestClaim(token:string,secret:string,now=Date.now()):Promise<MpTestClaim>{if(typeof token!=='string'||token.length>2048||!/^[-\w]+\.[-\w]+$/.test(token))throw new Error('INVALID_CLAIM');const [iv,data]=token.split('.').map(unb64);if(iv.length!==12)throw new Error('INVALID_CLAIM');const claim=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad},await key(secret),data)));if(!valid(claim,now))throw new Error('EXPIRED_CLAIM');return claim;}
