import { test, expect } from '@playwright/test';
import { mockBackend, STORE, USER } from './fixtures';

test('agenda mostra registros reais da resposta e separa configuração no celular', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockBackend(page, { auth: true });
  await page.route('**/rpc/food_business_status', route => route.fulfill({ json: { profile: { store_id: STORE, primary_segment: 'fitness' }, legacy: false, modules: [{ code: 'appointments', effective: true }] } }));
  await page.route('**/rpc/food_business_operate', route => route.fulfill({ json: { items: [{ id: 'service', name: 'Avaliação fictícia', active: true }] } }));
  await page.route('**/rpc/food_fitness_status', route => route.fulfill({ json: { professionals: [{ user_id: USER, active: true }], windows: [], blocks: [], terms: [], appointments: [{ id: 'appointment', service_id: 'service', professional_id: USER, starts_at: '2099-01-05T13:30:00Z', ends_at: '2099-01-05T14:30:00Z', status: 'scheduled' }] } }));
  await page.route('**/rpc/food_fitness_student_session_admin_list_v1', route => route.fulfill({ json: { students: [] } }));
  await page.goto('/admin/fitness');
  const agenda = page.locator('#agenda-fitness');
  await expect(agenda).toContainText('Avaliação fictícia');
  await expect(agenda).toContainText('Agendado');
  await agenda.getByLabel('Consultar dia').fill('2099-01-06');
  await expect(agenda).toContainText('Nenhum atendimento neste dia');
  await agenda.getByRole('link', { name: 'Disponibilidade e bloqueios' }).click();
  await expect(page.locator('#configuracoes-agenda')).toHaveAttribute('open', '');
  await page.getByRole('button', { name: 'Abrir menu' }).click();
  await expect(page.getByRole('dialog', { name: 'Menu do negócio' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: info.outputPath('agenda-menu-mobile.png'), fullPage: true });
});
