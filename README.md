# translationCore 4

translationCore 4 (tC4) is a desktop application for Bible translation. The goal is one
application for the full translation loop: draft, check and publish, on one stored text.

tC4 is a client for the Pankosmia platform. One project is one Scripture Burrito git
repository. That repository holds the translation text, the word alignments and the
checking decisions together. The application does not export or import between stages.

## Status

**Version 4.0.0-alpha.2 (pre-release).** In development toward the **v4.0.0 pilot
release, October 16, 2026** — the plan is `docs/ROADMAP.md`; pre-releases are on the
[releases page](https://github.com/unfoldingWord/translationCore4/releases).

Do not use tC4 for production translation work.

| Function | State |
|---|---|
| Draft | Built. Create a project, add books, edit verses. |
| Check | Built. Check a book against the translation helps; edit and re-review. |
| Align | Built. Align a verse; carry alignments over an edit. |
| Publish | Not built. |
| Sync with Door43 | Resource download at pinned versions is built. Push is not built. |

## What the application will do

- **Draft** — write the translation beside the source texts and the translation helps.
- **Check** — run translationWords, translationNotes and word-alignment checks against
  the drafted text. The checks read the same stored text.
- **Publish** — export USFM with the alignments included, and print-ready output.
- **Sync** — get resources from Door43, and send work to Door43. Between syncs, the
  application works offline.

## Requirements

- Node.js 22
- npm

## Install and test

Do the steps that follow:

1. Clone this repository.
2. Type this command: `npm ci`
3. Type this command: `npm test`

Expect this result on a clean clone: **424 tests passed, 37 tests skipped**
[VERIFIED — measured 2026-08-22 on a fresh clone of this branch at commit 04e0e67,
with no Pankosmia rig running and no sibling `sample-burrito` checkout].

The `.npmrc` file sets `legacy-peer-deps=true`. This setting is necessary.
`word-aligner@1.0.3` declares a `usfm-js ^2` peer dependency, but the proven pairing is
`usfm-js@3.4.3`. Do not change these versions. The conformance harness proves the pairing.

## Other commands

| Command | Action |
|---|---|
| `npm run dev` | Start the development server on port 5199. |
| `npm run build` | Build the client. |
| `npm run lint` | Run ESLint. |
| `npm run typecheck` | Run the TypeScript compiler with `--noEmit`. |
| `npm run verify` | Run lint, typecheck, test and build. |
| `npm run test:e2e` | Run the Playwright journey tests. See the limit below. |

## Tests that this repository cannot run alone

37 tests skip on a clean clone. They skip; they do not fail. Each skipped test names the
prerequisite that it needs.

Two prerequisites are outside this repository:

- **The Pankosmia development rig** on port 19998. The integration tests and the
  Playwright journey tests (`npm run test:e2e`) need this server.
- **A sibling `sample-burrito` checkout.** The three S-0 smoke tests need it. The
  conformance harness and its sample project now live in `conformance/` in this
  repository (issue #47). The S-0 test code still reads the sibling path
  (`../sample-burrito`), so the sibling-checkout instruction still applies to the S-0
  tests until a code PR updates that path.

The continuous-integration workflow does not supply either prerequisite. CI runs lint,
typecheck, test, build and the dependency audit, plus the conformance suite in
`conformance/` (generate + validate:all).

## Repository layout

| Path | Contents |
|---|---|
| `src/` | The client. `src/data/` holds the typed HTTP layer and the store. |
| `test/` | Unit and integration tests (Vitest). |
| `test/fixtures/` | Pinned test data. Read `test/fixtures/README.md` for the source of each file. |
| `e2e/` | Journey tests (Playwright). |
| `conformance/` | The conformance harness and the reference `sample-burrito/` project. Read `conformance/README.md` and `conformance/LICENSE-CONTENT.md`. |
| `rig/` | Client registration files for the development rig. |
| `public/` | Static assets. |
| `docs/` | The project documents. See the map below. |
| `dev-env/` | The local Pankosmia server rig. Read `dev-env/README.md`. |

## The documents

| Question | Read |
|---|---|
| What is the project format? | `docs/BURRITO-SPEC.md` — **normative** |
| What do we build, and why? | `docs/ARCHITECTURE.md` |
| What does the platform actually do? | `docs/PLATFORM-NOTES.md` (verification rules are its final section) |
| What was decided, and when? | `docs/DECISIONS.md` — cite decisions as `Dnn` |
| What are the known risks? | `docs/RISKS.md` — cite risks as `Ledger #n` |
| What proves a claim? | `docs/evidence/` — dated measurement records |
| What is the Phase-2 journal design? | `docs/BURRITO-SPEC.md` §8 + Appendix A — the journal WRITE side ships in 4.0.0 (D47); the fold/sync features stay Phase 2 |
| What does `D28`, `OQ#17`, or `Ledger #2` mean? | `docs/LEGACY-IDS.md` — the reference-ID decoder |
| Where does work live? | The GitHub issues, milestones and project board of this repository |

## Run against a local server (optional)

The client runs against a Pankosmia server. `dev-env/` builds one, pinned to
pankosmia-web 0.18.5 (`99fd9be`). Read `dev-env/README.md` for the steps. Without it,
the rig-backed tests skip and the development server serves the client alone.

## Contribute

Report a defect or a request in the GitHub issues of this repository.

Before you send a pull request:

1. Run this command: `npm run verify`
2. Put the test output in the pull request.

Two rules apply to code that speaks to the platform:

- Verify a claim about platform behavior against source at a recorded commit. Record the
  version, the commit hash and the date.
- Do not open pull requests, issues or comments on any repository in the `pankosmia`
  organization. Send your finding to the project owner instead.

## License

GPL-2.0-or-later. Read the `LICENSE` file.

This work is based on an earlier work by Wycliffe Associates, released under the ISC
license.
