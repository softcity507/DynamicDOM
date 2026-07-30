import type { Page } from 'playwright';

export type DomSnapshot = Record<string, string>;

/**
 * Map every element that has an `id` or `class` to its own visible text,
 * keyed by "#id" or ".class.list" (duplicates get a "__N" suffix so classes
 * shared by many elements don't clobber each other). This is the raw
 * material for dataDrift.ts's JSON-based drift check — a different, coarser
 * signal than the role/name accessibility tree driftDetector.ts already uses.
 */
export async function captureDomSnapshot(page: Page): Promise<DomSnapshot> {
  return page.evaluate(() => {
    const result: Record<string, string> = {};
    const seen = new Map<string, number>();
    const nodes = document.querySelectorAll<HTMLElement>('body *');

    for (const el of nodes) {
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') continue;

      // Own text only (direct text-node children) — NOT innerText, which
      // would pull in every descendant's text too and make every ancestor
      // "change" whenever a single nested label does.
      let text = '';
      for (const child of el.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? '';
      }
      text = text.trim();
      if (!text) continue;

      const id = el.id;
      const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).filter(Boolean) : [];
      let key: string | null = id ? `#${id}` : classes.length ? `.${classes.join('.')}` : null;
      if (!key) continue;

      const count = seen.get(key) ?? 0;
      seen.set(key, count + 1);
      if (count > 0) key = `${key}__${count}`;

      result[key] = text.length > 500 ? `${text.slice(0, 500)}…` : text;
    }

    return result;
  });
}
