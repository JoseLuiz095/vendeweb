import {test} from 'node:test';
import assert from 'node:assert/strict';
import {testBuyerEmail} from '../supabase/functions/_shared/mercadoPagoTestBuyer.ts';

test('aceita somente e-mail de comprador fictício configurado no servidor',()=>{
 assert.equal(testBuyerEmail('TEST_USER123@testuser.com'),'test_user123@testuser.com');
 for(const value of ['', 'real@example.com','test_user@testuser.com.evil.test','bad @testuser.com', 'x'.repeat(255)+'@testuser.com'])assert.equal(testBuyerEmail(value),null);
});
