// Journey-spec harness (TEST-PLAN §2.2 E-J*; STATE.md rule: an increment completes a
// journey, not a screen). Runs the real client (vite :5199) against the seeded rig
// server (dev-env/, :19998). Reset discipline: global-setup reseeds via seed.zsh so
// every run starts from the identical fixture state.
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rigLauncherCommand, rigServerOptions } from './e2e/rig-shell';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TC4_ROOT = HERE;
const RIG_RUN = path.join(TC4_ROOT, 'dev-env', 'scripts', 'run.zsh');
const RIG_LAUNCHER = path.join(TC4_ROOT, 'e2e', 'rig-launcher.cjs');

const EXTERNAL_RIG = process.env.TC4_RIG_EXTERNAL === '1';

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
    ...(EXTERNAL_RIG ? [] : [{
      // Rig server (pankosmia_web 0.18.5 git-rev pin — D27 update; isolated state under dev-env/state/).
      // Port readiness is intentional: a poisoned rig returns HTTP 500, but is
      // still the process that global setup must diagnose through its health probe.
      ...rigServerOptions(rigLauncherCommand(RIG_RUN, RIG_LAUNCHER)),
    }]),
    {
      command: 'npm run dev',
      url: 'http://localhost:5199',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
