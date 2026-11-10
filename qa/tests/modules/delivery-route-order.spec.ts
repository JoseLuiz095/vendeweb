import { test, expect } from '@playwright/test';
import { mockBackend, STORE } from './fixtures';

for (const width of [390, 1366]) {
  test(`rota segue a ordem escolhida e rejeita retirada em ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await mockBackend(page, { auth: true });
    const rows = [1, 2, 3].map(n => ({ id: `b0000000-0000-4000-8000-${String(n).padStart(12,'0')}`, store_id: STORE, order_number: n, customer_name: `Cliente ${n}`, delivery_type: n===3?'pickup':'delivery', delivery_street: `Rua Teste ${n}`, delivery_number: '10', delivery_city: 'Linhares', delivery_state: 'ES', payment_method: 'cash', payment_status: 'paid', status: 'received', subtotal: 10, total: 10, created_at: new Date().toISOString() }));
    await page.route(/\/rest\/v1\/food_orders(?:\?|$)/, route => route.fulfill({ json: rows }));
    await page.goto('/admin/pedidos');
    await page.getByRole('checkbox', { name: 'Selecionar pedido 1', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Selecionar pedido 2', exact: true }).check();
    await page.getByText('Conferir e ordenar entregas').click();
    const link = page.getByRole('link', { name: 'Abrir rota no Maps' });
    let url = new URL((await link.getAttribute('href'))!);
    expect(url.searchParams.get('waypoints')).toContain('Rua Teste 1');
    expect(url.searchParams.get('destination')).toContain('Rua Teste 2');
    await page.getByRole('button', { name: /Mover pedido .*2 para cima/ }).click();
    url = new URL((await link.getAttribute('href'))!);
    expect(url.searchParams.get('waypoints')).toContain('Rua Teste 2');
    expect(url.searchParams.get('destination')).toContain('Rua Teste 1');
    await expect(link).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: info.outputPath(`rota-${width}.png`), animations: 'disabled' });
    await page.getByRole('checkbox', { name: 'Selecionar pedido 3', exact: true }).check();
    await expect(page.getByRole('status').filter({ hasText: 'Rota indisponível' })).toBeVisible();
    await expect(link).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
