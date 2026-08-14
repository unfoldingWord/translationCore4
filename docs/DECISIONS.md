# Decision log — translationCore 4

This file is the public decision record. One section per decision, append-only.
A recorded decision is not open for re-proposal (`CONTRIBUTING.md`, hard rule 5).
If you believe a decision is wrong, say so to the project owner with evidence.

Extracted 2026-08-07 from the internal build-state log; the internal file keeps
the gates and points here. Dates and wording are preserved exactly, except bracketed
`[publication note …]` additions and one reworded file path in D38 (each listed in
the migration manifest). Some numbers
are absent (never assigned or folded into a revision); numbering is stable —
cite decisions as `Dnn`.


## D1 (rev. 2026-07-06) `design/tC4-2/translationCore.dc.html` is a **style reference** (visual
language), not a feature-complete design. Features come from the PRD; the check surface is a
design-native build — tC3 RCL *components* are not embedded; their read/write contract binds.

## D2 (2026-07-06) Check semantics = triage (`valid|invalid|todo`) **plus** tC3 selections;
decisions persist in the full BURRITO-SPEC §5.2 shape (incl. additive `status`).

## D3 (2026-07-06) Prototype data layer = FixtureStore over the real `sample-burrito/` behind
the BurritoStore interface; HTTP adapter is a later increment.

## D5 (2026-07-06) Phase 1 journey scope = J1–J10 + J12; J11 (team sync) is Phase 2.

## D6 (2026-07-06) Gateway-language *aligned* bible pane out of Phase 1 (OPEN-QUESTIONS #8).

## D7 (2026-07-06) Translator-identity posture: user-controlled git author (pseudonyms OK),
no telemetry, identity exposure shown before first push (FR-33).

## D8 (2026-07-06) Editor identity property is **byte-strict outside the edited verse** —
splice-based; `usfm-js` reads structure, never re-serializes the book (FR-7).

## D9 (2026-07-06) Save on verse blur + idle debounce; git commits at checkpoints (session
close, mode switch, before branch ops, before export/import).

## D10 (2026-07-06) ULT/UST source panes required in the first J2 increment; `extraScripture`
promoted in that increment's PR, spec + harness together (OPEN-QUESTIONS #13).

## D11 (2026-07-07) tQ is out of Phase 1 (OPEN-QUESTIONS #12).

## D13 (2026-07-07) Phase 2 journal format fully specified (BURRITO-SPEC §8) + reference
implementation + journal conformance suite; [PROPOSED] pending ratification
(OPEN-QUESTIONS #10/#16). M4 build remains gated on Phase 1 milestones. [superseded in
part by D47, 2026-08-12 — the journal WRITE side ships in 4.0.0 (Increment 3); the M4
gate holds for the fold/sync/review app work.]

## D14 (2026-07-07) Translator's sections (`\ts\*`) are presentation only — derived at load
from the pinned *source* text; the target draft never contains `\ts\*` (spec §4.1/§8.4a).

## D15 (2026-07-08) Upstream confirmed the metadata-fidelity change in principle; the
branch-merge endpoint ask was withdrawn (capability exists via local `file://` remotes).
All upstream communication is owner-routed and issue-sized.

## D16 (2026-07-10) Corrected Phase 2 topology: separate full working projection + persistent
per-actor publication branch (commits touch only the owned journal); named-branch integration
in disposable scratch; receive = validated rebuild-and-swap. J19/J20 prove it; named-branch
route verification is OPEN-QUESTIONS #23.

## D17 (2026-07-12) **Pin sets + per-book resolution** (driven by partial-coverage GLs —
es-419_tn covers 14/66 books [VERIFIED via DCS API 2026-07-12]): `resources.json` pins TWO
language sets, primary GL + English fallback (each a coherent tn+tw+tA at pinned versions;
English ships with the install). Resolution is per (tool, book) by coverage; the resolved
resource is recorded in the §5.2 per-book decision file (field exists); a book's resolution
change is a warned update, never silent. **Cross-language decision re-attach** [decided
2026-07-12]: when `checkId` doesn't match, match on (reference + original-language quote +
occurrence); that key is NOT unique ([VERIFIED] duplicate quote+occurrence rows in en_tn
2TI/ACT), so tiebreak tn by `SupportReference` and tw by the TWLink slug (both
language-independent `rc://*` forms; en_twl and es-419_twl rows sampled identical incl. IDs);
ambiguous multi-matches surface for review. §5.3 schema change + harness land in the same
commit (spec §9). **Addendum 2026-07-31 — LANDED** (OPEN-QUESTIONS #28 closed): BURRITO-SPEC
1.6-draft §5.3 schemaVersion 2 (`languageSets.primary/fallback`, tn+twl+tw+tA per set; twl
slot added for deterministic (tool, book) coverage resolution per §4.2 — spec-editor
derivation, noted in §5.3), §5.2 resolution record + re-attach rule; sample + harness in the
same change set — 33 checks (Stage-1 29) + journal 59, all green [publication note 2026-08-10: counts as of 2026-07-31 — the harness has since grown; run it for the current counts. The verbatim wording was restored by owner ruling after the P6 review]. Primary-set pins verified
live [VERIFIED — DCS API 2026-07-31; `docs/evidence/es419-suite-pins-2026-07-31.md`]. The
product writer still writes the schemaVersion-1 shape — its migration is the first
Increment-2 resource task.


## D18 (2026-07-16) tc4-POC-2 learnings adopted (`docs/evidence/tc4-poc2-learnings-2026-07-16.md`):
the documented endpoint surface is **demonstrated end-to-end** from a browser client against a
live 0.16.20 server (create project → seed book → draft → text on disk; Door43 clone); the
unified single-client shape is viable (parity 48/9/0/5); drafting fallback ladder is
`\ts\*` → `\p` → verse (replaces whole-chapter proposal); new books seed client-side from the
pinned source skeleton (`new-scripture-book` writes no `\ts`); print-CSS is the leading publish
candidate. POC divergences that must not carry into product: companion `*_tcchecks` repo, flat
check records, index-pair alignments, blanket `no_bak`, whole-book writes. New PLATFORM-NOTES #18/#19.


## D19 (2026-07-18) Dev-env rig built (pre-coding infrastructure, project-owner directive):
scripted seeded server (`dev-env/`, pinned to the latest published crate `pankosmia_web
=0.17.0`), fully isolated workspace, launch config, deterministic reset. Transport suite
(`validate:transport`, 10/10) re-proves J19 delayed-receive + J20 zero-trust intake with all
git ops through real HTTP endpoints. **OPEN-QUESTIONS #23 CLOSED:** single-branch publication
repos make `pull-repo` deterministic — named-branch integration works on existing endpoints,
no upstream change; multi-branch `pull-repo` measured ordering-steered (unsafe). Two platform
behaviors discovered: add-and-commit panics on commitless repos (PLATFORM-NOTES #20); post-normal-
merge worktree untrustworthy — integrator writes the validated union, intake reads commit
bytes (PLATFORM-NOTES #21; candidate upstream finding, owner-routed). Evidence:
`docs/evidence/transport-rig-2026-07-18.md`.


## D20 (2026-07-19, project-owner directive) The desktop shell is **Electronite**
(unfoldingWord's Graphite-enabled Electron fork, github.com/unfoldingWord/electronite) —
a hard requirement so complex-script languages needing SIL Graphite smart-font rendering
work throughout the app; plain Electron/Chromium does not shape Graphite-only fonts.
The architecture already targeted an Electronite shell [VERIFIED tag of 2026-07-16 basis];
this decision makes it a requirement rather than a pipeline detail. Whether the Pankosmia
desktop template's shipped wrapper is Electronite (or where our build substitutes it) is
OPEN-QUESTIONS #25; packaged-app Graphite rendering added to TEST-PLAN M-5.


## D21 (2026-07-22) Server round-trip suite (`validate:roundtrip`, 12/12 @ 0.17.0): all tC4
custom work survives every server operation at Stage-1 (23/23 conformance on the server-touched
copy); BOTH regeneration paths wipe roles+relationships (a same-day claim that the write path
preserves roles was an instrument error, corrected — PLATFORM-NOTES #5); zip export↔import mutually incompatible — server 500s on its own export
(PLATFORM-NOTES #22); PLATFORM-NOTES #7 (payload panic) fixed upstream at 0.17.0. The suite is upstream
Change 1's acceptance test. Evidence: docs/evidence/server-roundtrip-2026-07-22.md.


## D22 (2026-07-27) We withdraw D21's zip claim. The test used the wrong endpoint. The
general import `POST /burrito/zipped/<repo_path>` accepts the server's own export without
changes. We verified this live, and the bytes are identical. The target must be
`_local_/_sideloaded_/`, and the target must not exist before the import.
`remake_burrito_from_zip` gives support to the tC4 prototype. It is not the general import.
We withdraw draft upstream issue 1. We audited finding 2 (roles/relationships wipe) again,
and finding 2 stands. Evidence: `docs/evidence/zip-roundtrip-correction-2026-07-27.md`.
PLATFORM-NOTES #22 is rewritten.


## D23 (2026-07-25..27, project-owner rulings) (a) The project owner ruled on all the
JOURNEYS-AND-GAPS §5 defaults. Default #1 is reworked: the selection of the checking language
pulls the whole suite, and the English fallback applies per (book, resource). This agrees with
D17. Default #2 is amended: the user can change the gateway language later, the change is
explicit, and the app shows the consequences. Defaults #3–#11 are approved. For #7, the
import-anyway/re-pin path is primary. It replaces the update-to-latest answer of 2026-07-12.
(b) OPEN-QUESTIONS #24 is CLOSED. The resource pin target is the sb-zip export. The pin is
(repoPath, tag, expected SHA). Each import verifies the pin. The tests prove that the import
keeps `\zaln` (`evidence/sb-zip-zaln-2026-07-25.md`). (c) #21 is CLOSED: audio reserves a slot
and has no behavior. (d) The ratification of §8 occurs after Phase 1 ships and before the
Phase 2 build. (e) NEW #26: versification has no specification. The platform writes
`ingredients/vrs.json`. The Proskomma mapping is available client-side. The spec needs an edit
before the create-project step of Increment 1.


## D24 (2026-07-29, project-owner rulings) (a) The scope of Increment 1 is larger. Increment 1
must include the selection of sources and the display of sources (the ULT/UST panes of D10;
the suite selection of §5 #1). `INCREMENT-1.md` is revised and goes back to [PROPOSED] for the
owner to read. (b) The code home is created: `github.com/unfoldingWord/translationCore4` is the
product repo. uw-tc4/ stays the local prototype. (c) OPEN-QUESTIONS #26(b) is decided. The
project stores refs in the versification that the project selects. TSV refs and
original-language refs map into the project frame at derive time. The Proskomma mapping does
this client-side. (d) The design now covers new projects, the selection of book packages, and
merge conflicts (JOURNEYS-AND-GAPS §4 is updated).


## D25 (2026-07-30) Versification is a **platform** capability. It is not a tC4 build item
(`evidence/pankosmia-versification-2026-07-30.md`, verified at `origin/main` 0.18.4). The
platform supplies six schemes. `mappedVerses` accepts ranges. Each project has an
`ingredients/vrs.json` file. The Proskomma mapping runs client-side. The platform also supplies
**native non-contiguous passage sets**: the translation-plan `sections` field, and `bcvWrapper`
with an array of `ranges`. tC4 adopts these capabilities and does not design a mapper. The
remaining tC4 work is spec-side only (#26 a/b/c). There is also one new open design point
(#26d: can we express a partial-book scope as a native translation plan?). Process finding: the
upstream mirror was 15 commits stale. PLATFORM-NOTES #23 is added (fetch before you make a claim).


## D26 (2026-07-30, project-owner rulings on OPEN-QUESTIONS #26 d/e) **Passage sets are a
minor UI option. Whole books are the default path.** Almost all groups translate whole books.
But tC4 MUST be **capable** of passage sets in its architecture and its data model from the
start. These changes are necessary. They go with the `vrs.json` spec edit, and the harness
changes in the same commit (§9): (1) BURRITO-SPEC §3 rules 4–5 become wider. At present they mandate
the whole-book form (`{"TIT": []}`). They must also permit SB's range-array form
(`{"TIT": ["1:1-2:5"]}`). `[]` stays the default. (2) Progress takes its denominator from the
scope of the project, not from the whole book. (3) The derive step filters check items to the
scope. (4) A book file that holds only some of the verses is legal. No component can assume
that a book file covers a whole book. **Non-canonical books are not allowed at this time.**
Thus the `canonical_book_codes` list, which comes from eng, is an accepted constraint. It is
not an upstream item. UI: the selection of a whole book stays the primary path. The passage-set
option is secondary, and it does not make the default flow more complex.


## D27 (2026-07-30, project-owner directive) **The rig is pinned at `=0.18.3` FOR INCREMENT 1
ONLY — this is not a permanent pin.** Examine the pin again when Increment 1 closes. Upstream
changes daily: it moved from 0.18.3 to 0.18.5 in one session. At that review, run the transport
suite and the round-trip suite again at the release that is current then. Measure one thing
specially: does **`relationships` now survive regeneration**? `role` and `relationships` came
into `structs.rs` at **0.18.5** [VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30)], and our
format uses `relationships` natively. Stage-2 stays at 0/2 while the pin is below that change.
This is expected. It is not a regression. (This closes review question 5 of 2026-07-30.) The bump is
done and re-baselined with this evidence: transport **10/10**, round-trip **12/12**, Stage-1
**23/23** on the server-touched copy, and no panics (`pkg_version 0.18.3`). The bump required
two things. (a) Since 0.18.0 ("No more main"), the server panics if no client is registered at
`/clients/<product.homepage>`. The default is `dashboard`, but the bundled dashboard client
declares `/clients/main`. Thus the rig's `product.json` now sets `"homepage": "main"`. Set it to
the tC4 client when tC4 becomes the landing client. That is how OPEN-QUESTIONS #4 closes.
(b) The pinned-version assertion of the transport suite moved to 0.18.3. Stale harness labels
are corrected to agree with D22. 0.18.4 exists (published 2026-07-30) and adds only "client
settings". The work in the scope of the plan is in 0.18.3.
**D27 update (2026-07-30, owner directive): the Increment-1 pin is now 0.18.5.** crates.io
stops at 0.18.4, and that crate was published from `5e5b693` — WITHOUT the role/relationships
modeling (verified from the published crate's `.cargo_vcs_info.json` and `structs.rs`). So the
pin is a **git rev pin** to `99fd9bea8a9f3d14ac6a61f8e2213f1c5d42ed2a` (the 0.18.5 bump commit;
read-only use; return to a crates.io `=` pin when 0.18.5+ publishes). Re-baselined with pasted
evidence [VERIFIED — `evidence/rig-rebaseline-0.18.5-2026-07-30.md`]: transport **10/10**,
round-trip **12/12**, Stage-1 **26/26** on the server-touched copy, `pkg_version 0.18.5`, no
panics. **The D27 special measurement is answered: `relationships` now SURVIVES regeneration
at 0.18.5; `x-` roles are still wiped (6→0).** S-1 authority is unchanged (resources.json
stays authoritative; the mirror is now durable in practice); S-2 stays permanent per D28. On
a server-rescanned copy the expected Stage-2 split is now **1/2**, not 0/2. The increment-close
pin review still runs (upstream moves fast), but its special measurement is already satisfied.


## D28 (2026-07-30, upstream position via the project owner —
`evidence/upstream-roles-relationships-2026-07-30.md`) Upstream added `relationships` and `role`
to its SB model. This is now **verified released**: `structs.rs` contains `pub role` and
`pub relationships` at 0.18.5 (99fd9be). But regeneration builds the ingredients again **from
disk**, and it cannot know the `x-` roles. Thus **`x-` roles are non-durable by design**. They
disappear at each remake, for example when a user adds a book. Therefore: (1) **stage rule S-2
becomes permanent** — the rule "paths are authoritative" loses its "until PR-1" clause (spec
edit; harness in the same commit, §9); (2) **tC4 sets its own roles again** after each operation
that causes a remake — tC4 does this client-side, with no upstream dependency; (3) there is
**no further upstream ask** about x-roles; the earlier `serde(flatten)` draft issue is satisfied
in part, and we close it, we do not escalate it; (4) `roadmap#160` stays read-only tracking and
is never a dependency — the resource pins are already decided (#24); (5) round-trip Stage-2
(0/2) now measures an **accepted** condition, not a fix that is pending. Upstream asks stay
rare, stable, issue-sized, and owner-routed.


## D29 (2026-07-30, project-owner ruling on OPEN-QUESTIONS #27 — **RCL target**) Adopt the
**contexts only** of `pankosmia-rcl` (`netContext`, `i18nContext`, `currentProjectContext`,
`bcvContext`, `typographyContext`, `authContext`, `languagesContext`, `messagesContext`,
`clientConfigContext`, `clientInterfacesContext`, `snippetContext`, `wordContext`,
`debugContext`). The contexts are non-visual, and they are in `pankosmia-rcl`, **not** in
`pankosmia-lib` [VERIFIED — pankosmia-rcl@0.4.0 unpacked from npm]. **Do not adopt its visual
components at all**: `create designs as needed, in keeping with our current design` (owner).
This ruling replaces the earlier suggestion to use `Pan*` chrome for utility surfaces that have
no design — we design the settings surface and the fonts surface like all other surfaces. Their
components use MUI primitives and a theme (`fallbackTheme` contains only `{palette}`, thus the
colour and the type would be ours). But a theme cannot remove the remaining seam — the MUI
layout and density idioms, the `variant` type ramp, the `@mui/icons-material` glyphs, and the
library-namespaced i18n strings (`library:pankosmia-rcl:*`) — and that seam is not acceptable on
surfaces that the translator sees. `PanVersificationPicker` and the other components stay useful
as a **reference** (it gets `/api/content-utils/versifications` — the #26 eng-default picker).
**Packaging note (owner, 2026-07-30):** the Pankosmia team changes from **npm → pnpm this coming
week**. Plan the tC4 toolchain for this change (a pnpm workspace and lockfile, and exact pins).
The bundled clients currently use `pankosmia-rcl` 0.2.5 and ^0.3.1, and the latest version on
npm is 0.4.0. Pin the version exactly.
**Timing update (owner, 2026-07-30, later the same day):** the upstream pnpm transition will
probably not complete before Increment 1 closes. So: **Increment 1 builds with npm** (exact
pins stay mandatory; `.npmrc` `legacy-peer-deps` per PLATFORM-NOTES #3). The pnpm move stays the
target and becomes its own small task, scheduled when the upstream transition has landed —
re-check it at the Increment-1 close pin review (with D27's rig re-pin).
**Version update [VERIFIED 2026-07-30 — npm tarball diff 0.4.0 vs 0.4.2]:** `pankosmia-rcl`
released 0.4.1 and 0.4.2 on 2026-07-30, after the #27 analysis. package.json dependencies,
peerDependencies, and exports fields are identical; the export list gains exactly one name —
**`productContext`** (a 14th context; additive, nothing removed or renamed; its internals are
minified and were not read). The contexts-only ruling is unaffected. Choose the exact pin at
scaffold time from the then-current release, and re-verify the export list the same way.


## D28 addendum (2026-07-30, verified platform constraint — corrects D28(2)'s assumed
mechanism, not its substance): **role re-assertion over HTTP is impossible at 0.18.5.**
`burrito2/raw_metadata.rs` exposes GET only; no route writes `metadata.json`; `ipath` cannot
escape `ingredients/` [VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30)]. So checklist
C1p.3 is closed as **reframed**: the re-assertion duty binds writers with filesystem access
(the harness generator complies); the tC4 HTTP client does not attempt it, app-created
projects carry no `x-` roles after first regeneration, and S-2 (paths authoritative,
permanent) carries the design exactly as intended. BURRITO-SPEC §6 W-2 now states the
scoped rule. Revisit only if upstream ships a metadata-write route.


## D31 (2026-07-31, project-owner rulings on the PHASE-1 §6 deviations + repo policy)
(1) **AD-1 amended:** the book-write rule is now "the splice engine, plus the one-time
creation seeder." The seeder writes only a book that has no text yet (stub bodies), is
verified against an independent usfm-js oracle over the real corpus, and never runs on a
book that carries text. (2) **Passage-set UI stays deferred** — whole books are the wizard
path; the D26 data capability is tested and stands. (3) **Write-only pins accepted for
Increment 1** — the panes read the installed-suite constant; Increment 2's resource manager
reads resources.json back. (4) **Push authorized:** the owner authorized pushes to
`github.com/unfoldingWord/translationCore4` (2026-07-31). The never-write-to-upstream rule
(pankosmia/*, git.door43.org) is unchanged. (5) Owner manual test 2026-07-31: create, edit,
project switch, persistence — correct in both projects. UI findings moved into the
Increment-1 UI pass (owner's design project governs the look).


## D30 (2026-07-30, project-owner rulings — resolution-model constraints for D17/OPEN-QUESTIONS
#28; they add no new machinery, they bound the decided machinery) (1) **The language-resolution
unit is (tool, book).** A book's checklist derives from one resource at one version. Per-check
language mixing inside a book never occurs. The §5.2 decision file records the resolved
resource. (2) **The automatic fallback ladder is exactly two rungs:** primary gateway language →
English (the installed suite). Any other language is an explicit, whole-project gateway-language
change (§5 default #2: settings action, consequences shown, warned re-derive). There is no
per-book language picker. Add one only if users ask. (3) **A project's pins bind every opener.**
A checker, a reviewer, or a consultant derives the same checklist from the project's pins. A
personal language preference never changes the project's resources. (This retires the tC3
v52/v53 reviewer-drift failure: the reviewer's local version is irrelevant.) (4) **When the
pinned version is absent locally and the machine is online, the app fetches it** (sb-zip +
SHA, #24) instead of a warn-toward-invalidation dialog. Version upgrades stay explicit, with
re-derive and the orphan review queue (§5 default #3). (5) **Offline with the pinned version
absent:** the affected (tool, book) checking is unavailable — a first-class state, not an
error, and not a block on other work (drafting, other books, other tools continue; composes
the owner's 2026-07-12 ruling on missing resources with §5 default #3). The user MAY choose an
explicit re-pin to a locally available version — warned, re-derive, orphans to review — but
the app never forces it. Implementation home: the D17 schema change (OPEN-QUESTIONS #28),
spec + harness in one change set (§9).


## D32 (2026-07-31, project-owner ruling — TW/TWL storage form; closes OPEN-QUESTIONS #29)
tC4 imports tc-ready book-package resources from Door43 as **SEPARATE burritos** via the
sb-zip pin path (#24): `*_twl` and `*_tw` each their own pin in the §5.3 two-slot shape.
There is **no post-pull combining step and no combined stored artifact**. The links+articles
merge happens at derive time only, as the in-memory groupsData cache (§4.2) — disposable and
regenerable, never a stored source of truth. Basis [VERIFIED — pankosmia-web 0.18.5 (99fd9be,
2026-07-30)]: the server has no logic keyed to the combined layout; the combined
`git.door43.org/uw/en_tw` burrito (per-book TWL TSVs + `payload/` articles, untagged, no
releases) is a convention of the `uw` content org + `uw-client-checks` only, and tC4 uses
neither (D29) — evidence `docs/evidence/uw-combined-tw-burrito-2026-07-31.md`. Rationale:
separate keeps each artifact byte-traceable to its sb-zip export (SHA re-verification);
twl and tw version independently upstream (en_twl v86 vs en_tw v87 at ruling time); set
coherence is enforced by the §5.3 `languageSets` schema, not by storage shape. Accepted
interop edge: Pankosmia's own checking client expects the combined form and will not find
tC4's separate pair.


## D33 (2026-07-31, project-owner ruling — SSE/provider wiring; supersedes the option
ranking in `evidence/rcl-provider-wiring-2026-07-31.md`, which D29 left open) Context: a headless
`SpaProviders` split out of `Spa`/`AppWrapper` is not available upstream [owner-reported
2026-07-31]. Ruling: **tC4 uses the Spa providers — mount `Spa` + `AppWrapper` as an
invisible infrastructure shell** (option a-lite), **as long as it does not impact the UX.**
Bounds that make it UX-neutral [VERIFIED — Spa.jsx + AppWrapper.jsx read in full,
core-client-rcl at npm 0.4.5]: (1) tC4 still renders ZERO MUI components of its own — D29
is unchanged; the shell's only visible surface is the `misc`-event toasts and a 100vh Box.
(2) The toasts MUST be restyled to the owner's design via global CSS over the
`.notistack-MuiContent-*` classes (Spa hardcodes pastel colors; not theme-drivable).
(3) The app-shipped theme (`app_resources/themes/default.json`) carries the tC4 tokens —
already true in the rig (Ocean #014263 / Inspire #31ADE3). (4) Exact rcl pin; at every pin
move re-read the SSE dispatch list (8 event types today) AND the snackbar class names the
CSS override targets. (5) **UX guard:** if a shell update introduces visible chrome that
cannot be restyled without forking, fall back to the thin ~150-line tC4 provider feeding
their context objects (the documented option b) — the guard is the ruling's own condition,
not a new decision.


## D34 (2026-08-03, project-owner ruling — the tW fetch unit; amends D32's rationale and
closes OPEN-QUESTIONS #30) **Option A: one tW pin per language.** For the tW tool tC4 pins
and fetches `<lang>_tw` and nothing else: its DCS sb-zip export already carries BOTH halves
— the per-book TWL link TSVs and the `payload/` articles — so `translationWordsLinks` and
`translationWords` in a §5.3 language set name the SAME repo at the same version (which
§5.3 already permits explicitly). `<lang>_twl` is no longer fetched. Basis [VERIFIED
2026-08-03 — `docs/evidence/tw-twl-sbzip-combined-2026-08-03.md`]: `unfoldingWord/en_tw`
`/sb/v87.zip` = 66 TWL TSVs + 954 articles; `es-419_gl/es-419_tw` `/sb/v37.zip` = 66 TSVs +
1056 articles — the same combined shape, so the rule generalizes across gateway languages.
D32's operative instruction is unchanged (tC4 never combines anything itself); only its
premise is corrected — the combining is DCS `go-rc2sb`'s, not the `uw` org's. Consequence
worth keeping in view: TWLinks inside **every** sb-zip export are repo-relative
(`./payload/kt/son.md`) — `go-rc2sb` rewrites the RC `rc://` form on conversion, measured
on both `en_tw` v87 and `en_twl` v86. The `rc://` form survives in RC source branches and
in tC3-era stored decisions, so `derive/` MUST still accept both (tested). (An earlier
note in the evidence file mis-attributed the `rc://` form to the standalone `_twl` export;
corrected there the same day.)


## D35 (2026-08-03, project-owner rulings — Increment-2 scope calls)
(a) **Wordmap suggestions (AD-7 / C2.13) are DEFERRED out of Increment 2** — "to a later
issue, but soon". The alignment data layer (link/unlink, bootstrap, I-2/I-3) stays in
Increment 2; only the propose-only suggestion feature moves out. It keeps AD-7's condition
when it lands: OFF by default until T21 passes.
(b) **The disposable derive cache (OPEN-QUESTIONS #9) is not built** — measured worst case
in the canon is 20.6 ms (`evidence/derive-perf-2026-08-03.md`). The owner's question that
produced this ruling is recorded because it reframed the item: could the cache catch save
issues? It cannot — derived lists are disposable and regenerable, and decision loss happens
in a different file entirely. The real exposure the question points at is
**OPEN-QUESTIONS #17** (sidecar writes have no compare-and-swap and keep no `.bak`, unlike
book writes), now raised in priority.
(c) **CONFIRMED 2026-08-04 — do not build the disposable derive cache.** OPEN-QUESTIONS #9
is CLOSED on the measured evidence (worst case 20.6 ms).
(d) **Phrase alignment (merging word cards into phrases, with SPLIT) ships WITH the
wordmap-suggestion work** — the same later issue as AD-7/C2.13, not Increment 2.
Increment 2 keeps click-to-place link/unlink only.


## D36 (2026-08-04, project-owner ruling — **the resource is the primary key**)
In tC3, a resource change **invalidated** checks. The owner set the same rule for tC4:
"if a user had completed all of the checks of a book (checking against a different resource) Changing resources will likely mean the user will have some more checks to do. This means that the resource is the primary key not the checks that remain from the previous resource."
**What this settles.** The check list derived from the currently-pinned resource IS the
work. A stored decision that neither re-attach pass (§5.2 — identity key, then D17's
cross-language key) can place does not become a queue item to work through later. It no
longer describes a check that exists, so it is marked `invalidated: true` +
`status: "invalid"`, kept in full (nothing is deleted — re-pinning the old resource
re-attaches it), and does not count as progress. A book that was 100% checked is honestly
less than 100% after the change.
**Where it happens.** At the change, not at the next read: `commitGatewayChange` derives
the new list per affected (tool, book) and rewrites each decision file under
compare-and-swap BEFORE the pins move, so the project is never pinned to a resource its
decisions were not reconciled against. The confirmation dialogue states the exact outcome
per book ("N carried over, M to check again") because the new list is already derived.
**Propagated** (same change set): BURRITO-SPEC §5.2 carry-over rule + §7 counts (1.7-draft,
suite 33 → **34**, Stage-1 29 → **30**); harness check `carry-over: an unplaceable decision
is invalidated...`; `src/data/carryOver.ts` + `test/carryOver.test.ts` (10 checks).
**Retired by this ruling:** the "orphaned decisions waiting for review" notice in the check
session, and the review-queue wording in §5.3 and the gateway dialogue.


## D37 (2026-08-04, project-owner ruling — **store what DCS reports**)
"You should maintain DCS casing so there is as little conversion needed as possible."
**What this settles.** The canonical stored form of a repo path is the form the DCS
catalogue reports. Pins, install records and coverage keys carry it unchanged, so the
normal comparison is a plain string match and nothing is normalized on the way in or out.
The one tolerance kept is at COMPARISON time only (`samePath`): a DCS path is a
case-insensitive address, so a burrito written by another tool must not read as "needs
downloading" for a resource that is on disk. That converts nothing that is stored.
**Propagated** (same change set): the conformance sample and `generate.mjs` now pin
`git.door43.org/es-419_gl/...` — DCS's own answer today [VERIFIED live 2026-08-04:
`GET /api/v1/repos/Es-419_gl/es-419_tn` -> `full_name: es-419_gl/es-419_tn`]; the
BURRITO-SPEC §5.2/§5.3 examples match; `pathKey` (the lower-casing map key) is removed.
Harness 34/34 after regeneration. PLATFORM-NOTES #31 records the underlying fact.
**Owner assessment on the companion defect (PLATFORM-NOTES #30, a renamed org baked into an
export):** "probably a pretty rare case — most users will be using the latest version."
Recorded, with one measured qualification: for es-419 the affected releases ARE the
latest (v66 / v37 / v4, all published 2024-07-17), so the stale org is that suite's
current state, not an old-version artifact. The handling stays as built (~20 lines,
7 checks); it is not treated as a headline risk.



## D38 (2026-08-06, project-owner ruling — **deferred work lives on the board**)
Increment-2 verification found the exit criteria demanding T21 while the same document
deferred the work T21 tests (C2.13, D35a). The criteria were unmeetable as written.
**Ruling:** amend the Increment-2 exit criteria to `T5, T11–T20`; C2.13 / FR-21 becomes a
GitHub issue in the **backlog with no milestone** — not Increment 3 — because it may need
its own epic when scoped.
**The general rule this sets.** A deferral is recorded by *moving the issue*, not by a
sentence in a document. An issue always lives somewhere: in an epic, in the backlog, or
closed. "Soon" is not a destination and is no longer expressible. The same applies to a
non-blocking review finding: it becomes an issue before the phase closes, never a line in
a PHASE-SUMMARY. Evidence for the rule: PHASE-1-SUMMARY §7 listed five follow-ups; three
were measured undone after a whole increment — Google-CDN fonts still linked in
`index.html` (FR-31 offline is violated today), no jsdom leg in S-0a although Increment 2
*was* the checking increment, and `vite-plugin-node-polyfills` unnarrowed.
**Consequence:** the GitHub board becomes the record of truth for work state. Files keep
contracts, decisions and evidence. Anything with a checkbox, a status or a done/not-done
column belongs on the board. `CLAUDE.md`'s "every shareable plan lives in `docs/`" is
superseded for work items; the migration plan is `ISSUE-MIGRATION-PLAN.md` [publication note 2026-08-07: a maintainer-workspace document, not in this repository].
**Not re-decided:** the derive cache. D35(c) already ruled no cache and OPEN-QUESTIONS #9
is closed. `INCREMENT-2.md` line 145 still said "awaiting owner"; that was an unpropagated
decision and is corrected in the same change set, not re-ruled.


## D39 (2026-08-06, project-owner ruling — **single instance per machine; concurrency has two
layers**) The Increment-2 independent review raised a "two realms bypass the process-local
write lock" finding (B17). The ruling separates two cases that were being conflated:
**(a) Same machine.** tC4 runs a **single instance per machine**, as tC3 did. The in-process
write lock (`httpStore.withPathLock`) therefore fully covers same-machine concurrency — the one
running copy's own overlapping async writes (debounced saves, panels, a gateway change). A
speculative cross-browser-tab guard (`navigator.locks`) added during the review is **reverted**:
under single-instance it is dead code.
**(b) Different machines.** Offline users on separate machines editing one project is **not a
lock problem** — each machine holds its own git clone, so there is no shared file to
compare-and-swap. It is resolved by the Phase-2 journal / publication design (per-actor streams,
fold/union, review-queue forks — BURRITO-SPEC §8), which is `[PROPOSED]` and **gated to start
after Phase 1 ships** (OPEN-QUESTIONS #10/#16; BACKLOG M4). It is **out of scope for Increment 2**
(Phase-1 single-user checking).
**Consequence:** B17 is not an Increment-2 blocker. Same-machine is closed by single-instance +
the in-process lock; cross-machine is tracked as Phase-2 journal work. OPEN-QUESTIONS #17's
remaining "cross-process/realm" concern is answered by this ruling (single instance) plus the
Phase-2 journal for the multi-machine case. Enforcement note: single-instance is a
packaging/shell responsibility (as in tC3); the client relies on it rather than re-implementing
a multi-realm CAS.


## D40 (2026-08-06, project-owner ruling — **every project maps refs uniformly; eng is not a
special case**) Surfaced by the Increment-2 review's B19 (scope filtering) work. Today the
client does NO versification mapping at derive: it selects a scheme at project creation and then
compares TSV/original-language refs against the project's `currentScope` **as-is**. That is
correct only because the default **eng** scheme's TSV refs already sit in the eng frame — a
coincidence, not a design. **Ruling:** all projects MUST be handled the same. Every project maps
TSV and original-language refs INTO the project's chosen versification frame at derive time
(Proskomma `mapVerse` + the project's `ingredients/vrs.json`), and scope containment
(`refInScope` / `doesReferenceContain`) and the §5.2 decision identity key operate on the
**frame-normalized** ref. There is no eng short-circuit and no eng-only assumption anywhere in
the derive/scope/identity path.
**Status:** this is the versification-mapping work already tracked as OPEN-QUESTIONS #26(b)
("store refs in the project frame; map at derive time"); D40 makes it a firm requirement and
removes any "eng works, non-eng later" framing.
**Scheduling [decided 2026-08-06]:** it becomes **its own gated increment** — NOT bolted onto
Increment 2 and NOT a bare backlog issue. It gets a proper design pass, because it touches the
derive pipeline, the §5.2 identity key, a new Proskomma-versification dependency, non-eng test
fixtures, and the storage-frame decision (#26b). **Increment 2 closes eng-proven**; D40 is the
standing requirement that the versification increment must satisfy (all projects handled the
same). Until that increment ships, tC4 checking is proven for eng projects only — recorded here,
not lost.


## D41 (2026-08-06, project-owner ruling — **warned fallback when a pinned primary is not
installed**) Increment-2 review B20. When a book resolves to the FALLBACK rung only because the
pinned PRIMARY resource is not installed, the resolver cannot tell "primary covers this book but
is not local (should fetch)" from "primary genuinely lacks this book (fallback is right)" —
coverage is local-evidence-only ("never assumed"). **Ruling:** open the installed fallback (the
session is usable) but do NOT do it silently — `preflightToolBook` sets `unavailablePrimary`, and
the UI surfaces a warned-update offering to fetch the pinned primary. Rejected alternatives: the
original **silent** language switch (the bug), and a **forced fetch** for every not-local primary
(over-correction — fetches for books the primary may not even cover). **The complete
fetch-vs-fallback decision needs the primary's coverage when it is not local → record per-pin
coverage in resources.json §5.3**, folded into the resolver-metadata increment (BACKLOG E2.6,
with D40's versification). Increment 2 ships with the warned fallback.

## D42 (2026-08-10, project-owner ruling) **Milestones and epics replace increment
documents.** The build plan lives on the GitHub board: a milestone is an increment, and an
epic issue carries the increment's journey and work items. No new `INCREMENT-N.md` document
is written; `INCREMENT-1.md` and `INCREMENT-2.md` stay frozen as historical records.
Supersedes the D24 clause that made the increment document govern its increment. First
instance: milestone "Increment 3 — open, resume, and share a project" with epic #39.

## D43 (2026-08-10, project-owner ruling) **This repository is the single source of truth
for the published project documents.** The files under `docs/` here are the masters; edits
go through pull requests to protected `main`. The maintainer workspace keeps no second live
copy — its old copies are pointer stubs or frozen mirrors. New decisions are recorded in
this file, by PR. Supersedes the workspace-is-master half of the 2026-07-30 SSOT ruling.
The P6 closing review (2026-08-10) verified the copies byte-identical before the handover.

## D44 (2026-08-10, project-owner rulings) **Fold the journal test plan; freeze the ID
decoder.** (a) `JOURNAL-TEST-PLAN.md` folds into `BURRITO-SPEC.md` as Appendix A — §9
already binds the spec, the plan, and the suite to one change set, so they are one
document. The old path keeps a pointer stub. (b) `LEGACY-IDS.md` is frozen reference, not
a maintained master: the IDs it decodes can no longer be assigned. It stays published
because the migrated issue bodies link to it.

**D44(c) addendum (2026-08-10, same-day owner ruling) — annotate superseded decided text;
never rewrite it.** In a frozen or historical document, a decided statement keeps its
original wording. When a later decision supersedes it, append one note in one fixed shape:
`[superseded by Dnn, YYYY-MM-DD — <the current rule in one clause>]` — at the end of the
decided text, never interleaved. The current rule goes inside the note, so a reader who
reads only the bracket gets today's truth. Current truth never lives only in an
annotation: a superseded rule that still matters for building MUST be carried by the
normative document (the completeness rule). Documents outside the authority contract
(planning seeds, frozen increment records) are history, not current truth — their
annotations are for human readers; agents take current truth from the authority table.

## D45 (2026-08-10, project-owner ruling) **No project-memory graph now.** The project
does not adopt a knowledge-graph store for decisions, architecture, or open questions.
The documents hold what is true; the disciplined IDs (Dnn, Ledger #n, PLATFORM-NOTES #n)
keep relations searchable. Adoption trigger — treated as a significant event, not routine:
a concrete miss (a missed supersession, a contradiction found late) or a second regular
contributor. If adopted then, the shape is a thin index derived from the documents by
script — never a hand-maintained second store.

## D46 (2026-08-10, project-owner ruling) **Versioning: SemVer pre-releases of 4.0.0.**
The client is translationCore 4. Releases go `4.0.0-alpha.N` → `4.0.0-beta.N` →
`4.0.0-rc.N` → `4.0.0`. Never `3.9.x`: translationCore 3 is a separate codebase, and the
version must mark the rewrite boundary. One pre-release per milestone close; the notes
carry the journey shipped and the pasted test evidence. Published 2026-08-10:
`v4.0.0-alpha.1` (`e4ada8b`, first public build) and `v4.0.0-alpha.2` (`3758a95`,
Increment-2 close). `package.json` tracks the current pre-release.

## D47 (2026-08-12, project-owner ruling) **The post-release format-change contract, and
data-first sequencing to 4.0.0.** (a) After 4.0.0 ships, no change to the at-rest project
format lands without all three: a `schemaVersion` bump per §9, a written migration, and
harness fixtures that prove old data opens correctly under the new reader. Additive-optional
fields are the only exception. (b) Before 4.0.0, work that shapes at-rest records ranks by
one test: does postponement accrue bad data? Work that accrues (versification mapping #15,
decision version stamps #28, coverage records #16, the write-side journal #52) lands first —
Increment 3 — before the feature increments multiply what is recorded. (c) The journal write
side ships in 4.0.0 (issue #52, after #22 ratifies §8): every 4.0.0 project carries complete
per-action history from day one, verified in CI by folding the app-written journal with the
reference implementation and comparing to actual state. The fold/sync/review app work stays
Phase 2. (d) Verse move/span operations are post-4.0 under clause (a) — they re-key stored
alignments and decisions.

**D42 addendum (2026-08-14, project-owner convention, recorded after the independent
Increment-3 readiness review):** the journey rule applies to feature increments. An
infrastructure increment (the first: Increment 3) completes no user journey — the
milestone description carries its ordering, and an epic exists only where several
issues share one design surface. Feature increments keep the journey-epic rule as
written. Increment 3 has no journey by design; journey J8 belongs to Increment 4.

## D48 (2026-08-14, project-owner ruling) **§8 conditionally ratified.** The journal
architecture — append-only actor journals, deterministic folding, explicit forks, derived
projections, isolated publication branches, zero-trust integration, rebuild-and-swap
receiving — is approved. **Section 8 becomes normative only when one change set lands with
all suites green, containing:** the seven contract corrections recorded on issue #22
(pin-slot grammar with a golden projection test; §5.1 extraction as the fold's only I-3
hash; the actor-binding refusal; the same-actor linear rule with tests; scope carried on
`book.add` as `[] | range[]` so checkpoints reconstruct §3 rule 4; out-of-band divergence
detection for every derived shared file; `project.meta.set` never writing `type`); the
structural re-key action (#65 — atomic old-key→new-key mapping, no half-applied
projections, retention per D36); the textTranslation flavor boundary (other flavors, e.g.
textStories/OBS, extend by version bump per §9 — v1 writers unaffected); the D47(d)
supersession note (#63 unparked verse operations); the published sample and conformance
harness (#47 — a hard dependency: §9 requires spec and harness to change together, which
is only possible in one repository). Sub-decisions adopted with the ruling: `textMd5` and
`skeletonMd5` are REMOVED from v1 (`targetVerseMd5`, which carries I-3, stays); Ledger #4's
"journal checking first" offer is declined — D47 chose every mutation from day one. Basis:
three independent reviews on #22, their reproduced implementation gaps verified twice over.
