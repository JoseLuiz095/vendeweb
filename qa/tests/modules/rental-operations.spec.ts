import { test, expect } from '@playwright/test';
import { mockBackend, STORE, ORG, PRODUCT, ORDER, USER } from './fixtures';

async function rentals(page: import('@playwright/test').Page) {
  const backend = await mockBackend(page, { auth: true, enabled: true });
  const asset = { offer_id: PRODUCT, store_id: STORE, organization_id: ORG, maintenance: false, maintenance_notes: '', equipment_name: 'Pula-pula azul', active: true };
  const now = Date.now();
  const reservation = { id: 'c0000000-0000-4000-8000-000000000001', item_id: 'd0000000-0000-4000-8000-000000000001', offer_id: PRODUCT, store_id: STORE, organization_id: ORG,
    starts_at: new Date(now - 86400000).toISOString(), ends_at: new Date(now - 3600000).toISOString(), status: 'reserved',
    deposit_cents: 5000, deposit_reference: 'Manual-001', contract: 'Condições atuais', assembly_checklist: [], return_checklist: [], checked_out_at: null as string | null, checked_out_by: null as string | null,
    returned_at: null as string | null, returned_by: null as string | null, return_notes: '', equipment_name: asset.equipment_name, order_id: ORDER, order_code: 123, total_cents: 20000, billing_status: 'draft' };
  const events: any[] = [];
  await page.route('**/*.supabase.co/rest/v1/**', async route => {
    const path = new URL(route.request().url()).pathname;
    let value: unknown;
    if (path.endsWith('/food_rental_asset_rows')) value = [asset];
    else if (path.endsWith('/food_rental_operation_rows')) value = [reservation];
    else if (path.endsWith('/food_rental_events')) value = events;
    else if (path.endsWith('/food_rental_availability_v1')) value = { checked_at: new Date().toISOString(), assets: [{ ...asset, in_use: !!reservation.checked_out_at && !reservation.returned_at, status: asset.maintenance ? 'maintenance' : reservation.returned_at ? 'available' : 'reserved', reservation_ids: [reservation.id] }] };
    else if (path.endsWith('/food_rental_command_v1')) {
      const { p_action, p_data } = route.request().postDataJSON(); backend.writes.push({ url: path, body: { p_action, p_data } });
      if (p_action === 'rental_update') Object.assign(reservation, p_data);
      if (p_action === 'rental_checkout') { reservation.checked_out_at = new Date().toISOString(); reservation.checked_out_by = USER; }
      if (p_action === 'rental_return') { reservation.returned_at = new Date().toISOString(); reservation.returned_by = USER; reservation.status = 'returned'; reservation.return_notes = p_data.notes; asset.maintenance = p_data.maintenance; }
      if (p_action === 'rental_asset') { asset.maintenance = p_data.maintenance; asset.maintenance_notes = p_data.notes; }
      events.unshift({ id: events.length + 1, offer_id: PRODUCT, reservation_id: reservation.id, actor_id: USER, occurred_at: new Date().toISOString(), action: 'followup', details: { notes: p_data.notes || 'Registro realizado' } });
      value = { id: reservation.id };
    } else return route.fallback();
    await route.fulfill({ json: value });
  });
  return { ...backend, reservation, asset };
}

for (const width of [320, 390, 768, 1366]) test(`operação de aluguel em ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const state = await rentals(page);
  await page.goto('/admin/modulos?tab=rentals');
  await expect(page.getByRole('heading', { name: 'Operação de aluguel' })).toBeVisible();
  const cards = page.locator('.rental-reservation');
  await expect(cards).toHaveCount(1);
  await expect(cards).toContainText('Saída não registrada');
  await expect(cards).not.toContainText('Devolução atrasada');
  await cards.getByRole('button', { name: 'Abrir reserva', exact: true }).click();
  const detail = page.locator('#rental-reservation-detail');
  await expect(detail).toContainText('R$ 150,00');
  await expect(detail).toContainText('Sinal manual');
  await detail.getByRole('checkbox', { name: 'Equipamento fixado' }).check();
  await detail.getByRole('button', { name: 'Salvar dados e checklists' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Alteração salva' })).toBeVisible();
  await expect(cards).toContainText('Saída não registrada');
  await detail.getByRole('button', { name: 'Registrar retirada ou entrega' }).click();
  await detail.getByRole('button', { name: 'Confirmar saída', exact: true }).click();
  await expect(cards).toContainText('Devolução atrasada');
  await detail.getByRole('button', { name: 'Registrar devolução', exact: true }).click();
  await detail.getByLabel('Condições observadas na devolução').fill('Cabo danificado');
  await detail.getByRole('checkbox', { name: 'Encaminhar equipamento para manutenção' }).check();
  await detail.getByRole('button', { name: 'Confirmar devolução', exact: true }).click();
  await expect(cards).toContainText('Devolvida');
  expect(state.reservation.deposit_cents).toBe(5000);
  await expect(detail.getByRole('button', { name: 'Registrar devolução', exact: true })).toHaveCount(0);
  await page.getByLabel('Início do período').fill('2026-12-10T10:00');
  await page.getByLabel('Término do período').fill('2026-12-10T18:00');
  await page.getByRole('button', { name: 'Consultar no servidor' }).click();
  const availability = page.getByRole('region', { name: 'Disponibilidade consultada' });
  await expect(availability).toContainText('Em manutenção');
  await page.getByRole('button', { name: 'Limpar filtros' }).click();
  await page.getByLabel('Buscar equipamento ou reserva').fill('inexistente');
  await expect(cards).toHaveCount(0);
  await page.getByLabel('Buscar equipamento ou reserva').fill('');
  await expect(cards).toHaveCount(1);
  expect(await page.locator('.rental-workspace').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.screenshot({ path: `test-results/rental-${width}.png`, fullPage: true });
});

test('consulta falha sem afirmar disponibilidade e invalida resultado após editar período', async ({ page }) => {
  await rentals(page); await page.goto('/admin/modulos?tab=rentals');
  await page.getByLabel('Início do período').fill('2026-12-10T10:00'); await page.getByLabel('Término do período').fill('2026-12-10T18:00');
  await page.getByRole('button', { name: 'Consultar no servidor' }).click(); await expect(page.getByRole('region', { name: 'Disponibilidade consultada' })).toBeVisible();
  await page.getByLabel('Término do período').fill('2026-12-11T18:00'); await expect(page.getByRole('region', { name: 'Disponibilidade consultada' })).toHaveCount(0);
  await page.route('**/rpc/food_rental_availability_v1', route => route.fulfill({ status: 403, json: { message: 'Acesso negado.' } }));
  await page.getByRole('button', { name: 'Consultar no servidor' }).click(); await expect(page.getByRole('alert')).toContainText('Acesso negado');
  await expect(page.getByRole('region', { name: 'Disponibilidade consultada' })).toHaveCount(0);
});
