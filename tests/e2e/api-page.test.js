import { test, expect } from '@playwright/test';

// The API/MCP page opens from the list's menu, lives at #/api, and takes the
// place "Sobre" takes: beside the rail on a wide screen, the whole screen on
// a phone. It hands over the one URL people come for.

const openFromMenu = async (page) => {
  await page.goto('/');
  await expect(page.locator('.conversation-item').first()).toBeVisible();
  await page.locator('.sidebar-menu-btn').click();
  const item = page.locator('.sidebar-dropdown-item', { hasText: 'API/MCP' });
  await expect(item.locator('.sidebar-dropdown-icon svg')).toBeVisible();
  await item.click();
  await expect(page.locator('.api-drawer')).toBeVisible();
};

test('opens from the menu, at its own address', async ({ page }) => {
  await openFromMenu(page);
  await expect(page).toHaveURL(/#\/api$/);
  await expect(page.locator('.api-drawer .profile-drawer-title')).toHaveText('API/MCP');
  await expect(page.locator('.api-drawer .api-code pre').first()).toHaveText('https://www.masterwhats.com.br/api/mcp');
});

test('opens straight from the address too', async ({ page }) => {
  await page.goto('/#/api');
  await expect(page.locator('.api-drawer')).toBeVisible({ timeout: 20000 });
});

test('lists every route of the table, each opening its example', async ({ page }) => {
  await openFromMenu(page);
  const routes = page.locator('.api-route');
  expect(await routes.count()).toBe(8);
  await expect(routes.first().locator('.api-route-path')).toHaveText('/conversations');
  await expect(routes.first()).toHaveAttribute('href', '/api/v1/conversations');
  await expect(routes.first()).toHaveAttribute('target', '_blank');
});

test('takes the place "Sobre" takes: beside the rail, or the whole screen', async ({ page }) => {
  await openFromMenu(page);
  const drawer = await page.locator('.api-drawer').boundingBox();
  const view = page.viewportSize();
  await expect(page.locator('.sidebar')).toBeHidden();
  if (view.width > 600) {
    expect(drawer.width).toBeLessThan(view.width * 0.6);
    await expect(page.locator('.profile-placeholder')).toBeVisible();
  } else {
    expect(drawer.width).toBeGreaterThan(view.width * 0.95);
  }
});

test('copies the MCP URL', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium-only here');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openFromMenu(page);
  await page.locator('.api-copy').first().click();
  await expect(page.locator('.api-copy').first()).toContainText('Copiado');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://www.masterwhats.com.br/api/mcp');
});

test('explains each client, with a command to copy', async ({ page }) => {
  await openFromMenu(page);
  for (const name of ['ChatGPT', 'Claude (claude.ai)', 'Claude Code', 'Cursor']) {
    await expect(page.locator('.profile-section-title', { hasText: `Como usar no ${name}` })).toBeVisible();
  }
  await expect(page.locator('.api-code pre', { hasText: 'claude mcp add' })).toBeVisible();
  await expect(page.locator('.api-limits')).toContainText('300/dia');
});

test('closes back to the list', async ({ page }) => {
  await openFromMenu(page);
  await page.locator('.api-drawer .profile-drawer-close').click();
  await expect(page.locator('.api-drawer')).toHaveCount(0);
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page).toHaveURL(/#\/$|\/$/);
});
