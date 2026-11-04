import { expect, test, type Page } from '@playwright/test';

const store = '10000000-0000-4000-8000-000000000001';
const user = '20000000-0000-4000-8000-000000000001';
const client = '30000000-0000-4000-8000-000000000001';

async function mockStudent(page: Page, mediaKey = '', exercises?: Array<{
  id:string; position:number; name:string; sets:number; repetitions:string; rest_seconds:number;
  load_or_effort:string; instructions:string; alternative:string; media_key:string; day?:string;
}>) {
  await page.addInitScript(({user}) => {
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = { sub: user, session_id: '40000000-0000-4000-8000-000000000001', role: 'authenticated', exp };
    const token = 'header.' + btoa(JSON.stringify(payload)) + '.signature';
    localStorage.setItem('foodservice.fitness.student.auth.v1', JSON.stringify({
      access_token: token, refresh_token: 'test-refresh', expires_at: exp, expires_in: 3600,
      token_type: 'bearer', user: { id: user, phone: '+5527999991234', aud: 'authenticated', app_metadata: {}, user_metadata: {} },
    }));
  }, {user});
  await page.route('https://*.supabase.co/**', route => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown = [];
    if (path === '/auth/v1/user') result = { id: user, phone: '+5527999991234', aud: 'authenticated', app_metadata: {}, user_metadata: {} };
    else if (path.endsWith('/food_fitness_student_status_v1')) result = { registered: true, store_id: store, client_id: client, name: 'Aluno fictício' };
    else if (path.endsWith('/food_fitness_student_session_v1')) result = { authorized: true };
    else if (path.endsWith('/food_fitness_offers_v1') || path.endsWith('/food_fitness_my_orders_v1')) result = [];
    else if (path.endsWith('/food_fitness_pix_v1')) result = {};
    else if (path.endsWith('/food_fitness_my_appointments')) result = { appointments: [{ id: 'appointment-1', starts_at: '2026-11-05T13:00:00Z', status: 'scheduled' }] };
    else if (path.endsWith('/food_fitness_list_workouts')) result = [{
      id: 'workout-1', level: 'basic', title: 'Ficha aprovada de teste', description: 'Conteúdo fictício',
      status: 'approved', source: 'custom', professional: {user_id:'professional-1',name:'Profissional fictício',council:'CREF',registration:'000001-G/ES'},
      exercises: exercises ?? [{ id:'exercise-1',position:1,name:'Movimento de teste',sets:2,repetitions:'8',rest_seconds:2,load_or_effort:'Conforme ficha',instructions:'Orientação revisada.',alternative:'Alternativa revisada.',media_key:mediaKey }],
    }];
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
  await page.route('https://cdn.jsdelivr.net/npm/@google/model-viewer@4.4.0/dist/model-viewer.min.js', route => route.fulfill({
    status: 200,
    contentType: 'text/javascript',
    headers: { 'access-control-allow-origin': '*' },
    body: `window.__fitnessAnimationCalls=[];customElements.define('model-viewer',class extends HTMLElement{connectedCallback(){setTimeout(()=>this.dispatchEvent(new Event('load')),20)}play(options){window.__fitnessAnimationCalls.push(options)}pause(){window.__fitnessAnimationCalls.push('paused')}});`,
  }));
}

for (const width of [320, 390, 768, 1280]) test(`student portal keeps a volatile workout sequence at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:900});
  await mockStudent(page);
  await page.goto(`/fitness/${store}/treinos`);
  await expect(page.getByRole('navigation',{name:'Áreas do aluno'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Ficha aprovada de teste'})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Minha agenda'})).toBeVisible();
  await expect(page.getByText(/quinta-feira, 5 de novembro de 2026.*10:00/)).toBeVisible();
  await page.getByRole('button',{name:'Marcar série 1 concluída'}).click();
  await expect(page.getByText('1 de 2 séries marcadas nesta sessão')).toBeVisible();
  await page.reload();
  await expect(page.getByText('0 de 2 séries marcadas nesta sessão')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBeTruthy();
});

test('workout sequence stays within the selected training day', async ({page}) => {
  await mockStudent(page,'',[
    {id:'exercise-a1',position:1,name:'Movimento A1',sets:1,repetitions:'8',rest_seconds:0,load_or_effort:'Leve',instructions:'Orientação revisada.',alternative:'Alternativa revisada.',media_key:'',day:'A'},
    {id:'exercise-a2',position:2,name:'Movimento A2',sets:1,repetitions:'8',rest_seconds:0,load_or_effort:'Leve',instructions:'Orientação revisada.',alternative:'Alternativa revisada.',media_key:'',day:'A'},
    {id:'exercise-b1',position:3,name:'Movimento B1',sets:1,repetitions:'8',rest_seconds:0,load_or_effort:'Leve',instructions:'Orientação revisada.',alternative:'Alternativa revisada.',media_key:'',day:'B'},
  ]);
  await page.goto('/fitness/' + store + '/treinos');
  await expect(page.getByRole('heading',{name:'Movimento A1'})).toBeVisible();
  await page.getByRole('button',{name:'Próximo exercício'}).click();
  await expect(page.getByRole('heading',{name:'Movimento A2'})).toBeVisible();
  await expect(page.getByRole('button',{name:'Próximo exercício'})).toHaveCount(0);
  await page.getByLabel('Dia de treino').selectOption('B');
  await expect(page.getByRole('heading',{name:'Movimento B1'})).toBeVisible();
});

test('student sees a looping exercise animation and reduced motion starts paused', async ({page}) => {
  await page.setViewportSize({width:390,height:900});
  await page.emulateMedia({reducedMotion:'reduce'});
  await mockStudent(page,'desk:mini-squat');
  await page.goto(`/fitness/${store}/treinos`);
  await expect(page.getByRole('heading',{name:'Ficha aprovada de teste'})).toBeVisible();
  const viewer = page.locator('model-viewer');
  await expect(viewer).toHaveAttribute('src','/assets/fitness-desk-break.glb');
  await expect(viewer).toHaveAttribute('animation-name','mini-squat');
  await expect(viewer).toHaveAttribute('aria-label',/demonstração animada/);
  await expect(page.getByRole('button',{name:'Reproduzir demonstração'})).toBeVisible();
  expect(await page.evaluate(() => ((window as Window & {__fitnessAnimationCalls?:unknown[]}).__fitnessAnimationCalls || []).some(call => typeof call === 'object'))).toBeFalsy();
  await page.getByRole('button',{name:'Reproduzir demonstração'}).click();
  await expect.poll(() => page.evaluate(() => ((window as Window & {__fitnessAnimationCalls?:unknown[]}).__fitnessAnimationCalls || []).some(call => typeof call === 'object' && (call as {repetitions?:number}).repetitions === Infinity))).toBeTruthy();
  await page.getByRole('button',{name:'Pausar demonstração'}).click();
  await expect.poll(() => page.evaluate(() => (window as Window & {__fitnessAnimationCalls?:unknown[]}).__fitnessAnimationCalls?.at(-1))).toBe('paused');
});

test('student sees both 2D reference poses assigned by the professional',async({page})=>{
  await mockStudent(page,'repdb:bench-press');
  await page.goto(`/fitness/${store}/treinos`);
  await expect(page.getByRole('img',{name:'Supino reto com barra · posição inicial'})).toHaveAttribute('src','/assets/fitness-exercises/bench-press-start.webp');
  await expect(page.getByRole('img',{name:'Supino reto com barra · posição principal do movimento'})).toHaveAttribute('src','/assets/fitness-exercises/bench-press-peak.webp');
  await expect(page.getByRole('link',{name:'Ilustrações de exercício por RepDB'})).toHaveAttribute('href','https://repdb.co');
});
