import { describe, expect, it } from 'vitest';
import { rigCommand, rigScriptArgs, rigScriptPath, rigShellEnv } from '../e2e/rig-shell';

// #396: global setup and the Playwright rig start run the .zsh scripts through zsh,
// with MSYS2 paths on Windows. Cases from the shell layer of #391.

describe('#396 — MSYS2 rig script paths', () => {
  it('converts a Windows path to an MSYS2 path', () => {
    expect(rigScriptPath('C:\\Users\\A User\\translationCore4\\dev-env\\scripts\\run.zsh', 'win32')).toBe(
      '/c/Users/A User/translationCore4/dev-env/scripts/run.zsh',
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
