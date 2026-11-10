import { expect, test } from '@playwright/test';
import { mockBackend } from './fixtures';

for (const width of [390, 1366]) {
  test(`vitrine, produto e finalização continuam utilizáveis em ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await mockBackend(page);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('/doce-lua');
    await expect(page.getByRole('heading', { name: 'Escolha seu favorito' })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`vitrine-${width}.png`), fullPage: true });
    await page.locator('.product-card').first().click();
    await expect(page.locator('.storefront-product-price')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`produto-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Adicionar ao carrinho', exact: true }).click();
    await page.goto('/doce-lua/finalizar');
    await expect(page.getByRole('heading', { name: 'Finalização', exact: true })).toBeVisible();
    await expect(page.getByLabel('Etapas do pedido')).toBeVisible();
    await expect(page.getByText('Compre sem criar conta.', { exact: false })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`finalizacao-${width}.png`), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
}

test('filtro de ofertas permite recuperar falha de consulta em outros ramos', async ({ page }) => {
  await mockBackend(page);
  const { snapshot } = await import('./fixtures');
  await page.route('**/rest/v1/rpc/food_get_public_storefront_v1', route => route.fulfill({ json: { ...snapshot, store: { ...snapshot.store, visual_theme: { preset: 'foodweb', businessSegment: 'retail' } } } }));
  let failing = true;
  await page.route('**/rest/v1/rpc/food_business_public', route => failing ? route.fulfill({ status: 503, json: { message: 'Falha simulada' } }) : route.fulfill({ json: { services: [], links: [] } }));
  await page.goto('/doce-lua');
  await page.getByLabel('Tipo').selectOption('services');
  await expect(page.getByRole('alert')).toContainText('Serviços e links indisponíveis');
  failing = false;
  await page.getByRole('button', { name: 'Tentar novamente' }).click();
  await expect(page.getByText('Nenhuma oferta deste tipo publicada no momento.')).toBeVisible();
});

test('animações acompanham a preferência de movimento do usuário', async ({ page }) => {
  await mockBackend(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/doce-lua');
  const profile = page.locator('.food-store-profile-v43');
  await expect(profile).toBeVisible();
  expect(await profile.evaluate(element => getComputedStyle(element).animationName)).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  expect(await profile.evaluate(element => getComputedStyle(element).animationName)).toContain('purchase-appear');
});
