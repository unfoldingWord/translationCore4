# tC4 Unified Client — Architecture

**Version:** 1.2-draft · 2026-07-30 (1.1: A-5 alignment sweep after the 2026-07-06 independent review. 1.2: consistency pass for STATE D22–D29 — corrected zip import endpoint, versification/vrs.json, scope-honoring derive and progress, S-1/S-2 permanent with client role re-assertion, RCL contexts-only, product repo + pnpm toolchain, rig re-baselines at 0.18.3 and 0.18.5)
**Scope:** the single unfoldingWord client that owns drafting, checking, and publishing on the Pankosmia platform. Phase 1 in full; Phase 2 components in outline.

**Why one client** [decided 2026-07-03]: three paths were evaluated — (A) assemble the app from the platform's existing separate clients, (B) keep the `pankosmia-web` server and build one unified client, (C) a standalone rebuild. Path (B) was selected. A Pankosmia product is normally composed of many clients, one per function — 11 to 12 in the shipped products (`app_config.env` in `desktop-app-pithekos` and `desktop-app-renaissance`), which the platform states as a design distinctive ("multiple clients per product, including standard clients for core functionality" — Pankosmia-Documentation). tC4's draft↔check loop needs one client that owns both surfaces on one stored text, so tC4 ships a single client and registers it for the `textTranslation` flavor. This is the platform's documented extension pattern, the same one `core-contenthandler_t_core` uses for the `x-tcore` flavor [VERIFIED 2026-08-04 — `pankosmia_metadata.json` `endpoints` keys]. Every option required a rewrite of both major UI surfaces, so the choice was only about the substrate. The server substrate is kept because git-backed storage, SB metadata handling, DCS resource download with an authenticated proxy, versification, i18n, and 3-OS packaging all exist and work [VERIFIED — endpoint inventory].

**Companions:** `BURRITO-SPEC.md` (project format — normative), the GitHub issues + project board (work breakdown — D38), `PLATFORM-NOTES.md` (gotchas & verification recipes), `DECISIONS.md` (the decision log), `RISKS.md` (the risk ledger). Legacy reference IDs are decoded in `LEGACY-IDS.md`.
**Retired source:** this document absorbed the scope and rationale of a retired 2026-08-04 predecessor document (maintainer workspace).
**Tags:** [VERIFIED] = read in source / proven by test; [PROPOSED] = design decision to be exercised by implementation.

---

## 1. System context

```
┌─ Desktop app (Electronite shell, template build) ─────────────────────────┐
│  pankosmia-web (Rust, crates.io pin) — localhost HTTP under /api          │
│    storage: git repos as Scripture Burritos      git/DCS/gitea proxy      │
│    static clients under /clients/<id>            SSE state, i18n, fonts   │
│                                                                            │
│  Clients bundled by app_config.env (our repo, our choice):                 │
│    core-client-dashboard   (CLIENT1 — platform convention, keep)           │
│    core-client-settings    (keep)                                          │
│    uw-tc4                  (NEW — this document; drafting+checking+publish)│
│    core-contenthandler_version_manager (keep initially — git/DCS UI)       │
│  Dropped from today's tc4 bundle: core-client-content, core-client-        │
│  workspace, core-contenthandler_t_core, core-contenthandler_text_          │
│  translation, uw-client-checks (superseded by uw-tc4), generic,            │
│  pdf_publisher (functionality absorbed — see §7).                          │
└────────────────────────────────────────────────────────────────────────────┘
```

- When we drop `core-client-content` and `core-client-workspace` from **our bundle**, the edit-endpoint collision goes away. Only one editor for each flavor is then reachable in the content grid — [VERIFIED]. No upstream change is necessary. Other Pankosmia apps continue to use these clients. We change only our own `app_config.env`.
- The landing mechanism is verified: `product.json` `"homepage"` selects the landing client, and since 0.18.0 the server panics at startup when no client is registered at `/clients/<product.homepage>` (PLATFORM-NOTES #25) [VERIFIED — rig re-baselines at pkg_version 0.18.3 and 0.18.5, 2026-07-30; D27(a)]. The rig sets `"homepage": "main"`. Remaining scaffold task: set `homepage` to the tC4 client. That closes OPEN-QUESTIONS #4.
- The build copies clients from **local sibling checkouts**. The app repo's config lists these checkouts. There is no GitHub-org lock-in [VERIFIED — template `build.js` reads local paths]. The product repo is `github.com/unfoldingWord/translationCore4` [decided 2026-07-29 — D24(b)]. `uw-tc4/` stays the local prototype.
- The desktop shell **must be Electronite** (unfoldingWord's Graphite-enabled Electron fork, github.com/unfoldingWord/electronite). Complex-script languages require SIL Graphite smart-font rendering. Plain Electron/Chromium does not shape Graphite-only fonts [decided 2026-07-19 — D20]. OPEN-QUESTIONS #25 asks two things: is the Pankosmia template's shipped wrapper already Electronite, and where does our build point it there? TEST-PLAN M-5 verifies Graphite rendering in the packaged app.

## 2. The uw-tc4 client

The client is a React SPA (Vite), served at `/clients/uw-tc4`. It registers in its `pankosmia_metadata.json` for flavor `textTranslation` (`edit` endpoint). It uses `pithekos-lib` for HTTP/SSE/i18n helpers — the same integration surface that uw-client-checks uses today [VERIFIED]. It uses `pankosmia-rcl` for its **contexts only** (`netContext`, `i18nContext`, `currentProjectContext`, `bcvContext`, `typographyContext`, `authContext`, `languagesContext`, `messagesContext`, `clientConfigContext`, `clientInterfacesContext`, `snippetContext`, `wordContext`, `debugContext`) — no `Pan*` or shell visual components. All chrome and all surfaces are our own designs; `PanVersificationPicker` stays a reference only [decided 2026-07-30 — D29]. Pin `pankosmia-rcl` exactly [VERIFIED — pankosmia-rcl@0.4.0 unpacked from npm].

**Toolchain [decided 2026-07-30 — D29 packaging note]:** the Pankosmia team switches npm → pnpm in the week of 2026-08-03. Plan a pnpm workspace and a lockfile, with exact-version pins for all pankosmia packages (the bundled clients run `pankosmia-rcl` 0.2.5 and ^0.3.1; npm latest is 0.4.2 as of 2026-07-30 — 0.4.1/0.4.2 add one export, `productContext`, nothing removed [VERIFIED — tarball diff]). **Timing [decided 2026-07-30 — D29 timing update]:** the upstream transition will probably not finish before Increment 1 closes; Increment 1 builds with npm (exact pins), and the pnpm move is its own later task.

### Proposed source layout [PROPOSED]

```
src/
  app/            shell, routing, contexts, i18n, theme
  data/           ← everything below §3; NO React imports here
    serverApi.ts       thin typed wrappers over the endpoints (§3.1)
    burritoStore.ts    project-level operations (§3.2)
    derive/            targetBible, check-item derivation, progress (§3.3)
    resources/         pin resolution, clone-at-version, repo readers (§3.4)
  checking/       session assembly (§4 — contract; UI is design-native per A-5)
  drafting/       editor (§5)
  publishing/     USFM export, PDF (§7)
  migrate/        x-tcore + tC3 importers (§8)
```

The `data/` layer is framework-free by design. This follows the POC-agnostic principle. The layer is the exit ramp: if the platform changes, this is the only layer that we must implement again.

## 3. Data layer

### 3.1 Server endpoints used (all [VERIFIED] in pankosmia-web/uw-client-checks source unless marked)

All routes are under the server's `/api` prefix. The `pithekos-lib` helpers (`getJson`, `getText`, `postJson`, `postEmptyJson`) apply the base and the prefix. Confirm the exact prefixing in pithekos-lib when you wire the client. The current checks client calls these routes through the same helpers.

| Purpose | Route | Notes / gotchas |
|---|---|---|
| Read ingredient | `GET /burrito/ingredient/raw/{src}/{org}/{repo}?ipath=…` | select json or text by the file extension |
| Read many | `GET /burrito/ingredients/raw/…?ipath=<dir>` | returns `{filename: content}` |
| List repo files | `GET /burrito/paths/{src}/{org}/{repo}` | used for existence checks |
| Write ingredient | `POST /burrito/ingredient/raw/…?ipath=…[&update_ingredients][&no_bak]` body `{"payload": "<string>"}` | creates dirs; a missing or non-string payload returns 500 (the panic was ≤0.16.x history, fixed at 0.17.0 — PLATFORM-NOTES #7); see BURRITO-SPEC §6 W-1..W-3 |
| Delete / revert | `POST /burrito/ingredient/delete/…` (renames to `.bak`), `/burrito/ingredient/revert/…` | single-level undo model |
| Re-register files | `POST /burrito/metadata/remake-ingredients/{path}` | full rescan; wipes `role`/`relationships` permanently, by design — re-assert tC4's roles client-side after every remake [decided 2026-07-30 — D28] |
| Repo metadata | `GET /burrito/metadata/summary/{path}`, `GET /burrito/metadata/summaries` | summaries = project/resource listing (filter by flavor client-side) |
| Export zip | `GET /burrito/zipped/{repo_path}` | the whole repository directory as one unwrapped zip, with no filter (`.git/`, `*.bak`, `.DS_Store` are inside); the Scripture Burrito export filters it (#359) |
| Import zip | `POST /burrito/zipped/{repo_path}` (multipart field `file`) | zip must hold a root `metadata.json` + `ingredients/`; the target must start with `_local_/_sideloaded_/` and must not exist (400 otherwise — delete the local copy first, or change the id info in the zip); `remake_burrito_from_zip` is tC4-prototype support only, PLATFORM-NOTES #22 [decided 2026-07-27 — D22] |
| New project | `POST /git/new-text-translation` | stamps template repo, initial commit; creation requires a `versification` (tC4 default `eng`, user-changeable — list from `GET /content-utils/versifications`); the platform writes `ingredients/vrs.json` and scaffolds books from `maxVerses` [decided 2026-07-30 — D25] |
| Git | `GET /git/branches/{path}`; `POST /git/branch/{branch}/{path}` (checkout), `/git/new-branch/{branch}/{path}`, `/git/clone-repo/{remote}`, `/git/pull-repo/origin/{remote}`, `/git/add-and-commit/{path}` body `{commit_message}`, `POST /git/push/{path}` (json body — confirmed in push.rs); also status/log/remotes/copy/delete |
| Git named-branch integration | **RESOLVED with existing endpoints, no upstream change (verified 2026-07-18, transport rig 10/10 @ 0.17.0; re-baselined 10/10 @ 0.18.3 and again @ 0.18.5 — D27 + update, 2026-07-30, `evidence/rig-rebaseline-0.18.5-2026-07-30.md`):** one **single-branch publication repo per actor** makes `pull-repo` deterministic. There is one head, so no incorrect head can be selected. Integrate via copy → `remote/add` (local) → `pull-repo` → validate → union-write → regenerate → commit → `pull-repo` ff into main. Multi-branch `pull-repo` is measured **ordering-steered** (unsafe). Do not trust the worktree after a normal merge — PLATFORM-NOTES #21. `evidence/transport-rig-2026-07-18.md` |
| DCS catalog | `GET /gitea/remote-repos/{host}/{org}`; proxy login `GET /gitea/login/{token_key}/{redir_path..}` (confirmed in gitea_proxy_login.rs); also endpoints/logout/user-remote-repos/my-collaborators |
| Versification | `GET /content-utils/versifications` (list — six schemes); `GET /content-utils/versification/{scheme}` (one scheme, e.g. `eng`) | `eng` is the tC4 default, user-changeable at creation (`PanVersificationPicker` is a reference only — D29); the platform writes `ingredients/vrs.json` into each project; refs are stored in the project's chosen frame, and the Proskomma mapping maps TSV and original-language refs into that frame client-side at derive time [decided 2026-07-30 — D25; D24(c)] |
| App state | `POST /app-state/current-project/{repoPath}`; current-project context via pankosmia-rcl | how the shell passes "open this project" |
| Net gate | `POST /net/enable` | offline-first: all DCS ops gated on net context |

The branch switch refuses a dirty working tree (`set_branch.rs`). Always commit first [VERIFIED].

### 3.2 BurritoStore interface [PROPOSED, shapes normative per BURRITO-SPEC]

> Every store operation returns the one `Report` shape (`journal/report.mjs`) once https://github.com/unfoldingWord/translationCore4/issues/156 lands; this interface gains that return type in the same pull request [D79; marked line].

```ts
interface BurritoStore {
  listProjects(): Promise<ProjectSummary[]>;              // summaries, flavor==textTranslation
  open(repoPath: RepoPath): Promise<ProjectHandle>;

  readBook(book): Promise<{usfm: string, md5: string}>;
  writeBook(book, usfm, opts?: {expectMd5?: string}): Promise<void>;  // whole-book; optimistic check [PROPOSED]

  readAlignments(book): Promise<AlignmentFile | null>;    // BURRITO-SPEC §5.1
  writeAlignments(book, data): Promise<void>;             // MUST normalize occurrences (I-2)

  readDecisions(tool, book): Promise<DecisionFile | null>;// §5.2
  upsertDecision(tool, book, decision): Promise<void>;    // merge by identity key

  readResources(): Promise<ResourcesFile>;                // §5.3
  readSettings()/writeSettings();                         // §5.4

  commit(message: string): Promise<void>;                 // add-and-commit; call at checkpoints (W-4)
}
```

Write policy: sidecar writes pass `update_ingredients`. USFM writes keep the `.bak` undo. Call `commit()` at session close, at book-done, and before sync. Concurrent-write protection beyond `writeBook`'s `expectMd5` (compare-and-swap / read-merge-retry for sidecars) is OPEN-QUESTIONS #17.

### 3.3 Derivation pipeline (the heart of single-source checking) [mechanisms VERIFIED via harness]

```
resources.json ─┐
                ├─► ensureResourcesLocal()  clone missing repos, checkout pinned version
<BOOK>.usfm ────┼─► targetBible = usfmjs.toJSON(usfm)        (chapters + headers)
orig <BOOK>.usfm┼─► origBible   = usfmjs.toJSON(usfm)
tN/tW <BOOK>.tsv┴─► derivedItems = derive/ TSV→items (parity ref: RCL twlTsvToGroupData…)
decisions file ───► merge by identity key ──► checkingData {category:{groupId:[items]}}
alignments file ──► per-verse validity check (targetVerseMd5) ──► aligner inputs
                                             └─► progress = decided ÷ scope-filtered derived-total
```

The derive step filters check items to the project scope. The progress denominator comes from the project scope, not from the whole book. A book file that holds only some verses is legal: no component may assume that a book file covers a whole book [decided 2026-07-30 — D26].

Load-time **revalidation** replaces the tC3 sync/marker files. For each stored decision with selections, run `selectionsHelpers.validateVerseSelections(currentVerseText, selections)`. If the result shows a change, flag `invalidated`. For each alignment verse, compare `targetVerseMd5`. Harness checks 12–14 prove these mechanics.

Performance is OPEN-QUESTIONS #9. Measure before you optimize. If a cache is necessary, add a disposable cache keyed by (usfm md5, tsv md5). The cache is never authoritative.

### 3.4 Resource repo readers [layouts VERIFIED in uw-client-checks]

| Resource | Local repo layout consumed |
|---|---|
| Original language | `<BOOK>.usfm` (aligned, `\w`+attributes) |
| translationWords (`en_tw`) | `payload/{kt,names,other}/<id>.md` articles + `<BOOK>.tsv` (TWL, 6-col: Reference, ID, Tags, OrigWords, Occurrence, TWLink) |
| translationNotes (`en_tn`) | `<BOOK>.tsv` (7-col: Reference, ID, Tags, SupportReference, Quote, Occurrence, Note) |
| translationAcademy (`en_ta`) | `<category>/<article>/01.md` + `translate/toc.yaml` (groupId↔title renames — keep the existing rename/reverse-rename logic) |
| Lexicon (`en_ugl`/`en_uhl`) | `content/<entry>.json` batch-read |

### 3.5 Report and refusal codes (issue #156, legibility L-3)

Every store operation reports its outcome in one closed shape, and every refusal it throws
carries one code from one closed table. Both live in `journal/report.mjs`; the TypeScript shapes
are in `src/data/journal/runtime.ts`. The export (§7), import (§8) and share kernels return the
same `Report`.

| Item | Contract | Test |
|---|---|---|
| `Report` | `{op, ok, code?, rule?, facts, startedAt, endedAt}`. `op` is one of `open`, `checkpoint`, `seed`, `reconcile`, `export`, `import`, `share`. `facts` is the operation's own record (an open: the recovery classification, the fold's forks and `phases`, the seed and reconcile Reports it ran; a checkpoint: the commit message and the paths written). A failed Report adds `facts.error` (the thrown message) and, for a refusal, `facts.refusal` (the refusal's own facts: paths, hashes, mismatches); both keys are reserved. `reportError` names the first problem of a malformed shape; `okReport` and `failedReport` emit only validated Reports. | `test/report.test.ts` |
| `REFUSAL_CODES` | code → the BURRITO-SPEC rule id it enforces, or `null` for an app rule with no R-id. Closed: `new Refusal(code, message, facts)` with a code outside the table throws. Thrown by `JournalingStore`, `JournalStore` and `journal/checkpoint.mjs`. | `test/report.test.ts`; the normative gate `conformance/normative/check.mjs` fails when a rule-bound code names a rule that is not live in §8 or §10, and lists the app-rule codes by name |
| `JournalingStore.lastReport` | The Report of the last open or checkpoint: ok with its facts, or failed with the code the thrown refusal carried. Replaces `OpenReport`. | `test/report.test.ts`; the recovery suites read it through `openFacts` |
| `expectRefusal(promise, code)` | The one way a test asserts a refusal: the rejection carries exactly `code` and the table's rule. | `test/helpers/report.ts` |

The Home banner (`src/state.jsx` `failureText`) shows a failed open's or checkpoint's thrown
diagnosis. It appends the recovery sentence of the catalog key `refusal.<code>` (`src/i18n/en.json`).
Every live code has one, approved by the owner on 2026-09-22; a test fails when a live code has
none. A reserved code shows the diagnosis alone until its issue adds the sentence. The ops record
per operation, crash recovery from it and the dev Inspector are #374.

## 4. Checking surface (tC3 contract reference — UI plan superseded by A-5)

**A-5 (2026-07-06) supersedes this section as a UI plan:** the check and alignment surfaces are design-native. Neither `tc-checking-tool-rcl`'s `Checker` nor the `@gabrielaillet/word-aligner-rcl` fork's UI is embedded (their runtime role: OPEN-QUESTIONS #14/#7). The contract below is verified against the published `tc-checking-tool-rcl@0.9.128` source — the same components the upstream checks client proved viable on-platform [VERIFIED]. We keep the contract as the normative reference for what our views must read, write, and honor:

- `<Checker>` **required:** `checkingData`, `contextId` (`{}` auto-selects first check), `glWordsData`, `targetBible`, `targetLanguageDetails` (`{id, name, direction, gatewayLanguageId, gatewayLanguageOwner, book:{id,name}}`), `translate` (i18n fn — required; English locale JSON ships in the package). **Optional:** `bibles` (array of `{book, description, languageId, bibleId, owner}` — element 0 treated as target on edit), `alignedGlBible` (OPEN-QUESTIONS #8), `checkType`, `getLexiconData(lexId, entryId) → {[lexId]:{[entryId]: data}}`, `initialSettings`, `showDocument`, `disableFontMenu`, plus the callbacks below.
- **Callbacks → persistence mapping:**
  - `saveCheckingData(newState)` → read `newState.currentCheck` (`verseEdits, contextId, selections, comments, nothingToSelect, reminders, invalidated`) → `upsertDecision` (coerce empty selections to `false`).
  - `changeTargetVerse(chapter, verse, newText, targetVerseObjects)` → `writeBook` with the verse replaced (plain text — alignment stays in sidecar) → update that verse's alignment entry (`updateAlignmentsToTargetVerse` result → sidecar, new `targetVerseMd5`) → run selections revalidation for decisions on that verse → flag `verseEdits`/`invalidated`.
  - `changedCurrentCheck(ctx)` → navigation state only.
  - `saveSettings(settings)` → `settings.json` `ui` block.
- **WordAlignmentTool:** assemble the inputs from targetBible + orig + alignment sidecar via `wordaligner.merge`; `saveNewAlignments` → `unmerge` → sidecar write (I-2 normalization). `initializeGroupDataForScripture` generates its in-memory groupsData — OPEN-QUESTIONS #7 verifies this during implementation.

Definitive integration test (per A-5): a full checking session in the design-native uw-tc4 client against `sample-burrito/` (OPEN-QUESTIONS #6, first milestone of E2.1).

## 5. Drafting surface [PROPOSED — new build; requirements from verified failures]

- The editor is tS-style chunked editing over the parsed book (verse or section granularity), with autosave. **Section grouping is presentation only** (the project owner, 2026-07-07). The editor derives the sections at load from the pinned *source* text's `\ts\*` milestones. The fallback ladder is `\ts\*` → `\p` paragraphs → per-verse ([PROPOSED — validated live in tc4-POC-2, 2026-07-16: JON renders exactly en_ult's 7 `\ts` chunks; DAN 175/175; parser records its `chunkMode`]). The target draft never contains `\ts\*` (BURRITO-SPEC §4.1/§8.4a). A section save writes the changed verses; nothing section-shaped is persisted. Chunk cards with per-verse fields also remove the verse-marker-placement step that chunk editors historically imposed (POC-2 evidence doc).
- **Requirement D-1 (from the verified data-loss failure):** the editor pipeline MUST be identity-preserving for everything it does not intentionally change. That is: the regenerated USFM differs from the input only in edited verse text. A round-trip property test in CI enforces this (parse→serialize over aligned & exotic USFM corpora; compare canonicalized).
- D-2: writes are plain USFM (I-1). No zaln ever enters the file, so nothing can be destroyed.
- D-3: whole-book read-modify-write with the md5 optimistic check. On a mismatch, reload and replay the edit (the single-app Phase 1 makes this rare).
- D-4: after a save, if a checking session is open for the book, trigger in-memory revalidation for the affected verses. Otherwise the load-time revalidation handles it.
- Do NOT reuse `core-client-workspace`'s `usfm2draftJson`/`draftJson2usfm` [VERIFIED destructive].

## 6. Project browser & lifecycle

List `textTranslation` projects from `metadata/summaries`. Create a project via `/git/new-text-translation`. Creation passes a `versification` (tC4 default `eng`, user-changeable); the platform writes `ingredients/vrs.json` into the project [decided 2026-07-30 — D25]. Add books: write stub USFM + `update_ingredients`. Apply scope updates via remake. Scope entries may be `[]` (whole book — the default) or SB range arrays, for example `{"TIT": ["1:1-2:5"]}` [decided 2026-07-30 — D26]. Every remake wipes the `x-` roles by design: the store re-writes tC4's roles immediately after each remake or `update_ingredients` regeneration — client-side, with no upstream dependency [decided 2026-07-30 — D28]. Set the current project via app-state before you enter the workspaces. This matches the shell convention [VERIFIED].

## 7. Export and share (module map) [decided 2026-09-22 — D79]

Files leave the app as browser downloads; Electron routes a download to the operating-system
save dialog. The renderer has no file-system bridge [VERIFIED — `scripts/desktop-main.cjs`,
main fb14ba5, 2026-09-22]. The main process handles `will-download` in tC4's own entry file and
reports each download's result (completed, cancelled, interrupted) to the page, so the menu says
"Saved" only after a completed download (D80 point 1; #382). The packaged app loads tC4's own
preload, `scripts/preload.cjs`, which the packaging recipe copies over the template's
`preload.js` (#20). It exposes two members: `electronAPI.setCanClose`, the unsaved-work close
guard, unchanged from the template (PLATFORM-NOTES #45), and `tc4Desktop.printPdf`, the PDF
bridge. The PDF bridge prints a print document to PDF bytes in a hidden window with
`printToPDF`; the bytes return to the producer, and the kernel downloads them like any other
file (task 1 of #20, owner-approved 2026-09-24) [VERIFIED — evidence/pdf-bridge-2026-09-24.md].
Every export is a pure producer registered in one table; the kernel
owns the checkpoint, the download, the `Report` and the menu. Each pull request that touches a
row updates the row.

| Module | Contract | Owner issue | Platform route | Test helper | e2e helper / block |
|---|---|---|---|---|---|
| `src/data/export/kernel.ts`, `producers.ts`, `src/views/ExportMenu.jsx` | `ExportProducer`, `ExportInput`, `ExportFile`; `runExport` → `Report` (`op: 'export'`, facts `{producer, filename, bytes}`): the D9 checkpoint through `commitPending` when the project is dirty, then `produce`, then `deliverFile` (the only Blob URL). A failure delivers nothing: `export.checkpoint-failed`, the producer's own refusal when it throws one (the PDF's `export.nothing-drafted`), or else `export.read-failed`. `exportFilename` gives `<subject>-<YYYY-MM-DD>.<ext>`. `PRODUCERS` is the one table. `ExportMenu` is the design system's `Menu` over the table, filtered by `appliesTo`; while no producer applies, it states when the exports arrive. The `exportFile` action in `src/state.jsx` drains the save schedulers first. | https://github.com/unfoldingWord/translationCore4/issues/375 | none (D9 checkpoint via `add-and-commit`) | `test/exportKernel.test.ts`; `test/helpers/export.ts` `assertProjectUnchanged` | `e2e/helpers/export.ts` `captureDownload`; `j07` kernel case (dev-only fake producer, flag `tc4.e2e.fakeExport`) |
| `src/data/export/pageSetup.ts` | `PageSetup`: semantic choices only (columns, spacing, drop-cap chapters, verse numbers, `paper` `'a4'` or `'letter'`, `pictures`, `obsLayout` `'above'` or `'wrapped'`), held in memory, never stored (D80 point 5). `DEFAULT_PAGE_SETUP` is frozen. `CommunityChecking` holds one page setup for the Bible and the OBS card and gives it to `ExportMenu`; `actions.exportFile(producer, pageSetup)` passes it to `runExport` as `ExportInput.pageSetup`. A producer reads the page setup only from its input. The OBS layout row is #11 | https://github.com/unfoldingWord/translationCore4/issues/142, https://github.com/unfoldingWord/translationCore4/issues/381 | none | `test/nav-community-checking.test.tsx` (the fake producer receives the page setup) | the J7 PDF block reads it through the producer |
| `scripts/desktop-main.cjs` (`will-download`) | planned in #382: the result of each download to the page; the `Toast` in `ExportMenu` | https://github.com/unfoldingWord/translationCore4/issues/382 | none | `scripts/desktop-bootstrap.test.cjs`, `test/exportMenu.test.tsx` | a manual packaged run in the pull request |
| `src/data/export/usfm.ts`, `weave.mjs` | producers `usfm-aligned` ("USFM, aligned", file `<BOOK>-aligned-<YYYY-MM-DD>.usfm`) and `usfm-plain` ("USFM, plain", file `<BOOK>-<YYYY-MM-DD>.usfm`), for Bible projects. Plain is the stored book file byte for byte, a leading byte-order mark included: it comes from `readZipped()`, because the text read drops that mark. Aligned is `weaveBook(usfm, alignments, AlignmentHelpers)`: each verse with a valid §5.1 record (no `invalid` flag, and I-3 holds) goes through word-aligner-lib's `addAlignmentsToTargetVerseUsingMerge`, the helper that the USFM export of the Pankosmia checking client (`pankosmia/uw-client-checks`) calls. The helper merges into the verse's USFM, so a footnote or a paragraph break inside the verse stays. Every other verse, and every byte outside the verses, keeps its stored form. `weave.mjs` is the one weave: `conformance/validate.mjs` imports it. The stored project does not change. | https://github.com/unfoldingWord/translationCore4/issues/19 | none (`readBook`, `readAlignments`, `readZipped`) | `test/export/usfm.test.ts` (the round trip on the conformance sample, with `test/helpers/zaln.ts` `extractVerseFromZalnUsfm` as the oracle) | `j07` USFM block: unweave every verse of the download; the plain download equals the stored file |
| `src/data/export/burritoZip.ts`, `relationships.ts` (types over `journal/relationships.mjs`) | producer `burrito-zip`, for Bible and OBS projects, file `<project>-<YYYY-MM-DD>.zip`. It reads `BurritoStore.readZipped()`, removes `.git/`, every `*.bak` and every `.DS_Store`, and keeps every other entry byte-identical. Only `metadata.json` changes: it gets the `relationships` mirror and the `dcs` id authority (BURRITO-SPEC §3 rules 2 and 6). An OBS project also gets its `ingredients` table rebuilt from the zipped files: the platform creates that table with keys that have no `ingredients/` prefix, and tC4 never rescans an OBS project (PLATFORM-NOTES #37). `relationshipsFromPins(resources)` is the one implementation; `conformance/generate.mjs` and `validate.mjs` call it too. The stored project does not change. | https://github.com/unfoldingWord/translationCore4/issues/359 | `GET /api/burrito/zipped/<path>` (`ServerApi.getZippedRepo`) | `test/export/burritoZip.test.ts`, `test/export/relationships.test.ts` | `j07` Scripture Burrito block: the harness validates the captured bytes (`BURRITO=` Stage-1 and the relationships check; `OBS_BURRITO=` the OBS group) |
| `src/data/export/pdf.ts`, `src/views/print/PrintBook.jsx`, `src/views/print/PrintPages.jsx`, `src/ds/tokens/print.css`, `src/data/bookModel.js`; bridge `scripts/desktop-main.cjs` (`export:pdf`) and `scripts/preload.cjs` | producer `pdf`, for Bible projects, file `<BOOK>-<YYYY-MM-DD>.pdf`: the print-styled route (row A-6). `printDocument` builds one print document of the book: the print DOM of `PrintBook` for each chapter with a drafted verse, and one line (`[ chapter 3 not yet drafted ]`, `[ chapters 5–7 not yet drafted ]`) for each run of undrafted chapters between two drafted ones (`printedItems` in `bookModel.js`; the preview uses the same rule; undrafted chapters before the first or after the last drafted chapter are left out; inside a printed chapter an undrafted verse states `[ verse not yet drafted ]`; with drop caps off each chapter opens with a `Chapter N` heading; the whole book is one flow through the columns, so a chapter runs from column 1 into column 2 of the same page and on to column 1 of the next page, in the preview and the PDF alike; each PDF page carries its number at the bottom centre (a CSS `@page` `@bottom-center` box); a book with no drafted verse refuses with `export.nothing-drafted`), then the page setup as CSS (`@page` size A4 or Letter, `--print-columns`, `--print-leading` = 1.4 × `PAGE_SPACING_FACTOR`, `printVariables`), then `print.css`. Drop caps and verse numbers change the DOM. `bookModel` and `printedItems` are the one verse model and the one chapter rule of the preview and the PDF (owner ruling 2026-09-24). The preview is page sheets (`PrintPages`): it renders the same `PrintParts` DOM with the same `print.css` (every rule scoped to a `print-*` class), on sheets of the paper size with the PDF's margins (`PAPER_MM`, `PAGE_MARGIN_MM`) and page numbers. A hidden sheet takes verses until the next would overflow and splits a verse between words; the pages are measured again when a web font arrives. The page count agrees with the PDF where the fonts agree. `printVariables` (`PRINT_LEADING` 1.4) is the one source of the columns and the leading for both. The producer sends the document to `window.tc4Desktop.printPdf`; `export:pdf` writes it to a temporary file, loads it in a hidden window with JavaScript off, and returns `printToPDF({ preferCSSPageSize: true })`. With no bridge (a browser), `appliesTo` is false and the menu has no PDF item. The print document loads no web font. | https://github.com/unfoldingWord/translationCore4/issues/20 | none (Electron `webContents.printToPDF`) | `test/export/pdf.test.ts`; `scripts/desktop-bootstrap.test.cjs` (the bridge) | `j07` PDF blocks: a test double of the bridge prints with Playwright `page.pdf()` and keeps each document; the seeded Titus prints 1 chapter; a journey-made drafted Titus proves page count, MediaBox and Double spacing |
| `src/data/export/obsMarkdown.ts`, `src/views/print/PrintStories.jsx` | producer `obs-markdown`; OBS print DOM for `pdf` | https://github.com/unfoldingWord/translationCore4/issues/360, layouts https://github.com/unfoldingWord/translationCore4/issues/11 | none | `test/export/obsMarkdown.test.ts` | `j07` OBS block |
| `src/data/share/door43Api.ts`, `shareOperation.ts`, `session.ts`, `src/views/modals/ShareSignIn.jsx` | share → `Report`; token in memory only | https://github.com/unfoldingWord/translationCore4/issues/362, https://github.com/unfoldingWord/translationCore4/issues/203 | Door43 API `POST /api/v1/user/repos`, tokens; `POST /git/remote/add`, `POST /git/push` (body credentials), `GET /git/remotes/<path>` | `test/share/*` with a fake Door43 API | `e2e/j11-share.spec.ts` |
| `src/data/dcsServer.ts`, `DcsServerLabel` in `src/App.jsx` | `DCS_SERVER`: the Door43 server for account and write calls. `https://qa.door43.org` when `import.meta.env.DEV` is true, `https://git.door43.org` otherwise (`dcsServerFor` is the rule). Every account or write call to Door43 takes its address from it; no read call does (reads use `DCS_HOST` in `gateways.ts`). `DCS_SERVER_LABEL` is the host to show, or null on production; `DcsServerLabel` renders it beside the save indicator. No other code compares against the QA address | https://github.com/unfoldingWord/translationCore4/issues/120 | none (the Door43 API calls of #203 and #362 use it) | `test/dcsServer.test.tsx` (the production value only) | `j02` step: the label beside `save-indicator` names `qa.door43.org`; attaches the label text and a screenshot of the app chrome |

Reference, not adopted: the Pankosmia PDF publisher renders paged.js HTML in headless Firefox
through puppeteer, downloading Firefox at run time; its print-spec tables and OBS page styles
are data that D79 point 3 planned to reuse after a licence check. The check found no licence,
so tC4 copies no file: it takes the standard paper sizes and writes its own print CSS
(PLATFORM-NOTES #42).

## 8. Import (module map) [decided 2026-09-22 — D79]

Import creates a **new** project only. Parsers are pure functions from bytes to one
`ImportBundle`; the shell owns every side effect and the all-or-nothing rollback. The fixture
manifest `conformance/fixtures/import/MANIFEST.json` states every expected outcome.

| Module | Contract | Owner issue | Platform route | Test helper | e2e helper / block |
|---|---|---|---|---|---|
| `src/data/import/types.ts`, `shell.ts`, `parsers.ts`, `src/views/modals/Import.jsx` | `ImportBundle`, `ImportParser`; `runImport(parser, files, edits, deps?)` → `Report` (`op: 'import'`, facts `{parser, repoPath, books, seedSource}`). A damaged finding refuses with its code before any write; an existing folder refuses with `import.name-exists`; a failure after the create deletes the repository and returns `import.write-failed` (facts `rolledBack`). A bundle built from parts takes the created repository's `metadata.json` with the bundle's full language tag, is registered by a rescan, and is seeded through `JournalingStore.openImported` (`tc3-import` for tC3, else the universal default `sidecar-migration`), and is committed by a checkpoint. An `archive` is stored as it is: no open and no checkpoint, because both rescan and so rewrite `metadata.json`; a plain `add-and-commit` commits it, and its first open seeds what its journal does not hold. `PARSERS` is the one table; a kind with no parser shows disabled. The import screen follows the owner's design: kind, files, review, then the new card on Home with a toast | https://github.com/unfoldingWord/translationCore4/issues/361 | create (`/git/new-text-translation`, `/git/new-obs-resource`, with the primary language subtag of the bundle's tag: `new-text-translation` refuses `es-419` — D80 point 4, PLATFORM-NOTES #43) → `POST /api/temp/bytes` (a wrapped zip) → `POST /api/burrito/remake_burrito_from_zip/<uuid>/<path>` → `add-and-commit`; rollback `POST /git/delete` | `test/importShell.test.ts` on the fake rig; `test/helpers/import.ts` `assertNoRepoCreated`, `runManifest` | `e2e/helpers/import.ts` `importFixture`; `j09` shell block (dev-only fake parser, flag `tc4.e2e.fakeImport`) |
| `src/data/import/usfm.ts` | parser `usfm`: one or more `.usfm`, `.sfm` or `.txt` files → one bundle, one book for each file. usfm-js reads the `\id` header (the book code) and the `\h` header (the name, for a one-book drop only); it never re-serializes (D8). The book text is the file's bytes: the decoder keeps a byte-order mark and refuses bytes that are not UTF-8. A USFM file has no language, so the review page gives it. The license finding is "none found, CC BY-SA 4.0 will be applied". No `\id`, two files for one book, or bytes that are not UTF-8 give a damaged finding with `import.damaged.usfm-parse` | https://github.com/unfoldingWord/translationCore4/issues/195 | none | `test/import/usfm.test.ts`; `fixtures/import/usfm/` (one book, three books, no `\id`); manifest field `lang` (the review page's language edit) | `j09` USFM block (one file, then open in Translate; the no-`\id` refusal) |
| `src/data/import/burrito.ts`, `burritoCheck.mjs` | parser `burrito`: one `.zip`, flat (the server's export) or wrapped (a DCS sb-zip), unwrapped by the shell's own `unwrapExport`. The kind comes from the flavor. `burritoCheck.mjs` is the one check module (`checkBurrito(files, validate)` → failures; `compileSbValidator(Ajv, addFormats, schemas)` over `conformance/sb-schema/`); `conformance/validate.mjs` Stage-1 imports its schema loader and ingredient check. It is `.mjs` so that Node runs it with no build step. A failed check is a damaged finding that names the check (`import.damaged.no-metadata`, `import.damaged.checksum-mismatch`, `import.damaged.truncated`; the schema and flavor checks have no code of their own). Not the platform audit (D80 point 6, PLATFORM-NOTES #44). The bundle is the burrito as it is (`archive`, D80 point 2). A tC4 burrito (with `ingredients/checking/`) also gives its alignments and decisions to the review page; a foreign burrito gives a `details` finding: text only | https://github.com/unfoldingWord/translationCore4/issues/196 | none | `test/import/burrito.test.ts`, `test/import/burritoCheck.test.ts`; `fixtures/import/burrito/` (`foreign/`, `tc4-export.zip`) and `fixtures/import/damaged/burrito-*`; manifest fields `wrap` and `name` | `j09` Scripture Burrito block (export, then import) |
| `src/data/import/tc3.ts` | parser `tc3` (manifest, chapter JSON, `alignmentData`, check index); the current state only, no history conversion (D80 point 3) | https://github.com/unfoldingWord/translationCore4/issues/21 | none | `test/import/tc3.test.ts`; `fixtures/import/tc3/` | `j09` tC3 block |
| `conformance/fixtures/import/damaged/` | manifest entries with refusal codes | https://github.com/unfoldingWord/translationCore4/issues/41 | none | the manifest runner | `j09` damaged block |

Seeds: every imported record becomes one `seed`-tagged journal event (BURRITO-SPEC §8.8;
`journal/reconcile.mjs` `seedFromSidecars`); `seed.source` is `tc3-import` for tC3 and the
specification's value for the other kinds. **x-tcore migration is closed without data**
(D79 point 8; #14): the prototype was internal and no populated x-tcore project exists. The
sideload route `POST /burrito/zipped/_local_/_sideloaded_/…` does no git init and is used for
resources only [VERIFIED — pankosmia-web 0.18.5 (99fd9be), `post_zipped_repo.rs`, 2026-09-22].

## 9. Phase 2 components (build after Phase 1 exit criteria)

**Write-side exception [decided 2026-08-12 — D47(c)]:** the `journalStore` WRITE side —
one new immutable checksum-sealed segment file for each mutation, plus a journaling
wrapper around the data layer's single write
interface — ships in 4.0.0 (Increment 3), so every 4.0.0 project carries complete
per-action history from day one, CI-verified by folding app-written journals with the
reference implementation. The components below otherwise remain Phase 2.

Phase 2 adds five components. `journalStore` writes each mutation as one new immutable checksum-sealed segment file, in its own actor directory only. It does not append to an accepted file, and it does not rewrite an accepted file. A torn write fails the segment's own checksum, so the whole action is unpublished and the writer republishes it from durable staged intent — BURRITO-SPEC §8.1. `foldEngine` and `reconcile` **import the reference implementation** from `journal/` (`src/data/journal/runtime.ts`; §8.6/§8.8 semantics, property-tested by the journal conformance suite; `test/journalRuntime.test.ts` holds the app's import path to the same results) [VERIFIED — `src/data/journal/runtime.ts:14-27` imports `journal/*.mjs`; 29a794e, 2026-09-04]. `publicationStore` holds a persistent `actor-<actorId>` repo/branch; own journal bytes are committed there before they are mirrored into the full working projection; every publication commit is path-checked. `syncEngine` runs this sequence: copy current main → disposable scratch → fetch + **explicit named-branch merge** → rescan → compare against pre-merge main for shared-byte identity, foreign-actor identity, and own-stream append-only extension → validate/fold/regenerate/commit → fast-forward integration. On receive, `syncEngine` builds and validates a replacement working projection, and swaps only after own-event inclusion succeeds — BURRITO-SPEC §8.7, JC-19/JC-20. `reviewQueue` is the UI for verse forks.

The named-branch operation uses **existing endpoints** via single-branch publication repos (`pull-repo` is deterministic with one head; verified end-to-end, transport rig 2026-07-18). Multi-branch `pull-repo` is measured ordering-steered and MUST NOT be used as a branch selector. The integrator writes the validated journal union explicitly and never trusts the post-merge worktree (PLATFORM-NOTES #21). The sync engine's acceptance bar is `npm run validate:transport` (10 checks) against the dev-env rig.

## 10. Cross-cutting

- **i18n:** platform template mechanism + client locale files. (The `translate`-fn bridge to the RCL key set is moot post-A-5 — UI strings are our own; the RCL key set matters only if its helpers run headless, OPEN-QUESTIONS #14.)
- **Offline:** every DCS operation is gated on the net context. All reads and writes go to the local server.
- **Testing:** the Playwright journeys in `e2e/` are the primary test method (OPEN-QUESTIONS #6, A-5). A journey verifies a complete feature, and each new journey produces an artifact that can be verified and that each run produces again in the same way. Test a part in isolation only when you must, and write down all the ways that it can fail before you write its code. Do not write a unit test after the code (`AGENTS.md`, "How to test"). The conformance harness in `conformance/` stays the executable proof of BURRITO-SPEC (§9).
- **Telemetry:** none.

## 11. Decision log (ADR-lite)

| # | Decision | Status |
|---|---|---|
| A-1 | One unified client on pankosmia-web (Option B); upstream collaboration retained | AGREED |
| A-2 | Draft USFM canonical in Phase 1; journals canonical in Phase 2; USFM derived thereafter | AGREED |
| A-3 | Alignments in sidecar, zaln only on export (I-1) | AGREED (forced by verified editor data-loss) |
| A-4 | Full tC3 check-item payload persisted; check lists derived, never stored | AGREED (verified derivable) |
| A-5 | REVISED 2026-07-06 (the project owner, via imported UI design): Check surface is design-native (design/tC4-2/translationCore.dc.html) with triage + tC3 selections (D2); tc-checking-tool-rcl *components* are not embedded. word-aligner/usfm-js logic and BURRITO-SPEC payloads unchanged — OPEN-QUESTIONS #6/#7 close via the uw-tc4 prototype instead of an RCL mount | AGREED |
| A-6 | PDF by the print-styled route (the same Chromium renders the editor and the PDF); the Pankosmia pdf_publisher is not bundled; content/workspace/t_core/checks clients dropped from the bundle | DECIDED 2026-09-22 (D79 point 3) |
| A-7 | Identity key = checkId+book+ch+v+occurrence, quoteString verification | PROPOSED (normative in BURRITO-SPEC §5.2) |
| A-8 | Stage rules S-1/S-2 — path-authoritative, permanently (the until-PR-1 clause is removed [decided 2026-07-30 — D28]); tC4 re-asserts its roles after every remake | AGREED with constraint evidence |

Open decisions live in OPEN-QUESTIONS.md — keep it the single list.
