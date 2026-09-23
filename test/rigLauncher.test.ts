import { describe, expect, it, vi } from 'vitest';
import launcher from '../e2e/rig-launcher.cjs';
import { RIG_ZSH, rigScriptPath } from '../e2e/rig-shell';
import { journeyExitCode, recoverManagedLease } from '../scripts/run-journeys.cjs';

const fs = process.getBuiltinModule('node:fs');
const os = process.getBuiltinModule('node:os');
const path = process.getBuiltinModule('node:path');
const childProcess = process.getBuiltinModule('node:child_process');

const ROOT = process.cwd();
const LAUNCHER = path.join(ROOT, 'e2e', 'rig-launcher.cjs');
const zshAvailable = path.isAbsolute(RIG_ZSH)
  ? fs.existsSync(RIG_ZSH)
  : childProcess.spawnSync(RIG_ZSH, ['--version'], { stdio: 'ignore' }).status === 0;

describe('Pankosmia rig launcher boundary', () => {
  it('routes both public journey commands through the lifecycle wrapper', () => {
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };

    expect(packageJson.scripts.journeys).toBe('node scripts/run-journeys.cjs');
    expect(packageJson.scripts['test:e2e']).toBe(packageJson.scripts.journeys);
  });

  it('returns a failing exit code when cleanup fails after passing tests', () => {
    expect(journeyExitCode({ code: 0 }, new Error('cleanup failed'), false)).toBe(1);
    expect(journeyExitCode({ code: 17 }, new Error('cleanup failed'), false)).toBe(1);
  });

  it('preserves test failures and reports interrupted runs as interrupted', () => {
    expect(journeyExitCode({ code: 17 }, null, false)).toBe(17);
    expect(journeyExitCode({ code: null, signal: 'SIGINT' }, null, true)).toBe(130);
    expect(journeyExitCode({ code: null, signal: 'SIGTERM' }, null, true)).toBe(143);
  });

  it('refuses recovery paths that are not managed rig leases in the OS temp directory', async () => {
    const stopManagedRig = vi.fn();
    const removeLease = vi.fn();

    const result = await recoverManagedLease(path.join(os.tmpdir(), 'important.json'), {
      stopManagedRig,
      removeLease,
    });

    expect(result.stopped).toBe(false);
    expect(result.message).toContain('Refusing recovery');
    expect(stopManagedRig).not.toHaveBeenCalled();
    expect(removeLease).not.toHaveBeenCalled();
  });

  it('retains a lease and gives an actionable retry when recovery cannot close the rig port', async () => {
    const leasePath = path.join(os.tmpdir(), 'tc4-rig-11111111-1111-4111-8111-111111111111.json');
    const removeLease = vi.fn();

    const result = await recoverManagedLease(leasePath, {
      stopManagedRig: async () => ({ found: true, stopped: false }),
      waitForPortClosed: async () => false,
      readLease: () => ({ pid: 12345 }),
      removeLease,
    });

    expect(result.stopped).toBe(false);
    expect(result.message).toContain('PID 12345');
    expect(result.message).toContain(leasePath);
    expect(result.message).toContain('--recover-lease');
    expect(removeLease).not.toHaveBeenCalled();
  });

  it('removes the lease after recovery verifies that the rig port is closed', async () => {
    const leasePath = path.join(os.tmpdir(), 'tc4-rig-11111111-1111-4111-8111-111111111111.json');
    const removeLease = vi.fn();

    const result = await recoverManagedLease(leasePath, {
      stopManagedRig: async () => ({ found: true, stopped: false }),
      waitForPortClosed: async () => true,
      removeLease,
    });

    expect(result).toEqual({ stopped: true });
    expect(removeLease).toHaveBeenCalledWith(leasePath);
  });

  it('retains a lease when the recorded process could not be stopped', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-rig-lease-'));
    const leasePath = path.join(temporaryRoot, 'rig.json');
    fs.writeFileSync(leasePath, JSON.stringify({
      version: 2,
      pid: 12345,
      identity: 'creation-token',
      runId: 'test-run',
      scriptPath: 'run.zsh',
    }));

    try {
      const result = launcher.stopLease(leasePath, 'win32', {
        processIdentity: () => 'creation-token',
        terminate: () => ({ status: 1 }),
      });

      expect(result).toEqual({ found: true, stopped: false });
      expect(fs.existsSync(leasePath)).toBe(true);
      expect(launcher.readLease(leasePath)?.identity).toBe('creation-token');
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('does not signal a PID whose current process identity differs from the lease', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-rig-lease-'));
    const leasePath = path.join(temporaryRoot, 'rig.json');
    fs.writeFileSync(leasePath, JSON.stringify({
      version: 2,
      pid: 12345,
      identity: 'original-process',
      runId: 'test-run',
      scriptPath: 'run.zsh',
    }));
    let signalled = false;

    try {
      const result = launcher.stopLease(leasePath, 'win32', {
        processIdentity: () => 'different-process',
        terminate: () => { signalled = true; return { status: 0 }; },
      });

      expect(result).toEqual({ found: true, stopped: false, stale: true });
      expect(signalled).toBe(false);
      expect(fs.existsSync(leasePath)).toBe(true);
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });

  it('uses the shared MSYS2 boundary for Windows launches', () => {
    const spec = launcher.buildRigLaunchSpec(
      'C:\\workspace\\dev-env\\scripts\\run.zsh',
      {
        Path: 'C:\\Program Files\\nodejs;C:\\Program Files (x86)\\Git\\cmd',
        TC4_ZSH: 'C:\\msys64\\usr\\bin\\zsh.exe',
      },
      'win32',
      'C:\\Program Files\\nodejs\\node.exe',
    );

    expect(spec.zshPath).toBe('C:\\msys64\\usr\\bin\\zsh.exe');
    expect(spec.args).toEqual([
      '-lc',
      'export PATH="/usr/bin:/bin:$PATH"; exec "$1"',
      'tc4-rig-script',
      '/c/workspace/dev-env/scripts/run.zsh',
    ]);
    expect(spec.env.PATH).toContain('/c/Program Files/nodejs');
    expect(spec.env.PATH).toContain('/c/Program Files (x86)/Git/cmd');
    expect(spec.env.MSYS2_PATH_TYPE).toBe('inherit');
  });

  it('preserves the POSIX shell contract', () => {
    const env = { PATH: '/usr/bin:/bin', TC4_ZSH: '/opt/msys/usr/bin/zsh' };
    const spec = launcher.buildRigLaunchSpec('/workspace/dev-env/scripts/run.zsh', env, 'linux', '/usr/bin/node');

    expect(spec.zshPath).toBe('/opt/msys/usr/bin/zsh');
    expect(spec.args).toEqual(['/workspace/dev-env/scripts/run.zsh']);
    expect(spec.env).toBe(env);
  });

  it.skipIf(!zshAvailable)('executes the real launcher and propagates the target status', () => {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-rig-launcher-'));
    const script = path.join(temporaryRoot, 'probe.zsh');
    const quietScript = path.join(temporaryRoot, 'quiet.zsh');
    const missingZsh = path.join(temporaryRoot, 'missing-zsh');

    fs.writeFileSync(script, [
      '#!/bin/zsh',
      'print -r -- "TC4_LAUNCHER_SCRIPT=$0"',
      'print -r -- "TC4_LAUNCHER_MARKER=$TC4_LAUNCHER_MARKER"',
      'print -r -- "TC4_LAUNCHER_MSYS2=$MSYS2_PATH_TYPE"',
      'exit 37',
      '',
    ].join('\n'));
    fs.writeFileSync(quietScript, '#!/bin/zsh\nprint -r -- quiet-success\nexit 0\n');

    try {
      const invalid = childProcess.spawnSync(process.execPath, [LAUNCHER, script], {
        env: { ...process.env, TC4_ZSH: missingZsh, TC4_LAUNCHER_MARKER: 'invalid' },
        encoding: 'utf8',
      });
      expect(invalid.status).not.toBe(37);
      expect(invalid.stderr).toContain('Unable to start the Pankosmia rig');

      const valid = childProcess.spawnSync(process.execPath, [LAUNCHER, script], {
        env: { ...process.env, TC4_ZSH: RIG_ZSH, TC4_LAUNCHER_MARKER: 'valid' },
        encoding: 'utf8',
      });
      expect(valid.status).toBe(37);
      expect(valid.stdout).toContain(`TC4_LAUNCHER_SCRIPT=${rigScriptPath(script)}`);
      expect(valid.stdout).toContain('TC4_LAUNCHER_MARKER=valid');
      if (process.platform === 'win32') {
        expect(valid.stdout).toContain('TC4_LAUNCHER_MSYS2=inherit');
      } else {
        expect(valid.stdout).toContain(`TC4_LAUNCHER_MSYS2=${process.env.MSYS2_PATH_TYPE ?? ''}`);
      }

      const quiet = childProcess.spawnSync(process.execPath, [LAUNCHER, quietScript], {
        env: { ...process.env, TC4_ZSH: RIG_ZSH },
        encoding: 'utf8',
      });
      expect(quiet.status).toBe(0);
      expect(quiet.stdout).toBe('');
      expect(quiet.stderr).toBe('');
    } finally {
      fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
  });
});
