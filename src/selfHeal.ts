import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!config.anthropicApiKey) return null;
  client ??= new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

const LOCATE_TOOL = {
  name: 'locate_element',
  description:
    'Report the single best-matching element for the requested UI action, based on the accessibility tree provided.',
  input_schema: {
    type: 'object' as const,
    properties: {
      found: { type: 'boolean', description: 'True only if a matching element actually exists in the tree.' },
      role: { type: 'string', description: 'The element\'s ARIA role, e.g. "button", "textbox", "combobox".' },
      name: {
        type: 'string',
        description: 'The exact accessible name, or the longest distinctive substring of it, to match against.',
      },
      reasoning: { type: 'string', description: 'One sentence on why this element matches the intent.' },
    },
    required: ['found', 'reasoning'],
  },
};

export interface HealedLocator {
  role: string;
  name: string;
  reasoning: string;
}

/**
 * Ask Claude to find the element for `intent` inside a live accessibility
 * snapshot. This is only a last resort: flowPage.ts always tries its static
 * role/name candidates first, and this only runs once every one of them has
 * failed to become visible — i.e. Google changed the DOM. Returns null if no
 * ANTHROPIC_API_KEY is configured, or Claude can't find a confident match.
 */
export async function healLocator(intent: string, snapshot: string): Promise<HealedLocator | null> {
  const anthropic = getClient();
  if (!anthropic) return null;

  const message = await anthropic.messages.create({
    model: config.anthropicModel,
    max_tokens: 400,
    tools: [LOCATE_TOOL],
    tool_choice: { type: 'tool', name: 'locate_element' },
    messages: [
      {
        role: 'user',
        content:
          `A Playwright locator broke because Google Flow's DOM changed. Find the element for this action:\n"${intent}"\n\n` +
          `Here is the CURRENT accessibility tree (role "name", indented by nesting):\n\n${snapshot}`,
      },
    ],
  });

  const toolUse = message.content.find((b) => b.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') return null;
  const result = toolUse.input as Partial<HealedLocator> & { found?: boolean };
  if (!result.found || !result.role || !result.name) return null;
  return { role: result.role, name: result.name, reasoning: result.reasoning ?? '' };
}

/**
 * Ask Claude to summarize a DOM diff and draft updated flowPage.ts
 * candidate-locator snippets. Used by the proactive drift detector
 * (`npm run detect-drift`) — never auto-applied, just printed/saved for
 * human review since there's no version control safety net in this project.
 */
export async function draftFix(oldSnapshot: string, newSnapshot: string, flowPageSource: string): Promise<string> {
  const anthropic = getClient();
  if (!anthropic) return '(ANTHROPIC_API_KEY not set — no AI suggestion available.)';

  const message = await anthropic.messages.create({
    model: config.anthropicModel,
    max_tokens: 1500,
    messages: [
      {
        role: 'user',
        content:
          'You maintain Playwright locators for a Google Flow automation tool (Page Object in flowPage.ts). ' +
          "Flow's DOM changed. Compare the OLD and NEW accessibility-tree snapshots below, summarize what changed " +
          'in 2-4 bullet points, then propose updated candidate-locator arrays (role + name regex) for whichever ' +
          'functions in flowPage.ts are affected. Output plain markdown: a short summary, then one ```ts fenced ' +
          'snippet per function that needs changing (just the changed array literal, not the whole file). Do not ' +
          'invent elements that are not present in the NEW snapshot.\n\n' +
          `--- OLD SNAPSHOT ---\n${oldSnapshot}\n\n--- NEW SNAPSHOT ---\n${newSnapshot}\n\n` +
          `--- CURRENT flowPage.ts ---\n${flowPageSource}`,
      },
    ],
  });

  const text = message.content.find((b) => b.type === 'text');
  return text && text.type === 'text' ? text.text : '(no response)';
}

export interface DomSnapshotDiff {
  added: Record<string, string>;
  removed: Record<string, string>;
  changed: Record<string, { before: string; after: string }>;
}

/**
 * Ask Claude to judge a data/latest.json vs data/previous.json diff (id/class
 * -> text map). Google's styled-components hashes shift on every rebuild
 * even when nothing user-visible changed, so a raw key diff is full of noise;
 * this asks Claude to separate that from real changes — a renamed/moved
 * button, changed label text, a new or removed control — and flag whether
 * flowPage.ts likely needs a locator update. Used by `npm run capture-dom-diff`.
 */
export async function analyzeDomDiff(diff: DomSnapshotDiff): Promise<string> {
  const anthropic = getClient();
  if (!anthropic) return '(ANTHROPIC_API_KEY not set — no AI analysis available. Raw diff only.)';

  const message = await anthropic.messages.create({
    model: config.anthropicModel,
    max_tokens: 1200,
    messages: [
      {
        role: 'user',
        content:
          "This is a diff of a Google Flow page's id/class -> visible-text map between two captures. " +
          'Class names are styled-components hashes (e.g. "sc-abc123-0") that change on every Google rebuild ' +
          'even when nothing user-visible actually changed — that alone is noise, not real drift. ' +
          'For each added/removed/changed entry below, decide whether it is (a) pure hash/id churn where the ' +
          "visible text is unchanged or trivially reformatted (ignore), or (b) a real change — a button's label, " +
          'a new or removed control, or anything that could break a Playwright locator in flowPage.ts. ' +
          'Reply with one verdict line ("REAL CHANGE", "NOISE ONLY", or "MIXED"), then a bullet per entry that ' +
          'matters, saying what changed and whether flowPage.ts likely needs a locator update. Skip entries that ' +
          'are pure noise instead of listing them all.\n\n' +
          `--- DIFF ---\n${JSON.stringify(diff, null, 2)}`,
      },
    ],
  });

  const text = message.content.find((b) => b.type === 'text');
  return text && text.type === 'text' ? text.text : '(no response)';
}
