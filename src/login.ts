/**
 * One-time login helper (auto-detect version — no ENTER needed).
 *   npm run login
 *
 * Opens a real browser at Flow. If Google asks you to sign in, do it in the
 * window. This script watches the page and, once you're actually on Flow and
 * NOT on a sign-in screen, it saves the session and closes automatically.
 *
 * Why no "press ENTER"? On Windows, npm pipes stdin in a way that fires ENTER
 * instantly, so the old version closed before you could log in. Polling the
 * page is reliable on every OS.
 */
import { getPage, closeBrowser } from './browser.js';
import { config } from './config.js';

const page = await getPage();
await page.goto(config.flowUrl, { waitUntil: 'domcontentloaded' });

console.log('\n=== A browser window is open. ===');
console.log('If Google asks you to sign in, log in there now.');
console.log('I will detect when Flow is ready and save the session automatically.');
console.log('(Up to 5 minutes. Watch this terminal.)\n');

const deadline = Date.now() + 5 * 60_000;
let saved = false;

while (Date.now() < deadline) {
  const url = page.url();

  const onLoginPage = /accounts\.google\.com|\/signin|ServiceLogin|gsi\//i.test(url);
  const onFlow = /labs\.google/i.test(url);

  // A visible "Sign in" control means we're still logged out even if the URL
  // looks like Flow.
  let hasSignInButton = false;
  try {
    hasSignInButton = await page
      .getByRole('button', { name: /sign in|log in|continue with google/i })
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
  } catch {
    /* ignore */
  }

  if (onFlow && !onLoginPage && !hasSignInButton) {
    console.log('✓ Flow detected and you look logged in. Saving session in 4s...');
    await page.waitForTimeout(4000);
    saved = true;
    break;
  }

  process.stdout.write('.'); // heartbeat so you see it's waiting
  await page.waitForTimeout(2000);
}

console.log('');
await closeBrowser(); // closing the persistent context flushes cookies to disk

if (saved) {
  console.log('Session saved. Now run `npm run dev`.');
} else {
  console.log(
    'Timed out before I could confirm login. If you DID finish signing in, ' +
      'the session may still be saved — just run `npm run dev` and try `/inspect`. ' +
      'If it says "Not logged in", run `npm run login` again.',
  );
}
process.exit(0);
