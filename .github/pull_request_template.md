<!-- Keep the sections. Delete the placeholder text. -->

## What this changes

One or two sentences. Name the issue this closes: `Closes #NN`.

## Evidence

Run `npm run verify` and paste the output summary below. "Done" means the acceptance
criteria of the linked issue pass, with this evidence. "Should work" is not evidence.

```text
(paste the verify output here — at minimum the test totals and the build result)
```

- [ ] `npm run verify` passes locally (output pasted above)
- [ ] The linked issue's acceptance criteria pass
- [ ] If this touches `docs/BURRITO-SPEC.md`: the conformance harness changes in this same PR
- [ ] Pinned versions unchanged: `usfm-js@3.4.3`, `word-aligner@1.0.3`, `word-aligner-lib@1.0.1`

## Rig-backed checks (only if labelled `needs-rig`)

CI cannot run the Pankosmia rig. Paste the rig-backed suite results here, or state that a
maintainer must run them before merge.
