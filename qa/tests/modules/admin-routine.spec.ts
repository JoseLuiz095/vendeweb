import {test,expect} from '@playwright/test';
import {mockBackend,STORE} from './fixtures';
for(const segment of ['food','confectionery','florist','retail','services','rentals','printing3d','personal','fitness','nutrition','creator'])test(`rotina operacional usa cadastro e módulos: ${segment}`,async({page})=>{
 await mockBackend(page,{auth:true});await page.setViewportSize({width:390,height:850});
 const codes=segment==='creator'?['creator']:['personal','fitness','nutrition','services'].includes(segment)?['clients','appointments']:[];
 await page.route('**/rpc/food_business_status',r=>r.fulfill({json:{profile:{store_id:STORE,primary_segment:segment},legacy:false,can_initialize:false,modules:codes.map(code=>({code,effective:true}))}}));
 await page.goto('/admin');if(segment==='fitness')await page.getByText('Mais ferramentas e informações da loja').click();const hub=page.getByRole('region',{name:'Rotinas e ferramentas'});
 const expand=hub.getByRole('button',{name:/Ver todas as ferramentas/});if(await expand.count())await expand.click();
 await expect(hub.getByRole('link',{name:/Conferir pagamentos/})).toHaveAttribute('href','/admin/pedidos?queue=payment');
 if(codes.includes('appointments'))await expect(hub.getByRole('link',{name:'Agenda Organizar atendimentos'})).toHaveAttribute('href',segment==='fitness'?'/admin/fitness':'/admin/operacao?tab=appointments');
 else await expect(hub.getByRole('link',{name:'Agenda Organizar atendimentos'})).toHaveCount(0);
 if(segment==='fitness')await expect(hub.getByRole('link',{name:/Alunos Cadastro/})).toBeVisible();
 await hub.getByLabel('Buscar ferramenta').fill('preco');await expect(hub.getByRole('link')).toHaveCount(1);await expect(hub.getByRole('link')).toContainText('Preços');
 await hub.getByLabel('Buscar ferramenta').fill('inexistente');await expect(hub.getByRole('status')).toContainText('Nenhuma ferramenta');await hub.getByRole('button',{name:'Limpar busca'}).click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});

for (const [name,codes] of [['com nutrição',['clients','appointments','training','nutrition']],['sem nutrição',['clients','appointments','training']]] as const) test(`painel Fitness ${name} respeita módulos e agenda`,async({page})=>{
 await mockBackend(page,{auth:true});await page.setViewportSize({width:390,height:850});
 await page.route('**/rpc/food_business_status',r=>r.fulfill({json:{profile:{store_id:STORE,primary_segment:'fitness'},legacy:false,can_initialize:false,modules:codes.map(code=>({code,effective:true}))}}));
 await page.route('**/rpc/food_fitness_status',r=>r.fulfill({json:{appointments:[{id:'futuro',starts_at:'2099-01-01T17:00:00Z',status:'confirmed'},{id:'cancelado',starts_at:'2099-01-02T17:00:00Z',status:'cancelled'}]}}));
 await page.goto('/admin');const home=page.getByRole('region',{name:'Início Fitness'});
 await expect(home.getByRole('link',{name:/Fichas de treino/})).toBeVisible();
 await expect(home.getByRole('link',{name:/Nutrição/})).toHaveCount(name==='com nutrição'?1:0);
 await expect(home.getByText('Confirmado')).toBeVisible();await expect(home.getByText('Cancelado')).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
});
