import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { FlowPage } from './flowPage.js';
import { config } from './config.js';
import { draftFix } from './selfHeal.js';

const SNAPSHOT_DIR = path.resolve('snapshots');
const BASELINE_PATH = path.join(SNAPSHOT_DIR, 'baseline.yaml');

export async function checkDrift(flow: FlowPage): Promise<string> {
  await mkdir(SNAPSHOT_DIR, { recursive: true });
  const current = await flow.dumpAccessibilityTree();

  let baseline: string | null = null;
  try {
    baseline = await readFile(BASELINE_PATH, 'utf8');
  } catch {
    /* first run */
  }

  if (baseline === null) {
    await writeFile(BASELINE_PATH, current, 'utf8');
    return `No baseline yet — saved the current DOM snapshot to ${BASELINE_PATH}. Run this again after Flow changes to detect drift.`;
  }

  if (baseline.trim() === current.trim()) {
    return 'No DOM drift detected — flowPage.ts locators should still match.';
  }

  let report = 'DOM drift detected: the live accessibility tree no longer matches the saved baseline.\n\n';

  if (!config.anthropicApiKey) {
    report +=
      'Set ANTHROPIC_API_KEY in .env for an AI-drafted fix. Raw snapshots for manual diffing:\n\n' +
      `--- BASELINE ---\n${baseline}\n\n--- CURRENT ---\n${current}`;
  } else {
    const flowPageSrc = await readFile(path.resolve('src/flowPage.ts'), 'utf8');
    const suggestion = await draftFix(baseline, current, flowPageSrc);
    const outPath = path.join(SNAPSHOT_DIR, `drift-suggestion-${Date.now()}.md`);
    await writeFile(outPath, suggestion, 'utf8');
    report += `${suggestion}\n\n(Full suggestion saved to ${outPath}. Review before applying to src/flowPage.ts.)`;
  }

  await writeFile(BASELINE_PATH, current, 'utf8');
  return report;
}
