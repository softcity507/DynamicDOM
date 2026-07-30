import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { getPage } from './browser.js';
import { FlowPage } from './flowPage.js';

export type JobStatus = 'queued' | 'running' | 'done' | 'error';

export interface JobInput {
  prompt: string;
  /** Optional UI options, e.g. { 'aspect ratio': '16:9', model: 'veo' } */
  options?: Record<string, string>;
}

export interface Job {
  id: string;
  status: JobStatus;
  input: JobInput;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  resultUrl?: string | null;
  videoPath?: string | null;
  screenshotPath?: string;
  error?: string;
}

const jobs = new Map<string, Job>();
const waiting: string[] = [];
let processing = false;

const OUTPUT_DIR = path.resolve('output');

export function createJob(input: JobInput): Job {
  const job: Job = {
    id: randomUUID(),
    status: 'queued',
    input,
    createdAt: Date.now(),
  };
  jobs.set(job.id, job);
  waiting.push(job.id);
  void drain();
  return job;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function listJobs(): Job[] {
  return [...jobs.values()].sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Process jobs ONE AT A TIME. Flow is a single browser session — running
 * two generations at once would fight over the same page. Serializing is
 * both correct and simpler.
 */
async function drain(): Promise<void> {
  if (processing) return;
  processing = true;
  try {
    await mkdir(OUTPUT_DIR, { recursive: true });
    while (waiting.length) {
      const id = waiting.shift()!;
      const job = jobs.get(id);
      if (!job) continue;
      await runJob(job);
    }
  } finally {
    processing = false;
  }
}

async function runJob(job: Job): Promise<void> {
  job.status = 'running';
  job.startedAt = Date.now();
  try {
    const flow = new FlowPage(await getPage());
    await flow.open();
    await flow.setPrompt(job.input.prompt);

    for (const [group, option] of Object.entries(job.input.options ?? {})) {
      await flow.selectOption(new RegExp(group, 'i'), new RegExp(option, 'i'));
    }

    await flow.generate();
    await flow.waitForRender();

    job.resultUrl = await flow.getResultUrl();
    job.screenshotPath = path.join(OUTPUT_DIR, `${job.id}.png`);
    await flow.screenshot(job.screenshotPath);

    // Try to download the actual video file into output/.
    try {
      job.videoPath = await flow.downloadResult(path.join(OUTPUT_DIR, `${job.id}.mp4`));
    } catch {
      job.videoPath = null; // download control not found; screenshot + url still available
    }

    job.status = 'done';
  } catch (err) {
    job.status = 'error';
    job.error = err instanceof Error ? err.message : String(err);
    // Capture what the page looked like at failure for fast diagnosis.
    try {
      const flow = new FlowPage(await getPage());
      job.screenshotPath = path.join(OUTPUT_DIR, `${job.id}-error.png`);
      await flow.screenshot(job.screenshotPath);
    } catch {
      /* ignore */
    }
  } finally {
    job.finishedAt = Date.now();
  }
}
