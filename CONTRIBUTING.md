# Contribute to translationCore 4

This document gives the rules for every contributor — human or AI-assisted. An AI agent
must also read `AGENTS.md`.

## Read these first

1. `README.md` — what the application is, and how to install and test it.
2. `docs/BURRITO-SPEC.md` — the project format. **Normative.**
3. `docs/ARCHITECTURE.md` — what we build and why.
4. `docs/PLATFORM-NOTES.md` — verified platform behaviors that are not evident from the
   API surface. Read it before you touch platform endpoints.

The platform's own documentation lives at
[Pankosmia-Documentation](https://github.com/pankosmia/Pankosmia-Documentation) —
read it for the ecosystem's architecture and conventions. (Remember hard rule 1
below: do not open issues or pull requests there.)

## Which document wins

| Question | The document that wins |
|---|---|
| The project format | `docs/BURRITO-SPEC.md`, proven by the conformance harness |
| Product decisions | `docs/DECISIONS.md` — the decision log; cite decisions as `Dnn` |
| Platform behavior | `docs/PLATFORM-NOTES.md` + `docs/evidence/` records |
| Known risks | `docs/RISKS.md`; cite risks as `Ledger #n` |
| Work items | the GitHub issues, milestones and project board of this repository |

`docs/BURRITO-SPEC.md` is normative. The conformance harness is executable evidence of
the specification. A mismatch between the two blocks merge until both agree — the
specification wins and the harness must be corrected. `npm run verify` reports whether
the implementation passes the current automated checks.

## Prove the claims to yourself

You do not have to trust the documentation. Run the proof:

```bash
npm ci
cd conformance && npm ci && cd ..
npm run prove
```

`npm run verify` runs lint, typecheck, the tests, the build and the docs gate. On a clean
clone, expect <!-- manifest: vitest passed -->828 tests passed and
<!-- manifest: vitest skippedTests -->37 tests skipped [VERIFIED — the two counts are read
from `docs/evidence/manifest.json`, the record of the CI run on a clean clone; that file
names the run's commit, date and Node version; `npm run docs:gate` fails when this
sentence disagrees with it].
A skipped test names the prerequisite that it needs. A skip is not a failure.

## Hard rules

1. **Do not write to upstream.** Do not open pull requests, issues or comments on any
   repository in the `pankosmia` organization, or on any `git.door43.org` organization that
   this project does not own. Send your finding to the project owner instead.
2. **Evidence first.** Tag each claim: `[VERIFIED]` (source read or test executed, with a
   version, a commit hash and a date), `[decided YYYY-MM-DD]` (a decision record), or
   `[PROPOSED]`. Do not assert an untagged assumption.
3. **The specification and the harness change together.** A change to `BURRITO-SPEC.md`
   ships with the matching harness change in the same change set. The harness lives in
   `conformance/` in this repository (published per issue #47, closed 2026-08-14), and CI
   runs it on every pull request.
4. **Do not change the pinned versions.** `usfm-js@3.4.3`, `word-aligner@1.0.3` and
   `word-aligner-lib@1.0.1` are a proven pairing. The conformance harness is the proof.
   Do not run `npm audit fix --force`.
5. **Do not re-propose decided things.** Read `docs/DECISIONS.md` before you propose a
   design change. A decision entry states what we tried, chose and withdrew.
6. **Verify a platform claim before you record it.** Apply the rules in "Verifying a
   platform claim", the final section of `docs/PLATFORM-NOTES.md`. Name the surface that
   you read. Cite the version, the commit hash and the date.

## Pull requests

Before you send a pull request:

1. Run `npm run prove` (or `npm run verify` for the quick subset).
2. Paste the test output into the pull request description.

"Done" means: the acceptance criteria pass, with pasted evidence.

## How work moves

- **Issues** hold work. An issue states its acceptance criteria and its Verify command.
- **Issues are written in plain language — title and body.** Assume the reader has
  never opened the project documents. The title is a plain statement of the work.
  Spell out every internal ID in words, and make each reference a link — to
  `docs/DECISIONS.md`, `docs/LEGACY-IDS.md`, or the file it names. Legacy IDs
  (`I1.2.4`, `D38`, …) go in the body so search still finds them. Never cite an
  internal or private document path.
- **Tracking issues** (label `epic`) group sub-issues.
- **Milestones** are delivery targets. A milestone is one increment.
- **The project board** has one Status field: `Backlog`, `Ready`, `In progress`,
  `Blocked`, `Done`. `Ready` means: the acceptance criteria and the Verify command are
  complete, and nobody is assigned. A `Ready` issue is claimable.

### Claim an issue

Assignment is the claim. If you have write or triage access to this repository, assign
yourself. If you do not, comment "claiming" and a maintainer assigns you. GitHub does not
let you assign yourself without that access. Seven days with no linked activity releases
the claim — a maintainer unassigns, and the issue is claimable again.

An issue is claimable when its board status is `Ready` and nobody is assigned. On the
web, read the `Status` column of the
[project board](https://github.com/orgs/unfoldingWord/projects/6). From the command line,
run `gh issue view <number>`; the `projects:` line shows the status in parentheses. An
issue with no board status is not yet triaged. Ask in a comment before you start it.
[VERIFIED — gh 2.86.0 against the board, 2026-09-04; GitHub's repository roles: triage
or higher assigns issues and applies labels]

### Found a defect while working another issue?

Fix it inline when it is inside the issue's own scope: the same defect class the issue
targets, in the files the issue touches. Say so in the pull request. Otherwise open a new
issue and link it from the pull request. Leave that fix out of the change set.

### Labels

| Label | Meaning |
|---|---|
| `Priority/Critical` … `Priority/Low` | Priority. |
| `needs-rig` | The item needs the Pankosmia development rig. Its acceptance is checked on the rig, not only on a clean clone. The `rig` job in CI runs the rig-backed suites on every pull request. |
| `question` | An open question. Answering it is the work. |
| `upstream` | The item depends on or observes an upstream (Pankosmia / Door43) behavior. |
| `epic` | A tracking issue that groups sub-issues. |
| `good first issue` | A bounded item with a clear verification command. |

Add a label only when a query needs it. Applying a label needs triage access. If you do
not have it, name the label in the issue or pull request body, for example
"needs `needs-rig`". A maintainer applies it.

## Tests that need more than this repository

Two prerequisites are outside this repository:

- **The Pankosmia development rig** on port 19998 — the integration tests and the
  Playwright journey tests need it.
- **A sibling `sample-burrito` checkout** — the three S-0 smoke tests need it.

Without them, the affected tests skip and name what they need. Work that touches the
platform boundary gets the `needs-rig` label. Ask for it in the body if you cannot apply
it. The `rig` job in CI runs the rig-backed suites on every pull request
[VERIFIED — `.github/workflows/rig.yml`, PR #168, 2026-09-04]; a maintainer may also run
them before merge.

## Write a test that reads files

The build plugin `vite-plugin-node-polyfills` (`vite.config.js`) aliases node builtins to
browser mocks. It does so under Vitest too, even with `environment: 'node'`. So
`import fs from 'node:fs'` gives you `null`, and `node:url` gives a browser proxy that
crashes. Get the real builtins from the runtime instead:

```ts
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');
```

Every test in `test/` that reads files uses this pattern. `test/indexer.test.ts` is a
short example. Resolve paths from `process.cwd()`; under Vitest that is the repository
root. [VERIFIED — `vite.config.js` lines 3-6 and 20-24, `vite-plugin-node-polyfills`
0.24.0; a search of `test/` on 2026-09-04 found 28 files with the pattern and none that
imports a node builtin directly]

## Style

- Write documentation in ASD-STE100 Simplified Technical English where you can. Short
  active sentences. One instruction in one sentence. Do not let style change a technical
  fact: keep numbers, versions, commands, paths and quoted labels exactly.
- unfoldingWord is always camelCase.

## License

GPL-2.0-or-later. A contribution is accepted under the same license.
