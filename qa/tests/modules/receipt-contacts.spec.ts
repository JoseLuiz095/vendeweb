import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import {mockBackend,STORE,ORDER} from './fixtures';
import {buildStaticPixCopyPaste} from '../../../src/utils/pix';
const point='30000000-0000-4000-8000-000000000001';
const anotherPoint='30000000-0000-4000-8000-000000000002';
const options=[{pointId:point,slot:1,name:'Ponto Centro',phone:'5511000000001'},{pointId:anotherPoint,slot:1,name:'Ponto Bairro',phone:'5511000000002'}];
const contacts=[{slot:1,name:'Admin sintético A',phone:'5511000000001'},{slot:2,name:'Admin sintético B',phone:'5511000000002'}];
const pix=buildStaticPixCopyPaste({key:'test@example.invalid',receiver:'Loja Teste',city:'Linhares',amount:12.5,txid:'PED42'});
async function setup(page:any,auth=false){
 const external:string[]=[],writes:string[]=[];
 await page.route('**/*',(r:any)=>{const u=new URL(r.request().url());if((u.hostname==='127.0.0.1'&&['5174','5193'].includes(u.port))||u.protocol==='data:')return r.continue();external.push(u.origin);return r.abort('blockedbyclient')});
 await mockBackend(page,{auth});
 page.on('request',(r:any)=>{if(r.method()!=='GET'&&/confirm|update_order|adjust|transfer|financial/.test(r.url()))writes.push(r.url())});
 return {external,writes};
}
async function success(page:any,pointId?:string){await page.addInitScript(({storeId,orderId,pickupId,pixCode}:any)=>sessionStorage.setItem(`foodservice_order_confirmation_v1_${orderId}`,JSON.stringify({storeId,receiptPickupLocationId:pickupId,receiptToken:'test.receipt',orderId,orderNumber:42,total:12.5,paymentMethod:'pix',customerName:'Pessoa sintética',fulfillment:pickupId?'pickup':'delivery',storeName:'Loja sintética',storeWhatsapp:'5511000000099',pixEnabled:true,pixReceiptMode:'copy_paste',pixKeyType:'random',pixKey:'',pixCopyPaste:pixCode,pixPayload:pixCode,pixReceiver:'Loja Teste',orderMessage:'Pedido sintético',createdAt:new Date().toISOString()})),{storeId:STORE,orderId:ORDER,pickupId:pointId,pixCode:pix});await page.goto(`/doce-lua/pedido/${ORDER}`);await expect(page.getByRole('navigation',{name:'Etapas do pagamento PIX'})).toContainText('1. Pagar com PIX');await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);await page.getByRole('button',{name:'Já fiz o PIX · enviar comprovante'}).click()}
for(const width of [320,390,768,1366])test(`link geral sem WhatsApp escolhe ponto e link do ponto tem destino direto ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:width===320?640:width===390?844:900});const {external,writes}=await setup(page);
 await page.route('**/rest/v1/rpc/food_get_receipt_destinations_v2',(r:any)=>{const b=r.request().postDataJSON();expect(b.p_store_id).toBe(STORE);return r.fulfill({json:{mode:b.p_pickup_location_id?'point':'selection',contacts:b.p_pickup_location_id?[contacts[1]]:options}})});
 await success(page);const section=page.getByRole('region',{name:'Enviar comprovante'});await expect(section.getByRole('combobox')).toBeVisible();await expect(section.getByRole('link')).toHaveCount(0);await expect(section.getByRole('button',{name:'Selecione um destino para enviar o comprovante'})).toBeVisible();await page.getByRole('button',{name:'Voltar para os dados do PIX'}).click();await expect(page.getByRole('button',{name:'Já fiz o PIX · enviar comprovante'})).toBeVisible();await page.getByRole('button',{name:'Já fiz o PIX · enviar comprovante'}).click();
 await section.getByRole('combobox').selectOption(`${point}:1`);await expect(section.getByRole('link')).toHaveAttribute('href',/^https:\/\/wa.me\/5511000000001\?/);
 await section.getByRole('combobox').selectOption(`${anotherPoint}:1`);await expect(section.getByRole('link')).toHaveAttribute('href',/^https:\/\/wa.me\/5511000000002\?/);
 await success(page,point);await expect(section.getByText('Destino:',{exact:false})).toContainText('Admin sintético B');await expect(section.getByRole('combobox')).toHaveCount(0);await expect(section.getByRole('link')).toHaveAttribute('href',/^https:\/\/wa.me\/5511000000002\?/);
 expect(writes).toEqual([]);expect(external).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1&&document.documentElement.scrollHeight<=innerHeight+1)).toBe(true);
 const a=await new AxeBuilder({page}).include('.receipt-destination').withTags(['wcag2a','wcag2aa']).analyze();expect(a.violations).toEqual([]);
});
test('link Pix novo usa destinos do servidor sem consulta por ID ou confirmação',async({page})=>{
 const {writes,external}=await setup(page);await page.route('**/functions/v1/food-order-payment',(r:any)=>{expect(r.request().postDataJSON()).toEqual({action:'resolve',token:'encrypted.capability'});return r.fulfill({json:{status:'pending',storeName:'Loja Teste',orderNumber:42,total:12.5,receiver:'Loja Teste',pixPayload:pix,expiresAt:new Date(Date.now()+3600000).toISOString(),receiptDestinations:{mode:'point',contacts:[contacts[1]]}}})});
 await page.goto('/pagamento/pix#encrypted.capability');await page.getByRole('button',{name:'Já fiz o PIX · enviar comprovante'}).click();await expect(page.getByRole('link',{name:'Abrir WhatsApp e enviar comprovante'})).toHaveAttribute('href',/^https:\/\/wa.me\/5511000000002\?/);await expect(page.getByText('Aguardando confirmação da loja. Enviar o comprovante não verifica o recebimento bancário.')).toBeVisible();expect(writes).toEqual([]);expect(external).toEqual([]);
});
test('link Pix sem contrato de destinos mostra etapa e impede encaminhamento indevido',async({page})=>{
 await setup(page);await page.route('**/functions/v1/food-order-payment',r=>r.fulfill({json:{status:'pending',storeName:'Loja Teste',orderNumber:42,total:12.5,receiver:'Loja Teste',pixPayload:pix,expiresAt:new Date(Date.now()+3600000).toISOString()}}));
 await page.goto('/pagamento/pix#encrypted.capability');await page.getByRole('button',{name:'Já fiz o PIX · enviar comprovante'}).click();
 const section=page.getByRole('region',{name:'Enviar comprovante'});await expect(section).toContainText('destino do comprovante não está disponível');await expect(section.getByRole('link')).toHaveCount(0);
});
test('erro não encaminha ao contato errado; retry e ponto indisponível são explícitos',async({page})=>{
 await setup(page);let mode='error';await page.route('**/rest/v1/rpc/food_get_receipt_destinations_v2',(r:any)=>r.fulfill(mode==='error'?{status:503,json:{message:'Erro sintético'}}:{json:{mode,contacts:[]}}));
 await success(page,point);const section=page.getByRole('region',{name:'Enviar comprovante'});await expect(section.getByRole('alert')).toBeVisible();await expect(section.getByRole('link')).toHaveCount(0);mode='unavailable';await section.getByRole('button').click();await expect(section).toContainText('destino do comprovante não está disponível');await expect(section.getByRole('link')).toHaveCount(0);
});
test('configuração salva dois contatos e vínculo sem regravar configurações gerais',async({page})=>{
 const {external}=await setup(page,true);let saved:any;
 await page.route('**/rest/v1/food_receipt_contacts?**',(r:any)=>r.fulfill({json:contacts}));await page.route('**/rest/v1/food_pickup_receipt_contacts?**',(r:any)=>r.fulfill({json:[{pickup_location_id:point,contact_slot:2}]}));await page.route('**/rest/v1/food_pickup_locations?**',(r:any)=>r.fulfill({json:[{id:point,name:'Ponto sintético'}]}));await page.route('**/rest/v1/rpc/food_save_receipt_contacts_v1',(r:any)=>{saved=r.request().postDataJSON();return r.fulfill({json:null})});
 await page.goto('/admin/configuracoes');const section=page.getByRole('region',{name:'Destinos dos comprovantes'});await expect(section.getByRole('combobox')).toHaveCount(0);await expect(section.getByText('Contato 1')).toHaveCount(0);await section.getByRole('checkbox',{name:'Conferi os destinos de comprovantes dos pontos.'}).check();await section.getByRole('button',{name:'Salvar regras de comprovantes'}).click();await expect(section.getByRole('status')).toHaveText('Regras dos comprovantes salvas.');expect(saved).toEqual({p_store_id:STORE,p_contacts:contacts,p_points:[{pickup_location_id:point,contact_slot:2}]});expect(external).toEqual([]);
});
test('ponto sem número exclusivo usa o WhatsApp cadastrado da loja',async({page})=>{
 await setup(page);await page.route('**/rest/v1/rpc/food_get_receipt_destinations_v2',r=>r.fulfill({json:{mode:'unassigned',contacts:[]}}));
 await success(page,point);const section=page.getByRole('region',{name:'Enviar comprovante'});await expect(section).toContainText('WhatsApp da loja');await expect(section.getByRole('link',{name:'Abrir WhatsApp e enviar comprovante'})).toHaveAttribute('href',/^https:\/\/wa.me\/5511000000099\?/);
});
test('abrir WhatsApp não informa pagamento; confirmação explícita registra o envio',async({page,context})=>{
 await setup(page);let reports=0;
 await page.route('**/rest/v1/rpc/food_get_receipt_destinations_v2',r=>r.fulfill({json:{mode:'point',contacts:[contacts[0]]}}));
 await page.route('**/functions/v1/food-order-payment',r=>{expect(r.request().postDataJSON()).toEqual({action:'report_receipt',token:'test.receipt'});reports++;return r.fulfill({json:{ok:true,status:'reported',paymentReportedByCustomer:true,autoPickedUp:false}})});
 await context.route('https://wa.me/**',r=>r.fulfill({contentType:'text/plain',body:'Canal sintético.'}));
 await success(page,point);const section=page.getByRole('region',{name:'Enviar comprovante'});expect(reports).toBe(0);
 const popup=page.waitForEvent('popup');await section.getByRole('link',{name:'Abrir WhatsApp e enviar comprovante'}).click();await (await popup).close();expect(reports).toBe(0);
 await section.getByRole('button',{name:'Já enviei o comprovante'}).click();await expect(section.getByRole('status')).toContainText('Comprovante informado');expect(reports).toBe(1);
});
test('WhatsApp exclusivo do ponto é cadastrado em Configurações',async({page})=>{
 await setup(page,true);let saved:any;
 await page.route('**/rest/v1/food_pickup_locations?**',r=>r.fulfill({json:[{id:point,name:'Ponto sintético',auto_pickup_on_receipt:false}]}));
 await page.route('**/rest/v1/food_pickup_point_contacts?**',r=>r.fulfill({json:[]}));
 await page.route('**/rest/v1/rpc/food_save_pickup_point_contacts_v1',r=>{saved=r.request().postDataJSON();return r.fulfill({json:null})});
 await page.goto('/admin/configuracoes');const editor=page.locator('.point-contacts-editor');await expect(editor).toContainText('Comprovantes de Ponto sintético');
 await editor.getByRole('textbox',{name:'Nome para identificação'}).fill('Contato do ponto');await editor.getByRole('textbox',{name:'WhatsApp com código do país'}).fill('5511000000002');
 await editor.getByRole('button',{name:'Salvar WhatsApp do ponto'}).click();await expect(editor.getByRole('status')).toHaveText('WhatsApp para comprovantes salvo.');
 expect(saved).toEqual({p_store_id:STORE,p_point_id:point,p_contacts:[{slot:1,name:'Contato do ponto',phone:'5511000000002',purpose:'proof'}]});
});
test('zero e um contato preservam compatibilidade; abrir conversa só registra clique',async({page,context})=>{
 const {writes}=await setup(page);let list:any[]=[],clicked=0;
 await page.route('**/rest/v1/rpc/food_get_receipt_destinations_v2',r=>r.fulfill({json:{mode:'general',contacts:list}}));
 await page.route('**/rest/v1/rpc/food_mark_public_order_whatsapp_clicked',r=>{expect(r.request().postDataJSON()).toEqual({p_order_id:ORDER});clicked++;return r.fulfill({json:null})});
 await context.route('https://wa.me/**',r=>r.fulfill({contentType:'text/plain',body:'Canal sintético. Nenhuma mensagem enviada.'}));
 await success(page);const section=page.getByRole('region',{name:'Enviar comprovante'});await expect(section.getByRole('link')).toHaveAttribute('href',/^https:\/\/wa.me\/5511000000099\?/);
 list=[contacts[0]];await page.reload();await page.getByRole('button',{name:'Já fiz o PIX · enviar comprovante'}).click();await expect(section.getByRole('combobox')).toHaveCount(0);await expect(section.getByRole('link')).toHaveAttribute('href',/^https:\/\/wa.me\/5511000000001\?/);
 const popup=page.waitForEvent('popup');await section.getByRole('link').click();await (await popup).close();await expect.poll(()=>clicked).toBe(1);expect(writes).toEqual([]);
});
test('falha ao carregar cadastro impede salvar configuração vazia',async({page})=>{
 await setup(page,true);let saves=0;
 await page.route('**/rest/v1/food_receipt_contacts?**',r=>r.fulfill({status:503,json:{message:'Erro sintético'}}));
 await page.route('**/rest/v1/rpc/food_save_receipt_contacts_v1',r=>{saves++;return r.fulfill({json:null})});
 await page.goto('/admin/configuracoes');const section=page.getByRole('region',{name:'Destinos dos comprovantes'});await expect(section.getByRole('alert')).toBeVisible();await expect(section.getByRole('button',{name:'Salvar regras de comprovantes'})).toBeDisabled();expect(saves).toBe(0);
});
test('compra de entrega pelo link do ponto preserva origem sem mudar retirada/estoque',async({page})=>{
 await setup(page);let payload:any;
 await page.route('**/rest/v1/rpc/food_get_public_pickup_locations_v1',r=>r.fulfill({json:[{id:point,name:'Ponto sintético Centro',short_code:'CENTRO'}]}));
 await page.route('**/rest/v1/rpc/food_get_public_location_availability_v1',r=>r.fulfill({json:[{product_id:'20000000-0000-4000-8000-000000000001',available:20,available_elsewhere:false}]}));
 await page.route('**/functions/v1/food-public-checkout',r=>{payload=r.request().postDataJSON().payload;return r.fulfill({json:{orderId:ORDER,orderNumber:42,total:15,receiptPickupLocationId:point}})});
 await page.route('**/rest/v1/rpc/food_get_receipt_destinations_v2',r=>{expect(r.request().postDataJSON()).toEqual({p_store_id:STORE,p_pickup_location_id:point});return r.fulfill({json:{mode:'point',contacts:[contacts[1]]}})});
 await page.goto('/doce-lua/produto/brigadeiro-teste?ponto=CENTRO');await page.getByRole('button',{name:'Adicionar ao carrinho',exact:true}).click();await page.goto('/doce-lua/carrinho?ponto=CENTRO');await page.getByRole('link',{name:'Continuar',exact:true}).click();
 await page.getByRole('button',{name:'Delivery Receber no endereço'}).click();await page.getByLabel('Nome',{exact:true}).fill('Pessoa sintética');await page.getByLabel(/WhatsApp/).first().fill('11000000001');await page.getByLabel('Bairro / área').selectOption({index:1});await page.getByLabel('Rua',{exact:true}).fill('Rua sintética');await page.getByLabel('Número',{exact:true}).fill('1');await page.getByRole('button',{name:/^PIX/}).click();await page.getByRole('button',{name:/Registrar pedido|Finalizar/}).filter({visible:true}).first().click();
 await expect(page).toHaveURL(new RegExp(ORDER));expect(payload).toMatchObject({store_id:STORE,delivery_type:'delivery',pickup_location_id:null,receipt_pickup_location_id:point});await page.getByRole('button',{name:'Já fiz o PIX · enviar comprovante'}).click();await expect(page.getByRole('region',{name:'Enviar comprovante'}).getByRole('link')).toHaveAttribute('href',/^https:\/\/wa.me\/5511000000002\?/);
});
test('link geral continua oferecendo escolha mesmo quando o cliente escolhe retirada',async({page})=>{
 await setup(page);let payload:any;
 await page.route('**/rest/v1/rpc/food_get_public_pickup_locations_v1',r=>r.fulfill({json:[{id:point,name:'Ponto sintético Centro',short_code:'CENTRO'}]}));
 await page.route('**/rest/v1/rpc/food_get_public_location_availability_v1',r=>r.fulfill({json:[{product_id:'20000000-0000-4000-8000-000000000001',available:20,available_elsewhere:false}]}));
 await page.route('**/functions/v1/food-public-checkout',r=>{payload=r.request().postDataJSON().payload;return r.fulfill({json:{orderId:ORDER,orderNumber:42,total:10,receiptPickupLocationId:null}})});
 await page.route('**/rest/v1/rpc/food_get_receipt_destinations_v2',r=>{expect(r.request().postDataJSON()).toEqual({p_store_id:STORE,p_pickup_location_id:null});return r.fulfill({json:{mode:'selection',contacts:options}})});
 await page.goto('/doce-lua/produto/brigadeiro-teste');await page.getByRole('button',{name:'Adicionar ao carrinho',exact:true}).click();await page.goto('/doce-lua/carrinho');await page.getByRole('link',{name:'Continuar',exact:true}).click();await page.getByRole('button',{name:/Retirada Buscar/}).click();await page.getByRole('combobox',{name:'Ponto de retirada',exact:true}).selectOption(point);await page.getByLabel('Nome',{exact:true}).fill('Pessoa sintética');await page.getByLabel(/WhatsApp/).first().fill('11000000001');await page.getByRole('button',{name:/^PIX/}).click();await page.getByRole('button',{name:/Registrar pedido|Finalizar/}).filter({visible:true}).first().click();
 await expect(page).toHaveURL(new RegExp(ORDER));expect(payload).toMatchObject({delivery_type:'pickup',pickup_location_id:point,receipt_pickup_location_id:null});await page.getByRole('button',{name:'Já fiz o PIX · enviar comprovante'}).click();await expect(page.getByRole('region',{name:'Enviar comprovante'}).getByRole('combobox')).toBeVisible();
});
