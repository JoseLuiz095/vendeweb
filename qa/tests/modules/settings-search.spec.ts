import { test, expect } from '@playwright/test';
import { mockBackend } from './fixtures';

for (const width of [320, 390, 768, 1366]) {
  test(`busca encontra campos e preserva alterações em ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { writes } = await mockBackend(page, { auth: true });
    await page.goto('/admin/configuracoes');
    const search = page.getByLabel('Buscar nas configurações');
    const results = page.getByLabel('Resultados da busca');
    await page.getByLabel('Frase da loja').fill('Alteração pendente');
    const writesBefore = writes.length;
    for (const term of ['Aceitar pedidos fora do horário', 'FORA DO HORARIO', 'loja fechada', 'pedido agendado', 'horario futuro']) {
      await search.fill(term);
      await expect(results.getByRole('button', { name: /Aceitar pedidos fora do horário.*Pedido e recebimento/ })).toBeVisible();
    }
    const target = page.getByLabel(/Aceitar pedidos fora do horário/);
    const before = await target.isChecked();
    await results.getByRole('button', { name: /Aceitar pedidos fora do horário.*Pedido e recebimento/ }).click();
    await expect(page.locator('#settings-service')).not.toHaveClass(/is-collapsed/);
    await expect(target).toBeFocused();
    await expect(target.locator('..')).toHaveClass(/settings-field-highlight/);
    await expect(target).toBeInViewport();
    expect(await target.isChecked()).toBe(before);
    await expect(page.getByLabel('Frase da loja')).toHaveValue('Alteração pendente');
    expect(writes.length).toBe(writesBefore);
    await search.fill('nova senha');
    await results.getByRole('button', { name: /Nova senha.*Senha da conta/ }).click();
    await expect(page.locator('#settings-password')).not.toHaveClass(/is-collapsed/);
    await expect(page.getByLabel('Nova senha', { exact: true })).toBeFocused();
    await search.fill('sem resultado xyz');
    await expect(page.getByRole('status').filter({ hasText: 'Nenhuma configuração encontrada' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  });
}

test('busca abre detalhes internos e mantém o rascunho ao fechar seções', async ({ page }) => {
  await mockBackend(page, { auth: true });
  await page.goto('/admin/configuracoes');
  await page.getByLabel('Frase da loja').fill('Rascunho');
  const search = page.getByLabel('Buscar nas configurações');
  await search.fill('recompra retorno');
  await page.getByLabel('Resultados da busca').getByRole('button', { name: /Recompra \/ retorno.*Mensagens programadas/ }).click();
  await expect(page.getByLabel('Recompra / retorno')).toBeVisible();
  await expect(page.getByLabel('Recompra / retorno')).toBeFocused();
  await page.locator('#settings-messages').getByRole('button', { name: 'Mensagens programadas' }).click();
  await expect(page.getByLabel('Frase da loja')).toHaveValue('Rascunho');
});

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
