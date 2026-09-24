// Reset the rig to its pristine seeded state before every journey run.
// seed.zsh is documented safe to run while the rig server is up (dev-env/README.md,
// transport-suite workflow) — it rebuilds dev-env/state/work from templates and
// re-copies sample-burrito as the seeded project. Then one health probe (#324):
// a poisoned rig stops the run before the first test.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRigHealthy } from './rig-health';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TC4_ROOT = path.resolve(HERE, '..', '..');

export default async function globalSetup() {
  execFileSync(path.join(TC4_ROOT, 'dev-env', 'scripts', 'seed.zsh'), {
    stdio: 'inherit',
  });
  await assertRigHealthy();
}
