# Implement OBS resources and image packs — issue #288

Status: **[PROPOSED] implementation plan**, 2026-09-16. No implementation is included.

Scope: [issue #288](https://github.com/unfoldingWord/translationCore4/issues/288), as updated
2026-09-16 at 13:10 UTC. The issue holds the acceptance criteria. This plan orders the work.
Source baseline: tC4 **4.0.0-alpha.6**, commit
`be5423c81b4d825b7c8f81d553c85a470bff39c7`, read 2026-09-16.

## Agreed result

**[decided 2026-09-16 — issue #288 definition review]**

- A complete OBS set has `obs`, `obs-tn`, `obs-twl`, `translationWords`, and
  `translationAcademy`. Bible-only members are optional for OBS. Bible completeness stays
  unchanged. An incomplete primary set can use the defined English fallback.
- Each language set may have an `obs-images` ResourcePin. It does not affect completeness.
- Images resolve per frame: project ingredient → primary image pin → fallback image pin
  → bundled default. Missing, corrupt, or ambiguous candidates fall through. No candidate
  means text only. Rendering never changes Markdown or stored pins.
- Gateway changes preview image changes. Untagged packs stay at their SHA and do not block
  discovery of help-resource updates. No branch-following behavior is introduced.

The implementation records the approved amendment in [DECISIONS.md](../DECISIONS.md) and
updates [BURRITO-SPEC.md](../BURRITO-SPEC.md) with its conformance checks in the same change
set. It retains the existing download, installation, store and journal infrastructure.

## Findings that determine the order

**[VERIFIED — source read at the baseline above; these are client-code findings, not new
claims about Pankosmia behavior.]**

| Surface | Current behavior | Work required |
|---|---|---|
| `src/data/burritoStore.ts:96–108`; `src/data/installed.ts:417–462` | LanguageSet and installed-set assembly require Bible help slots. | Add OBS slots and explicit project-kind validation/assembly. |
| `journal/grammar.mjs:357–359`; `journal/checkpoint.mjs:103–138` | The three OBS text slots already validate and project; `obs-images` does not. | Add the image slot without losing existing slot ordering or pin removals. |
| `src/state.jsx:2718–2778` | Resource-change planning enumerates book codes and consults versification. | Route OBS planning through `(tool, OBS)` and story references. |
| `src/data/journal/journalingStore.ts:2319–2380` | Decision diffs require a book generation, inspect `bookId`, and emit v1 events. | Support v2 story decisions without a generation before OBS carry-over can work. |
| `src/data/journal/journalingStore.ts:2708–2769` | Resource changes validate preconditions and publish decision/pin diffs together. | Reuse this transaction and forward-recovery path. |
| `src/data/serverApi.ts:341–345` | The inspected raw-ingredient wrapper returns text. | Verify the platform's binary-image serving surface before choosing the image adapter. |
| `scripts/desktop-bootstrap.cjs:23–40`; `scripts/package-desktop.zsh:442–490` | Windows and POSIX first-run seeding have distinct entry points. | Exercise both; changing only the Windows bootstrap would not prove all installers. |

The context graph was available for this planning pass. Refresh it after substantial code
changes. The unrelated deletion of `.mcp.json` present at planning time must be left alone.

## 1. Establish real resource and image fixtures

**Deliverable:** a dated resource evidence record and small provenance-backed fixtures.

1. Run one invalid-input negative control through the resource download path. Then select
   valid identities from the catalogue, installed configuration or discovery response.
2. Start with the English and Spanish identities in
   `conformance/sample-burrito-obs/ingredients/checking/resources.json`. Verify their
   available exports, commit SHAs, actual flavor labels, story paths, help paths and article
   links. Do not treat the fixture's decision-based flavor strings as export evidence.
3. Inspect `uW/obs_images_360` at a recorded commit. Establish its ingredient paths, image
   names and frame mapping; record the source and image licenses. Check the real source
   image line against the installed pack. Do not fetch arbitrary image URLs from Markdown.
4. Verify how the pinned platform serves image bytes locally, following the evidence rules
   in [PLATFORM-NOTES.md](../PLATFORM-NOTES.md). Record version, commit and date. A successful
   HTTP response containing text is not a decoded-image proof.
5. Vendor only the small real samples needed for deterministic tests, with provenance.
   Derive wrong-SHA, missing-image and malformed-image controls explicitly from those
   fixtures. Keep full packs in the existing packaging cache, not the source tree.

**Exit check:** successful exact-SHA text and image retrieval, distinct negative-control
failures, and a documented frame-to-image mapping. If export labels differ, correct the
specification and harness in step 2. Do not invent replacement repos or tags.

## 2. Land format, types and journal support together

**Files:** `docs/DECISIONS.md`, `docs/BURRITO-SPEC.md`, `src/data/burritoStore.ts`,
`journal/grammar.mjs`, `journal/checkpoint.mjs`, relevant seed/validation helpers,
`conformance/generate-obs.mjs`, `conformance/validate.mjs`,
`conformance/validate-journal.mjs`, and product journal tests.

1. Record the approved OBS completeness rule and optional image slot. Update §5.3/§10.6,
   including compatibility with existing documents and incomplete-primary fallback.
   Define completeness as distinct from whether a stored document is readable; do not
   reject a project merely because a pin is not installed on this machine.
2. Make common resource slots explicit in TypeScript. Use project-kind-aware validation
   and narrowing at the boundaries, so loosening the shared shape does not weaken Bible
   checks. Do not infer project kind from missing Bible slots or invent a new persisted
   kind field; use the project's existing flavor.
3. Accept `languageSets.primary.obs-images` and `languageSets.fallback.obs-images` in the
   pin grammar. Project them after `obs-twl`. Preserve `schemaVersion: 2` for the additive
   slot and keep SHA required, version optional. Verify seed → fold → checkpoint → reopen
   and pin removal, including old Bible and OBS documents without image pins.
4. Extend the existing decision-diff path for OBS. Validate story references, select the
   `OBS.json` records, emit v2 `check.decision.set` events without `generation`, and keep
   Bible events unchanged. Preserve resolution records, comments, bookmarks and retained
   invalid decisions. Reuse the existing atomic resource-change publication and recovery.
5. Every new or amended normative rule gets a check that fails when the rule is violated.
   Keep existing v1 journal behavior and fixtures green.

**Exit checks:** conformance validation, journal validation, normative coverage gate,
focused product journal tests, and TypeScript checks.

## 3. Add OBS discovery, installation and resolution

**Files:** `src/data/installedSuite.js`, `installed.ts`, `resourceFetch.ts`, `resolve.ts`,
`gateways.ts`, `coverageBackfill.ts`, and the resource helpers used by `src/state.jsx`.

1. Add the verified English OBS pins and default image-pack pin to the bundled-resource
   configuration. Keep the default separate from optional project override pins. Reuse
   installed copies by `(repoPath, sha)` and retain support for coexisting revisions.
2. Extend installed-set assembly and package-row discovery to accept project kind.
   OBS rows request its text and help slots plus shared articles, without requiring
   Bible books, original-language texts or lexicons. Do not synthesize repository names
   as evidence that a resource exists; match actual discovered records.
3. Resolve a complete OBS collection for each checking tool at `(tool, OBS)`.
   Distinguish missing slot, available exact pin, fetch required, unavailable offline,
   and discovery/transport failure. Do not run OBS through Bible versification or use
   Scripture Burrito's Bible-passage scope as evidence of story coverage.
4. Return the resolved help resource and its matching gateway story source together.
   Missing gateway helps use the warned English fallback; an established missing local
   pin does not silently change identity. Share the same resolved word/academy articles.
5. Adapt the minimum headless OBS TSV-to-check-item handling needed for resource-change
   previews. Preserve story/frame identity, title frame 0 and occurrence 1. Expose this
   helper to #290/#291; leave their screens out of this change.

**Tests:** extend installed-resource, resource-slot, package-row, fetch and resolution
suites. Cover an OBS-only set, an incomplete primary, English fallback, offline missing
pins, same-repo/wrong-SHA installs, sha-only pins and unchanged Bible results.

## 4. Extend upgrade and gateway-change transactions

**Files:** `src/data/upgrade.ts`, `gatewayChange.ts`, `carryOver.ts`, `src/state.jsx`,
`src/views/modals/GatewayChange.jsx`, `UpgradeSet.jsx`, the resource-selection modal and
`src/i18n/en.json`.

1. Extend slot enumeration for OBS text, helps and tagged image overrides. Treat a verified
   no-release image pack as unchanged; do not swallow network, permission or malformed
   response errors as “no release.” Keep existing Bible upgrade scope unchanged.
2. Build OBS previews from stored `(tool, OBS)` decision files. Re-derive against staged,
   SHA-verified resources and calculate actual carried/invalidated records. Remove the
   Bible-versification prerequisite from the OBS branch only.
3. Before accepting a new OBS source, compare all fifty stories' fixed frame identities
   with the project's existing stories, including same-count identity changes. Reject
   incompatible changes without editing the project or rewriting source image lines.
4. Show text/help pin changes and the effective image-pack change. A new primary set with
   no image override removes the old primary override; fallback stays unchanged. Cancel
   leaves pins, decisions, draft bytes and displayed images unchanged.
5. Commit through the existing resource-change store transaction only after staging is
   complete. Revalidate the preview's expected hashes and project/session identity before
   publication. Test stale previews and switching projects during a download.
6. Distinguish cancellation/download failure before publication from interruption after
   journal publication: the former changes no project data; the latter must use existing
   forward recovery to one consistent result, not pretend the action never happened.

**Tests:** successful upgrade/change, cancelled preview, wrong SHA, failed download,
untagged image pack, incompatible frame set, stale preview, retained invalid decisions,
image-only changes, unchanged fallback, and recovery after publication. Include a project
with actual OBS decisions; a project with no decisions cannot prove carry-over.

## 5. Build the reusable image resolver

**Proposed module:** `src/data/obsImages.ts`, plus a small binary/local-image adapter at
the verified platform boundary. Keep React out of the data module.

1. Accept the project metadata, parsed story/frame, language-set pins, installed-resource
   inventory and explicit default-pack pin. Return a selected local image descriptor plus
   provenance, or an explicit no-image result; do not return a remote CDN fallback.
2. Apply the mapping established in step 1 within each precedence tier. Ambiguous matches
   produce a diagnostic and fall through instead of depending on directory order.
3. Decode candidates before considering them usable. Missing/corrupt images fall through;
   retain diagnostics for transport or metadata failures so they are not misreported as
   proven absence. Rendering remains text-usable even when no candidate works.
4. Use exact pin identity and frame identity in any cache key; invalidate it after resource
   or metadata changes. If object URLs are needed, release them on replacement/unmount.
5. Test that resolution performs no project writes, does not alter image-line bytes, and
   remains consistent after metadata refresh and project reopen. Reuse existing metadata
   role handling where available; do not rely on an in-memory-only project override.

**Exit check:** tests cover all four precedence tiers, absent optional slots, duplicate
pins, missing/corrupt/ambiguous candidates, no image anywhere and wrong-SHA rejection.
Supply a small browser test for actual decoding; mocked image success is insufficient.

## 6. Bundle resources and prove offline first launch

**Files:** `scripts/package-desktop.zsh`, the resource-cache helper,
`scripts/desktop-bootstrap.cjs`, `scripts/desktop-bootstrap.test.cjs`,
`scripts/smoke-api.cjs`, both `smoke-installed` scripts, existing packaging CI and
[PACKAGING.md](../PACKAGING.md).

1. Include the three English OBS text resources and the default image pack in every
   supported production artifact. Verify pins against the application configuration and
   emit them in `BUILD-MANIFEST.json` and attribution records.
2. Cover both Windows bootstrap and POSIX launcher seeding. Preserve existing installed
   revisions and exact-pin lookup. If an occupied canonical directory has another SHA,
   use the existing coexistence convention rather than overwriting it or claiming success.
3. Extend the post-install smoke proof with a browser-capable image decode check using the
   installed app's actual local serving path. A text/HTTP-only check in `smoke-api.cjs`
   is not enough. Reuse packaged Electronite or the existing CI browser tooling; do not
   add a development dependency to the production runtime for the test.
4. Run with a fresh isolated store and browser cache, external networking disabled before
   first launch, and loopback available. Resolve story 1/frame 1 from the bundled pack;
   assert decode success and positive dimensions, and fail on any external/CDN request.
5. Restart and prove idempotent seeding. Record artifact version, commit, platform, manifest
   identities and complete command output for Windows, macOS and Linux through the
   existing packaging matrix.

**Exit check:** artifact and installed-app evidence passes. Clean-clone skips remain
legitimate, but cannot replace this proof.

## Delivery order and acceptance mapping

Use one issue-scoped branch, such as `codex/288-obs-resources`, with reviewable commits:

| Commit group | Depends on | Acceptance coverage |
|---|---|---|
| Evidence, format and journal | Steps 1–2 | Completeness, slot persistence, OBS decision transactions, compatibility |
| Resource install and resolution | Step 2 | Correct pins, fallback, offline states, unchanged Bible behavior |
| Resource changes | Step 3 | Upgrade/change previews, carry-over, cancellation and failure behavior |
| Image resolver | Steps 1–3 | Precedence, matching, decode, no Markdown writes |
| Packaging and installed proof | Resolver and resource configuration | Bundled assets, first launch, restart, offline decode |

Do not open new work items or reassign this issue as part of planning. The issue is assigned
to `eliaspinero`; the API returned no project-board item during this read. At implementation
start, coordinate board status and overlap with #287, especially project types, resource
selection and `src/state.jsx`.

#288 owns the headless resource and image contracts and installed image-decode proof.
#289–#291 consume those contracts in their story screens; #292 proves the complete OBS
journeys. Those screens are not prerequisites for this foundation's tests.

## Final verification

From the repository root, after installing root and conformance dependencies:

```text
npm run verify
npm --prefix conformance run validate:all
```

Run focused tests at each commit group, then the full commands above. `validate:all` includes
the normative gate; run `node conformance/normative/check.mjs` directly while editing rule
coverage. Add product cases to suites that `verify` actually executes. Run the existing
Bible resource journeys where the rig is available, plus the OBS resource integration
cases and installed-app smoke on the supported platforms.

Keep the three pinned alignment libraries unchanged. Use Node's real builtins in file-based
Vitest tests as CONTRIBUTING requires. Refresh the graph after implementation. Attach
untruncated evidence and the issue acceptance mapping to the PR. Tests and production
builds have not been run for this planning-only document.
