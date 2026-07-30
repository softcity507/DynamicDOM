import type { Page, Locator } from 'playwright';
import { config } from './config.js';
import { healLocator } from './selfHeal.js';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * FlowPage = the ONLY place locators live. Every element is found by its
 * accessibility role + visible name (or placeholder / contenteditable),
 * never by position, nth-child, hashed classes, or coordinates — so it
 * survives Flow's daily DOM reshuffles.
 *
 * `firstWorking()` tries a list of candidate locators and uses the first
 * that's actually visible. When Google renames something, you just add the
 * new name to the list instead of rewriting anything.
 */
export class FlowPage {
  constructor(private page: Page) {}

  /**
   * `intent` is optional and only used as a fallback: if every static
   * candidate above fails to appear, and ANTHROPIC_API_KEY is set, we hand
   * `intent` plus the live accessibility tree to Claude to find the element
   * Google moved/renamed. Static candidates are always tried first — this
   * never runs unless all of them miss.
   */
  private async firstWorking(candidates: Locator[], timeoutMs = 20_000, intent?: string): Promise<Locator> {
    const deadline = Date.now() + timeoutMs;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      for (const loc of candidates) {
        try {
          if (await loc.first().isVisible()) return loc.first();
        } catch (e) {
          lastErr = e;
        }
      }
      await this.page.waitForTimeout(300);
    }

    if (intent) {
      const healed = await this.tryHeal(intent);
      if (healed) return healed;
    }

    throw new Error(
      `No candidate locator became visible in ${timeoutMs}ms. ` +
        `Run \`npm run inspect\` to see the current role+name values and add them here. ` +
        `Last error: ${String(lastErr)}`,
    );
  }

  /** Last-resort AI lookup — see firstWorking's `intent` param. */
  private async tryHeal(intent: string): Promise<Locator | null> {
    try {
      const snapshot = await this.page.locator('body').ariaSnapshot();
      const guess = await healLocator(intent, snapshot);
      if (!guess) return null;

      const candidate = this.page.getByRole(guess.role as Parameters<Page['getByRole']>[0], {
        name: new RegExp(escapeRegExp(guess.name), 'i'),
      });
      if (!(await candidate.first().isVisible().catch(() => false))) return null;

      console.warn(`[self-heal] "${intent}" -> role="${guess.role}" name="${guess.name}" (${guess.reasoning})`);
      return candidate.first();
    } catch (e) {
      console.warn(`[self-heal] failed for "${intent}": ${String(e)}`);
      return null;
    }
  }

  /** Open Flow, confirm we're logged in, and wait for the editor to hydrate. */
  async open(): Promise<void> {
    await this.page.goto(config.flowUrl, { waitUntil: 'domcontentloaded' });

    if (/accounts\.google\.com/.test(this.page.url())) {
      throw new Error('Not logged in. Run `npm run login`, sign in, then retry.');
    }

    await this.waitForEditor();
  }

  /**
   * Flow is a heavy SPA that shows "Loading…" first. Wait until an actual
   * editable prompt element exists before doing anything (or inspecting),
   * so we never act against a half-rendered page.
   */
  async waitForEditor(timeoutMs = 90_000): Promise<void> {
    await this.page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => void 0);

    // The prompt input only exists once the editor is really up.
    await this.page
      .locator('textarea, [contenteditable="true"], [role="textbox"]')
      .first()
      .waitFor({ state: 'visible', timeout: timeoutMs })
      .catch(() => void 0);

    // A little extra settle for late-mounting toolbar buttons.
    await this.page.waitForTimeout(2500);
  }

  /**
   * Type the prompt. Handles ALL the shapes Flow might use:
   * a real textbox, a <textarea>, or a contenteditable <div>.
   */
  async setPrompt(text: string): Promise<void> {
    const box = await this.firstWorking(
      [
        this.page.getByRole('textbox', { name: /prompt|describe|idea|create|type/i }),
        this.page.getByPlaceholder(/prompt|describe|generate|idea|type|scene/i),
        this.page.locator('textarea'),
        this.page.locator('[contenteditable="true"]'),
        this.page.getByRole('textbox'),
      ],
      20_000,
      'the main prompt input where the user types what to create (a textbox, textarea, or contenteditable area)',
    );

    await box.click();
    // Clear whatever is there (works for input, textarea, and contenteditable).
    await box.press('Control+A').catch(() => void 0);
    await box.press('Delete').catch(() => void 0);
    await this.page.keyboard.type(text, { delay: 12 });

    // Assert-before-act: make sure the text actually landed.
    const got =
      (await box.inputValue().catch(() => null)) ??
      (await box.textContent().catch(() => null)) ??
      '';
    if (got && !got.includes(text.slice(0, 15))) {
      // Fallback for stubborn fields.
      await box.fill(text).catch(() => void 0);
    }
  }

  /** Optional: pick a setting like aspect ratio / model / duration. */
  async selectOption(groupName: RegExp, optionName: RegExp): Promise<void> {
    const trigger = await this.firstWorking(
      [
        this.page.getByRole('button', { name: groupName }),
        this.page.getByRole('combobox', { name: groupName }),
        this.page.getByLabel(groupName),
      ],
      20_000,
      `the control that opens the "${groupName}" setting (e.g. aspect ratio, model, duration)`,
    );
    await trigger.click();
    const option = await this.firstWorking(
      [
        this.page.getByRole('option', { name: optionName }),
        this.page.getByRole('menuitem', { name: optionName }),
        this.page.getByText(optionName),
      ],
      20_000,
      `the "${optionName}" choice inside the currently open settings menu`,
    );
    await option.click();
  }

  /**
   * Click Generate / Create — covers text buttons AND icon-only buttons.
   *
   * Flow's create screen has TWO buttons whose name contains "Create":
   * a header/nav button (icon "add_2 Create") and the actual submit button
   * next to the prompt box (icon "arrow_forward Create", disabled until you
   * type). The icon-qualified candidate must come first or we may click the
   * wrong one.
   */
  async generate(): Promise<void> {
    const btn = await this.firstWorking(
      [
        this.page.getByRole('button', { name: /arrow_forward.*create/i }),
        this.page.getByRole('button', { name: /^generate$|generate|render|run|animate/i }),
        this.page.getByLabel(/generate|create|send|submit|run/i),
        this.page.getByText(/^generate$/i),
        this.page.getByRole('button', { name: /create/i }),
      ],
      20_000,
      'the submit button that starts generating the video/image from the prompt (often labeled Generate, ' +
        'Create, or Render — NOT a header/nav button, and NOT the media-upload "Add Media" button)',
    );
    await btn.click();
  }

  /**
   * Wait on the RESULT, not a timer. First look for a "working" signal,
   * then for the finished video to appear. No sleep() anywhere.
   */
  async waitForRender(): Promise<void> {
    await this.page
      .getByText(/generating|rendering|processing|loading|working/i)
      .first()
      .waitFor({ state: 'visible', timeout: 20_000 })
      .catch(() => void 0);

    await this.page
      .locator('video, [data-media-type="video"], img[src^="blob:"], a[download]')
      .first()
      .waitFor({ state: 'visible', timeout: config.renderTimeoutMs });
  }

  /** Grab a media URL from the DOM if one is exposed (blob: or src). */
  async getResultUrl(): Promise<string | null> {
    const video = this.page.locator('video[src], video source[src]').first();
    if (await video.count()) return (await video.getAttribute('src')) ?? null;
    return null;
  }

  /**
   * Click Flow's download/export control and save the file to `destPath`.
   * Handles a direct Download button, an aria-labelled icon, or a Download
   * item hidden behind a "⋮ / More" menu. Returns the saved path, or null
   * if no download control was found.
   */
  async downloadResult(destPath: string): Promise<string | null> {
    let trigger: Locator | null = null;
    const direct = [
      this.page.getByRole('button', { name: /download|export|save/i }),
      this.page.getByLabel(/download|export|save/i),
      this.page.locator('a[download]'),
    ];
    for (const c of direct) {
      try {
        if (await c.first().isVisible()) {
          trigger = c.first();
          break;
        }
      } catch {
        /* ignore */
      }
    }

    // Not visible directly? Open a "More" / kebab menu and look inside.
    if (!trigger) {
      const more = [
        this.page.getByRole('button', { name: /more|options|menu/i }),
        this.page.getByLabel(/more|options/i),
      ];
      for (const m of more) {
        try {
          if (await m.first().isVisible()) {
            await m.first().click();
            break;
          }
        } catch {
          /* ignore */
        }
      }
      const inMenu = [
        this.page.getByRole('menuitem', { name: /download|export|save/i }),
        this.page.getByText(/download|export/i),
      ];
      for (const c of inMenu) {
        try {
          if (await c.first().isVisible()) {
            trigger = c.first();
            break;
          }
        } catch {
          /* ignore */
        }
      }
    }

    if (!trigger) return null;

    const [download] = await Promise.all([
      this.page.waitForEvent('download', { timeout: 60_000 }),
      trigger.click(),
    ]);
    await download.saveAs(destPath);
    return destPath;
  }

  async screenshot(path: string): Promise<void> {
    await this.page.screenshot({ path, fullPage: true });
  }

  /** DEBUG: dump the live ARIA tree (roles + names) as readable YAML. */
  async dumpAccessibilityTree(): Promise<string> {
    return this.page.locator('body').ariaSnapshot();
  }
}
