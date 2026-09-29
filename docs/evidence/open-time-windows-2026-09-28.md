# The Windows open-with-journal failures: the cause, measured — the issue #423 record

**Date:** 2026-09-28. **Commit:** `main` `051873f`, on the branch of issues #425 and #423.
**Machine:** Intel Core i5-12600KF, 32 GB RAM, Windows 11 Pro 10.0.26200, Node v22.23.3,
`pankosmia-web` 0.18.5 rig (git rev `99fd9be`), the Vite dev server (`npm run dev`) at :5199,
Chromium via Playwright.

## What was measured

Why the four open-with-journal journey tests of issue #423 (`e2e/j08-resume.spec.ts:147`,
`e2e/j15-slow-open.spec.ts:73`, `:88`, `:130`) fail on Windows and pass on macOS. The open
read every journal segment with one sequential HTTP GET
(`JournalStore.classifySegments` → `GET /api/burrito/ingredient/raw`), 4,002 requests for
the seeded large fixture. The macOS record (`open-time-run2-2026-09-05.md`) measured the
whole open at 4,620 ms — about 1.15 ms per segment.

## The cause: per-request cost of the browser's fetch path on Windows

One segment file of the large fixture, read 300–500 times sequentially, average wall-clock
per request:

| Client → route | ms per request |
|---|---|
| Node fetch → rig (:19998) | 0.89 |
| Node fetch → Vite proxy (:5199) → rig | 2.67 |
| Chromium fetch → rig (:19998, `no-cors`) | 4.12 |
| Chromium fetch → Vite proxy (:5199) → rig | **13.62** |
| Chromium fetch → Vite proxy with a keep-alive agent → rig | 3.17 |

The last row is the same measurement after `vite.config.js` gave the `/api` proxy
`agent: new http.Agent({ keepAlive: true })`: without it the proxy opened a new upstream
TCP connection per request. A second cost multiplies the first: on Home, every OBS
project's draft percentage reads all fifty stories (`src/state.jsx` obsStoryProgress), so
a Home visit with several OBS projects queues hundreds of reads on the browser's
six-connection pool, and a project open started from that Home waits behind them (seen in
the j08 trace: `content/NN.md` reads of four OBS projects still streaming while the open's
indicator stood). The keep-alive agent drains that burst about four times faster; the
burst itself is issue #460's neighborhood, not changed here.

A Playwright trace of the failing broken-journal test recorded the same rate live: 1,004
segment requests in 23.7 s (average 21.2 ms, median 18.6 ms) before the 30 s test timeout
killed the run. At that rate the 4,002-segment open needs over 80 s; the four tests fail
on their end states (indicator still standing, error report never reached), not on a
product defect in the open pipeline. Playwright tracing is not the cause: the test fails
identically with `--trace off`. The server is not the cause: it answers in under 1 ms.
The cost is the Chromium-on-Windows request path, roughly tripled by the Vite proxy hop.

## The fix this record supports

`JournalStore` now fetches the whole journal as ONE zip through the platform's own
ingredient-directory route (`GET /api/burrito/ingredient/zipped/<repo>?ipath=checking/journal`,
PLATFORM-NOTES note 41) and falls back to the per-file reads when that route refuses
(a journal-less project has no `checking/journal/` directory, and the route answers 400).
The route serves the 4,002-segment journal (2,258,632 bytes) in about 1.3 s on this
machine — one request in place of 4,002. Its zip names entries with `\` on Windows exactly
like the repository zip (4,005 of 4,007 entries observed), so the read goes through the
issue #425 normalizer (`src/data/serverZip.ts`).
