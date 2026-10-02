// D88 (#514): one recorder for "did the client use the internet?". It watches a page for
// every request and every WebSocket, and calls a request EXTERNAL when it
//   - goes to any host other than the dev client (localhost:5199, which proxies /api to
//     the rig), or
//   - goes to the dev client on a platform route that makes the server use the
//     internet: /api/gitea/... or /api/git/push/... (src/data/internet.ts OUTBOUND_ROUTES).
// `data:`, `blob:` and `about:` URLs leave nothing on the network and are not recorded.
// The log is written as JSON into the test's output folder and attached to the report,
// so each run leaves a repeatable artifact.
import fs from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';

export const CLIENT_HOST = 'localhost:5199';
const OUTBOUND_PATHS = ['/api/gitea/', '/api/git/push/'];

export interface RecordedRequest {
  kind: 'request' | 'websocket';
  method: string;
  host: string;
  path: string;
  external: boolean;
}

export interface ExternalRecorder {
  /** Every recorded request since the start or the last reset. */
  all(): RecordedRequest[];
  /** The external ones, as `METHOD host/path` lines (for readable failures). */
  external(): string[];
  /** Forget what was recorded so far (a new phase of the same test). */
  reset(): void;
  /** Write the whole log (all and external, with a marker per phase) to the output folder and attach it. */
  save(testInfo: TestInfo, name?: string): Promise<string>;
}

export const isExternal = (url: URL): boolean =>
  url.host !== CLIENT_HOST || OUTBOUND_PATHS.some((p) => url.pathname.startsWith(p));

export function recordExternal(page: Page): ExternalRecorder {
  let log: RecordedRequest[] = [];
  const phases: Array<{ at: number; recorded: RecordedRequest[] }> = [];
  const note = (kind: RecordedRequest['kind'], method: string, raw: string) => {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return;
    }
    if (!/^(https?|wss?):$/.test(url.protocol)) return;
    log.push({ kind, method, host: url.host, path: url.pathname, external: isExternal(url) });
  };
  page.on('request', (req) => note('request', req.method(), req.url()));
  // Playwright's request event does not cover WebSockets; the dev client's HMR socket is local.
  page.on('websocket', (ws) => note('websocket', 'WS', ws.url()));
  const external = () => log.filter((r) => r.external).map((r) => `${r.method} ${r.host}${r.path}`);
  return {
    all: () => [...log],
    external,
    reset() {
      phases.push({ at: Date.now(), recorded: log });
      log = [];
    },
    async save(testInfo, name = 'external-requests') {
      const file = testInfo.outputPath(`${name}.json`);
      const body = {
        earlierPhases: phases.map((p) => ({ requests: p.recorded.length, external: p.recorded.filter((r) => r.external).length, log: p.recorded })),
        requests: log.length,
        externalRequests: external(),
        log,
      };
      fs.writeFileSync(file, JSON.stringify(body, null, 2));
      await testInfo.attach(name, { path: file, contentType: 'application/json' });
      return file;
    },
  };
}
