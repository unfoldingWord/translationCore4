import { describe, expect, it } from 'vitest';
import { RIG_ZSH, rigCommand, rigScriptArgs, rigScriptPath, rigShellEnv } from '../e2e/rig-shell';

// #396: global setup and the Playwright rig start run the .zsh scripts through zsh,
// with MSYS2 paths on Windows. Cases from the shell layer of #391.
const fs = process.getBuiltinModule('node:fs');
const os = process.getBuiltinModule('node:os');
const path = process.getBuiltinModule('node:path');
const { execSync } = process.getBuiltinModule('node:child_process');

describe('#396 — MSYS2 rig script paths', () => {
  it('converts a Windows path to an MSYS2 path', () => {
    expect(rigScriptPath('C:\\Users\\A User\\translationCore4\\dev-env\\scripts\\run.zsh', 'win32')).toBe(
      '/c/Users/A User/translationCore4/dev-env/scripts/run.zsh',
    );
  });

  it('leaves a POSIX path unchanged', () => {
    expect(rigScriptPath('/workspace/translationCore4/dev-env/scripts/run.zsh', 'linux')).toBe(
      '/workspace/translationCore4/dev-env/scripts/run.zsh',
    );
    expect(rigScriptPath('/workspace/translationCore4/dev-env/scripts/run.zsh', 'darwin')).toBe(
      '/workspace/translationCore4/dev-env/scripts/run.zsh',
    );
  });

  it('translates the inherited Windows PATH for zsh', () => {
    const env = rigShellEnv({ Path: 'C:\\Program Files\\nodejs;C:\\Program Files (x86)\\Git\\cmd' }, 'win32');
    expect(env.PATH).toMatch(/^\/usr\/bin:\/bin:/);
    expect(env.PATH).toContain('/c/Program Files/nodejs');
    expect(env.PATH).toContain('/c/Program Files (x86)/Git/cmd');
    expect(env.MSYS2_PATH_TYPE).toBe('inherit');
  });

  it('does not split a single-entry Windows PATH at its drive colon', () => {
    const env = rigShellEnv({ Path: 'C:\\Program Files\\Git\\cmd' }, 'win32');
    expect(env.PATH).toContain('/c/Program Files/Git/cmd');
    expect(env.PATH).not.toContain('C:\\Program Files');
    expect(env.PATH?.split(':')).not.toContain('C');
  });

  it('leaves the environment alone off Windows', () => {
    const env = { PATH: '/usr/local/bin:/usr/bin' };
    expect(rigShellEnv(env, 'darwin')).toBe(env);
  });

  it('runs the script directly off Windows, and through a login shell on Windows', () => {
    expect(rigScriptArgs('/repo/dev-env/scripts/seed.zsh', 'linux')).toEqual(['/repo/dev-env/scripts/seed.zsh']);
    expect(rigScriptArgs('C:\\repo\\dev-env\\scripts\\seed.zsh', 'win32')).toEqual([
      '-lc',
      'export PATH="/usr/bin:/bin:$PATH"; exec "$1"',
      'tc4-rig-script',
      '/c/repo/dev-env/scripts/seed.zsh',
    ]);
  });

  it('quotes every argument of the Playwright command line', () => {
    expect(rigCommand('/my repo/dev-env/scripts/run.zsh', 'darwin', 'zsh')).toBe(
      '"zsh" "/my repo/dev-env/scripts/run.zsh"',
    );
    expect(rigCommand('C:\\my repo\\run.zsh', 'win32', 'C:\\msys64\\usr\\bin\\zsh.exe')).toBe(
      '"C:\\msys64\\usr\\bin\\zsh.exe" "-lc" "export PATH=\\"/usr/bin:/bin:$PATH\\"; exec \\"$1\\"" "tc4-rig-script" "/c/my repo/run.zsh"',
    );
  });
});

// The command line above, run for real the way Playwright's webServer runs it:
// through the system shell (cmd.exe on Windows), with rigShellEnv().
const zshPresent = (() => {
  if (process.platform === 'win32') return fs.existsSync(RIG_ZSH);
  try {
    execSync(`command -v ${RIG_ZSH}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!zshPresent)(`#396 — a script runs through ${RIG_ZSH} (needs zsh; MSYS2 on Windows)`, () => {
  it('runs a .zsh file in a directory with a space, with the MSYS2 tools and Node on PATH', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4 rig shell '));
    try {
      const script = path.join(dir, 'probe.zsh');
      // The shebang matters: the Windows command execs the script, as it does run.zsh and seed.zsh.
      fs.writeFileSync(
        script,
        '#!/bin/zsh\nprint -r -- "zsh=$ZSH_VERSION unzip=${+commands[unzip]} node=${+commands[node]} dir=${0:a:h:t}"\n',
      );
      const out = execSync(rigCommand(script), { env: rigShellEnv(), encoding: 'utf8' });
      expect(out).toMatch(/^zsh=\d/);
      expect(out).toContain('node=1');
      expect(out).toContain(`dir=${path.basename(dir)}`);
      if (process.platform === 'win32') expect(out).toContain('unzip=1');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
