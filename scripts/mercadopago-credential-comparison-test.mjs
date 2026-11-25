import {test} from 'node:test';
import assert from 'node:assert/strict';
import {inspectComparisonCredential} from '../supabase/functions/_shared/mercadoPagoCredentialComparison.ts';
const input={accessToken:'private-token',publicKey:'public-test',oauthPublicKey:'public-test',sellerId:'123'};
const ok=user=>new Response(JSON.stringify(user));
test('credentials probe only reads the exact identity endpoint and exposes no raw account data',async()=>{
 let calls=0;
 const result=await inspectComparisonCredential(input,async(url,init)=>{
  calls++;assert.equal(url,'https://api.mercadolibre.com/users/me');assert.equal(init.method,'GET');assert.equal(init.redirect,'error');
  assert.equal(init.headers.Authorization,'Bearer private-token');
  return ok({id:123,site_id:'MLB',tags:['test_user'],email:'private@example.com',access_token:'private-token'});
 });
 assert.equal(calls,1);assert.equal(result.expectedTestSeller,true);assert.equal(result.publicKeyMatchesOAuth,true);
 assert(!JSON.stringify(result).includes('private'));
});
test('distinguishes another test seller, a real account and a foreign test account',async()=>{
 for(const user of [{id:456,site_id:'MLB',tags:['test_user']},{id:123,site_id:'MLB',tags:[]},{id:123,site_id:'MLA',tags:['test_user']}]){
  const result=await inspectComparisonCredential(input,async()=>ok(user));assert.equal(result.expectedTestSeller,false);
 }
});
test('missing secrets do not send requests; bad responses and network failures stay sanitized',async()=>{
 assert.equal((await inspectComparisonCredential({...input,accessToken:''},async()=>{throw Error('must not run')})).result,'not_configured');
 for(const response of [new Response('private-token',{status:401}),new Response('private@example.com'),new Response('x'.repeat(32769)),ok(null)]){
  const result=await inspectComparisonCredential(input,async()=>response);assert.notEqual(result.result,'identity_checked');assert(!JSON.stringify(result).includes('private'));
 }
 assert.equal((await inspectComparisonCredential(input,async()=>{throw Error('private-token')})).result,'unavailable');
});
