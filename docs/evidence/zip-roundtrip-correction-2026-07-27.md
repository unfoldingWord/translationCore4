# Correction: the zip round-trip works — the 2026-07-22 test used the wrong import endpoint

**Date:** 2026-07-27. **Trigger:** a field report from upstream, relayed by the project owner: a manual
export/import works, and the correct import endpoint is `POST /burrito/zipped/<repo_path>`.
A field report has more weight than our failing probe. Therefore we did the test again
with his conditions.

## What was wrong

The 2026-07-22 test (`evidence/server-roundtrip-2026-07-22.md`) used the export
(`GET /burrito/zipped/<repo>`) with `POST /burrito/remake_burrito_from_zip/`. That is not
the general import endpoint. Per upstream, remake is a support tool for the tC4 prototype. It
remakes the content of an EXISTING burrito from a DCS-style wrapped zip. This makes it
possible to handle Door43 releases as if they were git commits.

The headline claim "zip export and zip import are mutually incompatible (0.17.0)" compared
the export with the wrong importer. That claim is **withdrawn**. The AI took its hints from
the code paths of the tC4 prototype, not from the general platform surface. This is the same
failure class as the earlier merge-endpoint over-proposal.

## Verification 1 [VERIFIED] — source read (mirror `pankosmia-web@68e480d`)

- `src/endpoints/burrito2/post_zipped_repo.rs`: `POST /burrito/zipped/<repo_path>`
  (multipart form, field `file`) writes a NEW repo from a zip. It calls
  `unpack_zip_file(..., None)`, which strips no prefix. It needs `metadata.json` at the
  zip root and an `ingredients/` directory. This is exactly the shape of the export.
- Limits in the source: the target path must start with `_local_/_sideloaded_/`. A target
  that already exists returns 400. A zip without a root `metadata.json` and an
  `ingredients/` directory returns 400 ("Zip does not look like a burrito").
- `remake_burrito_from_zip.rs` calls `unpack_zip_file(..., Some(1))`, which strips one
  directory level. The two endpoints need different zip shapes by design.

## Verification 2 [VERIFIED] — live round-trip (dev-env rig, `pankosmia_web 0.17.0`)

1. `GET /api/burrito/zipped/_local_/_local_/sample_burrito` → 200, 35,211 bytes.
2. `POST /api/burrito/zipped/_local_/_sideloaded_/rt_correct` with the unmodified export
   → **200** `{"is_good":true}`.
3. Byte comparison: all 10 files outside `.git` in the imported repo are byte-identical to
   the contents of the export. The only `diff -r` entries are empty `.git` housekeeping
   directories (`objects/info`, `objects/pack`, `refs/tags`). A zip does not carry empty
   directories.
4. Controls (all behave as the source predicts):
   - Re-POST to the same path → 400 "Repo already exists".
   - POST to `_local_/_local_/...` → 400 "Second repo path component must be '_sideloaded_'".
   - POST of a non-burrito zip → 400 "Zip does not look like a burrito".

## What still holds from 2026-07-22

- `remake_burrito_from_zip` returns 500 on an unwrapped zip and needs a target that already
  exists. This is true. But it describes the contract of remake itself, and it is not a
  platform defect.
- The export includes `.git` and `.DS_Store`. This is still true.

## Finding 2 re-checked with the same lens — it stands

We examined the other 2026-07-22 finding (regeneration drops `role` + `relationships`) again
for the same failure class. That failure class is a prototype endpoint mistaken for platform
surface. The finding is not affected. Its endpoints (`post_raw_ingredient.rs` with
`update_ingredients`, `post_remake_ingredients_metadata.rs`) are general burrito2 surface.

The mechanism is verified again at mirror `68e480d`: `structs.rs` has zero matches for
`role`, `relationships`, or `serde(flatten)`. The write path still replaces the whole
ingredients map (`post_raw_ingredient.rs:115`). A sweep of the sibling endpoints in
`src/endpoints/burrito2/` found no other metadata-write path that keeps the fields. Draft
issue 2 (upstream Change 1) stays valid. The correction adds one detail: the zip round-trip
itself keeps both fields, because it is a byte-level unpack and does not pass through
`structs.rs`. The loss occurs only when the server REWRITES `metadata.json` by regeneration.

## Consequences

- PLATFORM-NOTES #22 is rewritten. The import goes to `_local_/_sideloaded_/`. To replace a local
  copy, delete it first or give it a new identity. This is per upstream guidance.
- The draft upstream issue "remake cannot import the output of GET /burrito/zipped/" is
  **withdrawn** — do not send it.
- tC3 zip round-trips through these endpoints were never on the upstream roadmap
  (upstream, 2026-07-27). The tC3 importer (ARCHITECTURE §8, BACKLOG I3.3.1) stays our own
  transformation code, and this correction does not affect it.
