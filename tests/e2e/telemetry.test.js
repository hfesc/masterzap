import { test, expect } from '@playwright/test';

test.describe('Zero Telemetry E2E Guard', () => {
  test('no external network requests are initiated during app lifecycle', async ({ page, baseURL }) => {
    const externalRequests = [];
    const baseOrigin = new URL(baseURL).origin;

    page.on('request', request => {
      const url = request.url();
      // Allow internal app requests, data: URIs, and blob: URIs
      if (url.startsWith(baseOrigin) || url.startsWith('data:') || url.startsWith('blob:')) {
        return;
      }
      externalRequests.push({ url, method: request.method(), resourceType: request.resourceType() });
    });

    // Navigate to homepage
    await page.goto('/');
    await expect(page.locator('.conversation-item').first()).toBeVisible();

    // Verify meta referrer tag is present and effective in DOM
    const metaReferrer = await page.locator('meta[name="referrer"]').getAttribute('content');
    expect(metaReferrer).toBe('no-referrer');

    // Click into a conversation
    await page.locator('.conversation-item[data-id="martha-graeff"]').click();
    await expect(page.locator('.chat-header-name')).toBeVisible();

    // Assert absolutely zero external requests were made
    expect(externalRequests).toEqual([]);
  });

  test('no external stylesheets, fonts, or scripts are loaded', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.conversation-item').first()).toBeVisible();

    const externalResources = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('link[rel="stylesheet"], link[rel="preconnect"]'))
        .map(l => l.href)
        .filter(href => href.startsWith('http') && !href.includes(window.location.host));

      const scripts = Array.from(document.querySelectorAll('script[src]'))
        .map(s => s.src)
        .filter(src => src.startsWith('http') && !src.includes(window.location.host));

      return { links, scripts };
    });

    expect(externalResources.links).toEqual([]);
    expect(externalResources.scripts).toEqual([]);
  });
});
