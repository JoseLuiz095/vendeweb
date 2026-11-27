import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import ts from 'typescript';
const source=readFileSync(new URL('../src/services/mercadoPagoIsolatedTestApi.ts',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const api=await import(`data:text/javascript;base64,${Buffer.from(`const getSupabaseClient=()=>globalThis.mockClient;\n${compiled}`).toString('base64')}`);
test('cria pedido de teste sem aceitar valor do navegador',async()=>{
 let sent;globalThis.mockClient={functions:{invoke:async(_name,options)=>{sent=options.body;return {data:{orderId:'22222222-2222-4222-8222-222222222222'},error:null}}}};
 try{await api.createIsolatedTestOrder('store','request','pix');assert.deepEqual(sent,{action:'create',storeId:'store',requestId:'request',method:'pix'});}finally{delete globalThis.mockClient}
});
test('Pix aceita resposta válida e trata erros sem expor detalhes',async()=>{
 let result;globalThis.mockClient={functions:{invoke:async()=>({data:result,error:null})}};
 try{result={id:'ORD123',status:'action_required',statusDetail:'waiting_transfer',qrCode:'000201-example'};assert.equal((await api.payIsolatedPix('store','order')).id,'ORD123');result={id:'<script>',status:'x',qrCode:'bad'};await assert.rejects(api.payIsolatedPix('store','order'));}finally{delete globalThis.mockClient}
});
test('falha no envio orienta a conferir a tentativa antes de repetir',async()=>{
 globalThis.mockClient={functions:{invoke:async()=>({data:null,error:{message:'detalhe privado'}})}};
 try{await assert.rejects(api.payIsolatedPix('store','order'),error=>error.message.includes('Confira a tentativa')&&!error.message.includes('privado'));}finally{delete globalThis.mockClient}
});
test('confirmação aceita apenas resultado conhecido',async()=>{
 let result;globalThis.mockClient={functions:{invoke:async()=>({data:result,error:null})}};
 try{result={result:'applied'};assert.equal(await api.checkIsolatedPayment('store','order'),'applied');result={result:'secret'};await assert.rejects(api.checkIsolatedPayment('store','order'));}finally{delete globalThis.mockClient}
});
test('cartão envia somente token e informações de método',async()=>{
 let sent;globalThis.mockClient={functions:{invoke:async(_name,options)=>{sent=options.body;return{data:{id:'ORD123',status:'processing',statusDetail:'in_process'},error:null}}}};
 try{await api.payIsolatedCard('store','order',{cardToken:'token',paymentMethodId:'visa',paymentType:'credit_card',installments:1,buyerEmail:'buyer@testuser.com'});assert.deepEqual(Object.keys(sent.card).sort(),['buyerEmail','cardToken','installments','paymentMethodId','paymentType']);}finally{delete globalThis.mockClient}
});
test('cartão distingue recusa informada pelo provedor de envio aguardando confirmação',async()=>{
 let status='failed';globalThis.mockClient={functions:{invoke:async()=>({data:{id:'ORD123',status},error:null})}};
 const card={cardToken:'token',paymentMethodId:'visa',paymentType:'credit_card',installments:1,buyerEmail:'buyer@testuser.com'};
 try{assert.equal(await api.payIsolatedCard('store','order',card),'failed');status='processed';assert.equal(await api.payIsolatedCard('store','order',card),'submitted');status='unknown';assert.equal(await api.payIsolatedCard('store','order',card),'submitted');}finally{delete globalThis.mockClient}
});
test('orienta comprador incorreto sem expor resposta privada',async()=>{
 globalThis.mockClient={functions:{invoke:async()=>({data:null,error:{context:Response.json({error:'test_buyer_mismatch',private:'sensitive'})}})}};
 try{await assert.rejects(api.payIsolatedCard('store','order',{cardToken:'token',paymentMethodId:'visa',paymentType:'credit_card',installments:1,buyerEmail:'other@testuser.com'}),error=>error.message.includes('conta compradora de teste')&&!error.message.includes('sensitive'));}finally{delete globalThis.mockClient}
});
test('configuração de cartão aceita apenas comprador de teste validado',async()=>{
 let result={publicKey:'TEST-public',amount:'50.00',buyerEmail:'test_user123@testuser.com'};
 globalThis.mockClient={functions:{invoke:async()=>({data:result,error:null})}};
 try{
  assert.equal((await api.getIsolatedCardConfig('store','order')).buyerEmail,'test_user123@testuser.com');
  result={...result,buyerEmail:'real@example.com'};await assert.rejects(api.getIsolatedCardConfig('store','order'));
  result={...result,buyerEmail:undefined};await assert.rejects(api.getIsolatedCardConfig('store','order'));
 }finally{delete globalThis.mockClient}
});
