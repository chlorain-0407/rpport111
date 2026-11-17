import puppeteer from 'puppeteer-core';

const ORIGIN = 'https://www.pacific.com.tw';
const DETAIL_PATH = '/Object/ObjectDetail/';
const RENDER_TIMEOUT_MS = 12_000;
let activeRender = false;

export async function readPacificListing(listingId: string, signal: AbortSignal) {
  if (!/^[A-Z]{0,3}\d{5,}$/.test(listingId) || activeRender || signal.aborted) return null;
  const source = new URL(DETAIL_PATH, ORIGIN);
  source.searchParams.set('saleID', listingId);
  activeRender = true;
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | undefined;
  const closeBrowser = () => { void browser?.close().catch(() => {}); };
  signal.addEventListener('abort', closeBrowser, { once: true });
  try {
    const executablePath = process.env.PACIFIC_CHROMIUM_PATH ||
      await (await import('@sparticuz/chromium')).default.executablePath();
    signal.throwIfAborted();
    // Chromium receives runtime paths only, with its normal security settings.
    const env: Record<string, string> = {};
    for (const name of ['PATH', 'HOME', 'TEMP', 'TMP', 'TMPDIR', 'SystemRoot', 'WINDIR',
      'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'LD_LIBRARY_PATH', 'FONTCONFIG_PATH', 'LANG']) {
      const value = process.env[name];
      if (value) env[name] = value;
    }
    browser = await puppeteer.launch({
      executablePath,
      headless: process.env.PACIFIC_CHROMIUM_PATH ? true : 'shell',
      pipe: true,
      env,
      timeout: 8_000,
      args: ['--disable-dev-shm-usage'],
    });
    signal.throwIfAborted();

    const page = await browser.newPage();
    await page.setBypassServiceWorker(true);
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const url = new URL(request.url());
      const sameOrigin = url.origin === ORIGIN;
      const mainDocument = request.isNavigationRequest() && request.frame() === page.mainFrame() &&
        url.pathname.toLowerCase().replace(/\/$/, '') === DETAIL_PATH.toLowerCase().replace(/\/$/, '') &&
        url.searchParams.get('saleID') === listingId;
      const publicResource = ['stylesheet', 'script', 'xhr', 'fetch'].includes(request.resourceType());
      const allowed = sameOrigin && (mainDocument || (!request.isNavigationRequest() && publicResource));
      void (allowed ? request.continue() : request.abort()).catch(() => {});
    });
    await page.goto(source.href, { waitUntil: 'domcontentloaded', timeout: RENDER_TIMEOUT_MS });

    await page.waitForFunction((id) => {
      const panel = document.querySelector('#divObject .house_data');
      return panel?.querySelector('h1 small')?.textContent?.trim() === id &&
        Boolean(panel.querySelector('.price b')?.textContent?.trim());
    }, { timeout: RENDER_TIMEOUT_MS }, listingId);

    return await page.evaluate((id) => {
      const root = document.querySelector('#divObject');
      const panel = root?.querySelector('.house_data');
      const { text } = {
        text(node: Element | null | undefined) {
          return (node as HTMLElement | undefined)?.innerText?.trim() || '';
        },
      };
      const heading = panel?.querySelector('h1');
      if (!root || !panel || text(heading?.querySelector('small')) !== id) return null;
      const tableSpecLabels = new Set(['屋齡', '管理費/收取方式', '主建物坪數', '附屬建物坪數', '公共設施坪數']);
      const specifications = [...panel.querySelectorAll('li')].map(text);
      for (const label of root.querySelectorAll('table th')) {
        const name = text(label).replace(/\s/g, '');
        const value = text(label.nextElementSibling);
        if (tableSpecLabels.has(name) && value) specifications.push(name + '：' + value);
      }
      return {
        name: text(heading?.querySelector('span')),
        address: text(panel.querySelector('h2')),
        price: text(panel.querySelector('.price')),
        previousPrice: text(panel.querySelector('.o_price del')),
        specifications: specifications.join('\n').slice(0, 6000),
      };
    }, listingId);
  } catch (error) {
    if (!signal.aborted) console.warn('[Pacific URL render]', error instanceof Error ? error.message.split('\n')[0] : 'Unexpected error');
    return null;
  } finally {
    signal.removeEventListener('abort', closeBrowser);
    try {
      await browser?.close();
    } catch {
      browser?.process()?.kill();
    } finally {
      activeRender = false;
    }
  }
}
