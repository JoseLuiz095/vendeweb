import { test, expect } from '@playwright/test';
import { mockBackend, store } from './fixtures';

test('lojista usa a IA e recebe aviso quando está indisponível',async({page})=>{
  await mockBackend(page,{auth:true});
  await page.route('**/rpc/food_get_admin_support_contact_v1',route=>route.fulfill({json:{support_whatsapp:'27999990000'}}));
  let available=true;const sent:any[]=[];
  await page.route('**/functions/v1/food-store-ai',route=>{sent.push(route.request().postDataJSON());return route.fulfill({status:available?200:503,contentType:'application/json',body:JSON.stringify(available?{text:'Sugestão para a loja.',source:'consulta',action:{label:'Conferir pedidos',href:'/admin/pedidos?queue=payment'}}:{error:'IA indisponível.'})});});
  await page.goto('/admin/ia');
  await expect(page.getByRole('heading',{name:'Central de IA'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await expect(page.getByText(/mensagens, anexos e o ramo da loja são enviados ao Google Gemini/)).toBeVisible();
  await expect(page.getByRole('link',{name:'Entrar em contato ↗'})).toHaveAttribute('href',/^https:\/\/wa\.me\/5527999990000\?/);
  await page.getByLabel('Sua mensagem').fill('Ideias para divulgar meus produtos');
  await page.locator('#store-ai-file').setInputFiles({name:'foto.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAAA','base64')});
  await page.getByRole('button',{name:'Enviar mensagem'}).click();
  await expect(page.getByRole('alert')).toContainText('Confirme');
  await page.getByRole('checkbox').check();
  await page.getByRole('button',{name:'Enviar mensagem'}).click();
  await expect(page.getByText('Sugestão para a loja.')).toBeVisible();
  await expect(page.getByText('Consulta ao sistema')).toBeVisible();
  await expect(page.getByRole('link',{name:'Conferir pedidos →'})).toHaveAttribute('href','/admin/pedidos?queue=payment');
  expect(sent[0].attachment.mime).toBe('image/png');
  available=false;
  await page.getByLabel('Sua mensagem').fill('Sugira outra ideia');
  await page.getByRole('button',{name:'Enviar mensagem'}).click();
  await expect(page.getByRole('alert')).toContainText('Não foi possível');
  await expect(page.getByRole('link',{name:'Entrar em contato ↗'})).toBeVisible();
  expect(sent[1].history).toHaveLength(1);
  expect(sent[1].history[0].role).toBe('user');
});

test('botão de ajuda abre o assistente e mantém o contato direto',async({page})=>{
  await mockBackend(page,{auth:true});
  await page.route('**/rpc/food_get_admin_support_contact_v1',route=>route.fulfill({json:{support_whatsapp:'27999990000'}}));
  await page.goto('/admin');
  await page.getByRole('link',{name:'Abrir assistente de ajuda'}).click();
  await expect(page).toHaveURL(/\/admin\/ia$/);
  await expect(page.getByRole('link',{name:'Entrar em contato ↗'})).toHaveAttribute('href',/^https:\/\/wa\.me\/5527999990000\?/);
});
test('loja em preparação mantém o suporte direto quando a IA não está liberada',async({page})=>{
  await mockBackend(page,{auth:true});
  await page.route('**/rest/v1/food_stores?**',route=>route.fulfill({json:[{...store,approval_status:'pending',access_status:'suspended'}]}));
  await page.route('**/rpc/food_get_admin_support_contact_v1',route=>route.fulfill({json:{support_whatsapp:'27999990000'}}));
  await page.goto('/admin');
  await expect(page.getByRole('link',{name:'Abrir suporte da VendeWeb no WhatsApp'})).toHaveAttribute('href',/^https:\/\/wa\.me\/5527999990000\?/);
});


