/**
 * Print the current accessibility tree of your Flow page.
 *   npm run inspect
 * Use the role + name values it prints to fill in the candidate locators
 * in flowPage.ts. This is your "find the DOM" tool — run it whenever Google
 * changes something and a locator stops matching.
 */
import { getPage, closeBrowser } from './browser.js';
import { FlowPage } from './flowPage.js';

const flow = new FlowPage(await getPage());
await flow.open();
const tree = await flow.dumpAccessibilityTree();
console.log(tree);
await closeBrowser();
process.exit(0);
