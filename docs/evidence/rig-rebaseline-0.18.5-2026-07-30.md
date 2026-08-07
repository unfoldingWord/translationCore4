# Rig re-baseline at pankosmia-web 0.18.5 — 2026-07-30

> **PARTLY SUPERSEDED — 2026-08-04.** One number in this record changed. The inner Stage-1
> count on the server-touched copy is now **30/30**, not 26/26. The count grew with the spec:
> 31 checks (1.5-draft) → 33 (1.6-draft, D17/D30) → 34 (1.7-draft, D36 carry-over). The
> R7 assertion in `validate-roundtrip.mjs` now expects 30 [VERIFIED 2026-08-04 — live rig,
> round-trip 12/12, transport 10/10, at the same pin `99fd9be`]. Every other measurement in
> this record still holds. The record is not edited: it states what was true on 2026-07-30.

**Trigger:** the owner's direction — bump the Increment-1 rig pin to 0.18.5, then approve
INCREMENT-1.

**Pin mechanics.** crates.io stops at `pankosmia_web 0.18.4`, and that crate was published
from commit `5e5b693` — **without** the role/relationships SB modeling (`5fbf1c4`). Verified
from the published crate itself: `.cargo_vcs_info.json` says `"sha1": "5e5b693b…"`, and its
`src/structs.rs` has no `pub role` / `pub relationships`. So the only faithful 0.18.5 is a
**git rev pin**: `dev-env/server/Cargo.toml` now pins
`{ git = "https://github.com/pankosmia/pankosmia-web.git", rev = "99fd9bea8a9f3d14ac6a61f8e2213f1c5d42ed2a" }`
(the 0.18.5 version-bump commit; read-only use — the stall-valve pin pattern, ARCHITECTURE.md).
Return to a crates.io `=` pin when 0.18.5+ is published. Build: `cargo build --release`
finished clean ("Compiling pankosmia_web v0.18.5 (…rev=99fd9bea…)").

**Suite results (executed 2026-07-30, fresh seed, server `pkg_version 0.18.5`):**

```
Transport rig: 10 passed, 0 failed (server http://127.0.0.1:19998/api, pankosmia_web 0.18.5)
Round-trip suite: 12 passed, 0 failed (server http://127.0.0.1:19998/api)
  R7 inner harness on the server-touched copy:
  Stage-1 (path-authoritative): 26 passed, 0 failed
  Stage-2 (role/relationships durability): 1 passed, 1 failed
```

The suites' own pin-expectation constants (`0.18.3`) were updated to 0.18.5 in the same
change set (T1 in `validate-transport.mjs`; header + observation label in
`validate-roundtrip.mjs`). This run also resolves the PLATFORM-NOTES recipe [FLAG] from earlier
today: the inner Stage-1 count on the server-touched copy is re-baselined at **26/26**
(it was 23/23 before the 1.4-draft harness additions).

**Material new observation — `relationships` now SURVIVES regeneration.**

```
R2: metadata after update_ingredients — observed: `relationships` SURVIVED, ingredient `role`s DROPPED (6→0)
R3 observation: relationships survived; roles DROPPED
```

At ≤0.18.3 both were dropped. At 0.18.5 (the `5fbf1c4` modeling):

- `relationships` (top-level) **survives** `update_ingredients` and `remake-ingredients`.
  The §5.3 mirror is now durable in practice. **S-1 is unchanged**: `checking/resources.json`
  stays authoritative — one durable mirror does not reverse authority (D28's reasoning
  stands: authority follows the client-owned file, and durability is re-measured per pin).
- `x-` ingredient roles are **still wiped** (6→0) by any regeneration — the scan rebuilds
  the table from disk, exactly as upstream described. D28 and stage rule S-2 (permanent)
  are unchanged; the client re-asserts roles after each remake (BURRITO-SPEC §6 W-2).
- Consequence for the conformance suite: on a **server-rescanned** copy the expected
  Stage-2 split is now **1/2** (relationships holds, roles fail) instead of 0/2. Against
  the pristine sample it remains 2/2. The R7 assertion (Stage-1 26/26) is unaffected.

**Increment-1 surface at the new pin.** The pin now includes the 0.18.4
`GET/POST /client-settings/<storage_id>` endpoints — available, optional. It also includes
`5e5b693`'s client-settings storage and the `ede5122` translation-plan scope reading. No
endpoint used by Increment 1 changed behavior between 0.18.3 and 0.18.5 (T2–T4/R0–R7 all
green with identical semantics; the only behavioral delta found is the `relationships`
survival above).
