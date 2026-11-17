import { test, expect } from '@playwright/test';
import { mockBackend } from './fixtures';

test('lojista usa a IA e recebe aviso quando está indisponível',async({page})=>{
  await mockBackend(page,{auth:true});
  let available=true;
  await page.route('**/functions/v1/food-store-ai',route=>route.fulfill({status:available?200:503,contentType:'application/json',body:JSON.stringify(available?{text:'Sugestão para a loja.'}:{error:'IA indisponível.'})}));
  await page.goto('/admin/ia');
  await expect(page.getByRole('heading',{name:'Central de IA'})).toBeVisible();
  await expect(page.getByText(/texto será enviado ao Google Gemini/)).toBeVisible();
  await page.getByLabel('Como posso ajudar?').fill('Ideias para divulgar meus produtos');
  await page.getByRole('button',{name:'Enviar para a IA'}).click();
  await expect(page.getByText('Sugestão para a loja.')).toBeVisible();
  available=false;
  await page.getByRole('button',{name:'Enviar para a IA'}).click();
  await expect(page.getByRole('alert')).toContainText('IA indisponível');
});

