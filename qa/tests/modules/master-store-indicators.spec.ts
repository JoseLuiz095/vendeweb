import { expect, test } from '@playwright/test';
import { mockBackend } from './fixtures';

test('master consulta indicadores da loja e altera o período', async ({ page }) => {
  await mockBackend(page, { auth: true, master: true });
  await page.route('**/rpc/food_get_store_analytics_v1', route => route.fulfill({ json: { storefrontSessions: 136, addToCartSessions: 59, checkoutSessions: 57, orderSessions: 48, orders: 157, revenue: 2755, averageTicket: 17.55, conversionRate: 35.3, checkoutAbandonmentRate: 15.8, topProducts: [{ productId: '1', name: 'Produto de teste', views: 99, soldUnits: 10 }], viewedNotSold: [] } }));
  await page.route('**/rpc/food_master_store_order_summary_v1', route => route.fulfill({ json: { paidOrders: 154, paidValue: 2685, cancelledOrders: 20 } }));
  await page.goto('/admin-master/indicadores');
  const filters = page.locator('.master-indicators-filter select');
  await filters.first().selectOption({ index: 1 });
  await page.getByRole('button', { name: 'Consultar indicadores' }).click();
  await expect(page.getByRole('heading', { name: 'Jornada dos clientes' })).toBeVisible();
  await expect(page.getByText('Produto de teste').first()).toBeVisible();
  await expect(page.getByText('Os valores dos pedidos registrados não confirmam recebimento.')).toBeVisible();
  await filters.nth(1).selectOption('7');
  await expect(page.getByRole('heading', { name: 'Jornada dos clientes' })).toHaveCount(0);
});
