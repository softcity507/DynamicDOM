/**
 * Detect DOM drift and get an AI-drafted fix for src/flowPage.ts.
 *   npm run detect-drift
 * First run saves a baseline snapshot. Every run after that diffs the live
 * accessibility tree against it; if Google changed something, and
 * ANTHROPIC_API_KEY is set, prints (and saves) Claude's suggested fix. Never
 * edits flowPage.ts itself — review the suggestion before applying it.
 */
import { getPage, closeBrowser } from './browser.js';
import { FlowPage } from './flowPage.js';
import { checkDrift } from './driftDetector.js';

const flow = new FlowPage(await getPage());
await flow.open();
console.log(await checkDrift(flow));
await closeBrowser();
process.exit(0);
