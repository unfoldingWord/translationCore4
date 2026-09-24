import { RIG_PORT } from './rig-health';
import {
  rigScriptArgs as buildRigScriptArgs,
  rigScriptPath as normalizeRigScriptPath,
  rigShellEnv as buildRigShellEnv,
  rigZshPath,
} from './rig-shell-common.cjs';

/**
 * The journey rig is driven by zsh scripts. Windows does not execute a .zsh
 * file directly, even when MSYS2 provides zsh on PATH, so the shell boundary is
 * explicit in both global setup and the Playwright launcher.
 *
 * Set TC4_ZSH when MSYS2 is installed somewhere other than its default path.
 */
export const RIG_ZSH = rigZshPath();

/** Convert a Windows absolute path to the POSIX form MSYS2 zsh expects. */
export const rigScriptPath = (scriptPath: string, platform: NodeJS.Platform = process.platform): string => {
  return normalizeRigScriptPath(scriptPath, platform);
};

/** Make Windows-installed Node and Git visible to a zsh launched by PowerShell. */
export const rigShellEnv = (
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv => {
  return buildRigShellEnv(env, platform);
};

/** Build zsh arguments that also work when Node was launched from PowerShell. */
export const rigScriptArgs = (scriptPath: string, platform: NodeJS.Platform = process.platform): string[] => {
  return buildRigScriptArgs(scriptPath, platform);
};

/** Build the command for the Node supervisor that owns the zsh rig process. */
export const rigLauncherCommand = (scriptPath: string, launcherPath: string): string =>
  `"${process.execPath}" "${launcherPath}" "${rigScriptPath(scriptPath)}"`;

/**
 * Keep the poisoned server reachable so global setup can classify its response.
 *
 * The journey wrapper sets TC4_RIG_EXTERNAL to '0' when it owns the rig. A direct
 * `npx playwright test` leaves it unset and reuses a running rig, as before.
 */
export const rigServerOptions = (
  command: string,
  reuse = process.env.TC4_RIG_EXTERNAL !== '0',
) => ({
  command,
  port: RIG_PORT,
  reuseExistingServer: reuse,
  timeout: 60_000,
});
