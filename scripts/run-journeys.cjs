const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { readLease, removeLease, stopLease } = require('../e2e/rig-launcher.cjs');

const PORT = 19998;
const ROOT = path.resolve(__dirname, '..');

function portIsOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const finish = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(250, () => finish(false));
  });
}

async function waitForPortClosed(port, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!(await portIsOpen(port))) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

function journeyExitCode(result, cleanupError, interrupted) {
  if (cleanupError || result.error) return 1;
  if (result.code !== null && result.code !== undefined) return result.code;
  if (result.signal) {
    if (interrupted && result.signal === 'SIGINT') return 130;
    if (interrupted && result.signal === 'SIGTERM') return 143;
    return 1;
  }
  return 1;
}

async function stopManagedRig(leasePath) {
  let result = stopLease(leasePath);
  for (let attempt = 0; attempt < 2 && !result.stopped && !result.stale; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 150));
    result = stopLease(leasePath);
  }
  return result;
}

function isManagedLeasePath(leasePath, platform = process.platform) {
  if (typeof leasePath !== 'string' || !leasePath) return false;
  const resolvedPath = path.resolve(leasePath);
  const temporaryDirectory = path.resolve(os.tmpdir());
  const normalize = (value) => platform === 'win32' ? value.toLowerCase() : value;
  const validName = /^tc4-rig-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.json$/i;
  return normalize(path.dirname(resolvedPath)) === normalize(temporaryDirectory)
    && validName.test(path.basename(resolvedPath));
}

async function recoverManagedLease(leasePath, tools = {}) {
  if (!isManagedLeasePath(leasePath)) {
    return {
      stopped: false,
      message: 'Refusing recovery: the lease must be a UUID-named tc4-rig file directly inside the OS temp directory.',
    };
  }

  const stop = tools.stopManagedRig || stopManagedRig;
  const wait = tools.waitForPortClosed || waitForPortClosed;
  const read = tools.readLease || readLease;
  const remove = tools.removeLease || removeLease;
  const stopped = await stop(leasePath);
  if (await wait(PORT)) {
    remove(leasePath);
    return { stopped: true };
  }

  const lease = read(leasePath);
  const processLabel = lease ? ` (PID ${lease.pid})` : '';
  return {
    stopped: false,
    message: `The managed Pankosmia rig still owns port ${PORT}${processLabel}; `
      + `the lease was retained at ${leasePath}. `
      + `Retry with: npm run journeys -- --recover-lease "${leasePath}"`,
    stopResult: stopped,
  };
}

async function main() {
  if (process.argv[2] === '--recover-lease') {
    const leasePath = process.argv[3];
    if (!leasePath) {
      console.error('Usage: npm run journeys -- --recover-lease <lease-path>');
      process.exitCode = 2;
      return;
    }
    const result = await recoverManagedLease(leasePath);
    if (result.stopped) console.log('Managed Pankosmia rig stopped; lease removed.');
    else console.error(result.message);
    process.exitCode = result.stopped ? 0 : 1;
    return;
  }

  const runId = randomUUID();
  const leasePath = path.join(os.tmpdir(), `tc4-rig-${runId}.json`);
  const external = await portIsOpen(PORT);
  const env = {
    ...process.env,
    TC4_RIG_EXTERNAL: external ? '1' : '0',
    TC4_RIG_LEASE: leasePath,
    TC4_RIG_RUN_ID: runId,
  };
  const playwrightCli = require.resolve('@playwright/test/cli');
  const child = spawn(process.execPath, [playwrightCli, 'test', ...process.argv.slice(2)], {
    cwd: ROOT,
    env,
    stdio: 'inherit',
    windowsHide: true,
  });

  let interrupted = false;
  const forwardSignal = (signal) => {
    interrupted = true;
    if (process.platform === 'win32' && child.pid !== undefined) {
      const result = spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      if (result.status !== 0) child.kill(signal);
      return;
    }
    child.kill(signal);
  };
  process.once('SIGINT', () => forwardSignal('SIGINT'));
  process.once('SIGTERM', () => forwardSignal('SIGTERM'));

  const result = await new Promise((resolve) => {
    child.once('error', (error) => resolve({ error }));
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });

  let cleanupError = null;
  if (!external) {
    const cleanup = await recoverManagedLease(leasePath);
    if (!cleanup.stopped) cleanupError = new Error(cleanup.message);
  } else {
    try { fs.rmSync(leasePath, { force: true }); } catch { /* best effort */ }
  }

  if (cleanupError) console.error(`Journey cleanup failed: ${cleanupError.message}`);
  if (result.error) {
    console.error(`Unable to start Playwright: ${result.error.message}`);
  }
  process.exitCode = journeyExitCode(result, cleanupError, interrupted);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Journey wrapper failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { journeyExitCode, recoverManagedLease };
