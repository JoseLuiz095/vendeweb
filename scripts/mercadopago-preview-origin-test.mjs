import {test} from 'node:test';import assert from 'node:assert/strict';
import {testOrigins} from '../supabase/functions/_shared/mpTestPreviewOrigin.ts';
test('admite somente a prévia específica sem ampliar as demais origens',()=>{
 const allowed='https://www.vendeweb.com.br',preview='https://codex-mercadopago-piloto-isolado-20261119-foodweb.joseluizacama.workers.dev';
 assert.equal(testOrigins(allowed,preview).has(preview),true);
 for(const bad of ['https://evil.test','https://codex-mercadopago-piloto-isolado-20261119-foodweb.joseluizacama.workers.dev.evil.test',preview+'/','*'])assert.equal(testOrigins(allowed,bad).has(bad),false);
 assert.equal(testOrigins(allowed,'').has(allowed),true);
});
