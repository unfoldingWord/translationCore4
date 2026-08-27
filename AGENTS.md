# Instructions for AI agents

Read `CONTRIBUTING.md` first. Every rule there binds you. The rules below are additions
for agents — they exist because an agent broke each one at least once in this project.

## Ground truth

`npm run verify` reports whether the implementation passes the current automated checks.
`docs/BURRITO-SPEC.md` is normative; the conformance harness is executable evidence of it,
and a mismatch between the two blocks merge until both agree. When your reasoning and a
test result disagree, the test result wins.

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

## If you change BURRITO-SPEC section 8, run the normative gate

```bash
node conformance/normative/check.mjs
```

Every normative rule in section 8 carries an `[R-x.y.z]` id, and every id must be
claimed inside a LIVE check's name in the journal suite — `[covers R-8.1.5]`. The
gate fails on any uncovered rule, any claim that names a rule the spec no longer
states, and any duplicate id. A commented-out check loses its claim.

If you add or reword a rule, add or update its check in the same change set (§9).
**Do not tag a check because its name sounds similar.** The check must fail when
the rule is violated. Counting look-alike checks is how the suite once reached
306 green checks while five blocking defects went unnoticed [VERIFIED — pull
request #75, review of 2026-08-17].

## Read the decisions before you propose

`docs/DECISIONS.md` holds the decision log. A recorded decision is not open for a new
proposal. If you believe a decision is wrong, say so to the owner with evidence — do not
silently build the alternative.

## Skips are not failures

37 tests skip on a clean clone. Each names its missing prerequisite (the Pankosmia rig,
or a sibling `sample-burrito` checkout). Do not "fix" a skip by inventing the missing
data, and do not report a skip as a defect.

## Shell discipline

Use absolute paths in shell commands. The working directory persists between calls, and a
leftover `cd` makes relative paths resolve in the wrong tree. Do not pipe verification
output through `head` or `tail` and then reason from the truncated result.

<!-- graft:start -->
## Graft — repo context graph

This repo is indexed in `graft/`: small linked markdown nodes that explain each
system and carry exact file:line spans, kept in sync with the code through git.

For ANY task here — understanding how something works, finding where code lives,
or scoping a change — get context from the graph before grepping or opening
source files. Re-ask freely (it's cheap) and reuse literal identifiers you
already have (symbol, error string, file name) as the query. New to this repo?
Run `graft map` first — a token-budgeted orientation (dir clusters, hubs,
hotspots), no LLM, no key.

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
range before finalizing. Only open source files when a node genuinely lacks a
needed detail, and then at the exact file:line the node points to — never
re-read whole files.

After big code changes, refresh the graph with `graft build` (deterministic,
no API key, $0).
<!-- graft:end -->
