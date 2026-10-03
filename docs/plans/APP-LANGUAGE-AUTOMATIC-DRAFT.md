# Choose an installed app language automatically on first launch

Published as [issue #525](https://github.com/unfoldingWord/translationCore4/issues/525),
the owner-requested follow-up to
[issue #522](https://github.com/unfoldingWord/translationCore4/issues/522).
Created 2026-10-02. No release milestone is assigned.

## User need

[decided 2026-10-02 — owner interview] Automatic language selection is later work.
#522 installs four local catalogs and remembers the user's explicitly applied
choice; it starts in English when no valid saved preference exists.

[PROPOSED] On a first launch with no explicit saved choice, use the computer's
language preferences to choose an appropriate installed UI catalog. Never replace
an explicit saved choice. Use English if no installed catalog matches. Selection
must work locally without downloading catalogs or contacting a translation service.

## Define before implementation

[PROPOSED] Specify exact language, region, and script matching, including which
Spanish system locales may resolve to Latin American Spanish. Decide whether
automatic selection happens once or remains a distinct Automatic preference that
tracks later system changes. Do not silently store a detected locale as an
explicit user choice. These decisions belong to this follow-up, not #522.

## Acceptance criteria

- [ ] A defined system-language matching policy selects only installed catalogs.
- [ ] Explicit user choices from #522 continue to win across restart.
- [ ] Unsupported system preferences fall back to English.
- [ ] Automatic selection causes no external requests and does not change project
      language, Scripture direction, resources, or internet-consent settings.
- [ ] E2E evidence covers a supported preference, an unsupported preference,
      regional/script matching, and an existing explicit choice.

## Platform reuse and verify

[PROPOSED] Reuse #522's registry, locale activation, and client-settings storage.
Before implementation, inspect the desktop shell's existing OS-language access
and document the chosen surface at an exact revision; a new platform capability
has not been verified for this draft.

Use the repository's existing E2E rig and attach repeatable artifacts. Run the
new journeys and `npm run verify`. Complete the matching policy and platform
reuse section before marking this follow-up Ready.
