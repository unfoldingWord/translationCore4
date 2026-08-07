# Transport rig findings — journal sync over real HTTP endpoints (2026-07-18)

**Setup:** `dev-env/` — pankosmia-web pinned to the latest published crate (`=0.17.0`,
released 2026-07-17; identical version to upstream HEAD `155e4c4`), booted against an isolated,
deterministic workspace. Suite: `sample-burrito-validation/validate-transport.mjs`
(`npm run validate:transport`). **Result: 10/10.** Every git transport operation runs through
server endpoints (`/git/copy`, `/git/remote/add` with local `file://` targets, `/git/pull-repo`,
`/git/add-and-commit`, `/git/delete`, `/burrito/ingredient/raw` writes); git/fs access in the
suite is assertion-only.

## Question answered (OPEN-QUESTIONS #23): named-branch integration

- **Multi-branch publication repos are UNSAFE, measured:** with branches `aaa-branch` and
  `zzz-branch`, `pull-repo` merged `aaa-branch` **regardless of which branch the source repo had
  checked out** (probes with HEAD on each). FETCH_HEAD selection is ordering-steered, not
  HEAD-steered — confirming the earlier libgit2 probe, now through the HTTP API itself.
- **Single-branch publication repos make `pull-repo` deterministic** — with exactly one head
  there is nothing to mis-select. The full J19 lifecycle passes over HTTP on this topology
  (T3), so **named-branch integration is achievable with existing endpoints and no upstream
  change**: one publication repo per actor, single branch, integrated via
  copy → `remote/add` → `pull-repo` → validate → regenerate → commit → `pull-repo` fast-forward
  into main. (For receive-from-DCS, `clone-repo?branch=` provides the per-branch
  materialization; https-only — its URL is hardcoded `https://`.)

## Lifecycle verified end-to-end over HTTP (T3 = J19 semantics)

A1 integrates → B1 integrates while A is offline → **A publishes A2 without ever receiving
B1** → clean integration, A2+B1 both survive → the counterexample (integrating A's full
working projection) conflicts with main untouched → receive rebuilds a replacement from main
while the old working repo stays untouched until swap. Zero-trust intake (T4 = J20 semantics)
rejects shared-file changes, foreign-actor-stream edits, and rewrites of accepted journal
bytes, with main byte-identical after every rejection.

## Platform findings (new platform notes)

1. **`add-and-commit` panics on a repo with no commits** (`refs/heads/<branch>` not found,
   `add_and_commit.rs:50` at 0.17.0). Real clients never hit it (the `new-*` endpoints create an
   initial commit); anything else creating repos must too. → PLATFORM-NOTES #20.
2. **After a NORMAL `pull-repo` merge, the working tree is not trustworthy.** Files *added* by
   the merge exist in the merge commit but not on disk; files *modified* by the merge can remain
   stale on disk (`normal_merge` ends with a non-force `checkout_head(None)` against a stale
   index; the fast-forward path force-checkouts, which is why FF cases behave). A subsequent
   `add-and-commit` (which sweeps the worktree) **commits the deletion of merge-added files.**
   The platform's own three-location flow never trips this (it never commits inside the scratch
   after a normal merge). → PLATFORM-NOTES #21. Consequence adopted into the integration protocol:
   **the integrator never trusts the merged worktree** — it writes the validated union of
   journal streams explicitly via ingredient writes before regenerating and committing, and
   intake validation reads bytes from the merge *commit*, never the worktree. This is also the
   correct zero-trust posture independent of the bug. (Candidate upstream finding; disposition
   routed through the project owner.)
3. `0.17.0` boot requires `app-resources/product/product.json` (`short_name`, `name`,
   `version`, `datetime`) — new since 0.16.x.
4. Ingredient writes with `update_ingredients` 500 if `metadata.json` does not satisfy the
   server's metadata structs (the round-trip of PLATFORM-NOTES #5) — fixtures need schema-valid
   metadata.

## What this does NOT claim

DCS push/receive over a real network partition is not exercised (local `file://` transport is
the platform's own offline path); the Phase-2 app components remain unbuilt (M4). The rig is
the standing acceptance harness for that future sync engine.
