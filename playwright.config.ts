// Journey-spec harness (TEST-PLAN §2.2 E-J*; STATE.md rule: an increment completes a
// journey, not a screen). Runs the real client (vite :5199) against the seeded rig
// server (dev-env/, :19998). Reset discipline: global-setup reseeds via seed.zsh so
// every run starts from the identical fixture state.
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TC4_ROOT = path.resolve(HERE, '..');

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false, // journeys share one rig working dir; state is per-run, not per-test
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:5199',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // Rig server (pankosmia_web 0.18.5 git-rev pin — D27 update; isolated state under dev-env/state/).
      // reuseExistingServer: the rig is normally already running during development.
      command: path.join(TC4_ROOT, 'dev-env', 'scripts', 'run.zsh'),
      url: 'http://127.0.0.1:19998/api/version',
      reuseExistingServer: true,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5199',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
