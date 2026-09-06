# Resume across a rig restart — the issue #184 record

**Date:** 2026-09-05 (22:11 EDT; the timestamps below are UTC). **Commit:** `2d6571e` on branch
`i184-resume-proof` (parent `c265b99`, `main` at that time).

**Machine**, each value read on the day by the command beside it:

| Value | Command | Output |
|---|---|---|
| CPU | `sysctl -n machdep.cpu.brand_string` | `Apple M2 Pro` |
| Memory | `sysctl -n hw.memsize` | `17179869184` |
| OS | `sw_vers` | `ProductName: macOS`, `ProductVersion: 26.5.1`, `BuildVersion: 25F80` |
| Node | `node --version` | `v22.14.0` |
| Rig | `curl -s http://127.0.0.1:19998/api/version` | `"pkg_version":"0.18.5"`, `"product_name":"tC4 dev rig"` (the rig binary is built from git rev `99fd9be`, `dev-env/server`) |
| Playwright | `grep '"version"' node_modules/@playwright/test/package.json` | `1.61.1` (Chromium is the one this version bundles) |
| Client | `npm run dev` | the Vite dev server at `http://localhost:5199` |

## What was measured

The half of the resume proof that a journey cannot drive: the **server** restarts, not only the
app. A translator drafts a verse, the rig server stops, the rig server starts again without a
reseed, the app reloads, and the translator uses the Resume card. The app-restart half (a page
reload on a running rig) is the first J8 test in `e2e/j08-resume.spec.ts`, live since this commit.

The Resume record (`lastEdit`) is per-installation state. The app writes it through
`POST /client-settings/uw-tc4`; the rig keeps it at `dev-env/state/work/client_settings/uw-tc4.json`.
This run checks that record on disk at each step.

## Method

1. `dev-env/scripts/seed.zsh` (pristine rig: `sample_burrito`, `sample_burrito_large`, the
   sideloaded suites, no Resume record).
2. The script `docs/evidence/tools/resume-restart-2026-09-05.mjs` drives Chromium against the
   dev server. It ran from the repository root as
   `node ./.resume-restart-tmp.mjs` (a copy of the script placed at the root so that
   `@playwright/test` resolves; the copy was deleted after the run). Its header gives the launch
   procedure. In order:
   1. Open `sample_burrito` › Titus, chapter 2. Draft the first undrafted verse with the text
      `La gracia de Dios se ha manifestado para salvación (reinicio del servidor).` Wait for the
      save indicator to show `saved`. Read the client-settings file until it carries `lastEdit`.
   2. `dev-env/scripts/stop.zsh`. Negative control: `GET /api/version` must fail, and a page
      reload must show the Home error banner with no project cards.
   3. `dev-env/scripts/run.zsh` in the background. No seed: `run.zsh` seeds only when
      `state/work` is absent. Wait for `GET /api/version`.
   4. Reload the app. Compare the project cards on Home with the directories under
      `state/work/repos/_local_/_local_`. Read the Resume card's text. Click it. Wait for the
      drafted text. Read the selected mode tab and the chapter heading.
   5. Read the project's commit count at the start, after the draft, and at the end.

## Result

```
[02:11:30.254Z] rig version before: 0.18.5
[02:11:30.255Z] client settings before: lastEdit=null
[02:11:30.268Z] commits before: 1
[02:11:31.727Z] drafted at Titus 2; save indicator: saved
[02:11:32.733Z] client settings after draft: lastEdit={"at":1788660691670,"book":"TIT","chapter":2,"repoPath":"_local_/_local_/sample_burrito","snippet":"La gracia de Dios se ha manifestado para salvación (reinicio del servidor).","verse":"1"}
[02:11:32.766Z] commits after draft (no checkpoint expected): 1
[02:11:32.827Z] rig server stopped
[02:11:32.833Z] rig version while stopped: null
[02:11:34.424Z] app reloaded while the rig was down: home-open-error banners=1, project cards=0
[02:11:34.638Z] rig version after restart: 0.18.5
[02:11:34.639Z] client settings after restart: lastEdit={"at":1788660691670,"book":"TIT","chapter":2,"repoPath":"_local_/_local_/sample_burrito","snippet":"La gracia de Dios se ha manifestado para salvación (reinicio del servidor).","verse":"1"}
[02:11:35.788Z] projects on disk: sample_burrito, sample_burrito_large
[02:11:35.788Z] project cards on Home: project-_local_/_local_/sample_burrito, project-_local_/_local_/sample_burrito_large
[02:11:35.793Z] resume card text: "Equipo Ejemplo — Tito y Jonás · Titus 2\n\nLast edited verse 1 — “La gracia de Dios se ha manifestado para salvación (reinicio del servidor).”\n\nResume →"
[02:11:36.011Z] after Resume: Translate tab aria-selected=true; heading="Titus 2"; drafted text on screen=true
[02:11:36.028Z] commits at the end: 1
```

| Check | Result |
|---|---|
| Resume record on disk before the draft | none |
| Resume record on disk one second after the draft | `sample_burrito`, TIT, chapter 2, verse 1, the drafted snippet |
| Rig stopped (negative control) | `GET /api/version` unreachable; Home shows the error banner and 0 project cards |
| Resume record after the restart | identical to the record before the stop (same `at`) |
| Projects listed after the restart | 2 of 2 directories on disk have a card on Home |
| Resume card | names the project (`Equipo Ejemplo — Tito y Jonás`), the book and chapter (`Titus 2`), and the drafted verse |
| After Resume | mode tab `Translate` selected; heading `Titus 2`; the drafted text on screen |
| Commits | 1 throughout: a save is not a checkpoint (D9) |

One run, one machine.

## Limits

- Development build (the Vite dev server), not the packaged application. The packaged
  application's server restart is the post-install smoke test (issue #45).
- The rig server start was fast: the script spawned `run.zsh` right after the log line at
  `02:11:34.424Z` and `GET /api/version` answered at `02:11:34.638Z`. A slow server start was
  not measured.
- The app-restart half (a page reload with the rig up) is not in this record: it is the first
  J8 test. The run below is `npx playwright test e2e/j08-resume.spec.ts` on the spec as
  committed in the same change set as this paragraph (the round-1 review repair), 2026-09-05,
  reseeded rig:

  ```
  Running 4 tests using 1 worker

    ✓  1 e2e/j08-resume.spec.ts:72:3 › J8 — a translator resumes where they left off › after a restart, all projects are listed and the last position (project/book/chapter/mode) is restored (FR-29, #184) @inc4 @J8 (3.5s)
    ✓  2 e2e/j08-resume.spec.ts:110:3 › J8 — a translator resumes where they left off › resume into a project with a large journal shows the open progress, then lands on the remembered chapter (#184, #95) @inc4 @J8 (11.9s)
    ✓  3 e2e/j08-resume.spec.ts:138:3 › J8 — a translator resumes where they left off › commits happen at exactly the checkpoints — a mode switch and leaving the project commit pending work; a switch with nothing pending commits nothing (FR-34 / W-4, D9, #183) @inc4 @J8 (4.0s)
    ✓  4 e2e/j08-resume.spec.ts:176:3 › J8 — a translator resumes where they left off › typing never produces a commit (FR-34) @inc4 @J8 (3.4s)

    4 passed (30.2s)
  ```

  The same spec after `e2e/j02-draft-verse.spec.ts` on one seed (the order of a full
  `npm run journeys`): 8 passed (40.0s). The rig job in CI runs no Playwright journey, so
  this proof is local.
- Not measured: a resume after a checkpoint commit, a second actor, a project that was
  deleted while the rig was down (the app hides the card when the project is gone,
  `refreshProjects` in `src/state.jsx`; not exercised here).
