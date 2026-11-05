import { test, expect } from '@playwright/test';
import { mockBackend, STORE, PRODUCT } from './fixtures';

test('conferência manual inclui Pix informado e dinheiro entregue, e usa a operação correta',async({page})=>{
  await mockBackend(page,{auth:true});
  const pixId='b0000000-0000-4000-8000-000000000001';
  const cashId='b0000000-0000-4000-8000-000000000002';
  let reported=true,cashPaid=false;
  const calls:string[]=[];
  const rows=()=>[
    {id:pixId,store_id:STORE,order_number:41,customer_name:'Pix fictício',delivery_type:'pickup',payment_method:'pix',payment_status:'paid',payment_reported_by_customer:reported,status:'delivered',subtotal:12.5,total:12.5,created_at:new Date().toISOString()},
    {id:cashId,store_id:STORE,order_number:42,customer_name:'Dinheiro fictício',delivery_type:'pickup',payment_method:'cash',payment_status:cashPaid?'paid':'pending',payment_reported_by_customer:false,status:'delivered',subtotal:12.5,total:12.5,created_at:new Date().toISOString()},
    {id:'b0000000-0000-4000-8000-000000000003',store_id:STORE,order_number:43,customer_name:'Cancelado fictício',delivery_type:'pickup',payment_method:'pix',payment_status:'paid',payment_reported_by_customer:true,status:'cancelled',subtotal:12.5,total:12.5,created_at:new Date().toISOString()},
  ];
  await page.route(/\/rest\/v1\/food_orders(?:\?|$)/,route=>{
    const select=new URL(route.request().url()).searchParams.get('select')||'*';
    const fields=select.split(',');
    return route.fulfill({json:rows().map(row=>select==='*'?row:Object.fromEntries(Object.entries(row).filter(([key])=>fields.includes(key))))});
  });
  await page.route(/\/rest\/v1\/food_order_items(?:\?|$)/,route=>route.fulfill({json:[{id:PRODUCT,order_id:pixId,product_id:PRODUCT,product_name:'Produto fictício',quantity:1,unit_price:12.5,item_total:12.5}]}));
  await page.route('**/rest/v1/rpc/food_review_receipt_report_v1',route=>{
    calls.push('review');expect(route.request().postDataJSON()).toEqual({p_order_id:pixId,p_accept:true});reported=false;return route.fulfill({json:{ok:true}});
  });
  await page.route('**/rest/v1/rpc/food_confirm_order_payment_v1',route=>{
    calls.push('cash');expect(route.request().postDataJSON()).toEqual({p_order_id:cashId});cashPaid=true;return route.fulfill({json:{ok:true}});
  });
  await page.goto('/admin/pedidos');
  const inbox=page.getByRole('region',{name:'Recebimentos a conferir'});
  const pix=inbox.locator('article').filter({hasText:'Pix fictício'});
  const cash=inbox.locator('article').filter({hasText:'Dinheiro fictício'});
  await expect(pix).toContainText('Pago informado pelo cliente');
  await expect(pix).toContainText('pagamento informado · confira o recebimento');
  await expect(cash).toContainText('Entregue · A pagar');
  await expect(inbox).not.toContainText('Cancelado fictício');
  page.once('dialog',dialog=>{expect(dialog.message()).toContain('já foi concluída');void dialog.accept();});
  await pix.getByRole('button',{name:'Confirmar recebimento'}).click();
  await expect.poll(()=>calls.includes('review')).toBe(true);
  await expect(pix).toHaveCount(0);
  page.once('dialog',dialog=>{expect(dialog.message()).toContain('já foi concluída');void dialog.accept();});
  await cash.getByRole('button',{name:'Confirmar recebimento'}).click();
  await expect.poll(()=>calls.includes('cash')).toBe(true);
  await expect(cash).toHaveCount(0);
  expect(calls).toEqual(['review','cash']);
});

test('devolver declaração para A receber preserva o pedido entregue',async({page})=>{
  await mockBackend(page,{auth:true});
  const id='b0000000-0000-4000-8000-000000000004';
  let reported=true,paid=true,patches=0;
  await page.route(/\/rest\/v1\/food_orders(?:\?|$)/,route=>{
    if(route.request().method()==='PATCH')patches++;
    return route.fulfill({json:[{id,store_id:STORE,order_number:44,customer_name:'Declaração fictícia',delivery_type:'pickup',payment_method:'pix',payment_status:paid?'paid':'pending',payment_reported_by_customer:reported,status:'delivered',subtotal:12.5,total:12.5,created_at:new Date().toISOString()}]});
  });
  await page.route('**/rest/v1/rpc/food_review_receipt_report_v1',route=>{
    expect(route.request().postDataJSON()).toEqual({p_order_id:id,p_accept:false});
    reported=false;paid=false;return route.fulfill({json:{ok:true}});
  });
  await page.goto('/admin/pedidos');
  const item=page.getByRole('region',{name:'Recebimentos a conferir'}).locator('article').filter({hasText:'Declaração fictícia'});
  await expect(item).toContainText('Pago informado pelo cliente');
  page.once('dialog',dialog=>void dialog.accept());
  await item.getByRole('button',{name:'Voltar para A receber'}).click();
  await expect(item).toContainText('Entregue · A pagar');
  await expect(item.getByRole('button',{name:'Confirmar recebimento'})).toBeVisible();
  expect(patches).toBe(0);
});

test('projeção do painel continua funcionando quando a coluna opcional ainda não existe',async({page})=>{
  await mockBackend(page,{auth:true});
  let retries=0;
  await page.route(/\/rest\/v1\/food_orders(?:\?|$)/,route=>{
    const select=new URL(route.request().url()).searchParams.get('select')||'';
    if(select.includes('payment_reported_by_customer')){
      retries++;
      return route.fulfill({status:400,json:{code:'42703',message:'column food_orders.payment_reported_by_customer does not exist'}});
    }
    return route.fulfill({json:[{id:'b0000000-0000-4000-8000-000000000005',store_id:STORE,order_number:45,customer_name:'Dinheiro antigo fictício',delivery_type:'pickup',payment_method:'cash',payment_status:'pending',status:'delivered',subtotal:12.5,total:12.5,created_at:new Date().toISOString()}]});
  });
  await page.goto('/admin/pedidos');
  const item=page.getByRole('region',{name:'Recebimentos a conferir'}).locator('article').filter({hasText:'Dinheiro antigo fictício'});
  await expect(item.getByRole('button',{name:'Confirmar recebimento'})).toBeVisible();
  expect(retries).toBeGreaterThan(0);
});
