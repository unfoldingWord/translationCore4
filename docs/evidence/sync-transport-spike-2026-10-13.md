# Sync transport spike (#673), 2026-10-13

Issue: [#673](https://github.com/unfoldingWord/translationCore4/issues/673), layer 3 of epic
[#24](https://github.com/unfoldingWord/translationCore4/issues/24). This record gives the
transport contract for #676, #677 and #681.

**Surface.** A rig on port 19673, from the worktree of branch `issue-673-sync-transport-spike`.
`GET /api/version` answered `"pkg_version":"0.18.15"`. The binary holds the source path
`pankosmia-web-…/a83725b`. That is the pin in `dev-env/server/Cargo.toml`. Source reads are
`git show a83725b:<path>` in the read-only mirror `upstream/pankosmia-web`. The freshness check
(`scripts/upstream-freshness.zsh`, 2026-10-13) gives upstream `main` as 0.19.2 (bf0a5d3).
`clone_repo.rs`, `push.rs`, `copy_repo.rs`, `pull_repo.rs` and `list_local_repos.rs` have no
change from a83725b to bf0a5d3 (`git diff --stat`, empty). All routes mount
under `/api`. The citation for every claim here is
`[VERIFIED — pankosmia-web 0.18.15 (a83725b, 2026-10-13)]`, with the surface named in the claim.

**How to read the pastes.** `>` is the request. The next line is the body of the reply. `< HTTP`
is the status. The pastes are exact, with two edits only: `<repo_dir>` replaces
`/Users/birch/Development/wt/issue-673/dev-env/state/work/repos`, and `<tmp>` replaces the
session scratch directory. The rig starts offline (PLATFORM-NOTES #45), so each run below
starts with `POST /api/net/enable`, unless the run is an offline control.

**Setup of the stand-in remote.** A bare repository `<tmp>/door43.git` (`git init --bare -b main`),
with `main` at `048fcd1`, pushed from a clone of the seeded `_local_/_local_/sample_burrito`.

## The answers

| Question | Answer | Evidence |
|---|---|---|
| Does a full clone, then a move, give a repository that a later push fast-forwards? | Yes. The moved repository keeps `.git`, all history and `origin`. A commit in it pushes as a fast-forward. | Runs 2 and 3 [VERIFIED — pankosmia-web 0.18.15 (a83725b, 2026-10-13), live rig, `file://` remote] |
| Does push to a local repository on the rig work, and must it be bare? | Yes, over `file://`. It must be bare: a non-bare remote answers HTTP 500 `code=BareRepo (-8)` and does not move. | Runs 3 and 5 [VERIFIED — pankosmia-web 0.18.15 (a83725b, 2026-10-13), live rig] |
| What happens when the clone path already exists? | A non-empty directory: HTTP 400 `code=Exists (-4)`, before any network call, and the directory does not change. An empty directory: the clone continues. | Run 1 [VERIFIED — pankosmia-web 0.18.15 (a83725b, 2026-10-13), live rig] |
| What is the rig stand-in for Door43? | A bare `file://` repository for the push, and a never-committed mirror under `_local_/_archive_/` for the clone (copy, then `pull-repo`). | "The rig stand-in" below, run 6 [VERIFIED — pankosmia-web 0.18.15 (a83725b, 2026-10-13), live rig] |

## The transport contract

Three server calls do the transport. A fourth call (`pull-repo`) occurs only in the rig stand-in.

### Call 1: full clone to the fixed path

- Request: `POST /api/git/clone-repo/<host>/<org>/<repo>`, no body. Send no `branch`.
- The server clones `https://<host>/<org>/<repo>` (`clone_repo.rs:60`). It always writes to
  `<repo_dir>/<host>/<org>/<repo>` (`:61-70`). The caller cannot choose the path.
- A trailing `.git` on `<repo>` is removed from the local path only (`:54-59`).
- With `?branch=<b>`, the clone is shallow (`depth(1)`, `:73-80`). Without it, the clone is full
  (`Repository::clone`, `:106`). The sync needs history for a fast-forward, so it sends no `branch`.
  [FLAG: that a push from a shallow clone fails is not tested here; the full clone avoids the question.]
- The full clone checks out the remote's default branch. The shell must read the branch name
  before it commits. [FLAG: inference from libgit2 `Repository::clone`; not run on the rig, because
  the rig has no HTTPS server.]
- The clone sends no credentials (PLATFORM-NOTES #40). Only a public repository clones.
- The clone sets `user.name` and `user.email` to the computer account (`:84-93`, PLATFORM-NOTES #47).
- A failed clone removes the target, but it keeps the parent directories `<host>/<org>/` (run 1).

### Call 2: move the clone to the scratch path

- Request: `POST /api/git/copy/<host>/<org>/<repo>?target_path=<scratch path>&delete_src=true`, no body.
- The server copies the whole directory (`.git` included, `copy_repo.rs:74`), then deletes the
  source (`:120-129`). It is a copy and a delete, not one rename. A stop between the two leaves
  two copies (relevant to G8).
- The source must exist (`:38-43`). The target must not exist (`:51-56`). The server makes the
  target's parent directories (`:58-72`).
- The route has no network gate: it works offline (run 4).
- After the move, the fixed path is free again. The empty parent `<host>/<org>/` stays (run 2).

### Call 3: push

- Request: `POST /api/git/push/<scratch path>`, body
  `{"remote":"origin","cred_type":"https","username":"<u>","pass_key":"<token>"}`.
- The server pushes the checked-out branch to the named remote (`push.rs:110-121`).
- The client must refuse a push with no `username` or `pass_key` first. The server unwraps both
  inside the HTTPS credential callback and panics (`push.rs:83-86`, PLATFORM-NOTES #40, #46).
  `ServerApi.push` already refuses (`src/data/serverApi.ts:525-528`).

### Failure replies and proposed refusal codes

The codes are [PROPOSED]. They go in `journal/report.mjs` (the one home of refusal codes, epic
rule 2), beside the `share.*` family. Tests assert the code, never the text.

| Call | Reply | Match on | Proposed code | Source |
|---|---|---|---|---|
| clone, push | HTTP 401 `{"is_good":false,"reason":"offline mode"}` | status 401 and `offline mode` | `sync.offline` | runs 1, 4 and 7; `clone_repo.rs:30-32`, `push.rs:41-43` |
| (before any call) | The session has no username or no token | client check | `sync.auth-failed` | `push.rs:83-86` panics without them |
| push over HTTPS | Door43 refuses the token (401) | `[PENDING — owner run]` | `sync.auth-failed` | owner run, step 5 |
| push over HTTPS | No write access (403) | `[PENDING — owner run]` | `sync.no-write-access` | owner run, step 4 |
| push | HTTP 500 `Could not push repo: cannot push because a reference that you are trying to update on the remote contains commits that are not present locally.; class=Reference (4); code=NotFastForward (-11)` | `NotFastForward` | `sync.non-fast-forward` (G4: start the sync again) | run 3 |
| clone | HTTP 400 `could not clone repo: '<path>' exists and is not an empty directory; class=Invalid (3); code=Exists (-4)` | status 400 and `code=Exists (-4)` | `sync.clone-path-exists` | run 1 |
| clone | Any other HTTP 400 `could not clone repo: …` | the prefix | `sync.clone-failed` | run 1 |
| copy | HTTP 400 `Source repo not found or not a directory`, HTTP 400 `Target repo already exists`, HTTP 400 `could not delete src repo: …`, HTTP 500 `Could not create target parent directories: …` | any `is_good: false` | `sync.move-failed` | run 2; `copy_repo.rs:38-128` |
| push | Any other reply with `is_good: false` (HTTP 400 `Could not find remote …`, HTTP 500 `Could not open repo: …`, HTTP 500 `Could not push repo: …`) | any other | `sync.push-failed` | runs 3 and 5 |

The `branch` form of the clone answers `could not clone branch <b>: …` (`clone_repo.rs:97-103`).
The sync does not send `branch`, but the match on `code=Exists (-4)` holds for both forms (run 1).

The push route sets no `push_update_reference` callback (PLATFORM-NOTES #46). So a refusal from
the Door43 server itself (a protected branch, a 403 after the pack) is not proven to give
`is_good: false`. The owner run, step 4, tests this.

## The rig stand-in for Door43

The rig has no HTTPS git server, and `clone-repo` accepts only `https://` (`clone_repo.rs:60`).
The stand-in has two parts. [PROPOSED for #676, #677 and #681; each part is proven on the rig.]

1. **The remote: a bare repository addressed by `file://`.** The test makes it with
   `git init --bare -b main`, as `makeBareRemote` does (`e2e/helpers/door43Share.ts:155-170`).
   The URL comes from `pathToFileURL(bare).href`, never from a string prefix (the Windows rule
   in `door43Share.ts:192-196`). Push uses call 3 unchanged. The share code accepts a `file://`
   remote only with `allowFileRemote`, which only the development build sets (`src/state.jsx:5829`).
   The remote must be bare (run 5).
2. **The clone: copy a mirror, then pull.** The test makes a mirror once with
   `git clone <file URL of the bare> <repo_dir>/_local_/_archive_/<name>`. The mirror never
   commits. On the rig, the transport's clone step is two server calls:
   `POST /api/git/copy/_local_/_archive_/<name>?target_path=<host>/<org>/<repo>`, then
   `POST /api/git/pull-repo/origin/<host>/<org>/<repo>`. The pull is always a fast-forward,
   because the mirror never commits. The result is a full clone at the remote's `main`, with
   `origin` set to the bare remote (run 6).
   - `list-local-repos` and the summaries skip `_local_/_archive_/` (`list_local_repos.rs:48-50`,
     `burrito2/summary_metadatas.rs:53-57`), so the mirror is not a project on Home. Run 6 shows
     this. tC4 does not use `_local_/_archive_/` for any other purpose (grep of `src`, `journal`,
     `scripts`, `e2e`).
   - It plugs in behind `ShareTransport` (`src/data/share/shareOperation.ts:33-36`): a
     development-only clone step, gated like `allowFileRemote`.

Limits of the stand-in:

- `pull-repo` checks the network only for a remote given as a URL (`pull_repo.rs:91-94`). With
  `origin`, the rig clone works offline (run 7). So the shell must check the network state
  before the clone, as `share()` does. A rig test cannot prove `sync.offline` for the clone.
- `pull-repo` picks `FETCH_HEAD` by order, not by `HEAD` (PLATFORM-NOTES #21 and
  `docs/evidence/transport-rig-2026-07-18.md`). Keep the bare remote to one branch, `main`.
- The stand-in cannot give the HTTPS replies: 401, 403, and the panic without credentials. Those
  come from the owner run only.
- A rejected alternative: a test helper that runs `git clone` into the fixed path. The app calls
  the clone at run time, from the browser, so a helper cannot run at that moment.

## Runs

### Run 1: clone controls and the existing path

```
> GET /api/net/status
{"is_enabled":false}
< HTTP 200
> POST /api/git/clone-repo/localhost/o/r
{"is_good":false,"reason":"offline mode"}
< HTTP 401
> POST /api/net/enable
{"is_good":true,"reason":"ok"}
< HTTP 200
== no directory, full clone (nothing listens on localhost:443)
> POST /api/git/clone-repo/localhost/o/r
{"is_good":false,"reason":"could not clone repo: failed to connect to localhost: Connection refused; class=Os (2)"}
< HTTP 400
ls: <repo_dir>/localhost/o/r: No such file or directory
== no directory, branch=main
> POST /api/git/clone-repo/localhost/o/r2?branch=main
{"is_good":false,"reason":"could not clone branch main: failed to connect to localhost: Connection refused; class=Os (2)"}
< HTTP 400
== after both: <repo_dir>/localhost/o exists and is empty
== path exists, not empty (mkdir -p <repo_dir>/localhost/o/r; one file in it)
> POST /api/git/clone-repo/localhost/o/r
{"is_good":false,"reason":"could not clone repo: '<repo_dir>/localhost/o/r' exists and is not an empty directory; class=Invalid (3); code=Exists (-4)"}
< HTTP 400
> POST /api/git/clone-repo/localhost/o/r?branch=main
{"is_good":false,"reason":"could not clone branch main: '<repo_dir>/localhost/o/r' exists and is not an empty directory; class=Invalid (3); code=Exists (-4)"}
< HTTP 400
file.txt
== path exists, empty
> POST /api/git/clone-repo/localhost/o/e
{"is_good":false,"reason":"could not clone repo: failed to connect to localhost: Connection refused; class=Os (2)"}
< HTTP 400
```

Result: the exists check comes before the network call, and the existing file stays. An empty
directory passes the check. After the failed clone, the empty directory stays, and
`list-local-repos` lists it as a repository (run 6). The offline check comes before the exists
check (run 7).

### Run 2: full clone at the fixed path, then the move

```
== stand-in clone: git clone file://<tmp>/door43.git <repo_dir>/door43.test/owner/project
048fcd1361cc301655f2b3af51fa50babf1cbfa7
false                                   (git rev-parse --is-shallow-repository)
> GET /api/git/remotes/door43.test/owner/project
{"is_good":true,"payload":{"remotes":[{"name":"origin","url":"file://<tmp>/door43.git"}]}}
< HTTP 200
== move, negative controls
> POST /api/git/copy/door43.test/owner/missing?target_path=_local_/_local_/project_scratch&delete_src=true
{"is_good":false,"reason":"Source repo not found or not a directory"}
< HTTP 400
> POST /api/git/copy/door43.test/owner/project?target_path=_local_/_local_/sample_burrito&delete_src=true
{"is_good":false,"reason":"Target repo already exists"}
< HTTP 400
<repo_dir>/door43.test/owner/project      (the source is still there)
== move, valid
> POST /api/git/copy/door43.test/owner/project?target_path=_local_/_local_/project_scratch&delete_src=true
{"is_good":true,"reason":"ok"}
< HTTP 200
ls: <repo_dir>/door43.test/owner/project: No such file or directory
<repo_dir>/door43.test/owner is empty
_local_/_local_/project_scratch holds: .git .gitignore ingredients metadata.json
> GET /api/git/remotes/_local_/_local_/project_scratch
{"is_good":true,"payload":{"remotes":[{"name":"origin","url":"file://<tmp>/door43.git"}]}}
< HTTP 200
git status --short: (empty)    git log --oneline -1: 048fcd1 seed
```

### Run 3: commit, push (fast-forward), then a non-fast-forward

```
> POST /api/burrito/ingredient/raw/_local_/_local_/project_scratch?ipath=ingredients/spike-673.txt&no_bak {"payload":"spike 673 change one\n"}
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /api/git/add-and-commit/_local_/_local_/project_scratch {"commit_message":"spike 673 commit one"}
{"is_good":true,"reason":"ok"}
< HTTP 200
scratch HEAD: 6b10e0cd8a7ef3aa50e9f907693192d24067125c  parent: 048fcd1361cc301655f2b3af51fa50babf1cbfa7
== negative control: missing remote
> POST /api/git/push/_local_/_local_/project_scratch {"remote":"nope","cred_type":"https","username":"x","pass_key":"y"}
{"is_good":false,"reason":"Could not find remote nope: remote 'nope' does not exist; class=Config (7); code=NotFound (-3)"}
< HTTP 400
== negative control: missing repository
> POST /api/git/push/_local_/_local_/no_such_repo {"remote":"origin","cred_type":"https","username":"x","pass_key":"y"}
{"is_good":false,"reason":"Could not open repo: failed to resolve path '<repo_dir>/_local_/_local_/no_such_repo': No such file or directory; class=Os (2); code=NotFound (-3)"}
< HTTP 500
bare main before: 048fcd1361cc301655f2b3af51fa50babf1cbfa7
== valid push
> POST /api/git/push/_local_/_local_/project_scratch {"remote":"origin","cred_type":"https","username":"x","pass_key":"y"}
{"is_good":true,"reason":"ok"}
< HTTP 200
bare main after: 6b10e0cd8a7ef3aa50e9f907693192d24067125c
== another translator pushes to the bare remote with git: main is c72b189
== commit two in project_scratch: HEAD 912a24eff8393f7ffc12f3e9aa985215377d2f64
> POST /api/git/push/_local_/_local_/project_scratch {"remote":"origin","cred_type":"https","username":"x","pass_key":"y"}
{"is_good":false,"reason":"Could not push repo: cannot push because a reference that you are trying to update on the remote contains commits that are not present locally.; class=Reference (4); code=NotFastForward (-11)"}
< HTTP 500
bare main after: c72b189bd52c6156cb875e0dbccf317eb4d1267f
== a file:// remote whose path is missing
> POST /api/git/push/_local_/_local_/project_scratch {"remote":"gone","cred_type":"https","username":"x","pass_key":"y"}
{"is_good":false,"reason":"Could not push repo: failed to resolve path '<tmp>/gone.git': No such file or directory; class=Os (2)"}
< HTTP 500
```

The `file://` push sends the credentials, but libgit2 does not ask for them on this transport.

### Run 4: offline controls

```
> POST /api/net/disable
< HTTP 200
> POST /api/git/push/_local_/_local_/project_scratch {"remote":"origin","cred_type":"https","username":"x","pass_key":"y"}
{"is_good":false,"reason":"offline mode"}
< HTTP 401
> POST /api/git/copy/_local_/_local_/project_scratch2?target_path=_local_/_local_/project_scratch3
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /api/net/enable
< HTTP 200
```

### Run 5: push to a non-bare remote

```
== nb: git clone of the bare remote, main checked out, bare? false, HEAD c72b189
== full clone of nb to door43.test/owner/project2, moved to _local_/_local_/project_scratch2, one commit: HEAD 0c00127
> POST /api/git/push/_local_/_local_/project_scratch2 {"remote":"origin","cred_type":"https","username":"x","pass_key":"y"}
{"is_good":false,"reason":"Could not push repo: local push doesn't (yet) support pushing to non-bare repos.; class=Invalid (3); code=BareRepo (-8)"}
< HTTP 500
nb main after: c72b189bd52c6156cb875e0dbccf317eb4d1267f
```

The control for this run is run 3: the same push to a bare remote answers HTTP 200.

### Run 6: the rig stand-in, end to end

```
bare main: c72b189bd52c6156cb875e0dbccf317eb4d1267f
== mirror: git clone of the bare remote into <repo_dir>/_local_/_archive_/door43_mirror, reset to 048fcd1 (stale on purpose)
> GET /api/git/list-local-repos
["_local_/_local_/project_scratch","_local_/_local_/sample_burrito_large","_local_/_local_/project_scratch3","_local_/_local_/project_scratch2","_local_/_local_/sample_burrito","_local_/_sideloaded_/…" (22 sideloaded entries),"localhost/o/r","localhost/o/e"]
< HTTP 200
== clone step 1: copy the mirror to the fixed path (the source stays)
> POST /api/git/copy/_local_/_archive_/door43_mirror?target_path=door43.test/owner/project
{"is_good":true,"reason":"ok"}
< HTTP 200
== clone step 2: pull (negative control first)
> POST /api/git/pull-repo/origin/door43.test/owner/nothere
{"is_good":false,"reason":"could not open repo: failed to resolve path '<repo_dir>/door43.test/owner/nothere': No such file or directory; class=Os (2); code=NotFound (-3)"}
< HTTP 500
> POST /api/git/pull-repo/origin/door43.test/owner/project
{"has_conflicts":false,"is_good":true,"merge_type":"fast-forward","reason":"ok"}
< HTTP 200
fixed path HEAD: c72b189bd52c6156cb875e0dbccf317eb4d1267f shallow: false commits: 3
git status --short: (empty); other-translator.txt is on disk
== move, commit, push
> POST /api/git/copy/door43.test/owner/project?target_path=_local_/_local_/project_scratch4&delete_src=true
< HTTP 200
> POST /api/git/add-and-commit/_local_/_local_/project_scratch4 {"commit_message":"chain commit"}
< HTTP 200
scratch4 HEAD: 24cf0e87c7029e5702b4446671550372bf6f83e1 parent: c72b189bd52c6156cb875e0dbccf317eb4d1267f
> POST /api/git/push/_local_/_local_/project_scratch4 {"remote":"origin","cred_type":"https","username":"x","pass_key":"y"}
{"is_good":true,"reason":"ok"}
< HTTP 200
bare main after: 24cf0e87c7029e5702b4446671550372bf6f83e1
bare refs: refs/heads/main 24cf0e8
```

The mirror does not show in `list-local-repos`. The empty `localhost/o/e` from run 1 does show.

### Run 7: the stand-in offline, the order of the clone checks, and recovery

This run comes after run 6, because it uses the mirror of run 6. The network is off at the start.

```
> POST /api/net/disable
< HTTP 200
== rig clone (stand-in) while offline
> POST /api/git/copy/_local_/_archive_/door43_mirror?target_path=door43.test/owner/project
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /api/git/pull-repo/origin/door43.test/owner/project
{"has_conflicts":false,"is_good":true,"merge_type":"fast-forward","reason":"ok"}
< HTTP 200
== the real clone on that existing path, offline
> POST /api/git/clone-repo/door43.test/owner/project
{"is_good":false,"reason":"offline mode"}
< HTTP 401
> POST /api/net/enable
< HTTP 200
== the same, online
> POST /api/git/clone-repo/door43.test/owner/project
{"is_good":false,"reason":"could not clone repo: '<repo_dir>/door43.test/owner/project' exists and is not an empty directory; class=Invalid (3); code=Exists (-4)"}
< HTTP 400
== recovery of the fixed path (negative control first)
> POST /api/git/delete/door43.test/owner/nothere
{"is_good":false,"reason":"could not delete repo: No such file or directory (os error 2)"}
< HTTP 400
> POST /api/git/delete/door43.test/owner/project
{"is_good":true,"reason":"ok"}
< HTTP 200
```

A stale clone at the fixed path (for example after a crash) blocks the next clone. `POST
/api/git/delete/<host>/<org>/<repo>` clears it. #676 decides when the shell may do that.

## Manual qa.door43.org run (owner)

The owner runs this, or approves it first. This spike did not contact qa.door43.org or any other
external host. Use a rig on a free port, never a rig that another session uses.

Preparation:

1. On qa.door43.org, make a public test repository `<owner>/tc4-sync-spike` that holds a
   Scripture Burrito on `main`. Use the seeded `sample_burrito`: push it with git, or share it
   from the development build. The commit route rewrites `metadata.json` (PLATFORM-NOTES #48),
   so the repository must have one.
2. Make a personal access token with repository write scope.
3. Find a public repository `<other>/<repo>` where your account has no write access.
4. Start a rig: `cd <worktree> && TC4_RIG_PORT=19673 zsh dev-env/scripts/run.zsh`.
5. In a second zsh shell, set `U=<owner>`, `T=<token>`, `O=<other>/<repo>` and
   `RD=<worktree>/dev-env/state/work/repos`, then paste the commands below.
   Do not put the token in a remote URL (PLATFORM-NOTES #40).

Commands. Each call has `--max-time 120`, so that a credential loop cannot stop the run.

```zsh
P=http://localhost:19673/api; R=qa.door43.org/$U/tc4-sync-spike; S=_local_/_local_/sync_spike
call() { print -r -- "> POST $1 ${2:-}"; curl -s --max-time 120 -w '\n< HTTP %{http_code}\n' -X POST -H 'Content-Type: application/json' ${2:+-d} ${2:+"$2"} "$P$1"; }
push() { call "/git/push/$S" "{\"remote\":\"$1\",\"cred_type\":\"https\",\"username\":\"$U\",\"pass_key\":\"$2\"}"; }
commit() { call "/burrito/ingredient/raw/$S?ipath=ingredients/spike.txt&no_bak" "{\"payload\":\"$1\"}"; call "/git/add-and-commit/$S" "{\"commit_message\":\"$1\"}"; }
call /net/enable
# 1. full clone to the fixed path (expect: not shallow, on main), then the move
call "/git/clone-repo/$R"
git -C "$RD/$R" rev-parse --is-shallow-repository --abbrev-ref HEAD
call "/git/copy/$R?target_path=$S&delete_src=true"
# 2. one commit, then a push that fast-forwards
commit "spike one"; push origin "$T"
# 3. not a fast-forward. First edit one file on qa.door43.org in the web editor, on main. Then:
commit "spike two"; push origin "$T"
# 4. no write access (403)
call "/git/remote/add/$S?remote_name=noaccess&remote_url=https://qa.door43.org/$O"
push noaccess "$T"
# 5. a bad token (401)
push origin not-a-token
# 6. the clone path exists: clone twice, with no move between, then clear the path
call "/git/clone-repo/$R"; call "/git/clone-repo/$R"; call "/git/delete/$R"
# After steps 2 to 5, record: git ls-remote https://qa.door43.org/$U/tc4-sync-spike main
```

The shell syntax of these commands ran on the spike rig with a `file://` remote in place of
qa.door43.org (see "Dry run of the owner commands" below).

### Dry run of the owner commands

The three functions and steps 2 to 6 ran unchanged on the spike rig, with these changes only:
`R=door43.test/$U/tc4-sync-spike`; step 1 used the stand-in clone (copy of the mirror, then
`pull-repo`); before step 3 a git push to the bare remote moved `main`; step 4 used
`https://localhost/o/r`. The replies, in short:

| Step | Reply on the rig |
|---|---|
| 1 | copy 200, `pull-repo` 200 `fast-forward`; `false`, `main`; move 200 |
| 2 | write 200, commit 200, push 200; bare `main` = `sync_spike` HEAD (`695c908`) |
| 3 | push 500 `code=NotFastForward (-11)` |
| 4 | remote add 200; push 500 `failed to connect to localhost: Connection refused` |
| 5 | push 500 `code=NotFastForward (-11)` (`file://` asks for no credentials) |
| 6 | clone-repo 400 `code=Exists (-4)`; delete 200 |

### Replies

`[PENDING — owner run]`

| Step | Reply | Door43 `main` after |
|---|---|---|
| 1 clone (full), shallow? | `[PENDING — owner run]` | |
| 1 move | `[PENDING — owner run]` | |
| 2 push, fast-forward | `[PENDING — owner run]` | |
| 3 push, not a fast-forward (HTTPS) | `[PENDING — owner run]` | |
| 4 push, no write access (HTTPS 403) | `[PENDING — owner run]` | |
| 5 push, bad token (HTTPS 401) | `[PENDING — owner run]` | |
| 6 clone, path exists | `[PENDING — owner run]` | |

When the replies are in, fill the two `[PENDING — owner run]` rows of the refusal table above.

## What this spike did not prove

- Any HTTPS reply: 401, 403, the non-fast-forward text over HTTPS, and the panic without
  credentials. The libgit2 non-fast-forward check is client-side, so the text is expected to be
  the same over HTTPS (PLATFORM-NOTES #46). The owner run confirms it.
- That a full clone over HTTPS checks out `main`. The owner run, step 1, shows it.
- A push from a shallow clone. The contract avoids it: it sends no `branch`.
- A stop of the server between the copy and the delete of call 2. The source shows that two
  copies stay (`copy_repo.rs:74`, `:120-129`); #676 owns the recovery (G8).
