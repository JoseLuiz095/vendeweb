import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cardBrickErrorCategory,watchCardForm} from '../src/services/mercadoPagoCardReadiness.ts';

test('classifica apenas códigos conhecidos sem expor mensagens ou dados privados',()=>{
 for(const error of ['fields_setup_failed',{code:'fields_setup_failed'},{cause:'fields_setup_failed'},{cause:{code:'fields_setup_failed'}}])assert.equal(cardBrickErrorCategory(error),'fields_setup_failed');
 for(const error of [null,'secret',{code:'secret'},{cause:{code:'secret'}},{message:'secret'}])assert.equal(cardBrickErrorCategory(error),'unknown');
});

test('avisa quando o formulário não fica pronto dentro do prazo', async()=>{
 let failures=0;
 const watch=watchCardForm(()=>failures++,10);
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(failures,1);
 watch.ready();
 assert.equal(failures,1);
});

test('formulário pronto ou tela desmontada não geram erro tardio', async()=>{
 let failures=0;
 const ready=watchCardForm(()=>failures++,10);ready.ready();
 const disposed=watchCardForm(()=>failures++,10);disposed.dispose();
 await new Promise(resolve=>setTimeout(resolve,30));
 assert.equal(failures,0);
});

test('erro do provedor é mostrado uma só vez',()=>{
 let failures=0;
 const watch=watchCardForm(()=>failures++,1000);
 watch.fail();watch.fail();watch.ready();
 assert.equal(failures,1);
});

test('erro após carregamento tardio também é exibido',()=>{
 let failures=0;
 const watch=watchCardForm(()=>failures++,1000);
 watch.fail();watch.ready();watch.fail();
 assert.equal(failures,2);
 watch.dispose();
});
