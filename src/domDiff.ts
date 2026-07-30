import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { DomSnapshot } from './domSnapshot.js';
import { config } from './config.js';
import { analyzeDomDiff } from './selfHeal.js';

const DIFF_PATH = path.join(path.resolve('data'), 'diff.json');

export interface SnapshotDiff {
  timestamp: string;
  added: DomSnapshot;
  removed: DomSnapshot;
  changed: Record<string, { before: string; after: string }>;
  analysis?: string;
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
 * Diff `previous` against `current` and, if they differ, write data/diff.json
 * — overwritten every run, so it always reflects the most recent change,
 * never a growing history. With ANTHROPIC_API_KEY set, also asks Claude to
 * judge which entries are real changes (a moved/renamed button, changed
 * label) versus pure class-hash churn from a Google rebuild, and folds that
 * judgment into the same file.
 */
export async function saveDiffIfChanged(previous: DomSnapshot, current: DomSnapshot): Promise<string> {
  const diff = diffSnapshots(previous, current);
  const addedCount = Object.keys(diff.added).length;
  const removedCount = Object.keys(diff.removed).length;
  const changedCount = Object.keys(diff.changed).length;

  if (addedCount + removedCount + changedCount === 0) {
    return 'No DOM data drift detected — id/class -> text map is unchanged.';
  }

  const summary = `+${addedCount} added, -${removedCount} removed, ~${changedCount} changed`;

  if (config.anthropicApiKey) {
    diff.analysis = await analyzeDomDiff(diff);
  }

  await writeFile(DIFF_PATH, JSON.stringify(diff, null, 2), 'utf8');

  let report = `DOM data drift detected: ${summary}.\nDiff saved to ${DIFF_PATH}.`;
  report += diff.analysis
    ? `\n\n${diff.analysis}`
    : '\nSet ANTHROPIC_API_KEY in .env for an AI judgment on which entries are real vs. hash churn.';

  return report;
}
