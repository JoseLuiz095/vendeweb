import { expect, test } from '@playwright/test';
import { mockBackend, PRODUCT, STORE, snapshot, store, ORDER } from './fixtures';

test('reserva de um equipamento usa quantidade um e permite revisar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockBackend(page);
  await page.route('**/rest/v1/rpc/food_modules_catalog', route => route.fulfill({ json: {
    store: { name: 'Festa teste' }, offers: [{ id: PRODUCT, name: 'Pula-pula', kind: 'rental', price_cents: 10000, store_id: STORE, max_quantity: 10, lead_hours: 24, ready_now: false }], combos: [],
  } }));
  let sent: any;
  await page.route('**/functions/v1/food-modules-public', route => {
    const body = route.request().postDataJSON();
    if (body.action === 'create') { sent = body.data; return route.fulfill({ json: { id: ORDER } }); }
    return route.fulfill({ json: { id: ORDER, code: 1, seller_store_id: STORE, status: 'draft', total_cents: 10000, charged_cents: 0, paid_cents: 0, expires_at: '2099-01-01T00:00:00Z', refund_due_cents: 0, pix: null, items: [] } });
  });
  await page.goto(`/modulos/eventos/${STORE}`);
  await expect(page.getByRole('radio', { name: /Pula-pula/ })).toBeChecked();
  await expect(page.getByLabel(/Quantidade/)).toHaveCount(0);
  await page.getByLabel('Seu nome').fill('Cliente teste');
  await page.getByLabel('WhatsApp').fill('27999999999');
  await page.getByLabel('Data e horário de início').fill('2098-01-01T10:00');
  await page.getByLabel('Data e horário de término').fill('2098-01-01T16:00');
  await page.getByRole('button', { name: 'Revisar pedido e valores' }).click();
  await expect(page).toHaveURL(/\/modulos\/eventos\/pedido\//);
  expect(sent.items).toEqual([{ offer_id: PRODUCT, quantity: 1 }]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('orçamento 3D direciona para contato sem prometer pedido salvo', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await mockBackend(page);
  await page.route('**/rest/v1/rpc/food_get_public_storefront_v1', route => route.fulfill({ json: { ...snapshot, store: { ...store, visual_theme: { preset: 'foodweb', businessSegment: 'printing3d' } } } }));
  await page.goto('/doce-lua');
  const quote = page.getByRole('region', { name: 'Projeto personalizado' });
  await expect(quote.getByText('A conversa não cria um pedido automaticamente.')).toBeVisible();
  await expect(quote.getByRole('link', { name: /Pedir orçamento no WhatsApp/ })).toHaveAttribute('href', /wa\.me\/5511999999999\?text=/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
