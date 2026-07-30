import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  apiKey: process.env.API_KEY ?? 'change-me',
  userDataDir: process.env.USER_DATA_DIR ?? './.chrome-profile',
  headful: (process.env.HEADFUL ?? 'true') === 'true',
  flowUrl: process.env.FLOW_URL ?? 'https://labs.google/fx/tools/flow',
  renderTimeoutMs: Number(process.env.RENDER_TIMEOUT_MS ?? 300_000),
  // Optional: enables AI self-healing locators + `npm run detect-drift`.
  // Static role/name candidates in flowPage.ts are always tried first; this
  // is only a fallback for when Google changes the DOM and all of them miss.
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
  anthropicModel: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5',
};
