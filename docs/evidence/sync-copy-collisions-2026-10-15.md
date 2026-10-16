# Sync recovery and copy collision evidence — 2026-10-15

Scope: [#723](https://github.com/unfoldingWord/translationCore4/issues/723) and
[#725](https://github.com/unfoldingWord/translationCore4/issues/725), against
translationCore4 `ba1fd4c` (2026-10-15). These are the 4.0.0 fixes in those issues.
The deferred startup-order, backup-ignore and opening-journey work stays in
#746, #747 and #748.

## Platform replies

[VERIFIED — source read 2026-10-15] The pinned pankosmia-web 0.18.15
(`a83725b67593b018f815fdb25a3920ce03e833e7`, 2026-09-29)
[copy endpoint](https://github.com/pankosmia/pankosmia-web/blob/a83725b67593b018f815fdb25a3920ce03e833e7/src/endpoints/git2/copy_repo.rs#L50-L82)
returns HTTP 400 with `is_good: false` and one of these `reason` values when
its destination exists:

- `Target repo already exists`: the endpoint's directory check, before the copy.
- `could not copy repo: target path exists`: the `copy_dir` dependency's existence
  check, before any destination write.

The dependency is pinned to `copy_dir` 0.1.3 in that revision's `Cargo.lock`.
Its [source](https://docs.rs/copy_dir/0.1.3/src/copy_dir/lib.rs.html#65-72)
returns `target path exists` with `ErrorKind::AlreadyExists` before creating or
copying the destination. The endpoint prefixes that error with `could not copy repo: `.
The classifier in `syncOperation.ts` accepts only these exact HTTP 400 replies.
All other copy failures still use partial-copy cleanup and remain failures.

[VERIFIED — freshness check 2026-10-15] `zsh scripts/upstream-freshness.zsh --report`
found upstream `main` at pankosmia-web 0.19.2 (`bf0a5d3`, 2026-10-07).
`git diff a83725b origin/main -- src/endpoints/git2/copy_repo.rs` was empty.
The pinned endpoint remains the implementation used by this product.

## Reproduction and verification

[VERIFIED — controlled transport tests, 2026-10-15] Before the fixes:

- `vitest run test/sync/syncOperation.test.ts test/sync/openFromDoor43.test.ts -t '#723|#725'`
  reproduced the empty-scope recovery exception (`holds no file; nothing was applied`)
  and deletion of the destination after `could not copy repo: target path exists`.
- The same tests passed for nonempty-scope recovery and for `Target repo already exists`.

After the fixes, that command passed. The full `syncOperation.test.ts` and
`openFromDoor43.test.ts` suites passed, including valid recovery, repeat recovery,
partial-copy cleanup and recovery after cleanup failures.
The marker-only cases first prove that direct empty apply refuses without changing
the live project. Recovery then returns `refused`, deletes the scratch copy, returns
`none` on repetition, permits a real store open, and the next sync clones again.
Both collision replies preserve the destination's files, metadata and fake git state;
the open still refuses `sync.move-failed` and removes its temporary repositories.

These tests inject damaged state and a transport collision. They do not measure a
physical power failure or a naturally observed filesystem race.

[VERIFIED — isolated live rig, 2026-10-15] The rig reported pankosmia-web 0.18.15.
The rig binary was built from the repository's pinned `dev-env/server/Cargo.toml`.
`TC4_RIG_PORT=19273 RIG_API=http://127.0.0.1:19273/api RIG_REPOS=<checkout>/dev-env/state/work/repos
vitest run test/sync/syncRig.integration.test.ts` passed. The new collision check
first tried a missing source and received HTTP 400 `Source repo not found or not a directory`.
Copying an existing project onto itself then received HTTP 400
`Target repo already exists`. A recursive byte comparison included `metadata.json`,
ingredients and `.git`: nothing changed. The suite also ran its full sync and
push-refusal checks. The race reply is verified by pinned source and injected transport,
separately from this live ordinary collision.

[VERIFIED — 2026-10-15] `npm run verify` passed lint, typecheck, Vitest,
desktop tests, the production build and the docs gate. The initial sandboxed run
could not bind localhost listeners for desktop HTTP tests (`EPERM`). The full
rerun with localhost access passed. Its general test lane named an unused port
(19274); the live sync suite above used the isolated rig on 19273.

## Self-review

The change uses the existing ingredient reader, whole-copy verifier, D101 cleanup,
and Pankosmia copy/delete routes. No new recovery protocol or platform dependency.
The empty-apply deletion guard remains. A transient read failure still throws and
keeps the apply marker for retry. Collision replies still refuse; only destination
cleanup changes. Genuine partial copies still follow the existing marker retry path.
No specification or design decision changes.
