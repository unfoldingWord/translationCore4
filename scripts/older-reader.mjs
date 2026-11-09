#!/usr/bin/env node
// INV-OLD-PROJECTS-OPEN-UNCHANGED, the other direction (docs/STORAGE.md §12.3 step 4, PLAN P10,
// #865): the build of the last frozen format version meets folders the current build wrote.
//
//   node scripts/older-reader.mjs --tc4 <exe> --ui <dir> --bundle <dir> --projects <dir> --commit <sha> --major <n>
//
// `<dir>` holds three projects the current build wrote (`cargo run -p tc-corpus --example
// capsule -- reader-folders <dir>`): `plain`, which the old build must open writable and save a
// verse in; `newer-minor`, whose `minReaderMinor` the old build cannot write, which it must open
// read-only with "needs a newer app" and write nothing to; and `newer-major`, which it must
// refuse before anything is written. `<sha>` is the frozen commit the old build must report,
// `<n>` the major the `newer-major` folder carries. The word "damaged" in any reply or on the
// old build's stderr fails the run. Prints `ok <step>` or `FAIL <step>: <why>` and exits
// non-zero at the first failure, as scripts/release/smoke.mjs does, whose API driving this
// repeats.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({
  options: {
    tc4: { type: 'string' }, ui: { type: 'string' }, bundle: { type: 'string' }, projects: { type: 'string' },
    commit: { type: 'string' }, major: { type: 'string' },
  },
});
for (const name of ['tc4', 'ui', 'bundle', 'projects', 'commit', 'major']) {
  if (!opt[name]) {
    console.error('usage: node scripts/older-reader.mjs --tc4 <exe> --ui <dir> --bundle <dir> --projects <dir> --commit <sha> --major <n>');
    process.exit(2);
  }
}

const HANG_MS = 60_000;
// A port nothing listens on: the old build must need no network.
const DEAD_DOOR43 = 'http://127.0.0.1:9/';
const BOOK = 'TIT';
const WORDS = 'Pablo, siervo de Dios — saved by the older build ñ 1:1';
const PLAIN = 'plain';
const NEWER_MINOR = 'newer-minor';
const NEWER_MAJOR = 'newer-major';

const projects = path.resolve(opt.projects);
const appData = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-older-reader-appdata-'));
/** Every reply and every stderr line the old build gave: "damaged" anywhere fails the run. */
const seen = [];

class Hung extends Error {}
const requestId = () => crypto.randomBytes(16).toString('hex');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bounded(promise, what) {
  let timer;
  const hang = new Promise((_, reject) => { timer = setTimeout(() => reject(new Hung(what)), HANG_MS); });
  return Promise.race([promise, hang]).finally(() => clearTimeout(timer));
}

async function until(what, poll, ms = HANG_MS) {
  const deadline = Date.now() + ms;
  let last;
  for (;;) {
    const value = await poll((s) => { last = s; });
    if (value) return value;
    if (Date.now() > deadline) throw new Hung(last === undefined ? what : `${what}; last seen ${JSON.stringify(last)}`);
    await pause(200);
  }
}

/** Starts the old `tc4 serve` on the folders; answers its first stdout line, parsed, and the child. */
async function start(what) {
  const child = spawn(path.resolve(opt.tc4), [
    'serve', '--app-data', appData, '--projects', projects, '--ui', path.resolve(opt.ui),
    '--bundle', path.resolve(opt.bundle), '--door43', DEAD_DOOR43,
  ], { stdio: ['pipe', 'pipe', 'pipe'] });
  readline.createInterface({ input: child.stderr }).on('line', (line) => { seen.push(line); process.stderr.write(`${line}\n`); });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve(code ?? signal)));
  child.on('error', () => {});
  const lines = readline.createInterface({ input: child.stdout })[Symbol.asyncIterator]();
  const first = await bounded(Promise.race([lines.next(), exited.then(() => ({ done: true }))]), what);
  const line = first.done ? null : JSON.parse(first.value);
  return { child, exited, line };
}

/** The running old build: `call` for its API as the page makes it, `quit`, `kill`. */
async function serve(what) {
  const { child, exited, line } = await start(what);
  if (!line?.url || !line?.token) {
    child.kill();
    throw new Error(`tc4 printed no address: ${JSON.stringify(line)} (exit ${await exited})`);
  }
  const base = new URL(line.url);
  const call = (endpoint, body = {}) => bounded(new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const request = http.request({
      host: base.hostname, port: base.port, method: 'POST', path: `/api/v1/${endpoint}`,
      headers: {
        Host: base.host, Origin: base.origin, 'X-Tc-Token': line.token, 'X-Tc-Api': '1',
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(text),
      },
    }, (response) => {
      const parts = [];
      response.on('data', (part) => parts.push(part));
      response.on('end', () => {
        const reply = Buffer.concat(parts).toString('utf8');
        seen.push(reply);
        if (response.statusCode !== 200) return reject(new Error(`${endpoint}: status ${response.statusCode} ${reply.slice(0, 300)}`));
        const parsed = JSON.parse(reply);
        if (parsed.type !== 'ok') return reject(new Error(`${endpoint}: ${reply.slice(0, 300)}`));
        resolve(parsed.value);
      });
    });
    request.on('error', reject);
    request.end(text);
  }), what);
  const quit = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    child.stdin.end('{"quit":true}\n');
    const code = await bounded(exited, `${what} (quit)`);
    if (code !== 0) throw new Error(`tc4 quit with exit ${code}`);
  };
  return { call, quit, kill: () => child.kill('SIGKILL') };
}

/** Runs the `session/open` job to its end; answers the job's last state. */
async function opened(app, project, what) {
  const job = await app.call('session/open', { request: requestId(), project, unit: null });
  return until(what, async () => {
    const view = await app.call('jobs/get', { job });
    return view && !['queued', 'running', 'cancelling'].includes(view.state.type) && view.state;
  });
}

/** Opens the project; answers its open session (its scope `at`, its `mode`). */
async function open(app, project, what) {
  const state = await opened(app, project, what);
  if (state.type !== 'done') throw new Error(`session/open ended ${JSON.stringify(state)}`);
  const session = (await app.call('app/hello')).sessions.find((s) => s.at.project === project);
  if (!session) throw new Error('app/hello names no open session for the project');
  return session;
}

const verseOne = async (app, at) => {
  const view = await app.call('editor/chapters', { at, book: BOOK });
  const row = view.chapters.find((c) => c.chapter === 1)?.verses.find((v) => v.key === '1');
  if (!row) throw new Error(`editor/chapters has no ${BOOK} 1:1`);
  return row;
};

/** Every file of a project folder with its sha256, so a run can show nothing was written. */
const files = (name) => {
  const folder = path.join(projects, name);
  return JSON.stringify(fs.readdirSync(folder, { recursive: true }).sort()
    .filter((f) => fs.statSync(path.join(folder, f)).isFile())
    .map((f) => [f, crypto.createHash('sha256').update(fs.readFileSync(path.join(folder, f))).digest('hex')]));
};

let running = [];
const state = {};
async function step(name, run) {
  try {
    await run();
    console.log(`ok ${name}`);
  } catch (error) {
    console.log(`FAIL ${name}: ${error instanceof Hung ? `hung: ${error.message}` : error.message}`);
    for (const app of running) app.kill();
    process.exit(1);
  }
}

await step('the_three_folders_are_there', async () => {
  for (const name of [PLAIN, NEWER_MINOR, NEWER_MAJOR]) {
    if (!fs.existsSync(path.join(projects, name, 'metadata.json'))) throw new Error(`${projects}/${name} is no project`);
  }
});

await step('address', async () => {
  state.app = await serve('address');
  running = [state.app];
});

await step('the_older_build_is_the_frozen_commit', async () => {
  const { build } = await state.app.call('app/hello');
  if (build.commit !== opt.commit) throw new Error(`app/hello says commit ${build.commit}, the frozen commit is ${opt.commit}`);
});

await step('bundled_resources_ready', async () => {
  const end = await until('bundled_resources_ready', async (s) => {
    const now = (await state.app.call('app/hello')).startup;
    s(now);
    return now.type !== 'preparing' && now;
  }, 180_000);
  if (end.type !== 'ready') throw new Error(`the start ended ${JSON.stringify(end)}`);
});

await step('a_plain_folder_opens_writable_and_saves_a_verse', async () => {
  const { at, mode } = await open(state.app, PLAIN, 'a_plain_folder_opens_writable_and_saves_a_verse');
  if (mode.type !== 'writable') throw new Error(`opened ${JSON.stringify(mode)}`);
  const row = await verseOne(state.app, at);
  const ack = await state.app.call('editor/saveVerse', { at, request: requestId(), shown: row.words.token, words: WORDS });
  if (ack.newConflicts.length) throw new Error(`the save made conflicts: ${JSON.stringify(ack.newConflicts)}`);
});

await step('a_restart_reads_the_verse_back', async () => {
  await state.app.quit();
  state.app = await serve('a_restart_reads_the_verse_back');
  running = [state.app];
  const { at } = await open(state.app, PLAIN, 'a_restart_reads_the_verse_back');
  const row = await verseOne(state.app, at);
  if (row.words.value !== WORDS) throw new Error(`read back ${JSON.stringify(row.words.value)}, saved ${JSON.stringify(WORDS)}`);
  await state.app.quit();
});

await step('a_newer_minor_opens_read_only_and_writes_nothing', async () => {
  const before = files(NEWER_MINOR);
  state.app = await serve('a_newer_minor_opens_read_only_and_writes_nothing');
  running = [state.app];
  const { mode } = await open(state.app, NEWER_MINOR, 'a_newer_minor_opens_read_only_and_writes_nothing');
  await state.app.quit();
  if (mode.type !== 'readOnly' || mode.value !== 'needsNewerApp') throw new Error(`opened ${JSON.stringify(mode)}`);
  if (files(NEWER_MINOR) !== before) throw new Error('a read-only open changed the project folder');
});

await step('a_newer_major_is_refused_before_anything_is_written', async () => {
  const before = files(NEWER_MAJOR);
  state.app = await serve('a_newer_major_is_refused_before_anything_is_written');
  running = [state.app];
  const end = await opened(state.app, NEWER_MAJOR, 'a_newer_major_is_refused_before_anything_is_written');
  await state.app.quit();
  const refusal = end.value?.value;
  if (end.type !== 'failed' || refusal?.type !== 'open' || refusal.value?.type !== 'newerFormat' || String(refusal.value.value?.format) !== opt.major) {
    throw new Error(`session/open ended ${JSON.stringify(end)}, not the newer-format refusal of major ${opt.major}`);
  }
  if (files(NEWER_MAJOR) !== before) throw new Error('a refused open changed the project folder');
});

await step('nothing_was_called_damaged', async () => {
  const hits = seen.filter((text) => /damaged/i.test(text));
  if (hits.length) throw new Error(`the older build said "damaged": ${hits[0].slice(0, 300)}`);
});
