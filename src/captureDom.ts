/**
 * Capture Flow's id/class -> text map as JSON.
 *   npm run capture-dom
 * Always captures fresh: whatever was in data/latest.json gets rotated to
 * data/previous.json first, then the live page is written to data/latest.json.
 * Run `npm run capture-dom-diff` afterward to see exactly what changed
 * between the two — that step needs no browser, just these two files. If
 * ANTHROPIC_API_KEY is set, it also asks Claude to judge which changes are
 * real (a moved/renamed button, changed label) versus pure class-hash churn
 * from a Google rebuild.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getPage, closeBrowser } from './browser.js';
import { FlowPage } from './flowPage.js';
import { captureDomSnapshot } from './domSnapshot.js';

const DATA_DIR = path.resolve('data');
const LATEST_PATH = path.join(DATA_DIR, 'latest.json');
const PREVIOUS_PATH = path.join(DATA_DIR, 'previous.json');

await mkdir(DATA_DIR, { recursive: true });

const page = await getPage();
const flow = new FlowPage(page);
await flow.open();
const current = await captureDomSnapshot(page);

let rotated = false;
try {
  const existing = await readFile(LATEST_PATH, 'utf8');
  await writeFile(PREVIOUS_PATH, existing, 'utf8');
  rotated = true;
} catch {
  /* nothing captured yet */
}

await writeFile(LATEST_PATH, JSON.stringify(current, null, 2), 'utf8');
console.log(
  `Captured ${Object.keys(current).length} id/class entries -> ${LATEST_PATH}` +
    (rotated ? ` (previous snapshot moved to ${PREVIOUS_PATH})` : ' (first capture, nothing to rotate yet)'),
);

await closeBrowser();
process.exit(0);
