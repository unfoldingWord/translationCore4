# Instructions for AI agents

Read `CONTRIBUTING.md` first. Every rule there binds you. The rules below are additions
for agents — they exist because an agent broke each one at least once in this project.

## Ground truth

`npm run verify` reports whether the implementation passes the current automated checks.
`docs/BURRITO-SPEC.md` is normative; the conformance harness is executable evidence of it,
and a mismatch between the two blocks merge until both agree. When your reasoning and a
test result disagree, the test result wins.

## How to test

Added 2026-09-25 by the owner.

1. **Do not write a unit test after you write the code.**
2. **Use E2E tests as the only test method when you can.** The E2E tests are the
   Playwright journeys in `e2e/`. Use them to verify that complex features work. At the
   end of each E2E test, produce an artifact that can be verified and that each run
   produces again in the same way.
3. **If you must test a part of the system in isolation, write down all the ways that it
   can fail first.** Then write the code.

## Do not invent test inputs

Source every test input from the system under test — its catalogue, its configuration, or
its discovery endpoint. Do not construct a plausible-looking identifier from memory.

Run a negative control first: feed one deliberately-invalid input. If the invalid input
and your "valid" input fail in the same way, your input is wrong — not the system.

## Verify before you claim

Do not state what the Pankosmia platform does from memory or inference. Apply
"Verifying a platform claim", the final section of `docs/PLATFORM-NOTES.md`:

1. Name the surface that you read, and confirm the behavior is general — not an artifact
   of one product's configuration or of your own test setup.
2. Cite the version, the commit hash and the date. A hash alone does not say whether the
   code is current.

A behavior that you observed only on your own rig is a rig finding until it reproduces
elsewhere. `docs/PLATFORM-NOTES.md` entry #26(a) records what happens when this rule is
skipped.

## Do not touch the pinned versions

`usfm-js@3.4.3`, `word-aligner@1.0.3`, `word-aligner-lib@1.0.1`. The exact pairing is
behavioral proof. Do not run `npm audit fix --force`. If an audit fix is needed, trial it
in a scratch copy and confirm these three versions are unchanged before you apply it.

## If you change BURRITO-SPEC section 8 or section 10, run the normative gate

```bash
node conformance/normative/check.mjs
```

Every normative rule in section 8 (the journal) and section 10 (the OBS project kind)
carries an `[R-x.y.z]` id, and every id must be claimed inside a LIVE check's name —
`[covers R-8.1.5]`. Claims live in `conformance/validate-journal.mjs` and
`conformance/validate.mjs`; the gate reads both. The gate fails on any uncovered
rule, any claim that names a rule the spec no longer states, and any duplicate
id. A commented-out check loses its claim.

If you add or reword a rule, add or update its check in the same change set (§9).
**Do not tag a check because its name sounds similar.** The check must fail when
the rule is violated. Counting look-alike checks is how the suite once reached
306 green checks while five blocking defects went unnoticed [VERIFIED — pull
request #75, review of 2026-08-17].

## Read the decisions before you propose

`docs/DECISIONS.md` holds the decision log. A recorded decision is not open for a new
proposal. If you believe a decision is wrong, say so to the owner with evidence — do not
silently build the alternative.

## What "we use Pankosmia" means

Three decisions are easy to read as one. Keep them apart.

**1. tC4 uses the Pankosmia platform.** The product is one client on the `pankosmia-web`
server (path B, [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) §1 "Why one client"). The
server keeps the git-backed storage, the Scripture Burrito metadata, the authenticated DCS
download proxy, versification, i18n and the 3-OS packaging. tC4 does not rebuild those. The client registers for the
`textTranslation` flavor and is served at `/clients/uw-tc4`.

**2. tC4 does not ship the local prototype.** The product repository is
`github.com/unfoldingWord/translationCore4`. The `uw-tc4/` directory in the planning
workspace stays a local prototype and carries no design weight
([D24(b)](docs/DECISIONS.md)). Upstream clones under `upstream/` are read-only reference.

**3. [D29](docs/DECISIONS.md) and [D33](docs/DECISIONS.md) govern HOW the platform's client
library is adopted.** D29: adopt the `pankosmia-rcl` **contexts only** — no `Pan*` visual components, all surfaces are our own
designs. D33: mount `Spa` + `AppWrapper` as an invisible infrastructure shell, under the
five bounds that keep it UX-neutral, with the fallback guard to a thin tC4 provider. D72
adds the working rule for new build paths: where Pankosmia provides a provider that can
serve behind our own interface (a context, an endpoint, a download function), use it;
where it provides chrome, we design our own.

So "no `pankosmia-rcl` visual components" does NOT mean "we left the platform", and no
`pankosmia-rcl` entry in `package.json` does not mean the decision changed. The dependency
is not installed yet [VERIFIED — `package.json` read at commit 3e2c39f, 2026-09-16, 12
dependencies, none from Pankosmia]: **when** the contexts and the
notification stream get adopted, and by which path, is open question
[#222](https://github.com/unfoldingWord/translationCore4/issues/222). Do not decide
that in passing while you build something else.

## Look at Pankosmia before you write code

Added 2026-09-26 by the owner. In #19 (pull request #418), an agent wrote its own USFM
alignment weave. The Pankosmia checking client already had one: it calls a repo-local copy
of `AlignmentHelpers.addAlignmentsToTargetVerseUsingMerge`, and the pinned `word-aligner-lib`
exports the same function. The agent's weave deleted footnotes, and that function keeps them.

1. **Read the issue's "Platform reuse" section first.** It names the Pankosmia code and
   the pinned uW libraries that already do the task, or it says what was searched.
2. **If the issue has no such section, search before you plan.** Search the
   [`pankosmia` organization](https://github.com/pankosmia) (for example
   `gh search code "<function or format name>" --owner pankosmia`), the reference clones
   under `upstream/` when you have them, and the pinned libraries: `usfm-js`,
   `word-aligner`, `word-aligner-lib`, `bible-reference-range`,
   `string-punctuation-tokenizer`. This applies to alignment, USFM, checking, resource
   and versification code.
3. **Use what exists behind our own interface.** Call the library function, or follow the
   Pankosmia client's method. Do not copy what our decisions forbid: a write of alignment
   markup into the project (I-1), or a `pankosmia-rcl` visual component (D29).
4. **Say what you found in the pull request.** Name the Pankosmia code that you used. If
   you did not use it, say why. "I did not search" is not an acceptable reason.

## Before you hand off a pull request

Added 2026-09-23. Each rule below comes from a pull request that a maintainer had to fix
after the agent reported it ready: [#354](https://github.com/unfoldingWord/translationCore4/pull/354)
and [#391](https://github.com/unfoldingWord/translationCore4/pull/391).

1. **Prove the last commit.** After each merge or rebase from `main`, run
   `npm run typecheck` and the tests again. A merge can bring in new code that uses a
   name that your branch changed. In #391, the merge added a call to a helper that the
   branch removed, and typecheck failed on CI.
2. **Read CI on the last commit before you say "ready".** A red check is your work to
   fix. Do not write "CI is the merge gate" and stop. If `npm run verify` fails on your
   machine, compare with `main` at your base commit (`CONTRIBUTING.md`, "Prove the
   claims to yourself").
3. **Test every user of a shared value.** Before you change a shared path, helper, or
   default, find each user with `rg`. Run the tests of each user. In #391, a change to
   `TC4_ROOT` in `e2e/helpers/rig.ts` affected the 17 journey files that import it.
   Only J1 ran. 10 of those files call a helper that read a path that did not exist.
4. **CI does not run the Playwright journeys.** The `rig` job runs the rig-backed Vitest
   and conformance suites only (`.github/workflows/rig.yml`, #185). If your change
   touches `e2e/`, `dev-env/` or `playwright.config.ts`, run each affected journey and
   paste the output. If you cannot run a journey, name it in the pull request body as
   "not run".
5. **Use only paths inside this repository.** A maintainer's checkout sits inside a
   planning workspace that holds copies such as `../sample-burrito` and `../dev-env`. A
   path above the repository root works on that one machine only. Use
   `conformance/sample-burrito` and this repository's `dev-env/`.
6. **Run what you build.** If you generate or copy a file that runs later, run it or
   parse it (`node --check`) in a test. In #354, a generated entry point had a syntax
   error. Declare each package that a script imports in `package.json`. In #354,
   `esbuild` was not declared.
7. **Build what the issue asks.** If you think the issue needs more, ask in the issue
   before you build it. In #391, the issue asked for a health probe. The pull request
   also added a process-lease system, and one of the four defects came from it. Do not
   edit the scope or the acceptance criteria of an issue to match your work. In #324,
   seven such edits replaced the owner's criteria, and the change grew from one file to 21.

## Skips are not failures

Some tests skip on a clean clone. Each names its
missing prerequisite (the Pankosmia rig). Do
not "fix" a skip by inventing the missing data, and do not report a skip as a defect.

## Shell discipline

Use absolute paths in shell commands. The working directory persists between calls, and a
leftover `cd` makes relative paths resolve in the wrong tree. Do not pipe verification
output through `head` or `tail` and then reason from the truncated result.

<!-- graft:start -->
## Graft — repo context graph

`graft/` holds small linked markdown nodes that explain each system and carry
exact file:line spans. It is a LOCAL cache: gitignored and regenerable with
`graft build`, so it is ABSENT in a fresh clone and in CI.

**Check first.** If `graft` is on PATH and `graft/` exists, prefer it — it is
faster and cheaper than grepping. If either is missing, that is the normal state
of a fresh clone, not a fault to report or work around: use ripgrep and read the
files directly, and treat nothing in this section as a prerequisite. Never
`npm install graft` to satisfy this section — the npm package of that name is
unrelated software.

When the graph is present: for understanding how something works, finding where
code lives, or scoping a change, get context from it before grepping. Re-ask
freely (it's cheap) and reuse literal identifiers you already have (symbol,
error string, file name) as the query. New to this repo? Run `graft map` first —
a token-budgeted orientation (dir clusters, hubs, hotspots), no LLM, no key.

- Run `graft ask "<your question>" --source` → ranked nodes with the relevant
  code spans inlined (each hit's ≤8-line crux by default; `--full` for whole
  definitions when the crux isn't enough). Match the tool to the task shape:
  for understanding or editing, the top node IS the answer — cite its
  `covers:` file:line spans and edit straight from `--source`. For
  exhaustive tasks ("every occurrence / every caller of this pattern"), ranked
  results are top-N, not complete — run `graft grep "<literal>"` instead
  (exhaustive over indexed files, grouped by enclosing symbol), falling back
  to raw `grep -rn` only for unindexed files.
- `graft skeleton <file>` → every definition's signature + span, ~10× cheaper
  than reading the file; use it to skim an API surface.
- `graft callers <symbol>` gives precomputed, exact edges — who calls this.
  Add `--direction out` for what it calls, or `--depth N` to walk
  transitively for the full blast radius. For structural questions, skip
  ranking and use this directly.
- Or browse: `graft/INDEX.md` lists every node; follow the links.
- Monorepos and folders of multiple repos rank fairly across sub-projects —
  hits carry `[scope/]` labels naming which one they're from. Narrow with
  `graft ask "<task>" --in <scope>/` once you know where you're working.

If a returned span is truncated ("+N more lines"), open the file at that exact
range before finalizing. While the graph is present, prefer a node's file:line
pointer over re-reading a whole file; when it is absent, read what you need.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
