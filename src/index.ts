import express, { type Request, type Response, type NextFunction } from 'express';
import { existsSync } from 'node:fs';
import { config } from './config.js';
import { createJob, getJob, listJobs } from './queue.js';
import { getPage } from './browser.js';
import { FlowPage } from './flowPage.js';
import { checkDrift } from './driftDetector.js';

const app = express();
app.use(express.json());

/** Shared-secret gate so only you can trigger the browser. */
function auth(req: Request, res: Response, next: NextFunction): void {
  if (req.header('x-api-key') !== config.apiKey) {
    res.status(401).json({ error: 'bad or missing x-api-key header' });
    return;
  }
  next();
}

app.get('/health', (_req, res) => res.json({ ok: true }));

/**
 * POST /jobs  -> submit a generation. Returns instantly with a job id.
 * body: { "prompt": "a cat surfing", "options": { "aspect ratio": "16:9" } }
 */
app.post('/jobs', auth, (req, res) => {
  const { prompt, options } = req.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'prompt (string) is required' });
  }
  const job = createJob({ prompt, options });
  res.status(202).json({ id: job.id, status: job.status });
});

/** GET /jobs/:id -> poll status/result. */
app.get('/jobs/:id', auth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job) return res.status(404).json({ error: 'no such job' });
  res.json(job);
});

/** GET /jobs -> list everything. */
app.get('/jobs', auth, (_req, res) => res.json(listJobs()));

/** GET /jobs/:id/screenshot -> download the captured frame. */
app.get('/jobs/:id/screenshot', auth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job?.screenshotPath || !existsSync(job.screenshotPath)) {
    return res.status(404).json({ error: 'no screenshot' });
  }
  res.sendFile(job.screenshotPath);
});

/** GET /jobs/:id/video -> download the generated .mp4 (if it was captured). */
app.get('/jobs/:id/video', auth, (req, res) => {
  const job = getJob(req.params.id);
  if (!job?.videoPath || !existsSync(job.videoPath)) {
    return res.status(404).json({ error: 'no video file captured for this job' });
  }
  res.sendFile(job.videoPath);
});

/**
 * GET /inspect -> dump the live accessibility tree. Use this whenever a
 * locator stops matching after Google changes the DOM: read the role+name
 * values, update the candidate lists in flowPage.ts.
 */
app.get('/inspect', auth, async (_req, res) => {
  try {
    const flow = new FlowPage(await getPage());
    await flow.open();
    res.type('text/plain').send(await flow.dumpAccessibilityTree());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

/**
 * GET /detect-drift -> diff the live DOM against the last known-good
 * snapshot. If Google changed something and ANTHROPIC_API_KEY is set,
 * returns Claude's drafted fix for flowPage.ts (for review, not auto-applied).
 */
app.get('/detect-drift', auth, async (_req, res) => {
  try {
    const flow = new FlowPage(await getPage());
    await flow.open();
    res.type('text/plain').send(await checkDrift(flow));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

app.listen(config.port, () => {
  console.log(`Flow automation API on http://localhost:${config.port}`);
  console.log(`Headful=${config.headful}. First time? run \`npm run login\`.`);
});
