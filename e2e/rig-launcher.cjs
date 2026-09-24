const fs = require('node:fs');
const { spawn, spawnSync } = require('node:child_process');
const { rigScriptArgs, rigShellEnv, rigZshPath } = require('./rig-shell-common.cjs');

const LEASE_VERSION = 2;
const OUTPUT_LIMIT = 2 * 1024 * 1024;

function buildRigLaunchSpec(
  scriptPath,
  env = process.env,
  platform = process.platform,
  execPath = process.execPath,
) {
  const zshPath = rigZshPath(env, platform);
  return {
    args: rigScriptArgs(scriptPath, platform),
    env: rigShellEnv(env, platform, execPath),
    zshPath,
  };
}

function appendOutput(buffer, chunk) {
  const next = `${buffer}${chunk}`;
  return next.length <= OUTPUT_LIMIT ? next : next.slice(next.length - OUTPUT_LIMIT);
}

function writeLease(leasePath, lease) {
  if (!leasePath) return;
  fs.writeFileSync(leasePath, JSON.stringify({ version: LEASE_VERSION, ...lease }, null, 2));
}

function processIdentity(pid, platform = process.platform) {
  if (!Number.isInteger(pid)) return null;

  if (platform === 'win32') {
    const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}"; `
      + 'if ($p) { [Console]::Write($p.CreationDate.ToUniversalTime().Ticks) }';
    const result = spawnSync('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script,
    ], { encoding: 'utf8', windowsHide: true });
    return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  }

  if (platform === 'linux') {
    try {
      // Linux field 22 is the process start tick count; parsing after the last
      // ')' handles spaces and ')' characters in the comm field.
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
      return fields[19] || null;
    } catch {
      return null;
    }
  }

  if (platform === 'darwin' || platform === 'freebsd' || platform === 'openbsd') {
    const result = spawnSync('ps', ['-p', String(pid), '-o', 'lstart='], {
      encoding: 'utf8',
      windowsHide: true,
    });
    return result.status === 0 && result.stdout.trim() ? result.stdout.trim() : null;
  }

  return null;
}

function removeLease(leasePath) {
  if (!leasePath) return;
  try {
    fs.rmSync(leasePath, { force: true });
  } catch {
    // The wrapper retries the same lease after the child process exits.
  }
}

function readLease(leasePath) {
  if (!leasePath || !fs.existsSync(leasePath)) return null;
  try {
    const lease = JSON.parse(fs.readFileSync(leasePath, 'utf8'));
    if (lease.version !== LEASE_VERSION || !Number.isInteger(lease.pid)
      || typeof lease.identity !== 'string' || !lease.identity) return null;
    return lease;
  } catch {
    return null;
  }
}

/** Stop only the exact process recorded by this journey run. */
function stopLease(leasePath, platform = process.platform, tools = {}) {
  if (!leasePath || !fs.existsSync(leasePath)) return { found: false, stopped: true };
  const lease = readLease(leasePath);
  if (!lease) {
    return { found: true, stopped: false };
  }

  const inspect = tools.processIdentity || ((pid) => processIdentity(pid, platform));
  const currentIdentity = inspect(lease.pid);
  if (!currentIdentity) return { found: true, stopped: false };
  if (currentIdentity !== lease.identity) {
    return { found: true, stopped: false, stale: true };
  }

  if (platform === 'win32') {
    const result = tools.terminate
      ? tools.terminate(lease.pid)
      : spawnSync('taskkill.exe', ['/PID', String(lease.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
    if (result.status !== 0) {
      const afterIdentity = inspect(lease.pid);
      return {
        found: true,
        stopped: false,
        ...(afterIdentity && afterIdentity !== lease.identity ? { stale: true } : {}),
      };
    }
    return { found: true, stopped: true };
  }

  try {
    if (tools.terminate) tools.terminate(lease.pid);
    else process.kill(-lease.pid, 'SIGTERM');
    return { found: true, stopped: true };
  } catch (error) {
    if (error && error.code === 'ESRCH') {
      removeLease(leasePath);
      return { found: true, stopped: true };
    }
    return { found: true, stopped: false };
  }
}

function replayOutput(stdout, stderr) {
  if (stdout) process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
}

function runRig(scriptPath) {
  if (!scriptPath) {
    console.error('Pankosmia rig launcher requires the run.zsh path.');
    process.exit(2);
  }

  const spec = buildRigLaunchSpec(scriptPath);
  const leasePath = process.env.TC4_RIG_LEASE;
  let stopping = false;
  let stdout = '';
  let stderr = '';
  const rig = spawn(spec.zshPath, spec.args, {
    env: spec.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    // Only a wrapper-owned rig gets its own process group: the wrapper stops it
    // through the lease. Without a lease, the rig stays in Playwright's group and
    // stops when Playwright stops the web server.
    detached: process.platform !== 'win32' && Boolean(leasePath),
  });

  writeLease(leasePath, {
    pid: rig.pid,
    identity: processIdentity(rig.pid),
    runId: process.env.TC4_RIG_RUN_ID || null,
    scriptPath,
    startedAt: new Date().toISOString(),
  });

  rig.stdout?.on('data', (chunk) => { stdout = appendOutput(stdout, chunk); });
  rig.stderr?.on('data', (chunk) => { stderr = appendOutput(stderr, chunk); });

  const stopRig = () => {
    if (stopping) return;
    stopping = true;

    if (process.platform === 'win32' && rig.pid !== undefined) {
      const killer = spawn('taskkill.exe', ['/PID', String(rig.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('error', () => rig.kill());
      return;
    }

    if (rig.pid !== undefined) {
      try {
        process.kill(-rig.pid, 'SIGTERM');
      } catch {
        rig.kill('SIGTERM');
      }
    }
  };

  process.once('SIGINT', stopRig);
  process.once('SIGTERM', stopRig);
  process.once('SIGHUP', stopRig);

  rig.once('error', (error) => {
    removeLease(leasePath);
    console.error(`Unable to start the Pankosmia rig through ${spec.zshPath}: ${error.message}`);
    process.exitCode = 1;
  });

  rig.once('exit', (code, signal) => {
    removeLease(leasePath);
    if (stopping) {
      replayOutput(stdout, stderr);
      process.exit(0);
    }

    if (code !== null) {
      if (code !== 0) replayOutput(stdout, stderr);
      process.exit(code);
    }

    replayOutput(stdout, stderr);
    console.error(`Pankosmia rig exited without a status code${signal ? ` after ${signal}` : ''}.`);
    process.exit(1);
  });
}

if (require.main === module) {
  runRig(process.argv[2]);
}

module.exports = {
  buildRigLaunchSpec,
  processIdentity,
  readLease,
  removeLease,
  stopLease,
};
