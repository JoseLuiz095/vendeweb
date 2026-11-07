import { test, expect } from '@playwright/test';
import { mockBackend, STORE } from './fixtures';

test('resumo mostra pedidos carregados e abre o pedido exato', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockBackend(page, { auth: true });
  const id = 'b0000000-0000-4000-8000-000000000001';
  await page.route('**/rest/v1/food_orders?**', route => route.fulfill({ json: [{ id, order_number: 104, store_id: STORE, customer_name: 'Pessoa de teste', delivery_type: 'pickup', payment_method: 'pix', payment_status: 'pending', status: 'received', subtotal: 10, total: 10, created_at: '2026-11-07T10:00:00Z' }] }));
  await page.goto('/admin/analytics');
  const flow = page.locator('details.analytics-flow');
  await expect(flow).not.toHaveAttribute('open');
  await flow.locator('summary').click();
  await expect(flow).toContainText('1 em andamento');
  await expect(flow).toContainText('A lista pode não incluir pedidos mais antigos');
  const link = flow.getByRole('link', { name: 'Ver pedido 00104' });
  await expect(link).toHaveAttribute('href', `/admin/pedidos?highlight=${id}`);
  await link.click();
  await expect(page).toHaveURL(new RegExp(`/admin/pedidos\\?highlight=${id}`));
  await expect(page.locator('.order-row-highlighted').first()).toBeVisible();
});
