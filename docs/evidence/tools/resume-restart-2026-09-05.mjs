// #184 — the rig-restart half of the resume proof, run by hand against the workspace rig.
// Steps: draft at Titus 2, stop the rig, start it again WITHOUT reseeding, reload the
// app, Resume. Every observation is printed; docs/evidence/resume-restart-2026-09-05.md
// quotes the output.
//
// Launch (the exact run recorded on 2026-09-05; the paths are that machine's workspace,
// edit WORK and SCRIPTS for another checkout):
//   zsh dev-env/scripts/seed.zsh              # pristine rig; the rig server is running
//   npm run dev                               # the client at :5199, in another shell
//   cp docs/evidence/tools/resume-restart-2026-09-05.mjs ./.resume-restart-tmp.mjs
//   node ./.resume-restart-tmp.mjs            # from the repository root, so
//                                             # @playwright/test resolves; delete the copy after
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';

const WORK = '/Users/birch/Development/tC4/dev-env/state/work';
const SCRIPTS = '/Users/birch/Development/tC4/dev-env/scripts';
const APP = 'http://localhost:5199';
const API = 'http://127.0.0.1:19998/api';
const REPO = '_local_/_local_/sample_burrito';
const TEXT = 'La gracia de Dios se ha manifestado para salvación (reinicio del servidor).';

const log = (s) => console.log(`[${new Date().toISOString()}] ${s}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clientSettings = () => JSON.parse(fs.readFileSync(`${WORK}/client_settings/uw-tc4.json`, 'utf8'));
const commitCount = () => execFileSync('git', ['-C', `${WORK}/repos/${REPO}`, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim();
async function version() {
  try { const r = await fetch(`${API}/version`); return (await r.json()).pkg_version; } catch { return null; }
}

log(`rig version before: ${await version()}`);
log(`client settings before: lastEdit=${JSON.stringify(clientSettings().lastEdit ?? null)}`);
log(`commits before: ${commitCount()}`);

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(APP);
await page.getByTestId(`project-${REPO}`).getByRole('button', { name: /Titus/ }).click();
await page.getByText('an apostle of Jesus Christ').first().waitFor({ timeout: 60_000 });
await page.getByRole('button', { name: '2', exact: true }).click();
await page.getByRole('button', { name: 'Start this verse' }).first().click();
const editor = page.getByRole('textbox', { name: /Verse/ });
await editor.fill(TEXT);
await editor.blur();
await page.locator('[data-testid="save-indicator"][data-state="saved"]').waitFor({ timeout: 10_000 });
log('drafted at Titus 2; save indicator: saved');
for (let i = 0; i < 50 && !clientSettings().lastEdit; i++) await sleep(200);
log(`client settings after draft: lastEdit=${JSON.stringify(clientSettings().lastEdit ?? null)}`);
log(`commits after draft (no checkpoint expected): ${commitCount()}`);

// Stop the rig. Negative control: the API must be unreachable before the restart.
log(execFileSync('zsh', [`${SCRIPTS}/stop.zsh`], { encoding: 'utf8' }).trim());
for (let i = 0; i < 50 && (await version()) !== null; i++) await sleep(200);
log(`rig version while stopped: ${await version()}`);
await page.reload();
await sleep(1500);
const errorWhileDown = await page.getByTestId('home-open-error').count();
log(`app reloaded while the rig was down: home-open-error banners=${errorWhileDown}, project cards=${await page.locator('[data-testid^="project-_local_/"]').count()}`);

// Start again, no seed (run.zsh seeds only when state/work is absent).
const rig = spawn('zsh', [`${SCRIPTS}/run.zsh`], { detached: true, stdio: 'ignore' });
rig.unref();
for (let i = 0; i < 300 && (await version()) === null; i++) await sleep(200);
log(`rig version after restart: ${await version()}`);
log(`client settings after restart: lastEdit=${JSON.stringify(clientSettings().lastEdit ?? null)}`);

await page.reload();
const cards = page.locator('[data-testid^="project-_local_/"]');
await cards.first().waitFor({ timeout: 30_000 });
await sleep(1000);
const ids = await cards.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
const onDisk = fs.readdirSync(`${WORK}/repos/_local_/_local_`, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort();
log(`projects on disk: ${onDisk.join(', ')}`);
log(`project cards on Home: ${ids.sort().join(', ')}`);
const card = page.getByTestId('resume-card');
await card.waitFor({ timeout: 30_000 });
log(`resume card text: ${JSON.stringify(await card.innerText())}`);
await card.click();
await page.getByText(TEXT).waitFor({ timeout: 60_000 });
const tab = await page.getByRole('tab', { name: 'Translate', exact: true }).getAttribute('aria-selected');
const heading = await page.getByRole('heading', { level: 2 }).first().innerText();
log(`after Resume: Translate tab aria-selected=${tab}; heading=${JSON.stringify(heading)}; drafted text on screen=true`);
log(`commits at the end: ${commitCount()}`);
await browser.close();
