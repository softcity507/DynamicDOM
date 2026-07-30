# Flow Automation API

A backend API **you own** that generates videos in **Google Flow** by driving
its **DOM** with Playwright. It never calls Google's private/backend API — it
does exactly what a person clicking the UI would do, just reliably and on demand.

The design solves your core problem (**the DOM shifts every day**) two ways:

1. **Semantic locators** — every element is found by its *accessibility role +
   visible name* (e.g. `button "Generate"`), never by position, `nth-child`,
   hashed class names, or coordinates. Those survive re-ordering and re-wrapping.
2. **One place to fix** — all locators live in `src/flowPage.ts`. When Google
   changes something, you edit one file, not your whole app.

---

## Architecture

```
HTTP client ──▶  Express API  ──▶  Job queue (1 at a time)  ──▶  FlowPage (Playwright)  ──▶  Google Flow UI (DOM)
   POST /jobs        src/index.ts        src/queue.ts                src/flowPage.ts               (a real browser)
   GET  /jobs/:id
```

- **`src/index.ts`** — REST endpoints. Auth via `x-api-key` header.
- **`src/queue.ts`** — async job queue. Generation is slow, so you submit a job,
  get an id back instantly, and poll. Jobs run **one at a time** (single browser session).
- **`src/flowPage.ts`** — the Page Object. THE ONLY FILE with locators. Your "API surface" for the UI.
- **`src/browser.ts`** — one persistent Chrome profile so you log in to Google just once.
- **`src/login.ts` / `src/inspect.ts`** — one-off helpers (log in; dump the DOM's roles+names).

---

## Setup (once)

```bash
npm install
npx playwright install chromium      # download the browser
cp .env.example .env                 # then edit .env (set API_KEY, FLOW_URL)
```

### Log in to Google (once)

```bash
npm run login
```

A browser window opens on Flow. Sign in by hand, wait until you see the Flow
editor, then press **ENTER** in the terminal. Your session is saved to
`USER_DATA_DIR` and reused forever after.

---

## Find the real button names (the important step)

The locators in `src/flowPage.ts` ship with sensible **guesses** (`/generate|create/i`,
`/prompt|describe/i`). Your Flow UI may use slightly different words. Discover the
exact ones:

```bash
npm run inspect
```

It prints the live **accessibility tree** — every interactive element's `role`
and `name`. Find your prompt box, your Generate button, your settings, and paste
their exact names into the candidate lists in `src/flowPage.ts`. Do this whenever
a locator stops matching after a Google update.

---

## Run the API

```bash
npm run dev        # or: npm start
```

### Submit a job

```bash
curl -X POST http://localhost:3000/jobs \
  -H "content-type: application/json" \
  -H "x-api-key: YOUR_KEY" \
  -d '{ "prompt": "a golden retriever surfing at sunset", "options": { "aspect ratio": "16:9" } }'
# -> { "id": "…", "status": "queued" }
```

### Poll it

```bash
curl http://localhost:3000/jobs/THE_ID -H "x-api-key: YOUR_KEY"
# status goes queued -> running -> done (or error)
# when done: resultUrl + a screenshot you can download
```

### Endpoints

| Method | Path                   | Purpose                                                               |
| ------ | ---------------------- | --------------------------------------------------------------------- |
| POST   | `/jobs`                | Submit a generation. Returns a job id.                                |
| GET    | `/jobs/:id`            | Poll status / result.                                                 |
| GET    | `/jobs`                | List all jobs.                                                        |
| GET    | `/jobs/:id/screenshot` | Download the captured frame.                                          |
| GET    | `/inspect`             | Dump the live accessibility tree.                                     |
| GET    | `/detect-drift`        | Diff live DOM vs baseline; AI-drafted fix if `ANTHROPIC_API_KEY` set. |
| GET    | `/health`              | Liveness check.                                                       |

All except `/health` require the `x-api-key` header.

---

## Why this survives "the DOM changes every day"

- **No positions.** We never say "the 4th button." We say `button named Generate`.
  Reordering / re-wrapping doesn't matter.
- **No hashed classes.** `css-1a2b3c` is ignored entirely.
- **Fallback chains.** `firstWorking([...])` tries several names; a rename means
  adding one candidate, not a rewrite.
- **Wait on results, not clocks.** No `sleep()`. We wait for the *video element*
  to appear, so the sequence is identical no matter how slow or rearranged the page is.
- **Loud failures.** On any break you get an error message + a screenshot of the
  exact page state, so `npm run inspect` fixes it in minutes.

---

## When a step breaks (daily maintenance loop)

1. `curl .../inspect` (or `npm run inspect`) → read current role+name values.
2. Update the matching candidate list in `src/flowPage.ts`.
3. Restart. Done — no other file changes.

This is still the ground truth: static role/name candidates in `flowPage.ts`
are always tried first. Everything below is an *optional* layer on top for
when you don't want to do that loop by hand every time Google ships a change.

---

## AI self-healing (optional)

Set `ANTHROPIC_API_KEY` in `.env` (get one at
[console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys))
and two things change:

1. **Runtime self-healing.** If every static candidate for a step (prompt box,
   settings, submit button, …) fails to appear — i.e. Google changed the DOM
   since you last updated `flowPage.ts` — instead of the job just failing, the
   live accessibility tree is handed to Claude with a plain-English
   description of what's needed ("the submit button that starts generating…").
   Claude picks the matching role + accessible name, and the job continues.
   Watch the process logs for `[self-heal] ...` lines — that's your signal
   Flow changed something and you should eventually update `flowPage.ts` for
   real, since self-heal is a fallback, not a permanent fix (it costs one
   extra API call + a few seconds, every time it triggers).
2. **Proactive drift detection**: `npm run detect-drift` (or `GET
   /detect-drift`). First run saves a baseline snapshot to
   `snapshots/baseline.yaml`. Every run after that diffs the live DOM against
   it — if nothing changed, it says so and exits. If something changed, Claude
   summarizes the diff and drafts updated candidate-locator code for the
   affected `flowPage.ts` functions, printed to the console and saved to
   `snapshots/drift-suggestion-<timestamp>.md`. **It never edits
   `flowPage.ts` itself** — this project has no git repo as a safety net, so
   you review the suggestion and hand-apply what looks right.

Without `ANTHROPIC_API_KEY` set, both features no-op cleanly: self-heal is
skipped (you get the original "no candidate matched" error) and
`detect-drift` still reports whether the DOM changed, just without a drafted
fix — everything else in this README behaves exactly as before.

---

## Notes & limits

- This automates a UI that has **no public API**; expect occasional maintenance.
  That's inherent to Flow, not to this design — this just makes fixes 2-minute edits.
- Keep it to **your own account** and reasonable volumes; respect Google's terms.
- For a headless server, set `HEADFUL=false` in `.env` *after* you've logged in once
  headful (login needs a visible window).
