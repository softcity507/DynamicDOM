/**
 * Capture Flow's id/class -> text map and diff it against the last capture,
 * in one step.
 *   npm run capture-dom
 * data/latest.json always holds the current capture. Before it's
 * overwritten, whatever was in it gets rotated into data/previous.json — the
 * permanent "old DOM" record for the next comparison. data/diff.json holds
 * the difference between old and new (overwritten every run, not a growing
 * history). With ANTHROPIC_API_KEY set, diff.json also gets Claude's
 * judgment on which entries are real changes versus pure class-hash churn
 * from a Google rebuild.
 *
 * After a run, exactly three files exist: previous.json, latest.json, and
 * (if anything changed) diff.json.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getPage, closeBrowser } from './browser.js';
import { FlowPage } from './flowPage.js';
import { captureDomSnapshot, type DomSnapshot } from './domSnapshot.js';
import { saveDiffIfChanged } from './domDiff.js';

const DATA_DIR = path.resolve('data');
const LATEST_PATH = path.join(DATA_DIR, 'latest.json');
const PREVIOUS_PATH = path.join(DATA_DIR, 'previous.json');

await mkdir(DATA_DIR, { recursive: true });

const page = await getPage();
const flow = new FlowPage(page);
await flow.open();
const current = await captureDomSnapshot(page);

let previous: DomSnapshot | null = null;
try {
  previous = JSON.parse(await readFile(LATEST_PATH, 'utf8')) as DomSnapshot;
  await writeFile(PREVIOUS_PATH, JSON.stringify(previous, null, 2), 'utf8');
} catch {
  /* first capture ever — nothing to rotate or diff against yet */
}

await writeFile(LATEST_PATH, JSON.stringify(current, null, 2), 'utf8');
await closeBrowser();

console.log(`Captured ${Object.keys(current).length} id/class entries -> ${LATEST_PATH}`);
console.log(
  previous
    ? await saveDiffIfChanged(previous, current)
    : 'No previous capture — this is the baseline. Run again later to see what changed.',
);

process.exit(0);
