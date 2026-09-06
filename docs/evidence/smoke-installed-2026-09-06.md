# Post-install smoke test on fresh runners — the issue #45 record

**Date:** 2026-09-06 (UTC timestamps below; the evening of 2026-09-05 in EDT). **Commit:**
`15bdd30` on branch `i45-smoke-installed` (parent chain from `main` `c265b99`). **Run:**
`package-desktop` run 34008651985 on pull request #192. **Machines:** two GitHub-hosted
runners, one per platform (a fresh runner is a clean machine: nothing of tC4 is installed
before the job).

## What was measured

The post-install smoke test (`smoke-installed.zsh`, shipped inside the artifact) on the
INSTALLED artifact of each platform the pipeline covers at this date: macOS arm64 and Linux
x64. Each `smoke-*` job downloads the raw artifact zip through the GitHub API (the file a
pilot's browser downloads), unpacks it once with `unzip`, and runs the shipped script under a
fresh `HOME`. The build-time smoke test (inside `scripts/package-desktop.zsh`) is a different
measurement and is not this record.

## Method

`.github/workflows/package-desktop.yml`, jobs `smoke-macos-arm64` and `smoke-linux-x64`, as
committed at `15bdd30`. Each job:

1. `gh api repos/unfoldingWord/translationCore4/actions/runs/<run>/artifacts` to find the
   artifact id of `tC4-4.0.0-alpha.3-<platform>-unsigned.zip`; `gh api .../artifacts/<id>/zip`
   to download it; `shasum -a 256` (macOS) or `sha256sum` (Linux) on the zip.
2. `unzip -q download/artifact.zip -d install`.
3. `TC4_SMOKE_HOME=$RUNNER_TEMP/smoke-home TC4_SMOKE_LOGDIR=$PWD/smoke-logs zsh
   install/translationCore4/smoke-installed.zsh install/translationCore4` (Linux: under
   `xvfb-run -a`, after `apt-get install` of Electron's shared libraries, `zsh`, `unzip`,
   `curl`, `lsof`, `xvfb`).
4. Upload `smoke-logs/` (the transcript and the two launcher logs) as
   `smoke-installed-<platform>`.

## Result

Both jobs passed: 15 `ok` lines and `SMOKE OK` on each platform. The stop needed no SIGKILL on either runner.

### Linux x64 (`smoke-linux-x64`)

Runner image `ubuntu-24.04` version `20260831.293.1`. Artifact `tC4-4.0.0-alpha.3-linux-x64-unsigned.zip`, id 9981772645, sha256 `c7af7fcc9c0393284d37eae614c16514f5e01b4e13c1b7d84bd4e4da7be789cd`.

```
ok artifact: /home/runner/work/translationCore4/translationCore4/install/translationCore4 (start-tc4.sh and electron are executable)
ok precondition: no tC4 server on 19119-19139 before the launch
ok first start: server on port 19119 (pid 2934), pkg_version 0.18.5, electron pid 2767 alive
ok root: 303 http://127.0.0.1:19119/clients/uw-tc4
ok client: /clients/uw-tc4 200
ok store: repo_dir /home/runner/work/_temp/smoke-home/pankosmia/tc4-projects (the production build's tC4-owned store; not pankosmia_repos)
ok create: _local_/_local_/smoke_1788664809 listed by /git/list-local-repos
ok write verse: TIT 1:1 = "tC4 smoke verse 1788664809"
ok store write: TIT 1:1 on disk at /home/runner/work/_temp/smoke-home/pankosmia/tc4-projects/_local_/_local_/smoke_1788664809/ingredients/TIT.usfm is the written verse
ok first stop: electron and server exited (pids 2767 2934), port 19119 no longer answers
ok second start: server on port 19119 (pid 3088), pkg_version 0.18.5, electron pid 3008 alive
ok restart: a new server process (pid 2934 before, 3088 after)
ok read back: TIT 1:1 still "tC4 smoke verse 1788664809" after the restart
ok delete: _local_/_local_/smoke_1788664809 removed
ok second stop: electron and server exited (pids 3008 3088), port 19119 no longer answers
SMOKE OK: /home/runner/work/translationCore4/translationCore4/install/translationCore4 under HOME=/home/runner/work/_temp/smoke-home, store /home/runner/work/_temp/smoke-home/pankosmia/tc4-projects
```

### macOS arm64 (`smoke-macos-arm64`)

Runner image `macos-15-arm64` version `20260829.0321.1`. Artifact `tC4-4.0.0-alpha.3-macos-arm64-unsigned.zip`, id 9981807985, sha256 `65e1531b3f5c292fdd1b876de924c53a582b852a07bf10a131718f2d2b0e00b1`.

```
ok artifact: /Users/runner/work/translationCore4/translationCore4/install/translationCore4 (start-tc4.command and Electron are executable)
ok precondition: no tC4 server on 19119-19139 before the launch
ok first start: server on port 19119 (pid 18161), pkg_version 0.18.5, electron pid 18090 alive
ok root: 303 http://127.0.0.1:19119/clients/uw-tc4
ok client: /clients/uw-tc4 200
ok store: repo_dir /Users/runner/work/_temp/smoke-home/pankosmia/tc4-projects (the production build's tC4-owned store; not pankosmia_repos)
ok create: _local_/_local_/smoke_1788664965 listed by /git/list-local-repos
ok write verse: TIT 1:1 = "tC4 smoke verse 1788664965"
ok store write: TIT 1:1 on disk at /Users/runner/work/_temp/smoke-home/pankosmia/tc4-projects/_local_/_local_/smoke_1788664965/ingredients/TIT.usfm is the written verse
ok first stop: electron and server exited (pids 18090 18161), port 19119 no longer answers
ok second start: server on port 19119 (pid 18536), pkg_version 0.18.5, electron pid 18456 alive
ok restart: a new server process (pid 18161 before, 18536 after)
ok read back: TIT 1:1 still "tC4 smoke verse 1788664965" after the restart
ok delete: _local_/_local_/smoke_1788664965 removed
ok second stop: electron and server exited (pids 18456 18536), port 19119 no longer answers
SMOKE OK: /Users/runner/work/translationCore4/translationCore4/install/translationCore4 under HOME=/Users/runner/work/_temp/smoke-home, store /Users/runner/work/_temp/smoke-home/pankosmia/tc4-projects
```

## Runs before this one, same branch

| Run | Commit | Result | What it showed |
|---|---|---|---|
| 34007702506 | `09cb2c8` | both smoke jobs failed at the first step | `actions/download-artifact@v7` extracted the zip itself and dropped the execute bits: `start-tc4.sh` and `start-tc4.command` at mode `-rw-r--r--`. The jobs now download the raw zip through the API and unpack it once; the script now says "exists but is not executable" for this case. |
| 34008006559 | `7ded5be` | Linux passed (15 `ok` lines, `SMOKE OK`, artifact 9981577816, sha256 `74790db3b32c514d1b948e7952a76dc102cbf89d35c0ed5f271fa9fdaec123e5`); macOS failed at `first stop` | On the macOS runner, Electron or the server was still alive 30 s after SIGTERM. Not reproduced since; the script now sends SIGKILL to a process still alive after 10 s and reports it. |
| 34008349821 | `42e3418` | both passed | macOS: artifact 9981727736, sha256 `6653b1842a8dd2dc2a7fe3460ea9c1cc649b66098f91c8bef98447680a8f7a48`; the stop needed no SIGKILL. |
| 34008490911 | `63e827e` | both passed | The round-2 review repairs (strict POST envelopes, exact TIT 1:1 compare, liveness checks). |

## Limits

- The runners are clean machines but not a pilot's machine: no Gatekeeper prompt on macOS
  (the unsigned app is launched from a shell, and the runner image does not quarantine the
  download), no desktop session on Linux (`xvfb-run`). A pilot's first launch on macOS meets
  the "unidentified developer" dialog (`docs/PACKAGING.md`, "Known limits").
- The smoke project is created and the verse written through the server's HTTP surface, not
  through the client's screens. The app's screens are the Playwright journeys' subject.
- One run per platform per commit. Timing is not measured.
- Windows is not covered: the pipeline has no Windows artifact yet (issue #181).
