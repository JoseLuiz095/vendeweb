import { expect, test, type Page } from '@playwright/test';

const store = '10000000-0000-4000-8000-000000000001';
const user = '20000000-0000-4000-8000-000000000001';
const client = '30000000-0000-4000-8000-000000000001';

async function mockStudent(page: Page) {
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
      exercises: [{ id:'exercise-1',position:1,name:'Movimento de teste',sets:2,repetitions:'8',rest_seconds:2,load_or_effort:'Conforme ficha',instructions:'Orientação revisada.',alternative:'Alternativa revisada.' }],
    }];
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(result)});
  });
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
