// Journey-spec harness (TEST-PLAN §2.2 E-J*; STATE.md rule: an increment completes a
// journey, not a screen). Runs the real client (vite :5199) against the seeded rig
// server (dev-env/, :19998). Reset discipline: global-setup reseeds via seed.zsh so
// every run starts from the identical fixture state.
import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rigCommand, rigShellEnv } from './e2e/rig-shell';
import { lane } from './e2e/lane.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TC4_ROOT = HERE;
// #524: TC4_RIG_PORT and TC4_VITE_PORT name a port lane. A named lane starts its own rig
// and vite, and stops when a port is in use: a reused server can be another worktree's.
const LANE = lane();

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false, // journeys share one rig working dir; state is per-run, not per-test
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  timeout: 30_000,
  use: {
    baseURL: LANE.clientOrigin,
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      // Rig server (pankosmia_web 0.18.5 git-rev pin — D27 update; isolated state under dev-env/state/).
      // reuseExistingServer: the rig is normally already running during development.
      // Through zsh, with MSYS2 paths on Windows (#396).
      command: rigCommand(path.join(TC4_ROOT, 'dev-env', 'scripts', 'run.zsh')),
      env: { ...rigShellEnv(), TC4_RIG_PORT: String(LANE.rigPort) } as Record<string, string>,
      url: `${LANE.rigApi}/version`,
      reuseExistingServer: !LANE.named,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: LANE.clientOrigin,
      reuseExistingServer: !LANE.named,
      timeout: 60_000,
      // #491: vite's own lines in the run's output. Once, a test met no server on
      // the vite port and the next test found it again; without them the run cannot show why.
      stdout: 'pipe',
    },
  ],
});
