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
`[VERIFIED — pankosmia-web 0.18.15 (a83725b, 2026-09-29), read and run 2026-10-13]`. The date in
the brackets is the commit date of a83725b. Each claim names its surface. The answers table
uses the short form `[VERIFIED — 0.18.15 (a83725b, 2026-09-29)]`.

**How to read the pastes.** `>` is the request. The next line is the body of the reply. `< HTTP`
is the status. Each request line is exact. Each reply body that is shown is exact. Two edits
apply: `<repo_dir>` replaces `<worktree>/dev-env/state/work/repos`, and `<tmp>` replaces the
session scratch directory. Lines that start with `==`, and lines in parentheses, are notes. They
give the git commands and results in short. Some replies show the status only:
`net/enable` and `net/disable` (each body was `{"is_good":true,"reason":"ok"}`), and the move and
the commit in run 6 (each body was `{"is_good":true,"reason":"ok"}`). Run 6 also
shortens the `list-local-repos` body, as its line says. The run numbers follow the topic, not
the time. No claim depends on the order. The server starts offline (D95: each launch starts
with the internet off), so `POST /api/net/enable` comes first, unless the run is an offline
control.

**Setup of the stand-in remote.** A bare repository `<tmp>/door43.git` (`git init --bare -b main`),
with `main` at `048fcd1`, pushed from a clone of the seeded `_local_/_local_/sample_burrito`.

## The answers

| Question | Answer | Evidence |
|---|---|---|
| Does a full clone, then a move, give a repository that a later push fast-forwards? | Yes, for a clone made by git (run 2) or by the stand-in (run 6). The moved repository keeps `.git`, all history and `origin`. A commit in it pushes as a fast-forward. On qa.door43.org, the server's own `clone-repo` gave a full clone on `main`, and the move and the push fast-forwarded (owner steps 1 and 2). | Runs 2, 3 and 6 [VERIFIED — 0.18.15 (a83725b, 2026-09-29)], live rig, `file://` remote; owner steps 1 and 2 [VERIFIED — owner run, qa.door43.org (Gitea 28.1.0+dcs.47-gb4768a2512) and rig 0.18.15 (a83725b), 2026-10-14] |
| Does push to a local repository on the rig work, and must it be bare? | Yes, over `file://`. It must be bare: a non-bare remote answers HTTP 500 `code=BareRepo (-8)` and does not move. | Runs 3 and 5 [VERIFIED — 0.18.15 (a83725b, 2026-09-29)], live rig |
| What happens when the clone path already exists? | A non-empty directory: HTTP 400 `code=Exists (-4)`, before any network call, and the directory does not change. An empty directory: the clone continues. | Run 1 [VERIFIED — 0.18.15 (a83725b, 2026-09-29)], live rig |
| What is the rig stand-in for Door43? | A bare `file://` repository for the push, and a never-committed mirror under `_local_/_archive_/` for the clone (copy, then `pull-repo`). | "The rig stand-in" below, run 6 [VERIFIED — 0.18.15 (a83725b, 2026-09-29)], live rig |

## The transport contract

Three server calls do the transport. A fourth call (`pull-repo`) occurs only in the rig stand-in.

### Call 1: full clone to the fixed path

- Request: `POST /api/git/clone-repo/<host>/<org>/<repo>`, no body. Send no `branch`.
- The server clones `https://<host>/<org>/<repo>` (`clone_repo.rs:60`). It always writes to
  `<repo_dir>/<host>/<org>/<repo>` (`:61-70`). The caller cannot choose the path.
- A trailing `.git` on `<repo>` is removed from the local path only (`:54-59`).
- With `?branch=<b>`, the clone is shallow (`depth(1)`, `:73-80`). Without it, the clone is full
  (`Repository::clone`, `:106`). The contract sends no `branch`, so the clone is full.
  [FLAG: a push from a shallow clone is not tested here.]
- The full clone checks out the remote's default branch. The shell must read the branch name
  before it commits. On qa.door43.org the clone was not shallow and was on `main` (owner step 1)
  [VERIFIED — owner run, qa.door43.org (Gitea 28.1.0+dcs.47-gb4768a2512) and rig 0.18.15 (a83725b), 2026-10-14].
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
| push over HTTPS | HTTP 500 `Could not push repo: server requires authentication that we do not support; class=Http (34); code=Auth (-16)` (Door43 refused the token) | `code=Auth (-16)` | `sync.auth-failed` | owner run, step 3 |
| push over HTTPS | No write access (403) | `[PENDING — #676]` | `sync.no-write-access` | not measured: the owner account is a site admin (see the owner run) |
| push | HTTP 500 `Could not push repo: cannot push because a reference that you are trying to update on the remote contains commits that are not present locally.; class=Reference (4); code=NotFastForward (-11)` | `NotFastForward` | `sync.non-fast-forward` (G4: start the sync again) | run 3 |
| clone | HTTP 400 `could not clone repo: '<path>' exists and is not an empty directory; class=Invalid (3); code=Exists (-4)` | status 400 and `code=Exists (-4)` | `sync.clone-path-exists` | run 1 |
| clone | Any other HTTP 400 `could not clone repo: …` | the prefix | `sync.clone-failed` | run 1 |
| copy | HTTP 400 `Source repo not found or not a directory`, HTTP 400 `Target repo already exists`, HTTP 400 `could not delete src repo: …`, HTTP 500 `Could not create target parent directories: …` | any `is_good: false` | `sync.move-failed` | run 2; `copy_repo.rs:38-128` |
| push | Any other reply with `is_good: false` (HTTP 400 `Could not find remote …`, HTTP 500 `Could not open repo: …`, HTTP 500 `Could not push repo: …`) | any other | `sync.push-failed` | runs 3 and 5 |

The `branch` form of the clone answers `could not clone branch <b>: …` (`clone_repo.rs:97-103`).
The sync does not send `branch`, but the match on `code=Exists (-4)` holds for both forms (run 1).

The push route sets no `push_update_reference` callback (PLATFORM-NOTES #46). So a refusal from
the Door43 server itself (a protected branch, a 403 after the pack) is not proven to give
`is_good: false`. The owner run did not test this, because step 4 did not run. #676 owns it.

The text of the `code=Auth (-16)` reply is misleading. Door43 answers rejected credentials with
HTTP 401 and no `WWW-Authenticate` header. libgit2 then reports "authentication that we do not
support" (libgit2 1.9.4, from `libgit2-sys` 0.18.5+1.9.4 in `dev-env/server/Cargo.lock`:
`src/libgit2/transports/http.c:182-183`, `handle_remote_auth`, source read 2026-10-14). A request with no credentials gets
`WWW-Authenticate: Basic realm="Gitea"`. [VERIFIED — `curl -D -` on `info/refs?service=git-receive-pack`
at qa.door43.org and git.door43.org with no credentials and with a fake token, 2026-10-14;
github.com sends `Basic` in both cases.] Match on the code, not on the text.

## The rig stand-in for Door43

The rig has no HTTPS git server, and `clone-repo` accepts only `https://` (`clone_repo.rs:60`).
The stand-in has two parts. [PROPOSED for #676, #677 and #681; each part is proven on the rig.]

1. **The remote: a bare repository addressed by `file://`.** The test makes it with
   `git init --bare -b main`, as `makeBareRemote` does (`e2e/helpers/door43Share.ts:167-184`).
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
   - The mirror name: `_local_/_archive_/<org>--<repo>` for the fixed path
     `<host>/<org>/<repo>`. `--` keeps two repositories with one name apart. The path checks
     refuse `..`, `/`, `~`, space and some other signs (`utils/paths.rs:19-31`), but not `-`.
     Run 6 used the name `door43_mirror`. [PROPOSED]
   - How it plugs in [PROPOSED]. Today `ShareTransport` is
     `Pick<ServerApi, 'getNetEnabled' | 'listRemotes' | 'addRemote' | 'push'>`
     (`src/data/share/shareOperation.ts:33-36`). #676 adds three `ServerApi` methods, one for
     each route: `cloneRepo(host, org, repo)` (call 1), `copyRepo(src, target, deleteSrc)`
     (call 2) and `pullRepo(remote, repoPath)`. The sync's transport type also picks
     `cloneRepo` and `copyRepo`. On the rig, the development build gives a transport whose
     `cloneRepo` is `copyRepo` from the mirror, then `pullRepo('origin', …)`. It is gated like
     `allowFileRemote`. The route behavior under these methods is
     [VERIFIED — 0.18.15 (a83725b, 2026-09-29)] (runs 2, 6 and 7). The method names and the
     gate are a choice for #676.

Limits of the stand-in:

- `pull-repo` checks the network only for a remote given as a URL (`pull_repo.rs:91-94`). With
  `origin`, the rig clone works offline (run 7). So the shell must check the network state
  before the clone, as `share()` does. A rig test cannot prove `sync.offline` for the clone.
- `pull-repo` picks `FETCH_HEAD` by order, not by `HEAD` (PLATFORM-NOTES #21 and
  `docs/evidence/transport-rig-2026-07-18.md`). Keep the bare remote to one branch, `main`.
- The stand-in cannot give the HTTPS replies: 401, 403, and the panic without credentials. The
  owner run gave the refused-token reply. The 403 reply is for #676. No run measured the panic
  without credentials over HTTPS.
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

The owner runs this, or approves it first. The runs 1 to 7 above did not contact
qa.door43.org or any other external host. The owner run of 2026-10-14 did ("The owner run of
2026-10-14" below). Use a rig on a free port, never a rig that another session uses.

Preparation:

1. On qa.door43.org, make a public test repository `<owner>/tc4-sync-spike` that holds a
   Scripture Burrito on `main`. Use the seeded `sample_burrito`: push it with git, or share it
   from the development build. The commit route rewrites `metadata.json` (PLATFORM-NOTES #48),
   so the repository must have one.
2. Make a personal access token with repository write scope.
3. Find a public repository `<other>/<repo>` that your account cannot write to. Do not use a
   repository of your own, of an organization where you can write, or of a team that you are on.
   On its Door43 page, make sure that you cannot edit a file.
4. Start a rig: `cd <worktree> && TC4_RIG_PORT=19673 zsh dev-env/scripts/run.zsh`.
5. In a second zsh shell, set `U=<owner>`, `T=<token>`, `O=<other>/<repo>` and
   `RD=<worktree>/dev-env/state/work/repos`, then paste the commands below.
   Do not put the token in a remote URL (PLATFORM-NOTES #40).

Commands. Each call has `--max-time 120`, so that a credential loop cannot stop the run. The
`call` function prints each request with `pass_key` replaced by `***`. No line prints the token,
so you can paste the output into this record. `curl` reads the body from stdin, so the token is
not in the process list.

The order matters. Steps 3 and 4 push while the local `main` is one commit ahead of Door43
`main`, so a fast-forward is possible. Thus a refusal there comes from the sign-in or the
access check, not from `NotFastForward`. Step 5 then pushes with the good token, and step 6
makes the non-fast-forward case.

How to read steps 3 and 4: a reply that holds `code=NotFastForward (-11)` comes from the libgit2
ref check, not from Door43's access check. Then the probe failed: for step 4, choose another
repository. Record the reason exactly as it comes. Step 3 showed that a refused token does not
name the status: the reason holds `code=Auth (-16)` (see the refusal table).

```zsh
P=http://localhost:19673/api; R=qa.door43.org/$U/tc4-sync-spike; S=_local_/_local_/sync_spike
call() { print -r -- "> POST $1 $(print -r -- "${2:-}" | sed -E 's/("pass_key":")[^"]*/\1***/g')"; print -rn -- "${2:-}" | curl -s --max-time 120 -w '\n< HTTP %{http_code}\n' -X POST -H 'Content-Type: application/json' ${2:+--data-binary} ${2:+@-} "$P$1"; }
push() { call "/git/push/$S" "{\"remote\":\"$1\",\"cred_type\":\"https\",\"username\":\"$U\",\"pass_key\":\"$2\"}"; }
commit() { call "/burrito/ingredient/raw/$S?ipath=ingredients/spike.txt&no_bak" "{\"payload\":\"$1\"}"; call "/git/add-and-commit/$S" "{\"commit_message\":\"$1\"}"; }
call /net/enable
# 1. full clone to the fixed path (expect: not shallow, on main), then the move
call "/git/clone-repo/$R"
git -C "$RD/$R" rev-parse --is-shallow-repository --abbrev-ref HEAD
call "/git/copy/$R?target_path=$S&delete_src=true"
# 2. one commit, then a push that fast-forwards. Now the local main = Door43 main.
commit "spike one"; push origin "$T"
# 3. a bad token (401). First make the local main one commit ahead.
commit "spike two"; push origin not-a-token
# 4. no write access (403)
call "/git/remote/add/$S?remote_name=noaccess&remote_url=https://qa.door43.org/$O"
push noaccess "$T"
# 5. the good token: expect a fast-forward
push origin "$T"
# If a push times out, check that GET $P/version answers before you go on.
# 6. not a fast-forward. First edit one file on qa.door43.org in the web editor, on main. Then:
commit "spike three"; push origin "$T"
# 7. the clone path exists: clone twice, with no move between, then clear the path
call "/git/clone-repo/$R"; call "/git/clone-repo/$R"; call "/git/delete/$R"
# After steps 2 to 6, record: git ls-remote https://qa.door43.org/$U/tc4-sync-spike main
```

The shell syntax of these commands ran on the spike rig with a `file://` remote in place of
qa.door43.org (see "Dry run of the owner commands" below).

### Dry run of the owner commands

The three functions and steps 2 to 6 ran unchanged on the spike rig, with these changes only:
`T=SECRET-TOKEN-VALUE`; `R=door43.test/$U/tc4-sync-spike`; step 1 used the stand-in clone (copy
of the mirror, then `pull-repo`); step 4 used `https://localhost/o/r`; before step 6 a git push
to the bare remote moved `main`. Step 7 put a copy of the mirror at the fixed path, then called
`clone-repo` once and `delete` once. The replies, in short:

| Step | Reply on the rig |
|---|---|
| 1 | copy 200, `pull-repo` 200 `fast-forward`; `false`, `main`; move 200 |
| 2 | write 200, commit 200, push 200; bare `main` = local HEAD (`2d1f0c7`) |
| 3 | commit 200; push 200, because `file://` asks for no credentials. Over HTTPS this push is expected to fail, and step 5 then has the commit to push. |
| 4 | remote add 200; push 500 `failed to connect to localhost: Connection refused` |
| 5 | push 200; bare `main` = local HEAD (`8e0f7b1`) |
| 6 | push 500 `code=NotFastForward (-11)` |
| 7 | clone-repo 400 `code=Exists (-4)`; delete 200 |

Every push line printed `"pass_key":"***"`. `grep -c SECRET-TOKEN-VALUE` on the whole output
gave 0, and `grep -c not-a-token` gave 0.

After review, `call` changed to send the body on stdin (`--data-binary @-`). The rig dry run used
the earlier `-d` form. The new `call` and `push` ran against a local echo server on 2026-10-13:
the server got the full body with the token, stdout and the `curl` argv in `ps` held neither
token, and the earlier `-d` form showed the token in `ps` (negative control).

### The owner run of 2026-10-14

The run started at 2026-10-14T01:35:16Z (2026-10-13, 21:35 local time). The owner ran a script form of the commands above, from `issue-673-sync-transport-spike` at
`de6b3f4`, against `birch/tc4-sync-spike` on qa.door43.org (Gitea `28.1.0+dcs.47-gb4768a2512`).
The script used the same `call` function and the same requests, with these changes:

- Step 0 is new. The test repository was empty. The script copied `sample_burrito` on the rig,
  added `origin`, and pushed it with the token. This filled Door43 `main` at `048fcd1`.
- Step 4 did not run. The owner account is a site admin on qa.door43.org. The owner chose to
  skip the step, because Gitea lets a site admin write to every repository. [FLAG: Gitea
  behavior, not measured here.] Thus the push could write to another account's repository.
- Step 6 used no web edit. A second `clone-repo` to the fixed path, a commit there and a push
  moved Door43 `main` first. Then the push from the scratch path was not a fast-forward.
- Step 7 called `clone-repo` once. The clone from step 6 was still at the fixed path.
- The scratch path and the seed copy have a time suffix (`sync_spike_213334`,
  `spike_seed_213334`).
- At the end the script deleted the fixed path, the scratch path and the seed copy.

The output, with `<repo_dir>` for the rig repository directory. The script printed every
`pass_key` as `***`. The script then counted the lines of the output file that hold the token, and printed the
count in the terminal: 0.

```text
(run start) #673 owner run 2026-10-14T01:35:16Z, rig {"os":"macos","pkg_version":"0.18.15","product_date_time":"2026-07-18T00:00:00Z","product_homepage":"uw-tc4","product_name":"tC4 dev rig","product_resources":[],"product_short_name":"tc4rig","product_version":"0.1.0"}
> POST /net/enable 
{"is_good":true,"reason":"ok"}
< HTTP 200
## 0. seed: copy sample_burrito, add origin, push to the empty Door43 repository
> POST /git/copy/_local_/_local_/sample_burrito?target_path=_local_/_local_/spike_seed_213334 
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /git/remote/add/_local_/_local_/spike_seed_213334?remote_name=origin&remote_url=https://qa.door43.org/birch/tc4-sync-spike 
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /git/push/_local_/_local_/spike_seed_213334 {"remote":"origin","cred_type":"https","username":"birch","pass_key":"***"}
{"is_good":true,"reason":"ok"}
< HTTP 200
door43 main: 048fcd1361cc301655f2b3af51fa50babf1cbfa7	refs/heads/main
## 1. full clone to the fixed path, then the move
> POST /git/clone-repo/qa.door43.org/birch/tc4-sync-spike 
{"is_good":true,"reason":"ok"}
< HTTP 200
false
main
> POST /git/copy/qa.door43.org/birch/tc4-sync-spike?target_path=_local_/_local_/sync_spike_213334&delete_src=true 
{"is_good":true,"reason":"ok"}
< HTTP 200
## 2. one commit, push (expect fast-forward)
> POST /burrito/ingredient/raw/_local_/_local_/sync_spike_213334?ipath=ingredients/spike.txt&no_bak {"payload":"spike one"}
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /git/add-and-commit/_local_/_local_/sync_spike_213334 {"commit_message":"spike one"}
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /git/push/_local_/_local_/sync_spike_213334 {"remote":"origin","cred_type":"https","username":"birch","pass_key":"***"}
{"is_good":true,"reason":"ok"}
< HTTP 200
door43 main: e1bbdd4d6dd8344e847653cfe07b808aa41ff808	refs/heads/main
## 3. bad token (local main one commit ahead)
> POST /burrito/ingredient/raw/_local_/_local_/sync_spike_213334?ipath=ingredients/spike.txt&no_bak {"payload":"spike two"}
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /git/add-and-commit/_local_/_local_/sync_spike_213334 {"commit_message":"spike two"}
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /git/push/_local_/_local_/sync_spike_213334 {"remote":"origin","cred_type":"https","username":"birch","pass_key":"***"}
{"is_good":false,"reason":"Could not push repo: server requires authentication that we do not support; class=Http (34); code=Auth (-16)"}
< HTTP 500
door43 main: e1bbdd4d6dd8344e847653cfe07b808aa41ff808	refs/heads/main
## 4. skipped: no non-admin account
## 5. good token (expect fast-forward)
> POST /git/push/_local_/_local_/sync_spike_213334 {"remote":"origin","cred_type":"https","username":"birch","pass_key":"***"}
{"is_good":true,"reason":"ok"}
< HTTP 200
door43 main: 46d021d547522656747d245e43ef1e954f9faa88	refs/heads/main
## 6. not a fast-forward: a second clone moves Door43 main first
> POST /git/clone-repo/qa.door43.org/birch/tc4-sync-spike 
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /burrito/ingredient/raw/qa.door43.org/birch/tc4-sync-spike?ipath=ingredients/spike.txt&no_bak {"payload":"spike other"}
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /git/add-and-commit/qa.door43.org/birch/tc4-sync-spike {"commit_message":"spike other"}
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /git/push/qa.door43.org/birch/tc4-sync-spike {"remote":"origin","cred_type":"https","username":"birch","pass_key":"***"}
{"is_good":true,"reason":"ok"}
< HTTP 200
door43 main: 4190cde5ce6c256d17e2547bc02d4293774ab4d9	refs/heads/main
> POST /burrito/ingredient/raw/_local_/_local_/sync_spike_213334?ipath=ingredients/spike.txt&no_bak {"payload":"spike three"}
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /git/add-and-commit/_local_/_local_/sync_spike_213334 {"commit_message":"spike three"}
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /git/push/_local_/_local_/sync_spike_213334 {"remote":"origin","cred_type":"https","username":"birch","pass_key":"***"}
{"is_good":false,"reason":"Could not push repo: cannot push because a reference that you are trying to update on the remote contains commits that are not present locally.; class=Reference (4); code=NotFastForward (-11)"}
< HTTP 500
door43 main: 4190cde5ce6c256d17e2547bc02d4293774ab4d9	refs/heads/main
## 7. clone path exists, then clear it
> POST /git/clone-repo/qa.door43.org/birch/tc4-sync-spike 
{"is_good":false,"reason":"could not clone repo: '<repo_dir>/qa.door43.org/birch/tc4-sync-spike' exists and is not an empty directory; class=Invalid (3); code=Exists (-4)"}
< HTTP 400
> POST /git/delete/qa.door43.org/birch/tc4-sync-spike 
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /git/delete/_local_/_local_/sync_spike_213334 
{"is_good":true,"reason":"ok"}
< HTTP 200
> POST /git/delete/_local_/_local_/spike_seed_213334 
{"is_good":true,"reason":"ok"}
< HTTP 200
```

### Replies

[VERIFIED — owner run, qa.door43.org (Gitea 28.1.0+dcs.47-gb4768a2512) and rig 0.18.15 (a83725b), 2026-10-14]

| Step | Reply | Door43 `main` after |
|---|---|---|
| 1 clone (full), shallow? | HTTP 200; `--is-shallow-repository` `false`, branch `main` | `048fcd1` (from step 0) |
| 1 move | HTTP 200 | `048fcd1` (from step 0) |
| 2 push, fast-forward | HTTP 200 | `e1bbdd4` |
| 3 push, bad token (HTTPS) | HTTP 500 `Could not push repo: server requires authentication that we do not support; class=Http (34); code=Auth (-16)` | `e1bbdd4` (no change) |
| 4 push, no write access (HTTPS 403) | Not run: the owner account is a site admin. `[PENDING — #676]` | |
| 5 push, good token, fast-forward | HTTP 200 | `46d021d` |
| 6 push, not a fast-forward (HTTPS) | HTTP 500 `Could not push repo: cannot push because a reference that you are trying to update on the remote contains commits that are not present locally.; class=Reference (4); code=NotFastForward (-11)`, the same text as run 3 | `4190cde` (no change) |
| 7 clone, path exists | HTTP 400 `could not clone repo: '<repo_dir>/qa.door43.org/birch/tc4-sync-spike' exists and is not an empty directory; class=Invalid (3); code=Exists (-4)` | |

An earlier attempt the same day failed at step 0: Door43 refused the token, with the step 3
reply. So the repository stayed empty, and two more replies came from that state. They matter
to #676 and #677, because a Door43 repository can be empty:

- `clone-repo` of an empty repository answers HTTP 200. The clone has no commit, and `HEAD` names
  `refs/heads/master`, which does not exist. `add-and-commit` in it answers HTTP 500
  `Could not load metadata as string: No such file or directory (os error 2)`.
- `push` from it answers HTTP 500 `unknown error while serving /api/git/push/<path>`. The rig log
  shows a panic at `push.rs:110`: `Could not locate head: … reference 'refs/heads/master' not found`.

## What this spike did not prove

- The HTTPS reply for no write access (403), and the panic without credentials over HTTPS. The
  owner account is a site admin, so step 4 did not run. #676 owns the 403 reply.
- A refusal from Door43 after the pack (a protected branch). The push route does not report it
  (PLATFORM-NOTES #46).
- A push from a shallow clone. The contract avoids it: it sends no `branch`.
- A stop of the server between the copy and the delete of call 2. The source shows that two
  copies stay (`copy_repo.rs:74`, `:120-129`); #676 owns the recovery (G8).
