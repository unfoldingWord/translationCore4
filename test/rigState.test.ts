import { describe, expect, it } from 'vitest';
import { RIG_ZSH, rigScriptPath, rigShellEnv } from '../e2e/rig-shell';

const fs = process.getBuiltinModule('node:fs');
const os = process.getBuiltinModule('node:os');
const path = process.getBuiltinModule('node:path');
const childProcess = process.getBuiltinModule('node:child_process');

const ROOT = process.cwd();
const STATE_HELPER = path.join(ROOT, 'dev-env', 'scripts', 'rig-state.zsh');
const RUN_SCRIPT = path.join(ROOT, 'dev-env', 'scripts', 'run.zsh');
const zshAvailable = path.isAbsolute(RIG_ZSH)
  ? fs.existsSync(RIG_ZSH)
  : childProcess.spawnSync(RIG_ZSH, ['--version'], { stdio: 'ignore' }).status === 0;

function ensureState(stateDirectory: string, seedScript: string, marker: string) {
  return childProcess.spawnSync(
    RIG_ZSH,
    [
      '-fc',
      'source "$0"; rig_ensure_state "$1" "$2"',
      rigScriptPath(STATE_HELPER),
      rigScriptPath(stateDirectory),
      rigScriptPath(seedScript),
    ],
    {
      env: { ...rigShellEnv(), RIG_MARKER: rigScriptPath(marker) },
      encoding: 'utf8',
    },
  );
}

describe('rig working-directory repair', () => {
  it.skipIf(!zshAvailable)('[requires zsh] reseeds incomplete state and preserves complete state', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-rig-state-'));
    const stateDirectory = path.join(temporaryRoot, 'work');
    const seedScript = path.join(temporaryRoot, 'seed.zsh');
    const marker = path.join(temporaryRoot, 'seed-count');
    const failingSeedScript = path.join(temporaryRoot, 'failing-seed.zsh');

    fs.writeFileSync(seedScript, '#!/bin/zsh\nprint -r -- seeded >> "$RIG_MARKER"\n');
    fs.writeFileSync(failingSeedScript, '#!/bin/zsh\nexit 23\n');
    if (process.platform !== 'win32') {
      fs.chmodSync(seedScript, 0o755);
      fs.chmodSync(failingSeedScript, 0o755);
    }
    try {
      const missing = ensureState(stateDirectory, seedScript, marker);
      expect(missing.status).toBe(0);
      expect(fs.readFileSync(marker, 'utf8')).toBe('seeded\n');

      fs.mkdirSync(stateDirectory, { recursive: true });
      fs.writeFileSync(path.join(stateDirectory, 'app_state.json'), '{}');
      expect(ensureState(stateDirectory, seedScript, marker).status).toBe(0);
      expect(fs.readFileSync(marker, 'utf8')).toBe('seeded\nseeded\n');

      fs.writeFileSync(path.join(stateDirectory, 'user_settings.json'), '{}');
      expect(ensureState(stateDirectory, seedScript, marker).status).toBe(0);
      expect(fs.readFileSync(marker, 'utf8')).toBe('seeded\nseeded\n');

      fs.rmSync(path.join(stateDirectory, 'app_state.json'));
      expect(ensureState(stateDirectory, seedScript, marker).status).toBe(0);
      expect(fs.readFileSync(marker, 'utf8')).toBe('seeded\nseeded\nseeded\n');

      fs.writeFileSync(path.join(stateDirectory, 'app_state.json'), '{}');
      fs.rmSync(path.join(stateDirectory, 'user_settings.json'));
      expect(ensureState(stateDirectory, seedScript, marker).status).toBe(0);
      expect(fs.readFileSync(marker, 'utf8')).toBe('seeded\nseeded\nseeded\nseeded\n');

      expect(fs.readFileSync(RUN_SCRIPT, 'utf8'))
        .toContain('rig_ensure_state "$DEV/state/work" "$DEV/scripts/seed.zsh"');

      fs.rmSync(path.join(stateDirectory, 'app_state.json'));
      const failure = ensureState(stateDirectory, failingSeedScript, marker);
      expect(failure.status).toBe(23);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
