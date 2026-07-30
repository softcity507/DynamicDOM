/**
 * Compare data/previous.json against data/latest.json and save any
 * difference to data/diffs/.
 *   npm run capture-dom-diff
 * Pure file comparison, no browser — run this any time after two
 * `npm run capture-dom` runs to see exactly what Google changed.
 */
import { runDiff } from './domDiff.js';

console.log(await runDiff());
