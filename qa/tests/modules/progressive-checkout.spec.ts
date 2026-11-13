import { expect, test } from '@playwright/test';
import { mockBackend, PRODUCT } from './fixtures';

for (const width of [320, 390, 820, 1366]) {
  test(`compra progressiva mantém seleção e apresenta finalização em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 850 });
    await mockBackend(page);
    await page.route('**/rest/v1/rpc/food_get_public_pickup_locations_v1', r => r.fulfill({ json: [{ id: '60000000-0000-4000-8000-000000000001', name: 'Trabalho', short_code: 'trabalho' }] }));
    await page.route('**/rest/v1/rpc/food_get_public_location_availability_v1', r => r.fulfill({ json: [{ product_id: PRODUCT, available: 3 }] }));
    await page.goto('/doce-lua?ponto=trabalho');
    await expect(page.locator('#continuar-pedido')).toHaveCount(0);
    await page.locator('.product-card-shell').first().getByRole('button', { name: 'Adicionar Brigadeiro teste', exact: true }).click();
    const checkout = page.locator('#continuar-pedido');
    await expect(checkout).toBeVisible();
    await expect(checkout.getByLabel('Nome', { exact: true })).toHaveCount(0);
    await checkout.getByRole('button', { name: /Retirada Buscar/ }).click();
    await expect(checkout.getByLabel('Nome', { exact: true })).toBeVisible();
    await checkout.getByLabel('Nome', { exact: true }).fill('Cliente teste');
    await checkout.getByLabel(/WhatsApp \/ telefone/).fill('11999999999');
    await checkout.getByRole('button', { name: /Continuar/ }).click();
    await expect(checkout.getByRole('heading', { name: 'Pagamento e revisão' })).toBeVisible();
    await expect(checkout.locator('.summary-total')).toContainText('10,00');
    await expect(checkout.locator('.preparation-summary')).toHaveCount(0);
    const submit = checkout.getByRole('button', { name: /Registrar pedido/ });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeVisible();
    await expect(page).toHaveURL(/doce-lua\?ponto=trabalho/);
  });
}
