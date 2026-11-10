import { test, expect, type Page } from '@playwright/test';
import { mockBackend, STORE, ORDER, PRODUCT, store } from './fixtures';
import { buildStaticPixCopyPaste } from '../../../src/utils/pix';
test('fila nova mantém declarações a conferir e não volta a limitar doze pedidos',async({page})=>{
 await isolated(page,true);
 const base={store_id:STORE,delivery_type:'pickup',payment_method:'pix',subtotal:12.5,total:12.5,created_at:new Date().toISOString()};
 const row=(number:number,status:string,payment:string,reported=false)=>({...base,id:`b0000000-0000-4000-8000-${String(number).padStart(12,'0')}`,order_number:number,customer_name:`Pessoa fictícia ${number}`,status,payment_status:payment,payment_reported_by_customer:reported});
 const rows=[...Array.from({length:14},(_,n)=>row(n+1,'received','pending')),row(15,'delivered','paid',true),row(16,'delivered','pending'),row(17,'cancelled','paid',true)];
 await page.route(/\/rest\/v1\/food_orders(?:\?|$)/,r=>r.fulfill({json:rows}));
 await page.goto('/admin/pedidos');
 const inbox=page.getByRole('region',{name:'Recebimentos a conferir'});
 await expect(inbox.locator('.orders-payment-inbox__list > article')).toHaveCount(16);
 await expect(inbox).toContainText('Pessoa fictícia 15');
 await expect(inbox).toContainText('Pessoa fictícia 16');
 await expect(inbox).not.toContainText('Pessoa fictícia 17');
 await expect(page.getByRole('button',{name:/Conferir pagamento/})).toContainText('16');
 await page.getByRole('button',{name:/Conferir pagamento/}).click();
 await expect(page.locator('#orders-payment')).toBeVisible();
});
const contacts=[{slot:1,name:'Contato fictício',phone:'5511000000001'}];
const pix=buildStaticPixCopyPaste({key:'test@example.invalid',receiver:'Loja Teste',city:'Teste',amount:12.5,txid:'PED42'});
async function isolated(page:Page,auth=false){
 await page.route('**/*',r=>new URL(r.request().url()).origin==='http://127.0.0.1:5193'?r.continue():r.abort('blockedbyclient'));
 await mockBackend(page,{auth});
}
for(const width of [320,390,768,1366])for(const tokenPresent of [false,true])test(`abrir comprovante não confirma pagamento nem retirada ${width}px token ${tokenPresent?'presente':'ausente'}`,async({page,context})=>{
 await isolated(page);await page.setViewportSize({width,height:900});let reports=0;
 await context.route('https://wa.me/**',r=>r.fulfill({contentType:'text/plain',body:'Conversa sintética.'}));
 await page.route('**/functions/v1/food-order-payment',r=>{
  const b=r.request().postDataJSON();if(b.action==='report_receipt'){reports++;return r.fulfill({status:500})}
  expect(b).toEqual({action:'resolve',token:'read.capability'});
  return r.fulfill({json:{status:'pending',storeName:'Loja fictícia',orderNumber:42,total:12.5,receiver:'Teste',pixPayload:pix,expiresAt:new Date(Date.now()+3600000).toISOString(),...(tokenPresent?{receiptToken:'receipt.capability'}:{}),receiptDestinations:{mode:'point',contacts}}});
 });
 await page.goto('/pagamento/pix#read.capability');
 const section=page.getByRole('region',{name:'Enviar comprovante'});const popup=page.waitForEvent('popup');
 await section.getByRole('link',{name:'Abrir WhatsApp e enviar comprovante',exact:true}).click();await (await popup).close();
 await expect(section).toContainText('Aguardando confirmação da loja');await expect(section).not.toContainText('Pagamento marcado como pago');
 expect(reports).toBe(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
for(const accept of [false,true])test(`admin ${accept?'confere declaração':'retorna declaração a receber'} sem PATCH operacional`,async({page})=>{
 await isolated(page,true);await page.setViewportSize({width:390,height:900});let reported=true,paid=true,patches=0;const reviews:unknown[]=[];
 await page.route(/\/rest\/v1\/food_orders(?:\?|$)/,r=>{if(r.request().method()==='PATCH')patches++;return r.fulfill({json:[{id:ORDER,store_id:STORE,order_number:42,customer_name:'Pessoa fictícia',delivery_type:'pickup',payment_method:'pix',payment_status:paid?'paid':'pending',payment_reported_by_customer:reported,status:'received',subtotal:12.5,total:12.5,created_at:new Date().toISOString()}]})});
 await page.route(/\/rest\/v1\/food_order_items(?:\?|$)/,r=>r.fulfill({json:[{id:PRODUCT,order_id:ORDER,product_id:PRODUCT,product_name:'Produto fictício',quantity:1,unit_price:12.5,item_total:12.5}]}));
 await page.route('**/rest/v1/rpc/food_review_receipt_report_v1',r=>{reviews.push(r.request().postDataJSON());reported=false;paid=accept;return r.fulfill({json:{ok:true}})});
 await page.goto('/admin/pedidos');const inbox=page.getByRole('region',{name:'Recebimentos a conferir'});
 await expect(inbox).toContainText('Pago informado pelo cliente · conferir');
 if(!accept){await inbox.locator('summary').filter({hasText:'Mais ações'}).click();page.once('dialog',async d=>{expect(d.message()).toContain('estoque não serão alterados');await d.accept()});}
 await inbox.getByRole('button',{name:accept?'Confirmar recebimento':'Voltar para A receber',exact:true}).click();
 if(accept){const dialog=page.getByRole('dialog',{name:'Confirmar recebimento'});await expect(dialog).toContainText('status operacional permanece igual');await dialog.getByRole('button',{name:'Confirmar recebimento'}).click();}
 await expect.poll(()=>reviews.length).toBe(1);expect(reviews).toEqual([{p_order_id:ORDER,p_accept:accept}]);
 await expect(inbox.getByText('Pago informado pelo cliente · conferir')).toHaveCount(0);expect(patches).toBe(0);
 if(!accept)await expect(inbox.getByRole('button',{name:'Confirmar recebimento',exact:true})).toBeVisible();
});
for(const configured of [false,true])test(`configuração de comprovantes não oferece autoconfirmação mesmo com estado anterior ${configured}`,async({page})=>{
 await isolated(page,true);let saved:unknown;
 await page.route('**/rest/v1/food_stores?**',r=>r.fulfill({json:[{...store,receipt_click_marks_paid:configured}]}));
 await page.route('**/rest/v1/food_receipt_contacts?**',r=>r.fulfill({json:contacts}));
 await page.route('**/rest/v1/food_pickup_receipt_contacts?**',r=>r.fulfill({json:[]}));
 await page.route('**/rest/v1/food_pickup_locations?**',r=>r.fulfill({json:[]}));
 await page.route('**/rest/v1/rpc/food_save_receipt_contacts_v1',r=>{saved=r.request().postDataJSON();return r.fulfill({json:null})});
 await page.goto('/admin/configuracoes');const card=page.getByRole('region',{name:'Destinos dos comprovantes'});
 await expect(card).toContainText('A loja deve conferir o recebimento e confirmar o pagamento');
 await expect(card.getByRole('checkbox',{name:/Permitir que o cliente informe o pagamento/})).toHaveCount(0);
 await expect(card.getByRole('checkbox',{name:/Concluir e baixar a retirada imediata/})).toHaveCount(0);
 await card.getByRole('button',{name:'Salvar destinos dos comprovantes'}).click();await expect(card.getByRole('alert')).toContainText('Confira os números');expect(saved).toBeUndefined();
 await card.getByRole('checkbox',{name:'Conferi os destinos de comprovantes cadastrados.'}).check();
 await card.getByRole('button',{name:'Salvar destinos dos comprovantes'}).click();await expect(card.getByRole('status')).toContainText('salvos');
 expect(saved).toEqual({p_store_id:STORE,p_contacts:contacts,p_points:[]});
});
