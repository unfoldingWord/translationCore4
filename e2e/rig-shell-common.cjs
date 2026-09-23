/** Select the zsh executable for the current host. */
function rigZshPath(env = process.env, platform = process.platform) {
  return env.TC4_ZSH || (platform === 'win32' ? 'C:\\msys64\\usr\\bin\\zsh.exe' : 'zsh');
}

/** Convert a Windows absolute path to the POSIX form MSYS2 zsh expects. */
function rigScriptPath(scriptPath, platform = process.platform) {
  if (platform !== 'win32') return scriptPath;
  const posix = scriptPath.replaceAll('\\', '/');
  return posix.replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);
}

/** Make Windows-installed Node and Git visible to a zsh launched by PowerShell. */
function rigShellEnv(env = process.env, platform = process.platform, execPath = process.execPath) {
  if (platform !== 'win32') return env;

  const inheritedPath = env.Path || env.PATH || '';
  // A Windows PATH is semicolon-delimited. A single drive-qualified entry has
  // no separator, so do not mistake its drive colon for a POSIX delimiter.
  const looksLikeWindowsPath = /^[A-Za-z]:[\\/]/.test(inheritedPath);
  const separator = inheritedPath.includes(';') || looksLikeWindowsPath ? ';' : ':';
  const inheritedEntries = inheritedPath
    .split(separator)
    .filter(Boolean)
    .map((entry) => /^[A-Za-z]:[\\/]/.test(entry) ? rigScriptPath(entry, platform) : entry);
  const nodeDirectory = execPath.replace(/[\\/][^\\/]+$/, '');
  const nodeDirectoryMsys = rigScriptPath(nodeDirectory, platform);
  const normalizedPath = ['/usr/bin', '/bin', nodeDirectoryMsys, ...inheritedEntries].join(':');

  return {
    ...env,
    MSYS2_PATH_TYPE: 'inherit',
    PATH: normalizedPath,
    Path: normalizedPath,
  };
}

/** Build zsh arguments that also work when Node was launched from PowerShell. */
function rigScriptArgs(scriptPath, platform = process.platform) {
  const normalizedPath = rigScriptPath(scriptPath, platform);
  if (platform !== 'win32') return [normalizedPath];
  return ['-lc', 'export PATH="/usr/bin:/bin:$PATH"; exec "$1"', 'tc4-rig-script', normalizedPath];
}

module.exports = {
  rigScriptArgs,
  rigScriptPath,
  rigShellEnv,
  rigZshPath,
};
