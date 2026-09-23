// Reset the rig to its pristine seeded state before every journey run.
// seed.zsh is documented safe to run while the rig server is up (dev-env/README.md,
// transport-suite workflow) — it rebuilds dev-env/state/work from templates and
// re-copies sample-burrito as the seeded project.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRigHealthy, waitForRigReady } from './rig-health';
import { rigScriptArgs, rigShellEnv, RIG_ZSH } from './rig-shell';
import { prepareRig } from './rig-setup';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TC4_ROOT = path.resolve(HERE, '..');
const SEED_OUTPUT_LIMIT = 2 * 1024 * 1024;

function seedRig(): void {
  try {
    execFileSync(RIG_ZSH, rigScriptArgs(path.join(TC4_ROOT, 'dev-env', 'scripts', 'seed.zsh')), {
      env: rigShellEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      maxBuffer: SEED_OUTPUT_LIMIT,
    });
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string };
    if (failure.stdout) process.stdout.write(failure.stdout);
    if (failure.stderr) process.stderr.write(failure.stderr);
    throw error;
  }
}

export default async function globalSetup() {
  await waitForRigReady(globalThis.fetch);
  await prepareRig(
    seedRig,
    () => assertRigHealthy(globalThis.fetch),
  );
}
