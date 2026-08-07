# tc4-POC-2 learnings (2026-07-16)

**What it is:** a local-only fork of `pankosmia/desktop-app-tc4` (branch `poc/ui-rework`,
14 commits) that vendored a new single-page client (`clients/tc4-poc`, Vite + React)
implementing the full tC4 design mockup — Home/projects, New-Bible + Add-book/import +
Source-texts + Export modals, Draft, Check (tW/tN/alignment), Publish — first on demo data,
then wired **live against a stock `pankosmia-web` 0.16.20 server** with real persistence,
real resources, real Door43 downloads, and print-CSS PDF. End-to-end verified in a browser
against on-disk repos. Never pushed anywhere. Status of the POC codebase itself: **evidence,
not product** — the observations below carry weight; the code does not.

## Confirmed (de-risks the plan)

1. **The documented endpoint surface works end-to-end from a browser client.** Verified live:
   `GET/POST /api/burrito/ingredient/raw/<repo>?ipath=…` (reads + writes with
   `update_ingredients`), `POST /api/git/new-text-translation`, `POST /api/git/new-scripture-book`,
   `GET /api/git/list-local-repos`, `GET /api/burrito/metadata/summaries`,
   `POST /api/burrito/metadata/remake-ingredients`, `POST /api/net/enable|disable` →
   `GET /api/gitea/remote-repos/<server>/<org>` → `POST /api/git/clone-repo/<path>`,
   `GET /api/i18n/negotiated`, `GET /api/settings/languages`. A project was created, a book
   seeded, a verse drafted in the browser, and the text confirmed present in the on-disk USFM;
   Door43 repos (`fr_gl/fr_ta`, `fr_tw`) cloned and listed. This moves ARCHITECTURE §3.1 and the
   HTTP-store increment (BACKLOG I1.2.1/I1.2.2) from "documented" to "demonstrated."
2. **A single unified client covering all five surfaces is viable on the platform.** Parity audit
   vs the mockup: 48 faithful / 9 minor / 0 missing / 5 deferred. Registration + serving at
   `/clients/<id>` works (appears in `/api/list-clients`).
3. **The sections-are-presentation model works in practice** (STATE D14). Chunk grouping derived
   at load from the *source* text's `\ts\*` milestones, with a **fallback ladder `\ts\*` → `\p` →
   per-verse** (`src/data/usfm.js`; parser records `chunkMode`). Verified against disk: JON
   renders exactly the 7 en_ult `\ts` chunk boundaries (and JON has **17 verses** — corrected an
   earlier 16-verse assumption); DAN parses 175/175. Chunk cards with per-verse fields also
   remove the verse-marker-placement step that chunk-editing tools historically imposed.
4. **New books can be seeded from the source skeleton.** `POST /git/new-scripture-book` writes no
   `\ts` markers, so the client seeded the book from the en_ult skeleton (TIT: 23 `\ts\*`,
   matching en_ult exactly). Adopt for J1/add-book: seed from the pinned source, don't rely on
   the server template.
5. **Real helps derive from local resource repos.** en_tn TSV (7-col:
   Reference/ID/Tags/SupportReference/Quote/Occurrence/Note) rendered and matched on-disk rows;
   en_ta articles loaded; a live Titus check session showed 64 real checks including UGNT Greek
   plus the previously persisted draft. Note: local layout had no `en_twl`, so tW items were
   derived without it — plan the TWL-absent path (relates to OPEN-QUESTIONS #24 pin decisions).
6. **Print-CSS PDF is a viable publish path** (input to the E3.3 decision): full-book print DOM
   with `@media print`, 1↔2 column toggle, spacing/dropcap/verse-number/RTL classes — no
   dependency on the platform's PDF client.
7. **Landing behavior observed** (input to OPEN-QUESTIONS #4): a stock run redirects
   `127.0.0.1:19119` → `/clients/main` (the dashboard build); client registration lives in
   `app_setup.json`, which is gitignored and **rebuilt/wiped by the run script** — a vendored
   client must re-register (`npm run install:server`) after every build wipe. The enforcing
   mechanism for "main" is still unread — #4 stays open, now with a concrete starting point.

## Divergences — POC conveniences that must NOT carry into tC4

1. **Checking persistence used a companion repo** (`_local_/_local_/<abbr>_tcchecks` with a single
   `ingredients/tc4_checks.json` `{version, status, alignGroups:{"<checkId>:<mode>":[{src,tgt}]}}`).
   That is the copied-project pattern this project retires, and the flat record is not the
   BURRITO-SPEC §5.2 decision shape (the full-record requirement exists precisely because
   simplified shapes fail to round-trip into the tC3 contract). tC4 persists to `checking/`
   sidecars **inside** the project repo, full §5.2 records. The POC took the shortcut knowingly
   (its own comments say why); the learning is that the *write path* (raw-ingredient writes to a
   repo) is proven — only the destination and shape change.
2. **Writes always passed `no_bak`.** Spec W-3: keep `.bak` undo for USFM writes; `no_bak` is for
   high-frequency sidecar writes only.
3. **Alignment persisted as index pairs** (`src`/`tgt` token indexes per check) — not the §5.1
   word/occurrence alignment shape; index-based records break under any tokenization change.
   UI interaction (drag-drop) is validated; the storage shape is not.
4. **Whole-book USFM writes on draft save.** Works, but Phase-1 tC4 requires the byte-strict
   splice discipline (STATE D8) — the POC did not exercise identity preservation outside the
   edited verse.

## Assembly/template gotchas (new; verified in the dev loop)

- `build_server.zsh` asks an interactive "Is the server off?" question — **always pass `-s`**
  when scripting; a hung prompt cost 2.5 h of wall clock.
- The run script's build step **wipes client registration** (gitignored `app_setup.json`):
  re-run the client's `install:server` step after every build, then restart.
- A client served under `/clients/<id>` needs Vite `base: './'` — absolute asset paths 404
  under the subpath.
- The template's build scripts clone **live branches** (no pins) and mutate
  `Cargo.toml`/`Rocket.toml` via `sed`; treat assembled builds as unpinned unless the app repo
  pins them deliberately (`local_server.env` pins the crate: `0.16.20`).
- Local project repos live at `_local_/_local_/<name>` (source/org/repo path convention).
- User data root: `~/pankosmia_working`; resource clones: `~/pankosmia_repos/git.door43.org/…`.

## Plan deltas adopted from this POC

- Drafting fallback ladder `\ts\*` → `\p` → verse replaces the earlier whole-chapter-fallback
  proposal (ARCHITECTURE §5; BURRITO-SPEC §8.4a note) — [PROPOSED], validated here.
- Book seeding from the pinned source skeleton (BACKLOG I1.3.1 acceptance).
- Print-CSS added as the leading E3.3 candidate.
- OPEN-QUESTIONS #4 updated with the observed landing/registration mechanics.
