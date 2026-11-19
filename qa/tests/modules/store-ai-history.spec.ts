import { test, expect } from '@playwright/test';
import { mockBackend } from './fixtures';

for (const width of [320, 390, 1366]) test(`histórico recupera conversa e abre campo em ${width}px`,async({page})=>{
  await mockBackend(page,{auth:true});
  const conversations:any[]=[];const messages:any[]=[];
  await page.route('**/rest/v1/food_ai_conversations?**',route=>route.fulfill({json:conversations}));
  await page.route('**/rest/v1/food_ai_messages?**',route=>route.fulfill({json:[...messages].reverse()}));
  await page.route('**/rest/v1/rpc/food_ai_append_turn',route=>{const body=route.request().postDataJSON();if(!conversations.length)conversations.push({id:body.p_conversation,title:body.p_prompt});messages.push({role:'user',content:body.p_prompt},{role:'assistant',content:body.p_reply,source:body.p_source,actions:body.p_actions});return route.fulfill({json:body.p_conversation});});
  await page.route('**/functions/v1/food-store-ai',route=>route.fulfill({json:{text:'Ative Aceitar pedidos fora do horário e salve.',source:'orientacao',actions:[{label:'Abrir opção de pedidos fora do horário',href:'/admin/configuracoes#settings-pedidos-fora-horario'}]}}));
  await page.setViewportSize({width,height:844});
  await page.goto('/admin/ia');await page.getByLabel('Sua mensagem').fill('Como permitir pedidos com a loja fechada?');await page.getByRole('button',{name:'Enviar mensagem'}).click();
  await expect(page.getByText('Ative Aceitar pedidos fora do horário e salve.')).toBeVisible();
  await expect.poll(()=>messages.length).toBe(2);
  await page.reload();await page.locator('.store-ai__history summary').click();
  await page.getByRole('button',{name:'Como permitir pedidos com a loja fechada?'}).click();
  await expect(page.getByText('Ative Aceitar pedidos fora do horário e salve.')).toBeVisible();
  await page.getByRole('link',{name:'Abrir opção de pedidos fora do horário →'}).click();
  const field=page.locator('#settings-pedidos-fora-horario');await expect(field).toBeVisible();await expect(field.locator('input')).toBeFocused();
  await expect(page.locator('#settings-service')).not.toHaveClass(/is-collapsed/);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

test('Admin Master ajusta prazo e vê a estimativa de armazenamento',async({page})=>{
  await mockBackend(page,{auth:true,master:true});let current=30;
  await page.route('**/rest/v1/rpc/food_ai_history_admin',route=>{const requested=route.request().postDataJSON().p_retention_days;if(requested!==null)current=requested;return route.fulfill({json:{retention_days:current,conversations:2,messages:8,expired_conversations:0,storage_bytes:16384,recent_text_bytes:3000}})});
  await page.goto('/admin-master/ia');
  await expect(page.getByRole('heading',{name:'Central de IA',exact:true})).toBeVisible();
  await expect(page.getByText(/Uso atual:/)).toContainText('16.0 KB');
  await page.getByLabel('Guardar conversas por (dias)').fill('60');
  await expect(page.getByText(/Estimativa para 60 dias:/)).toBeVisible();
  await page.getByRole('button',{name:'Salvar prazo'}).click();
  await expect(page.getByRole('status').filter({hasText:'Prazo atualizado'})).toBeVisible();
});
