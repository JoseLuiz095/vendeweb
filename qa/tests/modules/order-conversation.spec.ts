import { expect, test } from '@playwright/test';
import { mockBackend, STORE } from './fixtures';

for (const width of [390,1366]) test(`conversa do cliente mantém tentativa e não expõe link em ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});await mockBackend(page);
  const attempts:string[]=[];let sent=false;
  await page.route('**/functions/v1/food-order-conversation',route=>{
    const body=route.request().postDataJSON();
    if(body.action==='customer_send'){
      attempts.push(body.requestId);
      if(attempts.length===1)return route.fulfill({status:503,json:{error:'Falha simulada'}});
      sent=true;
    }
    return route.fulfill({json:{orderNumber:5,messages:sent?[{id:'1',sender:'customer',body:'Olá, loja!',createdAt:'2026-11-10T10:00:00Z'}]:[]}});
  });
  await page.goto(`/conversa/pedido#${'a'.repeat(43)}`);
  await expect(page.getByRole('heading',{name:'Conversa com a loja'})).toBeVisible();
  await expect.poll(()=>new URL(page.url()).hash).toBe('');
  await page.getByLabel('Escreva uma mensagem').fill('Olá, loja!');
  await page.getByRole('button',{name:'Enviar mensagem'}).click();
  await expect(page.getByRole('alert')).toContainText('não foi confirmada');
  await expect(page.getByLabel('Escreva uma mensagem')).toHaveValue('Olá, loja!');
  await page.getByRole('button',{name:'Enviar mensagem'}).click();
  await expect(page.getByText('Olá, loja!',{exact:true})).toBeVisible();
  expect(attempts).toHaveLength(2);expect(attempts[0]).toBe(attempts[1]);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('pedido da loja permite emitir link sem criar pedido',async({page})=>{
  const {writes}=await mockBackend(page,{auth:true});
  const id='b0000000-0000-4000-8000-000000000001';
  await page.route(/\/rest\/v1\/food_orders(?:\?|$)/,route=>route.fulfill({json:[{id,store_id:STORE,order_number:42,customer_name:'Pessoa fictícia',delivery_type:'pickup',payment_method:'cash',payment_status:'paid',status:'received',subtotal:10,total:10,created_at:new Date().toISOString()}]}));
  await page.route('**/functions/v1/food-order-conversation',route=>{const body=route.request().postDataJSON();return route.fulfill({json:body.action==='staff_issue'?{token:'b'.repeat(43),expiresAt:'2030-01-01T00:00:00Z'}:{messages:[]}})});
  await page.goto('/admin/pedidos');await page.getByRole('button',{name:'Detalhes'}).first().click();
  await expect(page.getByRole('heading',{name:'Conversa com cliente'})).toBeVisible();
  await page.getByRole('button',{name:'Gerar novo link'}).click();
  await expect(page.getByLabel('Link privado')).toHaveValue(/\/conversa\/pedido#/);
  expect(writes.some(item=>item.url.endsWith('food-public-checkout'))).toBe(false);
});

test('atualização antiga não oculta mensagem recém enviada',async({page})=>{
  await mockBackend(page);
  let listCount=0;
  let releaseOld!:()=>void;
  const oldResponse=new Promise<void>(resolve=>{releaseOld=resolve;});
  await page.route('**/functions/v1/food-order-conversation',async route=>{
    const body=route.request().postDataJSON();
    if(body.action==='customer_send')return route.fulfill({json:{messages:[{id:'new',sender:'customer',body:'Mensagem recente',createdAt:'2026-11-10T10:00:00Z'}]}});
    listCount++;
    if(listCount===2)await oldResponse;
    return route.fulfill({json:{messages:[]}});
  });
  await page.goto(`/conversa/pedido#${'a'.repeat(43)}`);
  await expect(page.getByText('Nenhuma mensagem ainda.')).toBeVisible();
  await page.getByRole('button',{name:'Atualizar'}).click();
  await expect.poll(()=>listCount).toBe(2);
  await page.getByLabel('Escreva uma mensagem').fill('Mensagem recente');
  await page.getByRole('button',{name:'Enviar mensagem'}).click();
  await expect(page.getByText('Mensagem recente',{exact:true})).toBeVisible();
  const oldFinished=page.waitForResponse(response=>response.url().includes('/food-order-conversation')&&response.request().postDataJSON().action==='customer_list');
  releaseOld();await oldFinished;
  await expect(page.getByText('Mensagem recente',{exact:true})).toBeVisible();
});
