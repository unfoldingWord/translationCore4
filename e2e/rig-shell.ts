// The journey rig is driven by zsh scripts (#396). Windows does not execute a .zsh
// file directly, even when MSYS2 provides zsh, so global setup and the Playwright
// rig start name the shell explicitly. Taken from the shell layer of #391
// (e2e/rig-shell-common.cjs at 8c61053), without its launcher and reuse options.
//
// Set TC4_ZSH when MSYS2 is installed somewhere other than its default path.

/** The zsh executable for this host. */
export const rigZshPath = (
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string => env.TC4_ZSH || (platform === 'win32' ? 'C:\\msys64\\usr\\bin\\zsh.exe' : 'zsh');

export const RIG_ZSH = rigZshPath();

const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;

/** Convert a Windows absolute path to the POSIX form MSYS2 zsh expects. */
export const rigScriptPath = (scriptPath: string, platform: NodeJS.Platform = process.platform): string => {
  if (platform !== 'win32') return scriptPath;
  const posix = scriptPath.replaceAll('\\', '/');
  return posix.replace(/^([A-Za-z]):\//, (_, drive: string) => `/${drive.toLowerCase()}/`);
};

/** Make the Windows-installed Node and Git visible to a zsh started from Node. */
export const rigShellEnv = (
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  execPath: string = process.execPath,
): NodeJS.ProcessEnv => {
  if (platform !== 'win32') return env;

  const inheritedPath = env.Path || env.PATH || '';
  // A Windows PATH is semicolon-delimited. A single drive-qualified entry has
  // no separator, so do not mistake its drive colon for a POSIX delimiter.
  const separator = inheritedPath.includes(';') || WINDOWS_ABSOLUTE.test(inheritedPath) ? ';' : ':';
  const inheritedEntries = inheritedPath
    .split(separator)
    .filter(Boolean)
    .map((entry) => (WINDOWS_ABSOLUTE.test(entry) ? rigScriptPath(entry, platform) : entry));
  const nodeDirectory = rigScriptPath(execPath.replace(/[\\/][^\\/]+$/, ''), platform);
  const normalizedPath = ['/usr/bin', '/bin', nodeDirectory, ...inheritedEntries].join(':');

  return { ...env, MSYS2_PATH_TYPE: 'inherit', PATH: normalizedPath, Path: normalizedPath };
};

/** zsh arguments that run one script. On Windows a login shell puts the MSYS2 tools first. */
export const rigScriptArgs = (scriptPath: string, platform: NodeJS.Platform = process.platform): string[] => {
  const normalizedPath = rigScriptPath(scriptPath, platform);
  if (platform !== 'win32') return [normalizedPath];
  return ['-lc', 'export PATH="/usr/bin:/bin:$PATH"; exec "$1"', 'tc4-rig-script', normalizedPath];
};

/** One command line for Playwright's webServer, which runs it through sh or cmd.exe. */
export const rigCommand = (
  scriptPath: string,
  platform: NodeJS.Platform = process.platform,
  zsh: string = rigZshPath(process.env, platform),
): string =>
  [zsh, ...rigScriptArgs(scriptPath, platform)].map((arg) => `"${arg.replaceAll('"', '\\"')}"`).join(' ');
