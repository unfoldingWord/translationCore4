#!/usr/bin/env node
// pin-check.mjs — compare the bundled resource pins with the latest Door43 releases (#504).
//
// The build bundles the English suite at fixed releases (scripts/package-desktop.zsh,
// BUNDLED_RESOURCES). Door43 publishes new releases a few times a year. This script reads
// every tagged pin from that array and asks the Door43 catalog for the repository's latest
// production release (`/api/v1/catalog/search?owner=&repo=&stage=prod`). The weekly workflow
// (.github/workflows/pin-check.yml) runs it and opens or updates one issue when a pin is behind.
//
//   node scripts/pin-check.mjs [--override <owner>/<repo>:<tag>] [--out <json>] [--body <md>]
//
//   --override  replace ONE pin's tag before the comparison. The negative control of the
//               workflow: `--override unfoldingWord/en_ult:v89` must report en_ult.
//   --out       write the result as JSON.
//   --body      write the issue body (Markdown) — only when a pin is behind.
//
// Three outcomes, kept apart:
//   exit 0, "pins: current"  every tagged pin names the catalog's latest release and commit.
//   exit 0, "pins: behind"   at least one pin differs (the table names each). With
//                            GITHUB_OUTPUT set, `behind=true` is written for the workflow.
//   exit 1                   a catalog lookup failed or answered with no release. Nothing is
//                            reported as behind: no answer is not "no".
// A sha-only pin (no tag: the lexicons and the picture pack) has no release to compare and is
// listed as skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECIPE = path.join(HERE, 'package-desktop.zsh');
const CATALOG = 'https://git.door43.org/api/v1/catalog/search';
export const ISSUE_TITLE = 'Bundled resource pins are behind the latest Door43 releases';

/** The BUNDLED_RESOURCES entries of package-desktop.zsh: `<owner>/<repo>:<tag>:<sha>`. */
export function readPins(recipeText) {
  const block = /BUNDLED_RESOURCES=\(([\s\S]*?)\n\)/.exec(recipeText);
  if (!block) throw new Error(`no BUNDLED_RESOURCES array in ${RECIPE}`);
  const pins = [];
  for (const m of block[1].matchAll(/"([^/":]+)\/([^/":]+):([^":]*):([0-9a-f]{40})"/g)) {
    pins.push({ owner: m[1], repo: m[2], tag: m[3] || null, sha: m[4] });
  }
  if (pins.length === 0) throw new Error('BUNDLED_RESOURCES holds no pin');
  return pins;
}

/** `<owner>/<repo>:<tag>` → the same pins with that one tag replaced. Throws on an unknown repo. */
export function applyOverride(pins, override) {
  if (!override) return pins;
  const m = /^([^/:]+)\/([^/:]+):(\S+)$/.exec(override.trim());
  if (!m) throw new Error(`--override must be <owner>/<repo>:<tag>, got "${override}"`);
  const [, owner, repo, tag] = m;
  const hit = pins.find((p) => p.owner.toLowerCase() === owner.toLowerCase() && p.repo === repo);
  if (!hit) throw new Error(`--override names ${owner}/${repo}, which is not a bundled pin`);
  return pins.map((p) => (p === hit ? { ...p, tag, sha: `override-${tag}` } : p));
}

/** The catalog's latest production release of one repository. */
export async function latestProdRelease(owner, repo, fetchFn = fetch) {
  const url = `${CATALOG}?owner=${encodeURIComponent(owner)}&repo=${encodeURIComponent(repo)}&stage=prod`;
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`${owner}/${repo}: catalog answered HTTP ${response.status}`);
  const body = await response.json();
  const entry = Array.isArray(body?.data) ? body.data[0] : undefined;
  if (!entry?.branch_or_tag_name || !entry.commit_sha) throw new Error(`${owner}/${repo}: the catalog lists no production release`);
  return { tag: entry.branch_or_tag_name, sha: entry.commit_sha, released: entry.released ?? null };
}

/** One row per tagged pin. `status` is `current` or `behind`; `reason` says why it is behind. */
export function compare(pin, latest) {
  if (pin.tag !== latest.tag) return { status: 'behind', reason: `pinned ${pin.tag}, latest ${latest.tag}` };
  if (pin.sha !== latest.sha) return { status: 'behind', reason: `same tag ${pin.tag}, another commit ${latest.sha.slice(0, 12)}` };
  return { status: 'current', reason: '' };
}

export async function run(pins, { fetchFn = fetch } = {}) {
  const rows = [];
  const skipped = [];
  for (const pin of pins) {
    const name = `${pin.owner}/${pin.repo}`;
    if (!pin.tag) {
      skipped.push({ repo: name, sha: pin.sha, reason: 'sha-only pin: no release tag to compare' });
      continue;
    }
    const latest = await latestProdRelease(pin.owner, pin.repo, fetchFn);
    rows.push({ repo: name, pinned: pin.tag, pinnedSha: pin.sha, latest: latest.tag, latestSha: latest.sha, released: latest.released, ...compare(pin, latest) });
  }
  return { checkedAt: new Date().toISOString(), rows, skipped, behind: rows.filter((r) => r.status === 'behind') };
}

/** The issue body: plain language, full URLs, one row per resource that is behind. */
export function issueBody(result, { override = '', runUrl = '' } = {}) {
  const lines = [];
  lines.push('The weekly pin check found bundled English resource releases that are older than the latest release on Door43.');
  lines.push('');
  lines.push('The build bundles these resources at fixed releases. The pins live in `scripts/package-desktop.zsh` (`BUNDLED_RESOURCES`) and `src/data/installedSuite.js`. To update them, follow "Bundled English suite" in https://github.com/unfoldingWord/translationCore4/blob/main/docs/PACKAGING.md, and check every copy named there.');
  lines.push('');
  lines.push('| Resource | Pinned release | Latest release on Door43 | Released |');
  lines.push('|---|---|---|---|');
  for (const r of result.behind) {
    lines.push(`| https://git.door43.org/${r.repo} | ${r.pinned} | ${r.latest} | ${r.released ? r.released.slice(0, 10) : ''} |`);
  }
  lines.push('');
  const current = result.rows.filter((r) => r.status === 'current').map((r) => `${r.repo} ${r.pinned}`);
  if (current.length) lines.push(`Current: ${current.join(', ')}.`);
  if (result.skipped.length) lines.push(`Not compared (no release tag): ${result.skipped.map((s) => s.repo).join(', ')}.`);
  lines.push('');
  if (override) {
    lines.push(`**Negative control.** This run replaced one pin with an old tag on purpose (\`${override}\`). The real pins were not checked here. Close this issue once the control is recorded.`);
    lines.push('');
  }
  lines.push(`Checked ${result.checkedAt}.${runUrl ? ` Run: ${runUrl}` : ''}`);
  return `${lines.join('\n')}\n`;
}

function printTable(result) {
  for (const r of result.rows) {
    console.log(`${r.status.padEnd(7)} ${r.repo} pinned ${r.pinned} (${r.pinnedSha.slice(0, 12)}); latest ${r.latest} (${r.latestSha.slice(0, 12)})${r.reason ? ` — ${r.reason}` : ''}`);
  }
  for (const s of result.skipped) console.log(`skipped ${s.repo} — ${s.reason}`);
}

async function main(argv) {
  const arg = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] ?? '' : '';
  };
  const override = arg('--override');
  const out = arg('--out');
  const bodyFile = arg('--body');
  const pins = applyOverride(readPins(fs.readFileSync(RECIPE, 'utf8')), override);
  if (override) console.log(`override: ${override} (negative control — the real pins are not checked)`);
  const result = await run(pins);
  printTable(result);
  const behind = result.behind.length > 0;
  console.log(behind ? `pins: behind (${result.behind.length} of ${result.rows.length})` : `pins: current (${result.rows.length} compared, ${result.skipped.length} sha-only skipped)`);
  if (out) fs.writeFileSync(out, `${JSON.stringify({ override: override || null, ...result }, null, 2)}\n`);
  if (bodyFile && behind) {
    const runUrl = process.env.GITHUB_SERVER_URL && process.env.GITHUB_REPOSITORY && process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : '';
    fs.writeFileSync(bodyFile, issueBody(result, { override, runUrl }));
  }
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `behind=${behind}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`pin-check: ${error.message}`);
    process.exit(1);
  });
}
