import { test, expect, type Page } from '@playwright/test';
import { mockBackend, STORE, ORDER } from './fixtures';
import { buildStaticPixCopyPaste } from '../../../src/utils/pix';

const pix=buildStaticPixCopyPaste({key:'test@example.invalid',receiver:'Loja Teste',city:'Teste',amount:12.5,txid:'PED42'});
async function openOrder(page:Page,token?:string) {
  await mockBackend(page);
  await page.route('**/rest/v1/rpc/food_get_receipt_destinations_v2',route=>route.fulfill({json:{mode:'general',contacts:[{slot:1,name:'Loja teste',phone:'5511000000001'}]}}));
  await page.addInitScript(({storeId,orderId,pixCode,receiptToken})=>{
    sessionStorage.setItem('foodservice_order_confirmation_v1_'+orderId,JSON.stringify({
      storeId,orderId,receiptToken,orderNumber:42,total:12.5,paymentMethod:'pix',customerName:'Pessoa fictícia',fulfillment:'delivery',
      storeName:'Loja teste',storeWhatsapp:'5511000000001',pixEnabled:true,pixReceiptMode:'copy_paste',pixKeyType:'random',pixKey:'',pixCopyPaste:pixCode,pixPayload:pixCode,pixReceiver:'Loja Teste',createdAt:new Date().toISOString()
    }));
  },{storeId:STORE,orderId:ORDER,pixCode:pix,receiptToken:token});
  await page.goto('/doce-lua/pedido/'+ORDER);
  await page.getByRole('button',{name:'Já fiz o PIX · enviar comprovante'}).click();
}

test('com autorização do checkout um clique registra o pagamento informado',async({page,context})=>{
  const calls:unknown[]=[];
  await context.route('https://wa.me/**',route=>route.fulfill({contentType:'text/plain',body:'Conversa de teste.'}));
  await openOrder(page,'checkout.receipt');
  await page.route('**/functions/v1/food-order-payment',route=>{
    calls.push(route.request().postDataJSON());
    return route.fulfill({json:{ok:true,status:'paid',autoPickedUp:false}});
  });
  const area=page.getByRole('region',{name:'Enviar comprovante'});
  const popup=page.waitForEvent('popup');
  await area.getByRole('button',{name:'Enviar comprovante pelo WhatsApp'}).click();
  const opened=await popup;
  await expect(area.getByRole('status')).toContainText('Pagamento marcado como pago');
  expect(calls).toEqual([{action:'report_receipt',token:'checkout.receipt'}]);
  await opened.close();
});

test('sem autorização o cliente é informado que precisa da conferência da loja',async({page})=>{
  await openOrder(page);
  await expect(page.getByText('A confirmação automática do pagamento está indisponível. Envie o comprovante e solicite a conferência da loja.')).toBeVisible();
});
