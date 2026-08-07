# Pankosmia sync/merge model — as-built, read from source (2026-07-08)

**Why:** upstream guidance (2026-07-08) was that tC4's one-repo integration "hasn't ever worked in the
last decade," described a client-side "copies and merge between three locations so the user's
local repo never has conflicts," and warned that in-repo merge that eats data is a
fireable-incident-level event. Goal: understand the actual model from their code, and answer
concretely whether it handles two translators editing the same book independently.

**Read at:** `core-contenthandler_version_manager` @ `a20c2d7` (2026-04-15); `pankosmia-web`
@ `origin/main` `32562d4` (2026-07-07). Method: read the version-manager client (the git/DCS
UI) + the server git endpoints it calls. All line numbers are at those commits.

## The model (as-built, verified)

Four operations, all client-orchestrated over server git endpoints. Three repo locations:
- **local** — the user's working repo (`<src>/<org>/<repo>` under repo_dir); where the editor writes.
- **downloaded** — a local `file://` mirror of the last DCS download (a git *remote* named `downloaded`).
- **updates** — a disposable scratch repo at `_local_/_updates_/<repo>`.
(Confirmed by upstream own `git remote -v`: `origin` = `https://git.door43.org/...`, `downloaded`
+ `updates` = `file://.../pankosmia_repos/...`.)

**Pull-from-downloaded** — the whole "three-location dance", verbatim in
`core-contenthandler_version_manager/src/pages/PullFromDownloaded.jsx:42-151`:
1. list remotes, find `downloaded`, resolve its local 3-part path (`:44-75`);
2. **copy** downloaded → `_local_/_updates_/<repo>` scratch (`/git/copy/...?target_path=...`, `:78-80`);
3. on the scratch, **add remote `editable`** → the user's local repo (`/git/remote/add/...`, `:91`);
4. **pull `editable` → scratch** = merge the user's local edits *into the scratch copy of downloaded* (`/git/pull-repo/editable/<scratch>`, `:110-111`);
5. **if `has_conflicts`** → show "merge conflicts", **delete scratch, abort** (`:123-131`);
6. else **pull scratch(`updates`) → local** = fast-forward the clean result into the user's repo (`/git/pull-repo/updates/<repoPath>`, `:134-135`);
7. **delete scratch regardless** (`/git/delete/<scratch>`, `:28-40, :144`).

The merge that can conflict happens **only in the disposable scratch**. On conflict the scratch
is deleted and the user's repo is untouched. On success the user's repo only ever fast-forwards.
That is exactly "the user's local repo never has conflicts" — true, by construction.

**Push-to-DCS** (`PushToDcs.jsx:26-45`): plain `git push origin` over https with DCS creds. No
merge; a non-fast-forward push just fails ("could not push") — the user must pull-from-downloaded first.

**Changes view** (`ChangesTab.jsx`): `git status` + `git log` + `add-and-commit` only. No diff, no
resolve. **Server endpoints** all exist at `32562d4` (`git2/mod.rs`): `copy_repo`
(`/git/copy`, uses `copy_dir`), `delete_repo`, `remotes`, `add_remote`, `pull_repo`, `push`.
`pull_repo` returns `has_conflicts` in its JSON (`pull_repo.rs`), and its net gate only blocks
`^(https?|ssh)://|git@`, so `file://` local remotes run offline.

## The crux: two translators editing the same book independently?

**Verdict: it AVOIDS corruption but does NOT resolve — concurrent same-book work has no path
through the tool.** Concretely, when translator B integrates after A has published to DCS, B's
"pull-from-downloaded" merges A's published edits with B's local edits *in the scratch*:
- edits in **different, non-adjacent** parts of the file → git line-merge auto-resolves → clean → fast-forwards into B's repo. Both survive.
- edits to the **same or adjacent** lines → **git conflict → `has_conflicts` → abort + delete scratch + "merge conflicts"**. B is left pristine but **stuck**: cannot integrate, cannot push, with **no in-app way forward**.

**There is no conflict-resolution UI, no review/choose step, no locking, and no rebase anywhere
in the client ecosystem** — the sole `conflict` handler is the abort at `PullFromDownloaded.jsx:123`
(grep of the full clone tree for `conflict|resolve|lock|rebase|mergetool|three-way` returns only
that abort). So the model is **conflict-avoidance** (never corrupt), not **conflict-resolution**
(never block). It fits a largely sequential / one-writer-at-a-time workflow; for genuinely
concurrent same-book translation — where overlap is normal — a non-technical translator hits a
dead end. This is the decade-long "hasn't worked" that upstream is describing: not a bug, a model limit.

## What's proven vs. not

- **Proven (read in their source):** the three-location transport, the conflict→abort→pristine
  guarantee, plain-push-to-DCS, the absence of any resolver/locking. Endpoints exist and behave
  as the client assumes.
- **Not claimed:** their exact download/clone bootstrap (how `downloaded` first gets configured)
  wasn't read end-to-end; not needed for the verdict. The `has_conflicts` field is read at the
  response top level in the JSX while the server nests it — a possible client bug in *their*
  code; irrelevant to the design and not ours to audit.

## 2026-07-10 correction: implication for tC4

The scratch principle is excellent and remains adopted: merge where failure can be discarded, and
never expose the user's working repo to a conflicted index. The 2026-07-08 implication above was
otherwise incomplete. It said "sync only journal files" without defining how, while the normative
checkpoint writes and commits regenerated USFM, metadata, sidecars, resources, and settings and
the server's `add-and-commit` stages `.`. A real-git A1 → B1/main advances → A2-without-receive
reproduction conflicts on the full working history. J18 only used journal-only repositories and
therefore did not prove the missing publication mechanism.

The corrected topology (BURRITO-SPEC §8.7; J19) is:

- Keep a full, conforming working projection for the UI and local recovery.
- Keep a separate persistent `actor-<actorId>` publication history whose commits modify only that
  actor's journal directory. Push this branch; never push the working projection as a contribution.
- Integrate an **explicitly named** actor branch in disposable scratch, then rescan, fold,
  regenerate, validate, commit, and fast-forward main.
- Receive by building and validating a replacement from current main + the local actor publication
  history, then swap; never merge advanced main into the divergent full working projection.

Public `pull-repo` at `32562d4` is not an explicit branch API: it downloads all refs and merges the
commit exposed by `find_reference("FETCH_HEAD")`. A direct git2 0.20.4 probe with local heads
`actor-a` and `main` returned `actor-a` only because that ref was the first FETCH_HEAD entry.
Ref-ordering is not a safe contract. Upstream reports an existing merge route (2026-07-10); the
plan now requires identifying and executable-testing that route against the named-branch,
no-mutation-on-conflict contract. If it is not released, the prepared PR-2 remains the reference.

J19 proves five facts: publication commits are path-isolated; A1 and B1 integrate cleanly; merging
the full offline working projection conflicts; A2 can be sent after main advances without receiving
B1 and both survive; and later receive succeeds by rebuild-and-swap while the old working repo stays
untouched. J20 proves that a clean git merge is still rejected if it changes a shared file, edits a
foreign actor stream, or rewrites accepted journal bytes, with main byte-identical after rejection.
The journal remains the conflict-resolution model, but publication isolation, zero-trust intake,
and the explicit branch target are all load-bearing.
