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
npm run verify
```

`npm run verify` runs lint, typecheck, the tests and the build. On a clean clone, expect
441 tests passed and 37 tests skipped [VERIFIED — measured 2026-08-22 on a fresh
clone at commit 7d9b281, with no rig and no sibling `sample-burrito` checkout].
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

1. Run `npm run verify`.
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

Assignment is the claim. A collaborator self-assigns. If you cannot self-assign, comment
"claiming" and a maintainer assigns you. Seven days with no linked activity releases the
claim — a maintainer unassigns, and the issue is claimable again.

### Labels

| Label | Meaning |
|---|---|
| `Priority/Critical` … `Priority/Low` | Priority. |
| `needs-rig` | The item needs the local Pankosmia development rig. CI cannot verify it. |
| `question` | An open question. Answering it is the work. |
| `upstream` | The item depends on or observes an upstream (Pankosmia / Door43) behavior. |
| `epic` | A tracking issue that groups sub-issues. |
| `good first issue` | A bounded item with a clear verification command. |

Add a label only when a query needs it.

## Tests that need more than this repository

Two prerequisites are outside this repository:

- **The Pankosmia development rig** on port 19998 — the integration tests and the
  Playwright journey tests need it.
- **A sibling `sample-burrito` checkout** — the three S-0 smoke tests need it.

Without them, the affected tests skip and name what they need. Work that touches the
platform boundary gets the `needs-rig` label; a maintainer runs the rig-backed suites
before merge.

## Style

- Write documentation in ASD-STE100 Simplified Technical English where you can. Short
  active sentences. One instruction in one sentence. Do not let style change a technical
  fact: keep numbers, versions, commands, paths and quoted labels exactly.
- unfoldingWord is always camelCase.

## License

GPL-2.0-or-later. A contribution is accepted under the same license.
