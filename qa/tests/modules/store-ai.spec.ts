import { test, expect } from '@playwright/test';
import { mockBackend } from './fixtures';

test('lojista usa a IA e recebe aviso quando está indisponível',async({page})=>{
  await mockBackend(page,{auth:true});
  let available=true;const sent:any[]=[];
  await page.route('**/functions/v1/food-store-ai',route=>{sent.push(route.request().postDataJSON());return route.fulfill({status:available?200:503,contentType:'application/json',body:JSON.stringify(available?{text:'Sugestão para a loja.'}:{error:'IA indisponível.'})});});
  await page.goto('/admin/ia');
  await expect(page.getByRole('heading',{name:'Central de IA'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expect(page.getByText(/mensagens e anexos são enviados ao Google Gemini/)).toBeVisible();
  await page.getByLabel('Sua mensagem').fill('Ideias para divulgar meus produtos');
  await page.locator('#store-ai-file').setInputFiles({name:'foto.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAAA','base64')});
  await page.getByRole('button',{name:'Enviar mensagem'}).click();
  await expect(page.getByRole('alert')).toContainText('Confirme');
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Enviar mensagem'}).click();
  await expect(page.getByText('Sugestão para a loja.')).toBeVisible();
  expect(sent[0].attachment.mime).toBe('image/png');
  available=false;
  await page.getByLabel('Sua mensagem').fill('Sugira outra ideia');
  await page.getByRole('button',{name:'Enviar mensagem'}).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível');
  expect(sent[1].history).toHaveLength(2);
});


