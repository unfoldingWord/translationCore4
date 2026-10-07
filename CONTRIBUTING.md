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
| User journeys and their end states | `docs/JOURNEYS.md`; cite journeys as `Jn` |
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
clone, expect every test to pass or skip.
A skipped test names the prerequisite that it needs. A skip is not a failure.

No document writes the number of tests that passed (D77) or skipped (D78). Both counts
move with added tests: the passed count moved in 47 of the 325 commits on `main` between
2026-09-05 and 2026-09-20, and the skip count moved four times between 2026-09-12 and
2026-09-21. Read both from the `prove-manifest` artifact of the commit's CI run.

### If your change moves a marked count

The marked counts are the conformance counts. They move when the specification and the
harness change together (BURRITO-SPEC §9). Then `npm run docs:gate` fails because a
marked sentence disagrees with the manifest. Close it like this, in this order:

1. Push your branch with the code change.
2. Open the **push-event** CI run of that commit — the run whose event is `push`, not the
   `pull_request` run. Download its `prove-manifest` artifact.
3. Copy that file to `docs/evidence/manifest.json`, edit the marked counts to match it,
   and commit all of them together.

The committed `docs/evidence/manifest.json` is otherwise refreshed once per milestone, in
the pre-release issue's checklist (the pattern of #260 and #293), so the record keeps a
recent commit, date and Node version without a commit per pull request.

Take the manifest from the push-event run only. A `pull_request` run checks out a temporary
merge commit that GitHub builds for the run, so its manifest records a commit that exists in
no branch and that nobody can check out later.

**A red docs gate on your own machine is not evidence.** `npm run verify` writes a new
`docs/evidence/manifest.json` from your run, and your run is not a clean clone: a local rig
makes the rig-gated tests execute instead of skip, so your counts differ from the recorded
ones and the gate reports a disagreement that does not exist on CI. Read the gate on CI
before you call it pre-existing. To see whether a failure is yours, compare your branch's CI
result with the CI result of `main` at the commit you branched from.

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
   Do not run `npm audit fix --force`. If an audit fix is needed, trial it in a scratch copy
   and confirm these three versions are unchanged before you apply it.
5. **Do not re-propose decided things.** Read `docs/DECISIONS.md` before you propose a
   design change. A decision entry states what we tried, chose and withdrew. If you believe
   a decision is wrong, say so to the owner with evidence. Do not silently build the
   alternative.
6. **Verify a platform claim before you record it.** Do not state what the Pankosmia
   platform does from memory or inference. Apply the rules in "Verifying a platform claim",
   the final section of `docs/PLATFORM-NOTES.md`. Name the surface that you read, and
   confirm the behavior is general, not an artifact of one product's configuration or of
   your own test setup. Cite the version, the commit hash and the date: a hash alone does
   not say whether the code is current. A behavior that you observed only on your own rig
   is a rig finding until it reproduces elsewhere (`docs/PLATFORM-NOTES.md` entry #26(a)).

## Pull requests

Before you send a pull request:

1. **Do a self-review.** The reviewer must not be the first person to read and run your
   change.
   - Read the full diff against each acceptance criterion and each Interruptions answer.
   - Run the built feature the way a user does, for each criterion and each Interruptions
     answer. Record what you saw: the command, the output or the screenshot. Passing tests
     do not replace this step. If you cannot run the feature, say why in the pull request.
     A criterion or an answer that you cannot run is not met.
   - Remove from the pull request each claim that you did not see happen.
   - Check these cases in the diff:
     - **Failure is not success.** Find each write, read or wait that you add. Find what
       happens when it throws, returns false or gets no answer. Keep "done", "no" and
       "no answer" separate.
     - **Inputs that differ.** For each filter, group or "pick first", try two inputs
       that differ and one that is empty.
     - **Read again after `await`.** A value that you read before an `await` can change
       before you use it.
     - **Test data that differs.** Give the fixtures one case where a field is empty and
       one where two inputs disagree.
     - **Parsed means stored.** Each value that you read from input is stored, or the
       pull request says why not.
2. **Record each point that was decided during the work.** Write it in a comment on the
   issue or in `docs/DECISIONS.md`. Link the record from the pull request description.
3. Run `npm run prove` (or `npm run verify` for the quick subset).
4. Paste the test output and the self-review results into the pull request description.

"Done" means: the acceptance criteria and the Interruptions answers pass, with pasted
evidence.

### Review findings

Adopted 2026-09-06, after Increment 4. One pull request ran 37 review rounds
(https://github.com/unfoldingWord/translationCore4/pull/116); 99 of the 252 commits on
`main` between 2026-08-26 and 2026-09-06 were review-fix commits. An adversarial reviewer
always finds something. These three rules end the loop.

1. **A finding is fixed in the pull request only if it fails one of two tests:** it fails
   an acceptance criterion of the issue, or it breaks a rule in this document. Any other
   finding gets one line in the pull request, as rule 3 says. Triage every finding
   against these two tests before the first fix commit.
2. **A pull request gets at most five review rounds, plus one grace round.** A round is
   one reviewed commit. This matches the review bench's cap (`uwreview`). After the grace
   round, the pull request is ready to merge, or it goes to the owner: the owner merges
   it, sends it back to the issue for a new definition, or allows more rounds in a
   comment on the pull request.
3. **A finding becomes an issue only if all three of these are true.** Otherwise it gets
   one line in the pull request: "dropped: <reason>". This applies to every finding,
   whatever severity the reviewer gives it.
   - **It reproduces.** Written steps go from a real user action or input to a wrong
     result, data loss or a security problem. "This could happen if …" is not enough.
   - **No open issue covers it.** If an open issue covers the same area, add the finding
     to that issue as a comment. Do not open a new issue.
   - **The owner agrees to track it.**

   If all three are true, the line is "filed as issue N" or "added to issue N".

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
  `Blocked`, `Done`. `Ready` means: the acceptance criteria, the Verify command, the
  Platform reuse section and the Interruptions section are complete, and nobody is
  assigned. A `Ready` issue is claimable.

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

### Before you start work

Added 2026-10-06. The issues for pull requests
[#538](https://github.com/unfoldingWord/translationCore4/pull/538) and
[#540](https://github.com/unfoldingWord/translationCore4/pull/540) answered only some of
the four questions below. Neither said what happens when an input changes partway. The
owner decided the open points while the pull requests were open. Most of their blocking
review findings were on the four questions.

When you claim an issue, read its Interruptions section. Do this before you write
code. The section answers four questions for each flow that has more than one step, or
that waits for a server, a worker or the user:

1. What happens when the user cancels partway?
2. What happens when a step fails or gets no answer?
3. What happens when the user starts a second action while the first is still pending?
4. What happens when an input changes partway, for example the account, the book or
   the model?

A flow with one step and no wait needs one line: "None: one step, no wait."

If the section is missing, or an answer is missing, ask in the issue. Wait for the
owner's answer. Do not choose the behavior yourself.

### Found a defect while working another issue?

Fix it inline when it is inside the issue's own scope: the same defect class the issue
targets, in the files the issue touches. Say so in the pull request. Otherwise leave the
fix out of the change set, and apply the three tests of "Review findings" rule 3: file or
add it to an issue only if all three are true, and link that issue from the pull request.
If they are not all true, say "dropped: <reason>" in the pull request.

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

One prerequisite is outside this repository:

- **The Pankosmia development rig** on port 19998 — the integration tests and the
  Playwright journey tests need it. To set up the rig and the resource cache for the
  journeys from a clean clone, follow "Journeys from a clean clone" in
  [`dev-env/README.md`](dev-env/README.md#journeys-from-a-clean-clone).

Without it, the affected tests skip and name what they need. Work that touches the
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
