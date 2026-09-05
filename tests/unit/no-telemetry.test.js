import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '../..');

describe('Zero Telemetry & Privacy Guard', () => {
  const indexHtmlPath = path.join(rootDir, 'index.html');
  const indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

  it('ensures index.html contains no external font links', () => {
    expect(indexHtml).not.toContain('fonts.googleapis.com');
    expect(indexHtml).not.toContain('fonts.gstatic.com');
  });

  it('ensures index.html contains no external analytics or tracking scripts', () => {
    expect(indexHtml).not.toContain('/_vercel/insights');
    expect(indexHtml).not.toContain('google-analytics.com');
    expect(indexHtml).not.toContain('googletagmanager.com');
    expect(indexHtml).not.toContain('sentry.io');
    expect(indexHtml).not.toContain('datadoghq.com');
    expect(indexHtml).not.toContain('logrocket');
  });

  it('ensures index.html enforces strict no-referrer policy', () => {
    expect(indexHtml).toContain('<meta name="referrer" content="no-referrer">');
  });

  it('ensures all external links in index.html have rel="noopener noreferrer"', () => {
    const anchorRegex = /<a\s+[^>]*href=["'](https?:\/\/[^"']+)["'][^>]*>/gi;
    let match;
    let externalLinkCount = 0;
    while ((match = anchorRegex.exec(indexHtml)) !== null) {
      externalLinkCount++;
      const fullTag = match[0];
      expect(fullTag).toContain('rel="noopener noreferrer"');
    }
    expect(externalLinkCount).toBeGreaterThan(0);
  });

  it('verifies that self-hosted font files exist and are not empty', () => {
    const fontsDir = path.join(rootDir, 'public/assets/fonts');
    expect(fs.existsSync(fontsDir)).toBe(true);

    const latinFont = path.join(fontsDir, 'roboto-latin.woff2');
    const latinExtFont = path.join(fontsDir, 'roboto-latin-ext.woff2');

    expect(fs.existsSync(latinFont)).toBe(true);
    expect(fs.statSync(latinFont).size).toBeGreaterThan(10000);

    expect(fs.existsSync(latinExtFont)).toBe(true);
    expect(fs.statSync(latinExtFont).size).toBeGreaterThan(10000);
  });

  it('ensures src/styles/fonts.css references only local fonts', () => {
    const fontsCssPath = path.join(rootDir, 'src/styles/fonts.css');
    const fontsCss = fs.readFileSync(fontsCssPath, 'utf8');

    expect(fontsCss).toContain("url('/assets/fonts/roboto-latin.woff2')");
    expect(fontsCss).toContain("url('/assets/fonts/roboto-latin-ext.woff2')");
    expect(fontsCss).not.toContain('http://');
    expect(fontsCss).not.toContain('https://');
  });

  it('ensures client source code in src/ performs no external network requests', () => {
    const srcDir = path.join(rootDir, 'src');
    const jsFiles = [];

    function findJsFiles(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          findJsFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
          jsFiles.push(fullPath);
        }
      }
    }

    findJsFiles(srcDir);
    expect(jsFiles.length).toBeGreaterThan(0);

    for (const filePath of jsFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      // Verify no hardcoded external API calls
      const fetchMatch = content.match(/fetch\s*\(\s*['"`](https?:\/\/[^'"`]+)['"`]/g);
      expect(fetchMatch).toBeNull();
    }
  });
});
