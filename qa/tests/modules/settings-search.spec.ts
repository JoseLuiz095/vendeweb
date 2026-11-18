import { test, expect } from '@playwright/test';
import { mockBackend } from './fixtures';

for (const width of [320, 390, 768, 1366]) {
  test(`busca abre a seção sem perder alterações em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await mockBackend(page, { auth: true });
    await page.goto('/admin/configuracoes');
    const search = page.getByLabel('Buscar nas configurações');
    await search.fill('horario');
    const nav = page.getByRole('navigation', { name: 'Ir para uma configuração' });
    await expect(nav.getByRole('button', { name: 'Dados e visual' })).toBeVisible();
    await page.getByLabel('Frase da loja').fill('Alteração pendente');
    await search.fill('mercado pago');
    const pix = nav.getByRole('button', { name: 'Pix e Mercado Pago' });
    await pix.click();
    await expect(pix).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#settings-pix')).not.toHaveClass(/is-collapsed/);
    await expect(page.getByLabel('Frase da loja')).toHaveValue('Alteração pendente');
    await search.fill('sem resultado xyz');
    await expect(page.getByRole('status').filter({ hasText: 'Nenhuma seção encontrada' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

for (const width of [390, 1366]) {
  test(`menu separa recebimento e plano em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await mockBackend(page, { auth: true });
    await page.goto('/admin');
    if (width < 768) await page.getByRole('button', { name: 'Abrir menu' }).click();
    const nav = page.getByRole('navigation', { name: 'Navegação do negócio' });
    await expect(nav.getByRole('link', { name: 'Configurações da loja' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Plano e pagamentos VendeWeb' })).toBeVisible();
    await nav.getByRole('link', { name: 'Recebimento das vendas' }).click();
    await expect(page).toHaveURL(/\/admin\/configuracoes#settings-pix$/);
    await expect(page.locator('#settings-pix')).not.toHaveClass(/is-collapsed/);
    await expect(page.locator('#settings-pix')).toBeInViewport();
    await page.locator('#settings-pix').getByRole('button', { name: 'PIX', exact: true }).click();
    await expect(page.locator('#settings-pix')).toHaveClass(/is-collapsed/);
    if (width < 768) await page.getByRole('button', { name: 'Abrir menu' }).click();
    await nav.getByRole('link', { name: 'Recebimento das vendas' }).click();
    await expect(page.locator('#settings-pix')).not.toHaveClass(/is-collapsed/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}
