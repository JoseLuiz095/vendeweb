import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runControlPix} from '../supabase/functions/_shared/mercadoPagoControlPix.ts';
const input={storeId:'3659d8c9-0e68-4c86-9e0d-779c36ff28a9',orderId:'c53c79c6-0453-48bb-85e9-024c5bb26463',total:'50.00',accessToken:'private-token'};
const identity={id:3835760583,site_id:'MLB',tags:['test_user']};
const order={id:'ORDCONTROL',user_id:'3835760583',external_reference:`control_${input.orderId}`,country_code:'BRA',total_amount:'50.00',status:'processed',transactions:{payments:[{amount:'50.00',payment_method:{id:'pix',type:'bank_transfer'}}]}};
const response=(data,status=200)=>new Response(JSON.stringify(data),{status});
test('control reads the exact confirmed test identity before POST, checks GET and retries with stable key',async()=>{
 const keys=[];
 const transport=async(url,init)=>{
  assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer private-token');
  if(url.endsWith('/users/me'))return response(identity);
  if(init.method==='POST'){keys.push(init.headers['X-Idempotency-Key']);assert.equal(JSON.parse(init.body).payer.email,'test_payer@example.com');return response(order);}
  assert.equal(url,'https://api.mercadopago.com/v1/orders/ORDCONTROL');return response(order);
 };
 const result=await runControlPix(input,transport);assert.equal(result.status,'processed');assert(!JSON.stringify(result).includes('private'));
 await runControlPix(input,transport);assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);assert(keys[0].length<=64);
});
test('wrong identity, real account, foreign account and invalid scope never POST',async()=>{
 for(const user of [{...identity,id:3840680792},{...identity,tags:[]},{...identity,site_id:'MLA'}])await assert.rejects(runControlPix(input,async(url,init)=>{assert.equal(init.method,'GET');return response(user)}));
 for(const patch of [{storeId:'other'},{total:'1.00'},{orderId:'bad'}])await assert.rejects(runControlPix({...input,...patch},async()=>{throw Error('must not call')}));
});
test('rejects divergent order data and keeps provider payloads private',async()=>{
 for(const patch of [{user_id:'3840680792'},{total_amount:'49.00'},{external_reference:'other'},{country_code:'ARG'},{live_mode:true},{currency:'USD'},{transactions:{payments:[]}}])await assert.rejects(runControlPix(input,async(url)=>response(url.endsWith('/users/me')?identity:{...order,...patch})));
 const result=await runControlPix(input,async(url)=>url.endsWith('/users/me')?response(identity):response({error:'invalid_credentials',access_token:'private-token',email:'private@example.com'},401));
 assert.equal(result.category,'invalid_credentials');assert(!JSON.stringify(result).includes('private'));
});
test('402 remains a refused provider order and does not report settlement',async()=>{
 const failed={...order,status:'failed'};
 const result=await runControlPix(input,async(url,init)=>response(url.endsWith('/users/me')?identity:init.method==='POST'?{data:failed,errors:[{code:'invalid_users_involved'}]}:failed,init.method==='POST'?402:200));
 assert.equal(result.status,'failed');assert.equal(result.category,'invalid_users_involved');assert(!('paid' in result));
});
