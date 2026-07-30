import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import type { DomSnapshot } from './domSnapshot.js';

const DATA_DIR = path.resolve('data');
const DIFF_DIR = path.join(DATA_DIR, 'diffs');
const LATEST_PATH = path.join(DATA_DIR, 'latest.json');
const PREVIOUS_PATH = path.join(DATA_DIR, 'previous.json');

export interface SnapshotDiff {
  timestamp: string;
  added: DomSnapshot;
  removed: DomSnapshot;
  changed: Record<string, { before: string; after: string }>;
}

export function diffSnapshots(previous: DomSnapshot, current: DomSnapshot): SnapshotDiff {
  const added: DomSnapshot = {};
  const removed: DomSnapshot = {};
  const changed: Record<string, { before: string; after: string }> = {};

  for (const [key, text] of Object.entries(current)) {
    if (!(key in previous)) added[key] = text;
    else if (previous[key] !== text) changed[key] = { before: previous[key], after: text };
  }
  for (const [key, text] of Object.entries(previous)) {
    if (!(key in current)) removed[key] = text;
  }

  return { timestamp: new Date().toISOString(), added, removed, changed };
}

/**
 * Compare data/previous.json against data/latest.json (both written by
 * `npm run capture-dom`) and, if they differ, save the diff to
 * data/diffs/diff-<timestamp>.json. Pure file comparison — no browser
 * needed, so this can be run any time after two captures.
 */
export async function runDiff(): Promise<string> {
  let previous: DomSnapshot;
  try {
    previous = JSON.parse(await readFile(PREVIOUS_PATH, 'utf8')) as DomSnapshot;
  } catch {
    return (
      `No previous snapshot at ${PREVIOUS_PATH} yet. Run \`npm run capture-dom\` twice ` +
      '(once to establish a baseline, again later to capture what changed) before diffing.'
    );
  }

  let current: DomSnapshot;
  try {
    current = JSON.parse(await readFile(LATEST_PATH, 'utf8')) as DomSnapshot;
  } catch {
    return `No current snapshot at ${LATEST_PATH} yet. Run \`npm run capture-dom\` first.`;
  }

  const diff = diffSnapshots(previous, current);
  const addedCount = Object.keys(diff.added).length;
  const removedCount = Object.keys(diff.removed).length;
  const changedCount = Object.keys(diff.changed).length;

  if (addedCount + removedCount + changedCount === 0) {
    return 'No DOM data drift detected — id/class -> text map is unchanged.';
  }

  await mkdir(DIFF_DIR, { recursive: true });
  const diffPath = path.join(DIFF_DIR, `diff-${Date.now()}.json`);
  await writeFile(diffPath, JSON.stringify(diff, null, 2), 'utf8');

  return (
    `DOM data drift detected: +${addedCount} added, -${removedCount} removed, ~${changedCount} changed.\n` +
    `Diff saved to ${diffPath}.`
  );
}
