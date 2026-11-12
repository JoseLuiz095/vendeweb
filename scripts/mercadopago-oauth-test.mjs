import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beginTestOAuth,hashTestOAuthState,sealTestSecret,openTestSecret,consumeTestOAuthState,buildTestTokenExchange } from '../supabase/functions/_shared/mercadoPagoOAuthTest.ts';

test('PKCE utiliza S256 e state imprevisível, sem incluir identidade no URL',async()=>{
 const input={clientId:'123',redirectUri:'https://example.test/oauth/callback',storeId:'store-secret',actorId:'actor-secret',now:1000};
 const a=await beginTestOAuth(input),b=await beginTestOAuth(input);const url=new URL(a.authorizationUrl);
 assert.equal(url.origin,'https://auth.mercadopago.com');assert.equal(url.searchParams.get('code_challenge_method'),'S256');
 assert.notEqual(url.searchParams.get('state'),new URL(b.authorizationUrl).searchParams.get('state'));
 assert.equal(await hashTestOAuthState(url.searchParams.get('state')),a.stateHash);
 assert.equal(url.searchParams.get('code_challenge'),await hashTestOAuthState(a.verifier));
 assert.equal(a.expiresAt,601000);assert.equal(a.authorizationUrl.includes(input.storeId),false);
 await assert.rejects(beginTestOAuth({...input,redirectUri:'http://example.test/callback'}));
 await assert.rejects(beginTestOAuth({...input,redirectUri:'https://example.test/callback?redirect=bad'}));
});

test('AES-GCM impede leitura por outra loja, finalidade, chave ou adulteração',async()=>{
 const key=crypto.getRandomValues(new Uint8Array(32));const sealed=await sealTestSecret(key,'store-a','seller-token','secret-synthetic');
 assert.equal(await openTestSecret(key,'store-a','seller-token',sealed),'secret-synthetic');
 await assert.rejects(openTestSecret(key,'store-b','seller-token',sealed));
 await assert.rejects(openTestSecret(key,'store-a','oauth-verifier',sealed));
 await assert.rejects(openTestSecret(crypto.getRandomValues(new Uint8Array(32)),'store-a','seller-token',sealed));
 const parts=sealed.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);
 await assert.rejects(openTestSecret(key,'store-a','seller-token',parts.join('.')));
});

test('consumo único exige estado, mesma loja e mesmo usuário, sem usar fluxo expirado',async()=>{
 const a=await beginTestOAuth({clientId:'123',redirectUri:'https://example.test/callback',storeId:'s',actorId:'u',now:1000});
 const state=new URL(a.authorizationUrl).searchParams.get('state');let stored=true;
 const consume=async(hash,store,actor,now)=>{if(!stored||hash!==a.stateHash||store!=='s'||actor!=='u'||now>=a.expiresAt)return null;stored=false;return {verifier:a.verifier,expiresAt:a.expiresAt};};
 for(const bad of [{storeId:'other'},{actorId:'other'},{state:'x'},{now:a.expiresAt}])await assert.rejects(consumeTestOAuthState({state,storeId:'s',actorId:'u',now:2000,...bad},consume));
 assert.equal(await consumeTestOAuthState({state,storeId:'s',actorId:'u',now:2000},consume),a.verifier);
 await assert.rejects(consumeTestOAuthState({state,storeId:'s',actorId:'u',now:2000},consume));
});

test('troca aponta endpoint fixo e solicita somente token de teste',()=>{
 const config={clientId:'123',clientSecret:'synthetic',redirectUri:'https://example.test/callback',code:'synthetic',verifier:'a'.repeat(43)};
 const request=buildTestTokenExchange(config);
 assert.equal(request.url,'https://api.mercadopago.com/oauth/token');assert.equal(request.body.test_token,true);assert.equal(request.body.code_verifier,config.verifier);
 assert.throws(()=>buildTestTokenExchange({...config,redirectUri:'http://example.test'}));
 assert.throws(()=>buildTestTokenExchange({...config,verifier:'bad'}));
});
