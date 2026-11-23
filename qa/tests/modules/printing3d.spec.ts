import { test, expect, type Page } from '@playwright/test';
import { mockBackend, STORE } from './fixtures';

const material='d0000000-0000-4000-8000-000000000001',second='d0000000-0000-4000-8000-000000000002';
const id='e0000000-0000-4000-8000-000000000001';
const plan={hours:1,time_basis:'piece',materials:[{inventory_item_id:material,quantity:20,unit:'g',basis:'piece'}]};
async function setup(page:Page,segment='printing3d') {
  await mockBackend(page,{auth:true,enabled:true});
  const writes:any[]=[];
  const jobs:any[]=[{id,description:'Chaveiros em PLA',quantity:3,plan,status:'waiting',revision:0,agreed_total_cents:7500,quote_snapshot:{base_cents:1200},order_id:null}];
  const records:any[]=[];const purchases:any[]=[];
  await page.route('**/rpc/food_business_status',r=>r.fulfill({json:{profile:{store_id:STORE,primary_segment:segment},legacy:false,modules:[{code:'custom',effective:true}]}}));
  await page.route('**/rest/v1/food_inventory_items?**',r=>r.fulfill({json:[{id:material,store_id:STORE,name:'PLA azul',item_type:'other',unit:'kg',current_quantity:.5,average_unit_cost:50,reorder_point:.1,active:true},{id:second,store_id:STORE,name:'PLA branco',item_type:'other',unit:'g',current_quantity:30,average_unit_cost:.05,reorder_point:50,active:true}]}));
  await page.route('**/rest/v1/food_print_jobs?**',r=>r.fulfill({json:jobs}));
  await page.route('**/rest/v1/food_print_records?**',r=>r.fulfill({json:records}));
  await page.route('**/rest/v1/food_inventory_purchases?**',r=>r.fulfill({json:purchases}));
  await page.route('**/rest/v1/food_inventory_purchase_items?**',r=>r.fulfill({json:[]}));
  await page.route('**/rpc/food_printing3d_command_v1',async r=>{
    const body=r.request().postDataJSON();writes.push(body);const d=body.p_data;
    if(body.p_action==='finish'||body.p_action==='correct') {const j=jobs.find(j=>j.id===d.id);Object.assign(j,{status:d.outcome,revision:j.revision+1});records.unshift({...d,job_id:d.id,id:`r${records.length}`,revision:j.revision,kind:body.p_action==='correct'?'correction':'finish',created_at:new Date().toISOString()});}
    if(body.p_action==='retry')jobs.push({...jobs[0],id:'retry',status:'waiting',revision:0,retry_of:jobs[0].id});
    await r.fulfill({json:{id:d.id||'created'}});
  });
  await page.goto('/admin/modulos?tab=custom');
  return {writes,jobs};
}

for(const width of [320,390,768,1366]) test(`produção e consumo responsivos em ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  const {writes}=await setup(page);
  await expect(page.getByRole('heading',{name:'Produção 3D',exact:true})).toBeVisible();
  expect(writes).toHaveLength(0);
  await page.getByRole('button',{name:'Registrar resultado e consumo'}).click();
  const form=page.getByRole('form',{name:'Confirmar consumo'});
  await expect(form.getByLabel('Consumo total',{exact:true})).toHaveValue('60');
  await expect(form.getByText('Saldo atual estimado: 0,5 kg · após este lançamento: 0,44 kg')).toBeVisible();
  await form.getByLabel('Consumo total',{exact:true}).fill('55');
  await expect(form.getByLabel('Origem do consumo')).toHaveValue('measured_manual');
  await form.getByRole('combobox',{name:'Resultado',exact:true}).selectOption('interrupted');
  await form.getByLabel('Peças produzidas').fill('1');
  await form.getByRole('button',{name:'Adicionar material utilizado'}).click();
  await form.getByLabel('Material utilizado').nth(1).selectOption(second);
  await form.getByLabel('Consumo total',{exact:true}).nth(1).fill('10');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2)).toBe(true);
  await page.screenshot({path:`test-results/print3d-${width}.png`,fullPage:true});
  await form.getByRole('button',{name:'Confirmar consumo',exact:true}).click();
  await expect(form).toHaveCount(0);
  expect(writes.filter(w=>w.p_action==='finish')).toHaveLength(1);
  expect(writes[0].p_data).toMatchObject({pieces:1,outcome:'interrupted',materials:[{quantity:55,origin:'measured_manual'},{quantity:10,origin:'measured_manual'}]});
  await page.getByLabel('Mostrar trabalhos').selectOption('all');
  await page.getByRole('button',{name:'Corrigir consumo'}).click();
  await form.getByLabel('Motivo da correção (obrigatório)').fill('Pesagem conferida');
  await form.getByLabel('Consumo total',{exact:true}).first().fill('50');
  await form.getByRole('button',{name:'Confirmar correção'}).click();
  await expect(form).toHaveCount(0);
  expect(writes.filter(w=>w.p_action==='correct')).toHaveLength(1);
  await page.getByRole('button',{name:'Ver histórico'}).click();
  await expect(page.getByRole('region',{name:'Histórico de consumo'})).toContainText('Pesagem conferida');
  await expect(page.getByRole('region',{name:'Histórico de consumo'})).toContainText('Registro inicial');
  expect(errors).toEqual([]);
});

test('orçamento e calculadora aproveitam previsão por peça',async({page})=>{
  const {writes}=await setup(page);
  await page.getByText('Cadastrar orçamento',{exact:true}).click();
  await page.getByText('Calcular preço sugerido (opcional)',{exact:true}).click();
  await page.getByRole('button',{name:'Usar no orçamento'}).click();
  await page.getByLabel('Cliente ou empresa').fill('Cliente fictício');
  await page.getByLabel('WhatsApp',{exact:true}).fill('11999999999');
  await page.getByLabel('Quantidade',{exact:true}).fill('4');
  await page.getByLabel('Tamanho / dimensões').fill('5cm');await page.getByLabel('Material',{exact:true}).fill('PLA');await page.getByLabel('Cor',{exact:true}).fill('Azul');await page.getByLabel('Prazo',{exact:true}).fill('2027-01-10T10:00');
  await page.getByRole('combobox',{name:'Material 1',exact:true}).selectOption(material);
  await expect(page.getByText('Total previsto: 80 g para 4 peças')).toBeVisible();
  await page.getByRole('combobox',{name:'Situação',exact:true}).selectOption('approved');
  await page.getByRole('button',{name:'Salvar orçamento',exact:true}).click();
  await expect.poll(()=>writes.length).toBe(1);
  expect(writes[0].p_action).toBe('quote_save');
  expect(writes[0].p_data).toMatchObject({quantity:4,status:'approved',print_plan:{hours:2,time_basis:'piece',materials:[{quantity:20,basis:'piece',inventory_item_id:material}]}});
});

test('reenvio após erro de rede conserva chave e bloqueia requisições simultâneas',async({page})=>{
  const {writes}=await setup(page);let calls:any[]=[];
  await page.route('**/rpc/food_printing3d_command_v1',async r=>{calls.push(r.request().postDataJSON());await r.fulfill({status:503,json:{message:'Falha temporária'}});});
  await page.getByRole('button',{name:'Registrar resultado e consumo'}).click();
  const button=page.getByRole('button',{name:'Confirmar consumo',exact:true});
  await button.click();await expect(page.getByRole('alert')).toContainText('Falha temporária');
  await button.click();await expect.poll(()=>calls.length).toBe(2);
  expect(calls[0].p_key).toBe(calls[1].p_key);expect(writes).toHaveLength(0);
});

test('ramo de alimentação mantém personalizados sem produção 3D',async({page})=>{
  const {writes}=await setup(page,'food');
  await expect(page.getByRole('heading',{name:'Orçamentos e personalizados'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Produção 3D',exact:true})).toHaveCount(0);expect(writes).toHaveLength(0);
});


test('reutilização copia parâmetros sem contatos, prazo ou observações do cliente',async({page})=>{
 await mockBackend(page,{auth:true,enabled:true});
 await page.route('**/rpc/food_business_status',r=>r.fulfill({json:{profile:{store_id:STORE,primary_segment:'printing3d'},legacy:false,modules:[{code:'custom',effective:true}]}}));
 await page.route('**/rest/v1/food_custom_requests?**',r=>r.fulfill({json:[{id,customer_name:'Contato anterior',customer_phone:'11988887777',quantity:4,size:'5cm',material:'PLA',color:'Azul',due_at:'2027-01-01T12:00:00Z',notes:'Dados particulares',status:'quote',quote:null,final_cents:2000,print_plan:plan}]}));
 await page.goto('/admin/modulos?tab=custom');
 await page.getByRole('button',{name:'Reutilizar parâmetros'}).click();
 const form=page.getByRole('form',{name:'Orçamento personalizado'});
 await expect(form.getByLabel('Cliente ou empresa')).toHaveValue('');
 await expect(form.getByLabel('WhatsApp',{exact:true})).toHaveValue('');
 await expect(form.getByLabel('Observações',{exact:true})).toHaveValue('');
 await expect(form.getByLabel('Prazo',{exact:true})).toHaveValue('');
 await expect(form.getByLabel('Quantidade',{exact:true})).toHaveValue('4');
 await expect(form.getByLabel('Material',{exact:true})).toHaveValue('PLA');
});

test('compras planejadas exigem confirmação de recebimento separada',async({page})=>{
 const {writes}=await setup(page);
 await page.getByText('Planejar compra de materiais',{exact:true}).click();
 const section=page.getByRole('region',{name:'Compra de materiais'});
 await section.getByRole('combobox',{name:'Insumo da compra'}).selectOption(material);
 await section.getByLabel('Quantidade na unidade do insumo').fill('1');
 await section.getByLabel('Custo por unidade do insumo (R$)').fill('50');
 await section.getByRole('button',{name:'Salvar compra sem entrada no estoque'}).click();
 await expect.poll(()=>writes.length).toBe(1);
 expect(writes[0]).toMatchObject({p_action:'purchase_plan',p_data:{stage:'planned',items:[{inventory_item_id:material,quantity:1,unit:'kg',unit_cost:50}]}});
});

test('fila encontra trabalhos e filtra pendências sem alterar estoque',async({page})=>{
  const {writes,jobs}=await setup(page);
  jobs.push({id:'outro-trabalho',description:'Suporte personalizado',quantity:4,plan:{hours:2,time_basis:'batch',materials:[]},status:'waiting',revision:0,agreed_total_cents:null,quote_snapshot:null,order_id:null});
  await page.getByRole('button',{name:'Atualizar',exact:true}).click();
  await expect(page.getByText('Suporte personalizado')).toBeVisible();
  await page.getByLabel('Buscar trabalho').fill('suporte');
  await expect(page.getByText('Suporte personalizado')).toBeVisible();
  await expect(page.getByText('Chaveiros em PLA')).toHaveCount(0);
  await page.getByLabel('Buscar trabalho').fill('inexistente');
  await expect(page.getByText('Nenhum trabalho encontrado com esses filtros.')).toBeVisible();
  await page.getByLabel('Buscar trabalho').clear();
  await page.getByLabel('Mostrar trabalhos').selectOption('pending');
  await expect(page.getByText('Suporte personalizado')).toBeVisible();
  await expect(page.getByText('Chaveiros em PLA')).toHaveCount(0);
  expect(writes).toHaveLength(0);
});
