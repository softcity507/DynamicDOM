import { chromium, type BrowserContext, type Page } from 'playwright';
import { config } from './config.js';

/**
 * One persistent browser for the whole process.
 *
 * We use a *persistent context* (a real on-disk Chrome profile) so your
 * Google login is saved. You log in by hand ONCE; after that every run
 * reuses the same cookies. Nothing here talks to Google's backend — we
 * only drive the same UI a human would.
 */
let context: BrowserContext | null = null;
let page: Page | null = null;

export async function getPage(): Promise<Page> {
  if (context && page && !page.isClosed()) return page;

  context = await chromium.launchPersistentContext(config.userDataDir, {
    headless: !config.headful,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });

  page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(30_000);
  return page;
}

export async function closeBrowser(): Promise<void> {
  await context?.close();
  context = null;
  page = null;
}

// Clean shutdown so the profile isn't left locked.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await closeBrowser();
    process.exit(0);
  });
}
