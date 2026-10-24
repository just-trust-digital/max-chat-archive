const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');

const dir = __dirname;
execFileSync(process.execPath, [path.join(dir, 'build-sample.cjs')], { stdio: 'inherit' });

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1, colorScheme: 'light' });
    for (const [number, name] of [['1', '01-export.png'], ['2', '02-result.png']]) {
      await page.goto(`${pathToFileURL(path.join(dir, 'carousel.html')).href}?slide=${number}`);
      await page.evaluate(() => document.fonts.ready);
      if (number === '2') await page.frameLocator('iframe').locator('h1').waitFor();
      await page.screenshot({ path: path.join(dir, name) });
      const layout = await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight
      }));
      if (layout.width > 1080 || layout.height > 1080) throw new Error(`${name}: content exceeds square`);
      process.stdout.write(`${name}: 1080 × 1080\n`);
    }
    await page.close();
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
