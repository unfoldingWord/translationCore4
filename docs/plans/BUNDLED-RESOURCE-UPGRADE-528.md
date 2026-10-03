# Development brief for bundled resource upgrades

Prepared 2026-10-02 for [issue 528](https://github.com/unfoldingWord/translationCore4/issues/528), which blocks [the rc.1 release](https://github.com/unfoldingWord/translationCore4/issues/371).

Installing a newer app must make its bundled resources available offline while existing projects continue to read their pinned releases. **Install each distinct resource revision in its own folder, regardless of whether an older revision is pinned.** Reuse an already installed exact revision. Keep project updates and removal of old releases separate from installation.

## Decision status

[decided 2026-10-02 — owner follow-up, published issue read back] Always preserve older releases and install each new revision separately. The owner requested that issue 528's main description adopt this design. The updated issue supersedes the earlier replace-if-unpinned ruling and revises its acceptance criteria. Startup ensures the bundled revision exists and is recorded; it does not scan project pins or replace an older revision.

[decided 2026-10-02 — issue 528] Accept the additional disk use for this fix. A later cleanup operation can remove unused releases after it proves they are not needed. Automatic cleanup during launch is outside this change. Implementation details below remain guidance where marked PROPOSED.

## Evidence and existing contracts

[VERIFIED — source read 2026-10-02] The inspected tC4 baseline is `4.0.0-rc.1`, commit `ddc7786b3ca38112ff2df8adda0312c4db696afd`. Links below pin that baseline. These are source findings, not proof that a changed installed app works.

| Source | Finding and implication |
| --- | --- |
| [Desktop bootstrap, lines 87–120](https://github.com/unfoldingWord/translationCore4/blob/ddc7786b3ca38112ff2df8adda0312c4db696afd/scripts/desktop-bootstrap.cjs#L87-L120) | `copyIfMissing` skips an existing destination. It stages a fresh copy before publishing it. `bootstrap` applies this to bundled resources. This explains why an older canonical folder prevents installation of the newer bundle. |
| [Desktop main, lines 135–157](https://github.com/unfoldingWord/translationCore4/blob/ddc7786b3ca38112ff2df8adda0312c4db696afd/scripts/desktop-main.cjs#L135-L157) and [Linux launchers, lines 459–518](https://github.com/unfoldingWord/translationCore4/blob/ddc7786b3ca38112ff2df8adda0312c4db696afd/scripts/package-desktop.zsh#L459-L518) | Mac and Windows call bootstrap under the Electron singleton lock. Linux copies missing folders in generated shell launchers before Electron starts. Fixing the CJS helper alone leaves Linux behind. |
| [Build manifest generation, lines 563–595](https://github.com/unfoldingWord/translationCore4/blob/ddc7786b3ca38112ff2df8adda0312c4db696afd/scripts/package-desktop.zsh#L563-L595) | `BUILD-MANIFEST.json` supplies repository identity, full SHA and optional version label. The staged Burrito supplies factual flavor and revision. Do not infer identity from a release label. |
| [D58, lines 965–990](https://github.com/unfoldingWord/translationCore4/blob/ddc7786b3ca38112ff2df8adda0312c4db696afd/docs/DECISIONS.md#L965-L990) and [resource pin specification](../BURRITO-SPEC.md#53-resource-pins-checkingresourcesjson-role-x-resource-links) | Identity is repository plus full commit SHA. The version label is optional. D58 supersedes D57's requirement for a version label; retain factual flavor recording. |
| [Exact installed resolution, lines 212–252](https://github.com/unfoldingWord/translationCore4/blob/ddc7786b3ca38112ff2df8adda0312c4db696afd/src/data/installed.ts#L212-L252) and [pinned download, lines 1164–1184](https://github.com/unfoldingWord/translationCore4/blob/ddc7786b3ca38112ff2df8adda0312c4db696afd/src/state.jsx#L1164-L1184) | The client already resolves exact identities across different local paths. Downloads already use a SHA suffix when the canonical path is occupied and record the actual installed path. Reuse this contract. |
| [Discovery, lines 122–183](https://github.com/unfoldingWord/translationCore4/blob/ddc7786b3ca38112ff2df8adda0312c4db696afd/src/data/installed.ts#L122-L183) | Discovery trusts a recorded path instead of re-reading its metadata. Without a record, `discoverOne` treats a SHA suffix as part of the repository name. Correct records and interrupted-record recovery are required. |
| [Default selection, lines 433–532](https://github.com/unfoldingWord/translationCore4/blob/ddc7786b3ca38112ff2df8adda0312c4db696afd/src/data/installed.ts#L433-L532) | Some suite and Bible selectors choose the first installed match by repository name. `pinsPreferringInstalled` prefers an exact SHA but covers only language sets. Folder coexistence must not make a new project select an arbitrary older release. |
| [Installed source smoke, lines 196–210](https://github.com/unfoldingWord/translationCore4/blob/ddc7786b3ca38112ff2df8adda0312c4db696afd/scripts/smoke-api.cjs#L196-L210) | The source check reads a fixed canonical `en_ult` path. A readable old release can pass it. The upgrade leg must assert the project's exact identity and resolved path. |

## Recommended storage and installation design

[PROPOSED] Use a deterministic folder such as:

```text
_local_/_sideloaded_/<owner>--<repo>--<full commit SHA>/
```

Use the full SHA for new bundled installs. Two labels that name the same repository and SHA reuse one release. A different SHA gets a different folder. Owner and repository comparisons follow the existing identity rules. A short SHA is suitable for display, but must not be the only check that a destination is the requested release.

[PROPOSED] Keep older bare-name, owner-qualified and short-SHA folders at their existing paths. Do not rename them or copy every legacy resource merely to impose a naming convention. If an exact bundled revision already exists in a complete legacy folder, reuse it and retain its path. Preserve that folder byte-for-byte.

[PROPOSED] Put the behavior behind one deep module with a small interface: `ensureBundledResources({ resourcesDir, home, storeLeaf })`. The name is illustrative. Its implementation owns identity validation, destination selection, staging, record updates and recovery. Callers should not need to know the publication order or folder rules. Use this module on all platforms under the existing singleton lock, before the server starts.

### Publication and recovery

[PROPOSED] For each bundled resource:

1. Read the bundled identity from the build manifest. Verify it against the staged resource's metadata and validate the expected complete resource tree. Read the flavor from the Burrito metadata.
2. Find an already installed exact revision, including legacy paths. Reuse a complete match. An existing directory with conflicting or incomplete identity is an error, not proof of installation.
3. If absent, copy into a staging location outside the server's discoverable resource tree. Validate the completed copy before publication. Keep staging on the same filesystem as its destination so publication can use a directory rename.
4. Publish the completed directory. Do not modify an older release or any project file.
5. Atomically merge the actual path and verified pin into `installedResources` in the existing client settings document. Preserve other resources and unrelated settings. Omit an absent version label rather than invent one.
6. Start the server only after the installed bytes and records agree. A second launch with correct bytes and records performs no writes.

[PROPOSED] Filesystem publication and a settings write are two operations. Recovery must handle a crash between them: on the next launch, recognize the complete published bundle and repair its missing record before the server starts. A failed record write must propagate through the existing startup error path. A retry must not duplicate the resource. Remove abandoned staging without presenting it as installed. Test process interruption as well as exceptions, because `finally` does not run after a process is killed.

[PROPOSED] Keep `installedResources` as the existing machine-local installation index. Do not introduce a second competing registry or a global mutable `current` folder. New-project defaults come from the shipped suite's explicit identities; each project's pins govern subsequent reads. Directory enumeration order and the largest-looking version label must never choose a revision.

### Resolution and new project defaults

[PROPOSED] Preserve exact `repoPath + sha` resolution for existing project slots. For initial English source texts and helps, select the exact shipped suite identities when present. Audit both Bible source selection and helps-suite selection with the old entry inserted first, then with the new entry first. Preserve existing gateway-language choices and explicit project update flows.

[PROPOSED] Bundled records must recover deterministically from the manifest and metadata. Where discovery supports versioned folders without records, ensure it does not turn the suffix into a repository name. Reuse the existing identity interpretation where possible; keep download naming changes outside this fix unless required to make the shared resolver correct.

## Implementation sequence and file scope

[PROPOSED]

1. Follow the updated issue 528 policy and acceptance criteria: preserve an unpinned old release while installing or reusing the bundled revision separately. Fresh-store user behavior stays the same while the new folder layout is allowed.
2. Write the upgrade smoke/journey cases before implementation. For isolated launcher tests, first document copy, publication, registry, retry and identity failure modes, as required by [AGENTS.md](../../AGENTS.md#how-to-test).
3. Extend `scripts/desktop-bootstrap.cjs` and its tests with the shared install operation and restart recovery. Reuse the existing profile path and atomic JSON-write discipline.
4. Call it from `scripts/desktop-main.cjs` on Linux too. Remove resource copies from the generated Linux launchers in `scripts/package-desktop.zsh`. Preserve debug seed behavior, store isolation, external-server mode and singleton behavior.
5. Reuse `src/data/installed.ts` for exact resolution. Adjust only the selectors and discovery behavior needed for deterministic coexistence. Verify `src/state.jsx` new-project/source paths through user flows.
6. Add the upgrade leg to `scripts/smoke-installed.zsh` and `scripts/smoke-installed.ps1`; put common fixture and assertion logic in a shipped CJS helper where useful. Update packaging's fixed-path checks and ship every required helper. Wire both fresh and upgrade legs into all `smoke-*` jobs.
7. Update [PACKAGING.md](../PACKAGING.md#bundled-english-suite-163-218-504): replace the obsolete copy-only-missing description and add an older-store offline run. Record the installed Mac witness in `docs/evidence/`.

[PROPOSED] No project format change, resource pin update, online fetch, platform upgrade, generalized package manager or cleanup feature is required.

## Acceptance and proof

The following summarizes the adopted issue 528 acceptance criteria. It is not a claim that they have passed.

| Case | Required result and artifact |
| --- | --- |
| Older release, no project pin | Old directory hashes stay unchanged. Bundled revision has its own complete directory and correct installation record. |
| Older release pinned by one or more projects | Old directory hashes stay unchanged. Each old project's source/helps resolve to its exact old SHA. A new Bible project pins and reads the bundled SHA. |
| Empty store | The app installs the whole shipped suite and works offline. Folder names may change; the user flow stays the same. |
| Already current, including a legacy path | Reuse the exact complete release. A second launch changes no resource bytes or correct settings and creates no duplicate folder. |
| Copy fails or process stops before publication | No partial directory is discoverable as installed. Old releases remain intact. Restart installs successfully. |
| Process stops after publication or registry write fails | Startup does not proceed with incorrect records. Restart reuses the complete directory and repairs the record. Other settings remain intact. |
| Multiple releases in different enumeration orders | New-project defaults select the shipped identity in either order. Existing project reads select their own exact identity. |
| Network unavailable after upgrade | A new Titus project shows source text in Translate, helps in Understand, and Translation Notes/Translation Words in Check without Needs Downloading. |

[PROPOSED] Derive fixture identities from actual bundled manifests, cached old releases or checked-in validated fixtures. The issue's abbreviated observed SHAs are not complete pin identities. Do not manufacture an old release by editing its metadata SHA. Use the existing deliberately missing bundle as the first negative control, then prove that the current launcher fails the real upgrade case before changing it.

[PROPOSED] The installed-app upgrade leg uses an isolated test HOME containing a real older resource, a project pinned to it, and a second older resource with no pin. Never seed or mutate a pilot's real store for an automated upgrade test. Run with the platform network gate disabled and assert that state. Capture old/new tree hashes, installation records, both projects' pins, resolved resource paths, and source/helps reads. An HTTP read alone does not prove the screen labels; retain E2E or installed-app UI evidence for those.

```bash
npm run test:desktop
npm run verify
```

[PROPOSED] Run the affected Playwright journeys separately; `verify` does not run them. The PR's `package-desktop` run must show upgrade-leg assertions and `SMOKE OK` from every `smoke-*` job. Repeat the documented offline run on a Mac with an older store, disabling the OS network. Attach the artifact ID, checksum, commit, OS, logs and screenshots. Source inspection and an empty-HOME smoke result do not close this issue.

## Platform reuse

[VERIFIED — tC4 baseline source read 2026-10-02] Reuse the Pankosmia desktop startup path, the isolated project store, local Burrito discovery and local client-settings storage. The client already uses these surfaces and already supports installed-path indirection. See [the platform architecture](../ARCHITECTURE.md#3-data-layer) and [platform notes on local zip installation](../PLATFORM-NOTES.md).

[VERIFIED — Pankosmia source comparison 2026-10-02] The relevant source files are unchanged between the packaged server pin `0.18.5`, commit `99fd9bea8a9f3d14ac6a61f8e2213f1c5d42ed2a`, and the local reference `0.18.15`, commit `a83725b67593b018f815fdb25a3920ce03e833e7`, dated 2026-09-29. [Summary discovery](https://github.com/pankosmia/pankosmia-web/blob/99fd9bea8a9f3d14ac6a61f8e2213f1c5d42ed2a/src/endpoints/burrito2/summary_metadatas.rs#L16-L110) returns physical third-level repository paths. [Zip sideloading](https://github.com/pankosmia/pankosmia-web/blob/99fd9bea8a9f3d14ac6a61f8e2213f1c5d42ed2a/src/endpoints/burrito2/post_zipped_repo.rs#L58-L137) accepts new sideloaded paths and refuses an occupied target. [Client settings](https://github.com/pankosmia/pankosmia-web/blob/99fd9bea8a9f3d14ac6a61f8e2213f1c5d42ed2a/src/endpoints/clients.rs#L155-L221) store the document at `client_settings/<client-id>.json`. These surfaces support separate release folders; they do not choose tC4 project defaults. The sideload endpoint runs after server startup, so it cannot install the bundle during the pre-server launch step. This comparison does not claim current GitHub HEAD or three-platform runtime verification.

[PROPOSED] Keep the upgrade reconciler in the tC4-owned packaging module. Project pin semantics and new-project defaults belong to tC4; they must not be replaced by a platform-wide latest-resource policy. Use the existing Pankosmia server to serve complete installed releases. Do not add a new downloader or change the pinned USFM/alignment libraries for a filesystem installation fix.
