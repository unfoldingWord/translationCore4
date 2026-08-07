# Upstream position on roles, x-roles, and relationships — 2026-07-30

**Source:** upstream, relayed by the project owner 2026-07-30. We did not request it. We record it
because it settles the durability question that our Stage-2 rules waited for, and it changes what
tC4 must ask for — namely nothing more.

## What upstream added

- `relationships` and ingredient `role` are in the Pankosmia SB model.
- Confirmed released: `structs.rs` contains `pub role` and `pub relationships`
  [VERIFIED — pankosmia-web 0.18.5 (99fd9be, 2026-07-30)]. At the time of this record the newest
  published crate was 0.18.3, where the round-trip suite still measured `relationships` DROPPED and
  roles DROPPED (5→0), so Stage-2 read 0/2. At 0.18.5 `relationships` survives and `x-` roles do
  not, so the split is 1/2 [VERIFIED — `rig-rebaseline-0.18.5-2026-07-30.md`].

## The durability limit — the part that matters

Ingredient regeneration rebuilds the list **from what is on disk**, and nothing on disk records a
role. Standard roles can be inferred from paths and file types. **`x-` roles cannot**, because the
server has no way to know what a custom role means, or whether it will mean the same thing later.

The consequence: `x-` roles may round-trip through a write, but they disappear as soon as anything
causes the ingredients list to be rebuilt — adding a book, for example.

Restoring existing roles across a rebuild is possible in principle, but it is not planned work.

Relationships: the roadmap item `pankosmia/roadmap#160` ("EPIC - repo-level connections") is where
repo linking becomes a feature. It warns that metadata schemas will change and that files will be
added. It carries no delivery date, so nothing may depend on it.

## What this means for tC4 — no upstream ask, no plan change

1. **Stage rule S-2 becomes a permanent design rule.** The spec had said "paths are authoritative;
   roles are decorative *until PR-1*". The PR-1 modelling landed and `x-` roles are still
   non-durable **by design**, so the "until" clause is removed: **paths are authoritative,
   permanently.** Our layout already uses path conventions (`ingredients/checking/…`), so no
   data-model change follows.
2. **Role re-assertion is tC4's job, not the server's.** After each operation that causes a rebuild
   — above all adding a book — the client writes its own roles again. This is cheap, fully in our
   control, and independent of upstream sequencing.
3. **Do not ask upstream to keep `x-` roles.** The reasoning is sound: the server cannot be
   responsible for semantics that only the client knows. Our earlier draft issue asked for a
   `serde(flatten)` catch-all; the modelling it wanted now exists. We absorb the remaining gap
   rather than escalate it.
4. **Do not wait on #160 for anything.** Resource pins already have a decided mechanism
   (OPEN-QUESTIONS #24: sb-zip export + tag + expected SHA). Track #160 read-only, to adopt *if* it
   lands. Never treat it as a dependency.
5. **Expectation correction for the round-trip suite.** R2/R3 will never report "survived" for `x-`
   roles. Standard roles may survive; ours will not persist across a rebuild. So the Stage-2 pair
   measures a **known and accepted** condition, not a pending upstream fix. The suite text was
   updated accordingly.

Recorded as STATE.md D28. Collaboration-process notes from this exchange are held by the project
owner and are not part of this record.
