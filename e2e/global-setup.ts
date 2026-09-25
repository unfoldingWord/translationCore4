// Reset the rig to its pristine seeded state before every journey run.
// seed.zsh is documented safe to run while the rig server is up (dev-env/README.md,
// transport-suite workflow) — it rebuilds dev-env/state/work from templates and
// re-copies conformance/sample-burrito as the seeded project. Then one health probe
// (#324): a poisoned rig stops the run before the first test.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { assertRigHealthy } from './rig-health';
import { TC4_ROOT } from './helpers/root';
import { RIG_ZSH, rigScriptArgs, rigShellEnv } from './rig-shell';

export default async function globalSetup() {
  // Through zsh, not as a program: Windows cannot run a .zsh file (#396).
  execFileSync(RIG_ZSH, rigScriptArgs(path.join(TC4_ROOT, 'dev-env', 'scripts', 'seed.zsh')), {
    env: rigShellEnv(),
    stdio: 'inherit',
  });
  await assertRigHealthy();
}
