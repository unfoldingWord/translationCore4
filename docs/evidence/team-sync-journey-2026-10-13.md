# Team sync journey J26: three translators on one rig (#681) — 2026-10-13

This record is the run record of journey J26 (`docs/JOURNEYS.md`), issue #681, layer 5 of epic
#24. It also holds the check of the epic's acceptance line "each guarantee G1–G8 has at least one
passing test whose name starts with its id".

## What ran

- Branch `issue-681-team-sync-journey` at `c25f2d8`. This commit merges round 1: #674, #675,
  #676, #679, #678, #680 (`origin/issue-680-door43-names` at `80360cb`) and #677
  (`origin/issue-677-open-from-door43` at `089ccf8`), and holds the J26 spec. The commit that
  adds this record changes only this record.
- The rig: `GET /api/version` gives `pkg_version` `0.18.15`. The HTTP API reports no hash. The
  server binary is the build of the pinned revision `a83725b67593b018f815fdb25a3920ce03e833e7`
  (`dev-env/server/Cargo.toml`) [VERIFIED — pankosmia-web 0.18.15 (a83725b, 2026-10-13)].
- Door43 `main` is a bare `file://` repository (the #673 stand-in). The fake Door43
  (`e2e/helpers/door43.ts`) answers the sign-in and the first share. Each translator signs in
  with a different username: `fixture-translator-a`, `fixture-translator-b` and
  `fixture-translator-c`, the usernames of the shared fixture. The stand-in mirror has a local
  git identity, because a machine with no global identity (CI) needs one.
- macOS (darwin), one Playwright worker, lane rig 19681 and vite 5281.

The command:

```bash
TC4_RIG_PORT=19681 TC4_VITE_PORT=5281 npm run journeys -- --grep "@J26"
```

## The journey

The spec is `e2e/j26-team-sync.spec.ts`. The verses, the texts, the check and the usernames come
from the shared fixture `conformance/fixtures/team-sync/` (D98). The spec reads them from the
fixture's segment files, so a journey failure can be reproduced in a core test.

1. A (the seeded project `sample_burrito`, reset to its seed commit) changes TIT 1:1
   (`different-verses`), sets one translationWords check result, and shares the project. The
   reset runs only when `sample_burrito` is its own git repository.
2. B and C open the project from Door43 under their own project names. B changes TIT 1:2 and
   TIT 1:4. C changes TIT 1:3 and TIT 1:4 in a different way (the two texts of `verse-two-ways`).
   B sets the check result of the word "apostle" in TIT 1:1 to `valid`, then C sets it to `todo`
   (`check-two-ways`). B syncs, then C syncs.
3. A syncs. The result shows 8 changes from teammates, 1 conflict kept the newest version, and
   1 verse conflict to review, from `fixture-translator-b` and `fixture-translator-c`. The
   projected check result in A's project is C's `todo` (the newest). The review shows TIT 1:4
   with two versions, each with the Door43 username of its owner. A keeps the version of B, then
   syncs again.
4. B and C sync. Each gets the version that A kept, and no conflict.
5. The three projects show the same text in Translate. On Home, no card shows a conflict, and
   the three cards show the same percent for each book.

The counts of A's first sync (`received` is the sum of the segment files of B and C that are new
on Door43 `main`), and the Home percents at the end:

```json
{
  "got": {
    "received": 8,
    "newest": 1,
    "conflicts": 1
  },
  "expectedReceived": {
    "a46026339d1c5916": 4,
    "ae11b220b194f7cb": 4
  }
}
{
  "A": [
    "TIT 11%",
    "JON 4%"
  ],
  "B": [
    "TIT 11%",
    "JON 4%"
  ],
  "C": [
    "TIT 11%",
    "JON 4%"
  ]
}
```

## Results at `c25f2d8`

J26, two runs:

```
== run 1
  ✓  1 e2e/j26-team-sync.spec.ts:292:3 › J26 — three translators sync one project through Door43 › A shares; B and C open it from Door43; each drafts, checks and syncs; A keeps one version of the conflict; all three end with the same text @J26 (45.5s)
  ✓  2 e2e/j26-team-sync.spec.ts:469:3 › J26 — three translators sync one project through Door43 › [G6] at the end the three projects have the same project files, and no verse has a conflict @J26 (758ms)
  ✓  3 e2e/j26-team-sync.spec.ts:487:3 › J26 — three translators sync one project through Door43 › [G1] every journal file that any translator wrote is on the stand-in's main @J26 (1.0s)
  3 passed (1.1m)
== run 2
  ✓  1 e2e/j26-team-sync.spec.ts:292:3 › J26 — three translators sync one project through Door43 › A shares; B and C open it from Door43; each drafts, checks and syncs; A keeps one version of the conflict; all three end with the same text @J26 (44.8s)
  ✓  2 e2e/j26-team-sync.spec.ts:469:3 › J26 — three translators sync one project through Door43 › [G6] at the end the three projects have the same project files, and no verse has a conflict @J26 (741ms)
  ✓  3 e2e/j26-team-sync.spec.ts:487:3 › J26 — three translators sync one project through Door43 › [G1] every journal file that any translator wrote is on the stand-in's main @J26 (1.0s)
  3 passed (59.5s)
```

The three journeys that touch sync, together:

```bash
TC4_RIG_PORT=19681 TC4_VITE_PORT=5281 npm run journeys -- --grep "@J17|@sync-button|@J26"
```

```
  ✓  1 e2e/j17-open-from-door43.spec.ts:87:3 › J17 — open a project from Door43 › another translator opens the project from Door43, and it syncs @J17 (12.8s)
  ✓  2 e2e/j17-open-from-door43.spec.ts:192:3 › J17 — open a project from Door43 › [G2] one invalid journal file on Door43 refuses the open, and no project is written @J17 (2.9s)
  ✓  3 e2e/j26-team-sync.spec.ts:292:3 › J26 — three translators sync one project through Door43 › A shares; B and C open it from Door43; each drafts, checks and syncs; A keeps one version of the conflict; all three end with the same text @J26 (48.3s)
  ✓  4 e2e/j26-team-sync.spec.ts:469:3 › J26 — three translators sync one project through Door43 › [G6] at the end the three projects have the same project files, and no verse has a conflict @J26 (723ms)
  ✓  5 e2e/j26-team-sync.spec.ts:487:3 › J26 — three translators sync one project through Door43 › [G1] every journal file that any translator wrote is on the stand-in's main @J26 (1.0s)
  ✓  6 e2e/sync-button.spec.ts:107:3 › #678 — Sync with Door43 › sync with no teammate change, then with one @sync-button (19.0s)
  ✓  7 e2e/sync-button.spec.ts:231:3 › #678 — Sync with Door43 › no write access: one plain message, and nothing changes @sync-button (4.6s)
  7 passed (1.7m)
```

Before the last merges, J26 also passed in three runs in a row with the spec of `d1151b9` (on
`1859571`), and in two runs with the code of each of `cca5356`, `ad56440` and `54f6dc9`. No J26 run log has a
`[vite]` reload line during the tests (the one `[vite]` line is the dependency optimization at
start).

## The full journeys suite

`npm run journeys` (all specs) ran once at `54f6dc9`, on the same lane, after a reseed:

```
  ✘   14 e2e/check-project-switch.spec.ts:105:1 › a Home tile that resumes into Check opens the tool with the open project's own pin after a switch: Bible ↔ stories (#434) @J4 @J22 @J8 @434 (1.1m)
  ✘   86 e2e/j04-check-book.spec.ts:279:3 › J4 — a checker works a book › progress is reconstructed from the derived list + saved decisions after a restart (FR-18) @inc2 @J4 (10.8s)
  ✘  126 e2e/j08-resume.spec.ts:357:3 › J8 — the Increment 4 journey: open, resume, and share a project (#185) › open the project, draft, mark one check, leave (a checkpoint commits), reload, resume i
  ✘  163 e2e/j11-share.spec.ts:285:5 › J11 — a facilitator shares the project to Door43 › sign in (#203) › 7c. a kept token: no Door43 request at start, and none when the upload dialog opens; the dial
  ✘  168 e2e/j11-share.spec.ts:585:5 › J11 — a facilitator shares the project to Door43 › share (#362) › 2. the shared card after a new session reads its state from origin; Upload changes opens the di
  ✘  169 e2e/j11-share.spec.ts:678:5 › J11 — a facilitator shares the project to Door43 › share (#362) › 2b. with "Stay signed in", Upload changes in a new app session asks no sign-in (#366 test 1; #5
  ✘  203 e2e/j13-gateway-change.spec.ts:1178:1 › Project settings settles its Checking language row on each of 30 opens, and the last open saves @inc9 @J13 (3.1m)
  7 failed
  8 skipped
  216 passed (54.3m)
```

J26 ran as tests 217 to 219, after each failure, so J26 did not cause them. Then each failing
file ran alone:

| Run | Commit | Result |
|---|---|---|
| `check-project-switch`, `j04`, `j08`, `j11`, `j13` | `c25f2d8` (this branch) | 61 passed, 3 failed, 1 skipped. Failed: `check-project-switch.spec.ts:105`, `j04-check-book.spec.ts:279`, `j08-resume.spec.ts:357`. J11 and J13 passed. |
| `check-project-switch`, `j04`, `j08` | `origin/main` `7531ea3` (control) | 22 passed |
| the same | `origin/issue-676-sync-shell` `5e6a753` | 22 passed |
| the same | `origin/issue-679-conflict-review` `d5df17c` | 19 passed, the same 3 failed |
| the same | `origin/issue-678-sync-button` `7ead38d` | 19 passed, the same 3 failed |

So the three failures come with the #679 branch, not with J26. In each failure a Check tool
does not open: `check-progress`, `check-session` or `check-rail` is not found. The J11 failures
(7c, 2, 2b) and the J13 failure (`j13-gateway-change.spec.ts:1178`) of the full run did not come
back when their files ran alone.

## G6: the three projects have the same project files

The test `[G6] at the end the three projects have the same project files, and no verse has a
conflict` compares every file of the three repositories (all files except `.git`) byte for byte.
It also checks that each `HEAD` is the same as Door43 `main`, and that the fold of each journal
has no `text|` fork. The file list (bytes, path), the same in the three projects:

```
9	.gitignore
744	ingredients/JON.usfm
1147	ingredients/TIT.usfm
7300	ingredients/checking/alignments/TIT.json
134	ingredients/checking/journal/a32cf07508b42b30/actor.json
68953	ingredients/checking/journal/a32cf07508b42b30/segments/2020-01-01T00_00_00.000Z,0001,a32cf07508b42b30.action.json
8326	ingredients/checking/journal/a32cf07508b42b30/segments/2026-10-14T01_45_52.437Z,0000,a32cf07508b42b30.action.json
505	ingredients/checking/journal/a32cf07508b42b30/segments/2026-10-14T01_45_52.938Z,0000,a32cf07508b42b30.action.json
3966	ingredients/checking/journal/a32cf07508b42b30/segments/2026-10-14T01_45_54.980Z,0000,a32cf07508b42b30.action.json
836	ingredients/checking/journal/a32cf07508b42b30/segments/2026-10-14T01_45_55.713Z,0000,a32cf07508b42b30.action.json
292	ingredients/checking/journal/a32cf07508b42b30/segments/2026-10-14T01_46_15.536Z,0000,a32cf07508b42b30.action.json
611	ingredients/checking/journal/a32cf07508b42b30/segments/2026-10-14T01_46_16.661Z,0000,a32cf07508b42b30.action.json
134	ingredients/checking/journal/a46026339d1c5916/actor.json
472	ingredients/checking/journal/a46026339d1c5916/segments/2026-10-14T01_46_04.456Z,0000,a46026339d1c5916.action.json
492	ingredients/checking/journal/a46026339d1c5916/segments/2026-10-14T01_46_04.684Z,0000,a46026339d1c5916.action.json
889	ingredients/checking/journal/a46026339d1c5916/segments/2026-10-14T01_46_05.165Z,0000,a46026339d1c5916.action.json
292	ingredients/checking/journal/a46026339d1c5916/segments/2026-10-14T01_46_07.151Z,0000,a46026339d1c5916.action.json
134	ingredients/checking/journal/ae11b220b194f7cb/actor.json
481	ingredients/checking/journal/ae11b220b194f7cb/segments/2026-10-14T01_46_10.048Z,0000,ae11b220b194f7cb.action.json
476	ingredients/checking/journal/ae11b220b194f7cb/segments/2026-10-14T01_46_10.288Z,0000,ae11b220b194f7cb.action.json
888	ingredients/checking/journal/ae11b220b194f7cb/segments/2026-10-14T01_46_10.765Z,0000,ae11b220b194f7cb.action.json
292	ingredients/checking/journal/ae11b220b194f7cb/segments/2026-10-14T01_46_12.756Z,0000,ae11b220b194f7cb.action.json
13028	ingredients/checking/resources.json
555	ingredients/checking/settings.json
2595	ingredients/checking/translationNotes/TIT.json
3130	ingredients/checking/translationWords/TIT.json
27681	ingredients/vrs.json
7760	metadata.json
```

## G1: every journal file of a translator is on Door43 main

The test `[G1] every journal file that any translator wrote is on the stand-in's main` checks
two sets:

- each segment file that a write step put on disk (A's draft, check and keep; the drafts and
  check results of B and C), with its bytes as written: each one is on `main` with the same
  bytes (`git show main:<path>`);
- each segment file in the actor folder of each translator at the end, also byte for byte.

The write steps (translator, path):

```
A	a32cf07508b42b30/segments/2026-10-14T01_45_52.938Z,0000,a32cf07508b42b30.action.json
A	a32cf07508b42b30/segments/2026-10-14T01_45_54.980Z,0000,a32cf07508b42b30.action.json
A	a32cf07508b42b30/segments/2026-10-14T01_45_55.713Z,0000,a32cf07508b42b30.action.json
B	a46026339d1c5916/segments/2026-10-14T01_46_04.456Z,0000,a46026339d1c5916.action.json
B	a46026339d1c5916/segments/2026-10-14T01_46_04.684Z,0000,a46026339d1c5916.action.json
B	a46026339d1c5916/segments/2026-10-14T01_46_05.165Z,0000,a46026339d1c5916.action.json
C	ae11b220b194f7cb/segments/2026-10-14T01_46_10.048Z,0000,ae11b220b194f7cb.action.json
C	ae11b220b194f7cb/segments/2026-10-14T01_46_10.288Z,0000,ae11b220b194f7cb.action.json
C	ae11b220b194f7cb/segments/2026-10-14T01_46_10.765Z,0000,ae11b220b194f7cb.action.json
A	a32cf07508b42b30/segments/2026-10-14T01_46_16.661Z,0000,a32cf07508b42b30.action.json
```

The journal on `main` (`git ls-tree -r --name-only main:ingredients/checking/journal`):

```
a32cf07508b42b30/actor.json
a32cf07508b42b30/segments/2020-01-01T00_00_00.000Z,0001,a32cf07508b42b30.action.json
a32cf07508b42b30/segments/2026-10-14T01_45_52.437Z,0000,a32cf07508b42b30.action.json
a32cf07508b42b30/segments/2026-10-14T01_45_52.938Z,0000,a32cf07508b42b30.action.json
a32cf07508b42b30/segments/2026-10-14T01_45_54.980Z,0000,a32cf07508b42b30.action.json
a32cf07508b42b30/segments/2026-10-14T01_45_55.713Z,0000,a32cf07508b42b30.action.json
a32cf07508b42b30/segments/2026-10-14T01_46_15.536Z,0000,a32cf07508b42b30.action.json
a32cf07508b42b30/segments/2026-10-14T01_46_16.661Z,0000,a32cf07508b42b30.action.json
a46026339d1c5916/actor.json
a46026339d1c5916/segments/2026-10-14T01_46_04.456Z,0000,a46026339d1c5916.action.json
a46026339d1c5916/segments/2026-10-14T01_46_04.684Z,0000,a46026339d1c5916.action.json
a46026339d1c5916/segments/2026-10-14T01_46_05.165Z,0000,a46026339d1c5916.action.json
a46026339d1c5916/segments/2026-10-14T01_46_07.151Z,0000,a46026339d1c5916.action.json
ae11b220b194f7cb/actor.json
ae11b220b194f7cb/segments/2026-10-14T01_46_10.048Z,0000,ae11b220b194f7cb.action.json
ae11b220b194f7cb/segments/2026-10-14T01_46_10.288Z,0000,ae11b220b194f7cb.action.json
ae11b220b194f7cb/segments/2026-10-14T01_46_10.765Z,0000,ae11b220b194f7cb.action.json
ae11b220b194f7cb/segments/2026-10-14T01_46_12.756Z,0000,ae11b220b194f7cb.action.json
```

## The epic's acceptance check: each guarantee has a passing test

`git grep -n "\[G[1-8]\]" -- ':!docs/evidence'` at `c25f2d8`:

```
CONTEXT.md:406:a guarantee starts its name with the id, for example `[G1] keeps every own file`. A
conformance/validate-journal.mjs:4897:  // [G2] R-8.7.8 — the intake walk over a journal root, with the ONE validator per file
conformance/validate-journal.mjs:4930:    check('[G2] JC-35: incoming journal files are checked — every file of the fixture passes the one validator (segments, names, actor.json); the invalid-file case is refused by its path (checksum), a flipped byte in a valid segment is refused, and a stray .jsonl and a foreign actor.json are refused [covers R-8.7.8]',
conformance/validate-journal.mjs:4938:  // [G1] R-8.7.7 — copying own files into a Door43 copy never overwrites a different file
conformance/validate-journal.mjs:4959:    check('[G1] JC-35: own work is never lost — copying A\'s own files into a Door43 copy keeps each one byte for byte, and an identical own file is accepted again; the changed-own-file case (a different valid action at an own path) is refused and its path is left as it was [covers R-8.7.7]',
conformance/validate-journal.mjs:4963:  // [G3] R-8.7.9 — every derived file is the projection of the fold; incoming derived bytes are no input
conformance/validate-journal.mjs:4984:    check('[G3] JC-35: derived files are rebuilt, never trusted — the projection of the fold over the fixture is the complete R-8.7.1 set, carries A\'s, B\'s and C\'s verses, and takes each (tool, book) resource record from the supplied resolution; a stale TIT.usfm and a forged decision resource on Door43 are no input and are told apart; without the resolution record the projection refuses (checkpoint.incomplete-inputs) [covers R-8.7.9]',
conformance/validate-journal.mjs:4989:  // [G3] R-8.7.10 — metadata.json is the server's. What this check proves: the projection set
conformance/validate-journal.mjs:5002:    check('[G3] JC-35: metadata.json belongs to the server — the projection set holds exactly one server-owned file, metadata.json, beside the eight journal-derived files a sync may write; the fixture fold carries no project.meta.set overlay, and one overlay event makes FoldOutput carry the overlay that the refusal (sync.metadata-overlay, #675) keys on and that changes only metadata.json [covers R-8.7.10]',
conformance/validate-journal.mjs:5008:  // [G6] R-8.7.11 — two computers with the same segment set write the same derived files
conformance/validate-journal.mjs:5020:    check('[G6] JC-35: the same journals give the same project — the fixture read in two orders (actors reversed, journals backward, one journal read twice) projects byte-identical derived files (metadata.json aside); a computer without C\'s check-result segment projects a different translationWords file [covers R-8.7.11]',
conformance/validate-journal.mjs:5024:  // [G7] R-8.7.12 — only the verse-text fork goes to a person; the non-text fork keeps the newest head
conformance/validate-journal.mjs:5040:    check('[G7] JC-35: non-text conflict takes the newest head — over the fixture, the one verse-text fork (TIT 1:4) is the only fork for a person; the check-two-ways fork projects its provisional head, the highest ts (C, status todo); when B\'s result is made newer the projection follows it [covers R-8.7.12]',
docs/BURRITO-SPEC.md:663:JC-1 HLC ordering/ratchet/overflow · JC-2 skeleton codec byte-identity · JC-3 fold determinism (property) · JC-4 LWW linear history · JC-5 fork detection + identical-payload auto-merge · JC-6 supersedes resolution · JC-7 I-3 staleness composition · JC-8 out-of-band reconcile · JC-9 three-device convergence · JC-10 sneakernet ≡ merge · JC-11 RETIRED (tested the deleted NDJSON stream form; the id is not reassigned — D44) · JC-12 end-to-end two-actor git regeneration · JC-13 de-duplication by ts · JC-14 schema totality + version policy · JC-15 Phase-1 sidecar seed migration · JC-16 section-vs-verse machinery · JC-17 definitions closure · JC-18 Pankosmia transport scratch behavior · JC-19 actor-publication lifecycle · JC-20 zero-trust intake rejection · JC-21 the structural action (all-or-nothing, dispositions) · JC-22 structural lineage + pending propagation · JC-23 sealed action segments (container, filenames, immutability, containment) · JC-24 staged-intent republication · JC-25 vrs first-value register · JC-26 pin golden projection · JC-27 removal semantics per surface · JC-28 actor binding + same-actor rule · JC-29 book generations (causal quarantine) · JC-30 checkpoint regeneration set + divergence · JC-31 value grammars, two independent layers · JC-32 base semantics, conservation + exclusivity (property) · JC-33 the OBS story kind (§10): frame registers, story targets + the §5.2 story key, the §10.6 pin slots, checkpoint story inputs, version policy (the file-level OBS checks are the `OBS` group of `validate.mjs`) · JC-34 renumbered verses: one action, re-key with re-review, collisions, span membership, old data over every record kind + checkpoint mirror · JC-35 team sync round 1 (D98): each check name starts with its guarantee id (`[G1]`…`[G7]`) and reads the shared fixture `conformance/fixtures/team-sync/`; the name action (v: 3 only, the Door43 username rule, one actor names only itself, the writer and the action refuse a second name, the fold reports a teammate's second name in `namesRejected`)
docs/DECISIONS.md:2669:the id, for example `[G1] keeps every own file`, so `git grep "\[G1\]"` lists every proof.
docs/RISKS.md:19:| 11 | Power loss or a kill during the swap of a sync (G8). The swap is four server calls: copy, delete, copy, delete. A copy on the server is a copy and a delete, not one rename (#673). A stop between two calls, or in one call, can leave two copies or a part folder | The ops log saves each swap phase before its step. A recovery goes forward only when nothing can have changed the live project since that phase. A server failure at `swap.copy-previous` goes back at once, and the project stays as it was. A server failure at a later phase runs the rest of the swap once more. If that also fails, the record stays open, and the project takes no open, no edit and no sync (`sync.swap-pending`) until `recover()` finishes the swap at the next start. No sync starts, and no project opens or takes an edit, until `recover()` loads the ops log at that start (`opslog.not-loaded`); a restart loads it again. As a second guard, the sync saves the live mark (the greatest journal segment name) when the swap begins. At `swap.copy-previous` or `swap.delete-project`, a recovery that finds a greater name goes back and keeps the live project. After a go-back at `swap.delete-project`, a live project that is part deleted can fail to open. The full old copy then stays in the previous copy, and no checkpoint deletes it. The next sync gets the own files back from Door43. Each step first deletes a part folder that a stopped copy can leave (`src/data/journal/opsLog.ts`, #676). Proof: the `[G8]` tests in `test/sync/syncOperation.test.ts`: the two kill sweeps, and the three server-failure tests |
docs/RISKS.md:20:| 12 | A sync loses own work (G1): an own journal file or outbox entry from before the sync is not in the project after the sync | The sync core puts each own file in the result byte for byte, or it refuses and changes nothing (`journal/sync.mjs`, R-8.7.7). The sync shell clears an outbox entry only after the copy is live (#676). Proof: the `[G1]` tests in `test/sync/syncCore.test.ts`, `[G1] JC-35` in `conformance/validate-journal.mjs`, and `[G1] after a sync, every own file and outbox entry is in the live project` in `test/sync/syncOperation.test.ts` |
e2e/j17-open-from-door43.spec.ts:192:  test('[G2] one invalid journal file on Door43 refuses the open, and no project is written', TAG, async ({ page }, testInfo) => {
e2e/j26-team-sync.spec.ts:5:// page would mint a new secret and a fourth actor. The [G6] and [G1] tests read only the disk
e2e/j26-team-sync.spec.ts:469:  test('[G6] at the end the three projects have the same project files, and no verse has a conflict', TAG, async ({}, testInfo) => {
e2e/j26-team-sync.spec.ts:487:  test('[G1] every journal file that any translator wrote is on the stand-in\'s main', TAG, async ({}, testInfo) => {
test/conflictReview.test.tsx:104:  it('[G7] lists only verse text: every version of the verse with its text, owner and date; never the check-result conflict', () => {
test/openFromDoor43Dialog.test.tsx:135:  it('[G2] a refusal shows its code, "No project was added", and Ask for help', () => {
test/sync/openFromDoor43.test.ts:117:  it('[G2] open refuses an invalid file', async () => {
test/sync/openFromDoor43.test.ts:319:  it('[G8] a kill after the clone: the next start deletes the clone path and the scratch copy, and the same repository opens again', async () => {
test/sync/openFromDoor43.test.ts:337:  it('[G8] kill sweep after and inside each folder call: the project is whole or not there, and nothing is left behind', async () => {
test/sync/syncCore.test.ts:87:  it('[G1] keeps every own file and outbox entry', async () => {
test/sync/syncCore.test.ts:102:  it('[G1] refuses a changed own file', async () => {
test/sync/syncCore.test.ts:120:  it('[G1] carries a teammate file that Door43 main lost', async () => {
test/sync/syncCore.test.ts:150:  it('[G2] refuses an invalid file', async () => {
test/sync/syncCore.test.ts:173:  it('[G2] refuses a foreign actor.json, a misnamed segment and a segment in another actor folder', async () => {
test/sync/syncCore.test.ts:196:  it('[G3] removes a derived file the fold no longer projects', async () => {
test/sync/syncCore.test.ts:215:  it('[G3] rebuilds with resolve', async () => {
test/sync/syncCore.test.ts:238:  it('[G3] never writes metadata.json', async () => {
test/sync/syncCore.test.ts:271:  it('[G6] same journals same files', async () => {
test/sync/syncCore.test.ts:283:  it('[G7] counts a non-text conflict once', async () => {
test/sync/syncCore.test.ts:298:  it('[G7] an alignment set two ways keeps the newest and is counted once', async () => {
test/sync/syncCore.test.ts:325:  it('[G7] a verse changed two ways appears once in textConflicts', async () => {
test/sync/syncOperation.test.ts:106:  it('[G5] same path and actor', async () => {
test/sync/syncOperation.test.ts:133:  it('[G1] after a sync, every own file and outbox entry is in the live project', async () => {
test/sync/syncOperation.test.ts:144:  it('[G4] retries then stops', async () => {
test/sync/syncOperation.test.ts:167:  it('[G4] a push that is not a fast-forward starts again, and the second try lands', async () => {
test/sync/syncOperation.test.ts:484:  it('[G8] swap kill sweep', async () => {
test/sync/syncOperation.test.ts:510:    console.log(`[G8] kill sweep: ${kills} kill cases, ${swapCalls} swap calls, ${projectGone} with the project folder absent at the kill`);
test/sync/syncOperation.test.ts:513:  it('[G8] swap kill sweep inside each server call (a part copy, a part delete)', async () => {
test/sync/syncOperation.test.ts:529:    console.log(`[G8] kill sweep inside the calls: ${kills} kill cases, ${partial} with a part folder at the kill`);
test/sync/syncOperation.test.ts:535:  it('[G1][G8] a server failure at swap.copy-previous rolls back now: the project stays, and work after it survives a restart', async () => {
test/sync/syncOperation.test.ts:564:  it('[G8] a server failure after the project folder is gone is retried once in the same run, and the sync completes', async () => {
test/sync/syncOperation.test.ts:578:  it('[G8] when the retry fails too: sync.swap-pending, the record stays open, the project cannot open or sync, and the next start finishes it', async () => {
test/sync/syncOperation.test.ts:604:  it('[G8] a sync pressed again after a failed swap, then a restart: one project at the path, and recovery resolves', async () => {
test/sync/syncOperation.test.ts:615:  it('[G8] one record whose recovery throws does not stop the others: it stays open and is reported', async () => {
test/sync/syncOperation.test.ts:628:  it('[G1][G8] killed after swap.copy-previous; the next start cannot load the ops log; the translator works; the third start goes back and keeps that work', async () => {
test/sync/syncOperation.test.ts:675:  it('[G1][G8] killed inside swap.copy-live; the next start cannot load the ops log: the part copy takes no open and no edit; the third start goes forward and nothing is lost', async () => {
test/sync/syncOperation.test.ts:706:  it('[G8] killed after swap.copy-previous, the live project unchanged: the next start goes forward (control)', async () => {
test/sync/syncOperation.test.ts:723:  it('[G8] a sync with no ops log is refused before any request: no scratch copy, no copy call', async () => {
test/sync/syncOperation.test.ts:733:  it('[G8] a kill after the push and before the swap leaves the project as it was', async () => {
test/sync/syncOperation.test.ts:744:  it('[G8] a kill after the clone deletes the clone path and the scratch copy', async () => {
test/verseConflicts.test.ts:122:  it('[G7] lists only verse text: the verse conflict with each head\'s actor and text, never the check-result conflict', () => {
```

One passing test for each guarantee. Each one passed at `c25f2d8` in
`TC4_RIG_PORT=19899 npx vitest run test/sync test/conflictReview.test.tsx test/verseConflicts.test.ts test/openFromDoor43Dialog.test.tsx`
(7 files passed, 1 skipped: the rig integration file, with no rig on 19899; 118 tests passed), or
in the J17 and J26 runs above.

| Id | A passing test |
|---|---|
| G1 | `[G1] keeps every own file and outbox entry` (`test/sync/syncCore.test.ts`); `[G1] every journal file that any translator wrote is on the stand-in's main` (J26) |
| G2 | `[G2] refuses an invalid file` (`test/sync/syncCore.test.ts`); `[G2] one invalid journal file on Door43 refuses the open, and no project is written` (J17) |
| G3 | `[G3] never writes metadata.json` (`test/sync/syncCore.test.ts`) |
| G4 | `[G4] a push that is not a fast-forward starts again, and the second try lands` (`test/sync/syncOperation.test.ts`) |
| G5 | `[G5] same path and actor` (`test/sync/syncOperation.test.ts`) |
| G6 | `[G6] same journals same files` (`test/sync/syncCore.test.ts`); `[G6] at the end the three projects have the same project files, and no verse has a conflict` (J26) |
| G7 | `[G7] counts a non-text conflict once` and `[G7] a verse changed two ways appears once in textConflicts` (`test/sync/syncCore.test.ts`) |
| G8 | `[G8] swap kill sweep` (`test/sync/syncOperation.test.ts`) |

## What the journey does not prove

- The check result key. The fixture's check result is the sample's first translationWords
  record, `a9p2` (the word "apostle" in TIT 1:1). The rig pins `es-419_twl` v18, whose list gives
  that word the id `sda6`. So the UI sets the same word in the same verse, and its register key
  is `dec|translationWords|sda6|tit|1|1|1`, not the key in `cases.json`. The fork has the same
  shape: two check results from the same base, and the newest one wins.
- The pair that changes TIT 1:4. The issue gives the verse to B and C. The fixture's case
  `verse-two-ways` gives it to A and B. The journey follows the issue and uses the key and the two
  texts of the fixture.
- Real Door43. The remote is the `file://` stand-in, and the fake Door43 answers the sign-in.
  The HTTPS push is the subject of #673.
