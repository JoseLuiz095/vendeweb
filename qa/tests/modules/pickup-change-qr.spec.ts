import { expect, test } from '@playwright/test';
import { mockBackend, PRODUCT, STORE, ORDER } from './fixtures';

test('QR de um ponto permite escolher outro e mantém estoque e pedido no ponto escolhido', async ({page}) => {
 await page.setViewportSize({width:390,height:844});
 const {writes}=await mockBackend(page);
 const a={id:'60000000-0000-4000-8000-000000000001',name:'Trabalho',short_code:'trabalho'};
 const b={id:'60000000-0000-4000-8000-000000000002',name:'Casa',short_code:'casa'};
 const checked:string[]=[];
 await page.route('**/rest/v1/rpc/food_get_public_pickup_locations_v1',r=>r.fulfill({json:[a,b]}));
 await page.route('**/rest/v1/rpc/food_get_public_location_availability_v1',r=>{
   const id=r.request().postDataJSON().p_pickup_location_id; checked.push(id);
   return r.fulfill({json:[{product_id:PRODUCT,available:3,available_elsewhere:false}]});
 });
 await page.goto('/doce-lua?ponto=trabalho');
 await page.getByRole('button',{name:'Adicionar Brigadeiro teste',exact:true}).click();
 await page.goto('/doce-lua/finalizar?ponto=trabalho');
 await expect(page.getByText('Local identificado: Trabalho')).toBeVisible();
 await expect(page.getByLabel('Ponto de retirada',{exact:true})).toBeVisible();
 await page.getByLabel('Ponto de retirada',{exact:true}).selectOption(b.id);
 await expect(page.getByText('Ponto escolhido: Casa')).toBeVisible();
 await expect(page).not.toHaveURL(/ponto=trabalho/);
 await page.reload();
 await expect(page.getByText('Ponto escolhido: Casa')).toBeVisible();
 await page.getByLabel('Nome',{exact:true}).fill('Cliente teste');
 await page.getByLabel(/WhatsApp \/ telefone/).fill('11999999999');
 await page.getByRole('button',{name:/Registrar pedido|^Finalizar$/}).filter({visible:true}).first().click();
 await expect(page).toHaveURL(new RegExp(ORDER));
 const order=writes.find(w=>w.url.endsWith('/food-public-checkout'));
 expect(order?.body.payload).toMatchObject({store_id:STORE,delivery_type:'pickup',pickup_location_id:b.id,receipt_pickup_location_id:a.id});
 expect(checked).toContain(b.id);
});

test('sem saldo no ponto escolhido bloqueia o pedido e mantém o ponto após recarregar', async ({page}) => {
 await page.setViewportSize({width:320,height:640});
 const {writes}=await mockBackend(page);
 const a={id:'60000000-0000-4000-8000-000000000001',name:'Trabalho',short_code:'trabalho'};
 const b={id:'60000000-0000-4000-8000-000000000002',name:'Casa',short_code:'casa'};
 await page.route('**/rest/v1/rpc/food_get_public_pickup_locations_v1',r=>r.fulfill({json:[a,b]}));
 await page.route('**/rest/v1/rpc/food_get_public_location_availability_v1',r=>r.fulfill({json:[{product_id:PRODUCT,available:r.request().postDataJSON().p_pickup_location_id===b.id?0:3,available_elsewhere:true}]}));
 await page.goto('/doce-lua?ponto=trabalho');
 await page.getByRole('button',{name:'Adicionar Brigadeiro teste',exact:true}).click();
 await page.goto('/doce-lua/finalizar?ponto=trabalho');
 await page.getByLabel('Ponto de retirada',{exact:true}).selectOption(b.id);
 await page.reload();
 await expect(page.getByText('Ponto escolhido: Casa')).toBeVisible();
 await page.getByLabel('Nome',{exact:true}).fill('Cliente teste');
 await page.getByLabel(/WhatsApp \/ telefone/).fill('11999999999');
 await page.getByRole('button',{name:/Registrar pedido|^Finalizar$/}).filter({visible:true}).first().click();
 await expect(page.locator('.checkout-inline-error')).toContainText(/Estoque insuficiente/);
 expect(writes.filter(w=>w.url.endsWith('/food-public-checkout'))).toHaveLength(0);
});
