import { describe, expect, it } from 'vitest';
import { rigLauncherCommand, rigScriptArgs, rigScriptPath, rigServerOptions, rigShellEnv } from '../e2e/rig-shell';
import { RIG_PORT } from '../e2e/rig-health';

describe('MSYS2 rig script paths', () => {
  it('converts Windows paths to MSYS2 paths', () => {
    expect(rigScriptPath('C:\\Users\\A User\\translationCore4\\dev-env\\scripts\\run.zsh', 'win32'))
      .toBe('/c/Users/A User/translationCore4/dev-env/scripts/run.zsh');
  });

  it('leaves POSIX paths unchanged', () => {
    expect(rigScriptPath('/workspace/translationCore4/dev-env/scripts/run.zsh', 'linux'))
      .toBe('/workspace/translationCore4/dev-env/scripts/run.zsh');
  });

  it('initializes the MSYS2 tool path for Windows script execution', () => {
    expect(rigScriptArgs('C:\\workspace\\dev-env\\scripts\\seed.zsh', 'win32'))
      .toEqual([
        '-lc',
        'export PATH="/usr/bin:/bin:$PATH"; exec "$1"',
        'tc4-rig-script',
        '/c/workspace/dev-env/scripts/seed.zsh',
      ]);
  });

  it('translates inherited Windows tool paths for zsh', () => {
    const env = rigShellEnv({
      Path: 'C:\\Program Files\\nodejs;C:\\Program Files (x86)\\Git\\cmd',
    }, 'win32');

    expect(env.PATH).toContain('/usr/bin:/bin');
    expect(env.PATH).toContain('/c/Program Files/nodejs');
    expect(env.PATH).toContain('/c/Program Files (x86)/Git/cmd');
    expect(env.MSYS2_PATH_TYPE).toBe('inherit');
  });

  it('preserves a single Windows PATH entry instead of splitting its drive colon', () => {
    const env = rigShellEnv({ Path: 'C:\\Program Files\\Git\\cmd' }, 'win32');

    expect(env.PATH).toContain('/c/Program Files/Git/cmd');
    expect(env.PATH).not.toContain('C:\\Program Files');
  });

  it('uses the Node supervisor for the long-lived rig process', () => {
    const command = rigLauncherCommand(
      'C:\\workspace\\dev-env\\scripts\\run.zsh',
      'C:\\workspace\\e2e\\rig-launcher.cjs',
    );

    expect(command).toContain(process.execPath);
    expect(command).toContain('rig-launcher.cjs');
    expect(command).toContain('run.zsh');
  });

  it('uses port readiness so a poisoned HTTP server reaches global setup', () => {
    const options = rigServerOptions('rig-launcher', false);

    expect(options.port).toBe(RIG_PORT);
    expect(options).not.toHaveProperty('url');
    expect(options.reuseExistingServer).toBe(false);
  });

  it('only reuses a rig when the wrapper identified it as external', () => {
    expect(rigServerOptions('rig-launcher', true).reuseExistingServer).toBe(true);
  });
});
