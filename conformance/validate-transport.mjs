// Transport rig — BURRITO-SPEC §8.7 over the REAL pankosmia-web HTTP API (dev-env server).
// Re-proves the J19 delayed-receive lifecycle and J20 zero-trust intake with every git
// transport operation performed through server endpoints (copy, remote/add, pull-repo,
// add-and-commit, delete), plus the OPEN-QUESTIONS #23 probes (named-branch integration).
// Journals are SEALED ACTION SEGMENTS — the only stream form (§8.1; converted from the
// pre-ratification draft's JSONL fixtures in review round 6, and run green post-conversion).
// Git/fs access below is ASSERTION-ONLY (reading state); the transport under test is HTTP.
// Requires the rig server: dev-env/scripts/seed.zsh && dev-env/scripts/run.zsh
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fold } from './journal/fold.mjs';
import { readUnion, writeActionSegment, sealAction, validateSegment, segmentName } from './journal/files.mjs';
import { SLOT } from './journal/skeleton.mjs';

const API = process.env.RIG_API || 'http://127.0.0.1:19998/api';
const REPOS = process.env.RIG_REPOS || path.resolve('../dev-env/state/work/repos');
const LOCAL = '_local_/_local_';

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};

// ---------- HTTP transport ops (the system under test) ----------
const post = async (p, body) => {
  const res = await fetch(`${API}${p}`, {
    method: 'POST',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null; try { json = await res.json(); } catch {}
  return { status: res.status, json };
};
const get = async (p) => { const r = await fetch(`${API}${p}`); return { status: r.status, json: await r.json().catch(() => null) }; };
const copyRepo   = (src, tgt) => post(`/git/copy/${src}?target_path=${encodeURIComponent(tgt)}`);
const addRemote  = (repo, name, url) => post(`/git/remote/add/${repo}?remote_name=${name}&remote_url=${encodeURIComponent(url)}`);
const pullRepo   = (remote, repo) => post(`/git/pull-repo/${remote}/${repo}`);
const commitRepo = (repo, msg) => post(`/git/add-and-commit/${repo}`, { commit_message: msg });
const deleteRepo = (repo) => post(`/git/delete/${repo}`);
const writeIngredient = (repo, ipath, payload) =>
  post(`/burrito/ingredient/raw/${repo}?ipath=${encodeURIComponent(ipath)}&update_ingredients&no_bak`, { payload });

// ---------- assertion helpers (read-only fs/git) ----------
const dirOf = (repo3) => path.join(REPOS, repo3.split('/').slice(-3).join(path.sep));
const git = (args, repo3) => execSync(`git ${args}`, { cwd: dirOf(repo3), stdio: 'pipe' }).toString().trim();
const head = (repo3) => git('rev-parse HEAD', repo3);
const mkEvent = (o) => ({ v: 1, base: null, ...o });
const ts = (s, actor) => `2026-06-01T00:00:${String(s).padStart(2, '0')}.000Z|0000|${actor}`;
const foldRepo = (repo3) => fold(readUnion(path.join(dirOf(repo3), 'ingredients/checking/journal')));

// Rig fixtures are created directly on disk (like J19's `git init` fixtures); ops on them are HTTP.
const initRepo = (repo3, branch = 'main') => {
  const d = dirOf(repo3);
  fs.mkdirSync(d, { recursive: true });
  execSync(`git init -q -b ${branch} .`, { cwd: d });
  execSync('git config user.email rig@local && git config user.name rig', { cwd: d });
  // add-and-commit panics on a commitless repo (refs/heads/<branch> not found) — the
  // platform's new-* endpoints always create an initial commit, so fixtures must too.
  execSync('git commit -q --allow-empty -m init', { cwd: d });
};
// Journals are sealed action segments — the only stream form (§8.1, round 6). One
// segment per event here (one action per save); writeActionSegment is idempotent for
// already-published actions, so re-publishing [a1, a2] after [a1] adds only a2.
const writeJournalFs = (repo3, actor, events) => {
  const dir = path.join(dirOf(repo3), 'ingredients/checking/journal', actor);
  for (const e of events) writeActionSegment(dir, [mkEvent(e)]);
};

const run = async () => {
  // ---------- T0: idempotency — clear this suite's own fixtures from any prior run ----------
  const localDir = path.join(REPOS, '_local_', '_local_');
  if (fs.existsSync(localDir)) {
    for (const d of fs.readdirSync(localDir)) {
      if (/^(rig_|dbg_)/.test(d)) fs.rmSync(path.join(localDir, d), { recursive: true, force: true });
    }
  }

  // ---------- T1: rig sanity ----------
  const v = await get('/version');
  check('T1: rig server is the pinned latest crate', v.json?.pkg_version === '0.18.5', `pkg_version=${v.json?.pkg_version}`);
  const sums = await get('/burrito/metadata/summaries');
  check('T1: seeded sample_burrito is served', !!sums.json?.[`${LOCAL}/sample_burrito`]);

  // ---------- shared fixtures ----------
  const skeleton = `\\id TIT\n\\c 1\n\\p\n\\v 1 ${SLOT}1:1${SLOT}\\v 2 ${SLOT}1:2${SLOT}\\v 3 ${SLOT}1:3${SLOT}`;
  // §8.5 self-contained book.add: one seed event carries the whole slot topology and
  // initial verse state (the multi-key rule confers its ts as every produced head).
  const seed = [
    { op: 'book.add', actor: 'seed', ts: ts(0, 'seed'), book: 'TIT', scope: [],
      skeleton, initialVerses: { '1:1': 'uno\n', '1:2': 'dos\n', '1:3': 'tres\n' } },
  ];
  const a1 = { op: 'text.verse.set', actor: 'actor-a', ts: ts(5, 'actor-a'), base: ts(0, 'seed'), book: 'TIT', chapter: '1', verse: '2', text: 'dos A1\n' };
  const a2 = { op: 'text.verse.set', actor: 'actor-a', ts: ts(7, 'actor-a'), base: ts(5, 'actor-a'), book: 'TIT', chapter: '1', verse: '2', text: 'dos A2\n' };
  const b1 = { op: 'text.verse.set', actor: 'actor-b', ts: ts(6, 'actor-b'), base: ts(0, 'seed'), book: 'TIT', chapter: '1', verse: '3', text: 'tres B1\n' };

  const P = `${LOCAL}/rig_project`;
  const project = (repo3) => { // fold → regenerate derived USFM (write via HTTP) — §8.7 checkpoint core
    const out = foldRepo(repo3);
    return writeIngredient(repo3, 'TIT.usfm', out.books.TIT.usfm).then((r) => ({ out, write: r }));
  };
  initRepo(P);
  writeJournalFs(P, 'seed', seed);
  // metadata must satisfy the server's BurritoMetadata structs (update_ingredients round-trips
  // it — PLATFORM-NOTES #5); reuse the schema-valid sample metadata as the fixture's.
  fs.copyFileSync(path.resolve('./sample-burrito/metadata.json'), path.join(dirOf(P), 'metadata.json'));
  await project(P);
  await commitRepo(P, 'base');
  const pBase = head(P);

  // ---------- T2: OPEN-QUESTIONS #23 probes — what does pull-repo actually merge? ----------
  // multi-branch publication repo: branches with edits to DIFFERENT files, HEAD steered
  const MB = `${LOCAL}/rig_probe_multibranch`;
  initRepo(MB);
  fs.writeFileSync(path.join(dirOf(MB), 'seed.txt'), 'base\n');
  git('add -A', MB); git('-c user.email=r@l -c user.name=r commit -qm base', MB);
  for (const b of ['aaa-branch', 'zzz-branch']) {
    git(`checkout -qb ${b} main`, MB);
    fs.writeFileSync(path.join(dirOf(MB), `${b}.txt`), `${b}\n`);
    git('add -A', MB); git(`-c user.email=r@l -c user.name=r commit -qm ${b}`, MB);
  }
  const probe = async (headBranch, label) => {
    git(`checkout -q ${headBranch}`, MB);
    const S = `${LOCAL}/rig_probe_scratch_${label}`;
    initRepo(S);
    fs.writeFileSync(path.join(dirOf(S), 'seed.txt'), 'base\n');
    // share ancestry: fetch MB main into scratch first via a bootstrap remote
    git(`remote add boot "${dirOf(MB)}"`, S); git('fetch -q boot main', S);
    git('reset -q --hard boot/main', S); git('remote remove boot', S);
    await addRemote(S, 'contrib', `${LOCAL}/rig_probe_multibranch`);
    const r = await pullRepo('contrib', S);
    const gotAaa = fs.existsSync(path.join(dirOf(S), 'aaa-branch.txt'));
    const gotZzz = fs.existsSync(path.join(dirOf(S), 'zzz-branch.txt'));
    await deleteRepo(S);
    return { status: r.status, merged: gotAaa && gotZzz ? 'both' : gotAaa ? 'aaa-branch' : gotZzz ? 'zzz-branch' : 'none' };
  };
  const p1 = await probe('aaa-branch', 'p1');
  const p2 = await probe('zzz-branch', 'p2');
  const headSteered = p1.merged === 'aaa-branch' && p2.merged === 'zzz-branch';
  const orderSteered = p1.merged === p2.merged && p1.merged !== 'both';
  check(`T2: multi-branch pull-repo merge target measured (HEAD@aaa→${p1.merged}; HEAD@zzz→${p2.merged})`,
    p1.merged !== 'none' && p2.merged !== 'none');
  console.log(`  #23 probe verdict: ${headSteered ? 'FETCH_HEAD follows the publication repo HEAD' : orderSteered ? `ordering-steered (${p1.merged}) — UNSAFE, confirms #23 caution` : p1.merged === 'both' ? 'merges octopus/all — investigate' : 'mixed — UNSAFE'}`);

  // ---------- T3: J19 lifecycle over HTTP with SINGLE-BRANCH publication repos ----------
  const pubA = `${LOCAL}/rig_pub_a`, pubB = `${LOCAL}/rig_pub_b`, workA = `${LOCAL}/rig_work_a`;
  for (const [repo, from] of [[pubA, P], [pubB, P], [workA, P]]) {
    const r = await copyRepo(from, repo);
    if (r.status !== 200) throw new Error(`copy ${from}→${repo} failed: ${r.status}`);
  }
  // A1: full checkpoint in the working projection; journal-only delta in the publication repo
  writeJournalFs(workA, 'actor-a', [a1]); await project(workA); await commitRepo(workA, 'A1 full working checkpoint');
  writeJournalFs(pubA, 'actor-a', [a1]); await commitRepo(pubA, 'publish A1');
  const pubA1Paths = git('diff --name-only HEAD^ HEAD', pubA).split('\n').filter(Boolean);

  let scratchSeq = 0;
  const integrate = async (pub, label) => {
    const S = `${LOCAL}/rig_scratch_${++scratchSeq}_${label}`;
    const before = head(P);
    await copyRepo(P, S);
    await addRemote(S, 'incoming', pub);
    const pull = await pullRepo('incoming', S);
    const conflicts = pull.json?.has_conflicts ?? pull.json?.payload?.has_conflicts ?? false;
    if (process.env.RIG_DEBUG) console.log(`  [${label}] pull:`, pull.status, JSON.stringify(pull.json));
    if (pull.status !== 200 || conflicts) { await deleteRepo(S); return { conflict: true, before, after: head(P) }; }
    // PLATFORM FINDING (0.17.0): after a NORMAL pull-repo merge, files added by the merge are in
    // the merge COMMIT but not the WORKING TREE (non-force checkout); a subsequent add-and-commit
    // would commit their deletion. The correct §8.7/J20 posture is also the workaround: the
    // integrator writes the VALIDATED UNION explicitly — every actor journal it accepted — via
    // ingredient writes, then regenerates and commits. Never trust the merged worktree.
    const union = new Map(); // repo-relative journal path -> bytes (accepted union)
    for (const src of [P, pub]) {
      const jdir = path.join(dirOf(src), 'ingredients/checking/journal');
      if (!fs.existsSync(jdir)) continue;
      for (const actor of fs.readdirSync(jdir)) {
        const sdir = path.join(jdir, actor, 'segments');
        if (!fs.existsSync(sdir) || !fs.statSync(sdir).isDirectory()) continue;
        for (const f of fs.readdirSync(sdir).filter((x) => x.endsWith('.action.json'))) {
          const rel = `checking/journal/${actor}/segments/${f}`;
          const bytes = fs.readFileSync(path.join(sdir, f), 'utf8');
          const prev = union.get(rel);
          if (prev === undefined) union.set(rel, bytes);
          else if (prev !== bytes) throw new Error(`accepted segment ${rel} differs between sources — §8.1 immutability violated`);
        }
      }
    }
    for (const [rel, bytes] of union) await writeIngredient(S, rel, bytes);
    const { out, write } = await project(S);
    const c = await commitRepo(S, `regenerate ${label}`);
    await addRemote(P, `updates${scratchSeq}`, S);
    const ff = await pullRepo(`updates${scratchSeq}`, P);
    if (process.env.RIG_DEBUG) console.log(`  [${label}] write:`, write.status, 'commit:', c.status, JSON.stringify(c.json), 'ff:', ff.status, JSON.stringify(ff.json), 'verses:', JSON.stringify(out.books.TIT.verses));
    const ffOk = ff.status === 200 && !(ff.json?.has_conflicts);
    await deleteRepo(S);
    return { conflict: false, before, after: head(P), out, ffOk, mergeType: ff.json?.merge_type };
  };

  const iA1 = await integrate(pubA, 'a1');
  check('T3: A1 integrates via HTTP scratch (copy→remote/add→pull-repo→regenerate→commit→pull-to-main)',
    !iA1.conflict && iA1.ffOk && iA1.after !== iA1.before,
    `merge_type=${iA1.mergeType}`);
  check('T3: publication commits are journal-only paths (publication isolation holds over HTTP)',
    JSON.stringify(pubA1Paths) === JSON.stringify([`ingredients/checking/journal/actor-a/segments/${segmentName(a1.ts)}`]),
    JSON.stringify(pubA1Paths));

  writeJournalFs(pubB, 'actor-b', [b1]); await commitRepo(pubB, 'publish B1');
  const iB1 = await integrate(pubB, 'b1');
  check('T3: B1 integrates while A is offline; both texts present',
    !iB1.conflict && iB1.ffOk && iB1.out.books.TIT.verses['1:2'] === 'dos A1\n' && iB1.out.books.TIT.verses['1:3'] === 'tres B1\n');

  // A continues OFFLINE — no receive of B1/main. Working projection diverges; publication stays journal-only.
  const workAHeadBeforeIntegrations = head(workA);
  writeJournalFs(workA, 'actor-a', [a1, a2]); await project(workA); await commitRepo(workA, 'A2 working checkpoint offline');
  writeJournalFs(pubA, 'actor-a', [a1, a2]); await commitRepo(pubA, 'publish A2 while offline');
  const iA2 = await integrate(pubA, 'a2');
  check('T3: A2 submits WITHOUT receiving B1 — clean HTTP integration; A2+B1 both survive',
    !iA2.conflict && iA2.ffOk && iA2.out.books.TIT.verses['1:2'] === 'dos A2\n' && iA2.out.books.TIT.verses['1:3'] === 'tres B1\n');

  // Counterexample: merging the full working projection (derived files committed) DOES conflict.
  const iWork = await integrate(workA, 'fullwork');
  check('T3: counterexample — integrating the full offline working projection conflicts, and main is untouched',
    iWork.conflict === true && iWork.after === iWork.before);

  // Receive = rebuild-and-swap: replacement from current main; old working repo untouched until swap.
  const recvA = `${LOCAL}/rig_recv_a`;
  await copyRepo(P, recvA);
  const recvFold = foldRepo(recvA);
  check('T3: receive rebuilds replacement from main (union present); old working repo untouched until swap',
    recvFold.books.TIT.verses['1:2'] === 'dos A2\n' && recvFold.books.TIT.verses['1:3'] === 'tres B1\n' &&
    head(workA) !== workAHeadBeforeIntegrations /* it advanced by A's own commits only */ &&
    foldRepo(workA).books.TIT.verses['1:3'] === 'tres\n' /* B1 never leaked into old working repo */);

  // ---------- T4: J20 zero-trust intake over HTTP ----------
  const intakeViolations = (S, incomingActor) => {
    const changed = git(`diff --name-only ${head(P)} HEAD`, S).split('\n').filter(Boolean);
    const allowedPrefix = `ingredients/checking/journal/${incomingActor}/`;
    const bad = changed.filter((f) => !f.startsWith(allowedPrefix));
    // §8.7 whitelist over sealed segments. Read incoming from the merge COMMIT, never the
    // worktree — non-force checkout leaves merged modifications stale on disk.
    const segRe = new RegExp(`^${allowedPrefix}segments/[^/]+\\.action\\.json$`.replaceAll('/', '\\/'));
    for (const f of changed.filter((x) => x.startsWith(allowedPrefix))) {
      if (fs.existsSync(path.join(dirOf(P), f))) { bad.push(`${f} (modifies an accepted segment — immutable, §8.1)`); continue; }
      if (f === `${allowedPrefix}actor.json`) continue;
      if (!segRe.test(f)) { bad.push(`${f} (not a whitelisted shape)`); continue; }
      const bytes = git(`show HEAD:"${f}"`, S);
      const r = validateSegment(bytes);
      if (!r.ok) { bad.push(`${f} (invalid segment: ${r.reason})`); continue; }
      if (r.events.some((e) => e.actor !== incomingActor)) { bad.push(`${f} (foreign-actor events)`); continue; }
      if (path.basename(f) !== segmentName(r.events[0].ts)) bad.push(`${f} (misnamed segment)`);
    }
    return bad;
  };
  const forgedB = mkEvent({ op: 'text.verse.set', actor: 'actor-b', ts: ts(9, 'actor-b'), base: ts(6, 'actor-b'), book: 'TIT', chapter: '1', verse: '3', text: 'tres FORGED\n' });
  const evilCases = [
    ['shared file', (d) => fs.writeFileSync(path.join(d, 'metadata.json'), '{"format":"evil"}\n')],
    ['foreign actor segment', (d) => writeActionSegment(path.join(d, 'ingredients/checking/journal/actor-b'), [forgedB])],
    ['rewrite accepted segment', (d) => fs.writeFileSync(
      path.join(d, 'ingredients/checking/journal/actor-a/segments', segmentName(a1.ts)),
      sealAction([mkEvent({ ...a1, text: 'dos TAMPERED\n' })]))],
    ['invalid incoming segment', (d) => {
      const sdir = path.join(d, 'ingredients/checking/journal/actor-a/segments');
      fs.mkdirSync(sdir, { recursive: true });
      fs.writeFileSync(path.join(sdir, segmentName(ts(9, 'actor-a'))),
        sealAction([mkEvent({ op: 'settings.set', actor: 'actor-a', ts: ts(9, 'actor-a'), path: 'ui.x', value: 9 })]).slice(0, 40)); // torn
    }],
  ];
  let t4ok = true, t4detail = [];
  for (const [label, sabotage] of evilCases) {
    const pubE = `${LOCAL}/rig_pub_evil_${t4detail.length}`;
    await copyRepo(pubA, pubE);
    sabotage(dirOf(pubE));
    await commitRepo(pubE, `evil: ${label}`);
    const S = `${LOCAL}/rig_scratch_evil_${t4detail.length}`;
    const beforeMain = head(P);
    await copyRepo(P, S);
    await addRemote(S, 'incoming', pubE);
    const pull = await pullRepo('incoming', S);
    const conflicts = pull.json?.has_conflicts ?? false;
    const violations = conflicts ? ['(git conflict)'] : intakeViolations(S, 'actor-a');
    const rejected = violations.length > 0;
    await deleteRepo(S); await deleteRepo(pubE);
    const mainIntact = head(P) === beforeMain;
    t4ok = t4ok && rejected && mainIntact;
    t4detail.push(`${label}:${rejected ? 'rejected' : 'MISSED'}`);
  }
  check('T4: zero-trust intake rejects shared-file / foreign-segment / rewrite / invalid-segment contributions; main byte-identical',
    t4ok, t4detail.join(' · '));

  console.log(`\nTransport rig: ${pass} passed, ${fail} failed (server ${API}, pankosmia_web ${v.json?.pkg_version})`);
  process.exit(fail ? 1 : 0);
};
run().catch((e) => { console.error('RIG ERROR:', e.message); process.exit(2); });
