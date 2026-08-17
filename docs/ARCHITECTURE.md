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

## 7. Publishing

- **USFM (aligned) export:** for each book, merge the alignment sidecar into the verse text (`wordaligner.merge` → verseObjects → `toUSFM`) — proven in harness check 22. Then download the result or write it as an export artifact (NOT over the canonical `<BOOK>.usfm`; I-1).
- **PDF:** two options. Option one: Electronite `printToPDF` of a print-styled route (the same Chromium renders the editor and the PDF — correct complex-script/RTL shaping). Option two: the platform's pdf_publisher client, if we keep it in the bundle. Decide in E3.3 [PROPOSED]. **Leading candidate: the print-styled route** — validated live in tc4-POC-2 (2026-07-16): full-book print DOM incl. persisted draft text, `@media print`, 1↔2 column toggle, spacing/dropcap/verse-number/RTL classes (`docs/evidence/tc4-poc2-learnings-2026-07-16.md`).

## 8. Migration & compatibility

- **x-tcore migrator (E2.6):** for each `book_projects/<name>` in an x-tcore repo, do these conversions. Convert `alignmentData/<book>/<ch>.json` → §5.1 file (normalize occurrences). Convert `index/<tool>/<book>/<groupId>.json` items with any user data → §5.2 decisions (synthesize `modifiedTimestamp` from file dates if absent). Convert `version_manager.json` → `resources.json`. Convert `checker_setting.json` → `settings.json`. Verify the origin drafting repo's `<BOOK>.usfm` md5 against the copied one, and show diffs for user choice. Then stop the creation of x-tcore repos. **Retirement sequence:** the `x-tcore` copied-project mechanism has exactly one consumer — the current checking client [VERIFIED single-consumer]. In Phase 1 the app creates no new x-tcore projects, and Phase 1 ships this one-time migrator (copied projects → sidecars in the repo of origin).
- **tC3 zip importer (E3.4):** the same transformations, from a tC3 project zip. Convert the text from chapter JSONs → USFM via the existing conversion helpers.
- **Phase 2 seed:** every sidecar record becomes one `seed`-tagged journal event (BURRITO-SPEC §8.8). `modifiedTimestamp` and `targetVerseMd5` were designed in for this. Journal-suite J15 proves it (seeded fold reproduces sidecar state exactly).

## 9. Phase 2 components (build after Phase 1 exit criteria)

**Write-side exception [decided 2026-08-12 — D47(c)]:** the `journalStore` WRITE side —
one new immutable checksum-sealed segment file for each mutation, plus a journaling
wrapper around the data layer's single write interface — ships in 4.0.0 (Increment 3),
so every 4.0.0 project carries complete per-action history from day one, CI-verified by
folding app-written journals with the reference implementation. The components below
otherwise remain Phase 2.

Phase 2 adds five components. `journalStore` writes each mutation as one new immutable checksum-sealed segment file, in its own actor directory only. It does not append to an accepted file, and it does not rewrite an accepted file. A torn write fails the segment's own checksum, so the whole action is unpublished and the writer republishes it from durable staged intent — BURRITO-SPEC §8.1. `foldEngine` and `reconcile` are **ports of the reference implementation** in `conformance/journal/` (§8.6/§8.8 semantics, already property-tested by the journal conformance suite; the port must pass that same suite). `publicationStore` holds a persistent `actor-<actorId>` repo/branch; own journal bytes are committed there before they are mirrored into the full working projection; every publication commit is path-checked. `syncEngine` runs this sequence: copy current main → disposable scratch → fetch + **explicit named-branch merge** → rescan → compare against pre-merge main for shared-byte identity, foreign-actor identity, and own-stream append-only extension → validate/fold/regenerate/commit → fast-forward integration. On receive, `syncEngine` builds and validates a replacement working projection, and swaps only after own-event inclusion succeeds — BURRITO-SPEC §8.7, J19/J20. `reviewQueue` is the UI for verse forks.

The named-branch operation uses **existing endpoints** via single-branch publication repos (`pull-repo` is deterministic with one head; verified end-to-end, transport rig 2026-07-18). Multi-branch `pull-repo` is measured ordering-steered and MUST NOT be used as a branch selector. The integrator writes the validated journal union explicitly and never trusts the post-merge worktree (PLATFORM-NOTES #21). The sync engine's acceptance bar is `npm run validate:transport` (10 checks) against the dev-env rig.

## 10. Cross-cutting

- **i18n:** platform template mechanism + client locale files. (The `translate`-fn bridge to the RCL key set is moot post-A-5 — UI strings are our own; the RCL key set matters only if its helpers run headless, OPEN-QUESTIONS #14.)
- **Offline:** every DCS operation is gated on the net context. All reads and writes go to the local server.
- **Testing:** (a) unit tests on `data/` against `sample-burrito` fixtures — port the 27 harness checks; (b) D-1 round-trip property tests; (c) Playwright journey tests of the design-native Check view against `sample-burrito` (OPEN-QUESTIONS #6, A-5); (d) migrator golden tests from a real tC3 project zip; (e) Phase 2 fold property tests.
- **Telemetry:** none.

## 11. Decision log (ADR-lite)

| # | Decision | Status |
|---|---|---|
| A-1 | One unified client on pankosmia-web (Option B); upstream collaboration retained | AGREED |
| A-2 | Draft USFM canonical in Phase 1; journals canonical in Phase 2; USFM derived thereafter | AGREED |
| A-3 | Alignments in sidecar, zaln only on export (I-1) | AGREED (forced by verified editor data-loss) |
| A-4 | Full tC3 check-item payload persisted; check lists derived, never stored | AGREED (verified derivable) |
| A-5 | REVISED 2026-07-06 (the project owner, via imported UI design): Check surface is design-native (design/tC4-2/translationCore.dc.html) with triage + tC3 selections (D2); tc-checking-tool-rcl *components* are not embedded. word-aligner/usfm-js logic and BURRITO-SPEC payloads unchanged — OPEN-QUESTIONS #6/#7 close via the uw-tc4 prototype instead of an RCL mount | AGREED |
| A-6 | Drop content/workspace/t_core/pdf?/checks clients from our bundle; keep dashboard+settings+version_manager | PROPOSED (pdf & remote-repos: decide in E1.1/E3.3) |
| A-7 | Identity key = checkId+book+ch+v+occurrence, quoteString verification | PROPOSED (normative in BURRITO-SPEC §5.2) |
| A-8 | Stage rules S-1/S-2 — path-authoritative, permanently (the until-PR-1 clause is removed [decided 2026-07-30 — D28]); tC4 re-asserts its roles after every remake | AGREED with constraint evidence |

Open decisions live in OPEN-QUESTIONS.md — keep it the single list.
