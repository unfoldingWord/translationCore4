# Choose the app language from the account menu

Published replacement for [issue #522](https://github.com/unfoldingWord/translationCore4/issues/522),
2026-10-02. The owner confirmed the behavior, including the pending-write guard,
in the interview. The published issue body was read back and verified.

## User need and scope

[decided 2026-10-02 — owner interview] A user can choose English, Latin American
Spanish, French, or Hindi for the app's menus and dialogs. Each language is
installed locally with the app. This is Increment 9 work.

Add **App language** to the account menu implemented by
[#514](https://github.com/unfoldingWord/translationCore4/issues/514), wherever that
menu already renders. **This issue adds no account-menu locations, separate
language menu, toolbar control, or sign-in requirement.** #514 remains the
prerequisite; integrate with its completed menu and settings flow.

## Owner choices

[decided 2026-10-02 — owner interview]

| Language | Catalog ID | Picker label |
| --- | --- | --- |
| English | `en` | English |
| Spanish, Latin America | `es-419` | Español (Latinoamérica) |
| French | `fr` | Français |
| Hindi | `hi` | हिन्दी |

- The menu item and dialog title are **App language**.
- Supporting text is **Choose the language for menus and dialogs.**
- Use one native select and **Apply** / **Cancel** buttons. Preselect the applied language.
- Selecting a language previews it across the whole app, including the dialog.
- Apply saves the choice on this computer and closes the dialog after success.
- Cancel, Escape, the close button, and scrim dismissal restore the previously
  applied language without saving the preview.
- A save failure keeps the preview visible and the dialog open. Show an error;
  allow retry or Cancel. Do not report success.
- Start in English when no valid saved choice can be read. Remember a successful
  applied choice across restart. Automatic system-language selection is later work.
- Generated translations may ship. Human approval is not a release prerequisite.
- Translate every source catalog entry. Natural count-neutral target wording is
  allowed, for example the target-language equivalent of **Number of books: {n}**.
  Do not add a plural engine for this issue.

## Preview and persistence contract

[PROPOSED — implementation model for the settled behavior]
Keep the displayed preview separate from the last successfully applied choice.
The following table describes observable results, not a required class design.

| Event | Displayed language | Saved preference |
| --- | --- | --- |
| Startup | Valid saved language, otherwise English | No write |
| Open picker | Previously applied language | No write |
| Select another language | Selected language, throughout the app | No write |
| Cancel / Escape / close / scrim | Previously applied language | No write |
| Apply succeeds | Selected language; dialog closes | Selected language |
| Apply fails | Selected preview; dialog remains with error | No successful new preference |
| Retry succeeds | Selected language; dialog closes | Selected language |
| Restart during an unapplied preview | Previously saved language | No preview persisted |

Use a translated save-failure message such as **The app language could not be
saved. Try again.** Render it in the current preview language. Include the new
picker and error strings in all four catalogs.

[decided 2026-10-02 — owner interview, Q9] Capture the selected locale when Apply starts.
While that write is pending, disable selection, repeated Apply, and dismissal.
Re-enable retry and cancellation if it fails. This avoids a write finishing after
Cancel has restored another language. Apply with an unchanged choice is disabled.

[decided 2026-10-02 — owner interview] Preview, rollback, and Apply must preserve
the open project and ongoing edits. Do not reload the page, restart the app,
navigate away, or remount the editor by changing a locale-based React key.
Return focus to the existing account-menu trigger when the dialog closes.

## Catalogs and future Weblate corrections

[decided 2026-10-02 — owner interview] Keep `src/i18n/en.json` as the authoritative
English catalog and source of keys. Add complete `es-419.json`, `fr.json`, and
`hi.json` catalogs beside it. Keep flat JSON with literal dotted IDs and the
existing `{name}` interpolation convention. Do not transfer tC3's locale files
with different keys; its Spanish is `es_ES`, not the Latin American target.

Generate and commit the translations during development. The installed app and
ordinary builds must not call a model or translation service. A generation
backend or automated translation pipeline is not required in this issue; report
how the initial catalogs were produced in the implementation PR.

Validate the implemented build's complete English key set, not a fixed count:
all target catalogs must provide string values, no empty translations, and the
same placeholder names and multiplicities as their English source. Preserve any
renderer-significant markup, URLs, and tokens. Shared product names and identifiers
may legitimately match English; do not fill untranslated sentences with English
and claim completeness. Include newly added strings from #514 and this picker.

Keep runtime English fallback even though the shipped catalogs must be complete.
If a target entry is missing or unusable, use English. If English also lacks the
key, preserve the existing explicit fallback and missing-key diagnostic behavior.

[VERIFIED — official Weblate documentation read 2026-10-02]
Weblate supports [ordinary JSON catalogs](https://docs.weblate.org/en/latest/formats/json.html)
with an English base file. Its ordinary `json` format preserves flat keys; the
`json-nested` format interprets newly added dotted keys as nested paths.
[decided 2026-10-02 — owner interview] Preserve the ordinary flat format and stable
IDs for later Weblate edits. Store locale metadata or generation notes separately
from translatable values. Do not create a custom catalog wrapper or plural format.

Later Weblate corrections will edit these same version-controlled catalogs and
return as pull requests. A build ships merged corrections locally. Preserve
reviewed edits; do not overwrite them by regenerating whole target catalogs.
Weblate setup, correction UI, and integration are outside this issue.

Install all four catalogs with the app. ZIP compression belongs to packaging;
the picker has no download or archive-import workflow. Report installed and ZIP
catalog bytes in the PR; there is no new hard size limit or compression framework.

## Implementation starting points and platform reuse

[VERIFIED — tC4 4.0.0-rc.1,
`e50e70147bb06e3991f5981a16c971888a6b2872`, source read 2026-10-02]
These links pin the inspected baseline. Recheck against the branch containing
#514, because its menu and preference bootstrap are not in this baseline.

| Starting point | What to reuse or watch |
| --- | --- |
| [Translation resolver](https://github.com/unfoldingWord/translationCore4/blob/e50e70147bb06e3991f5981a16c971888a6b2872/src/i18n/index.js#L5) | Only English is imported. `setLocale()` changes a module variable without notifying React. Add a small reactive locale subscription or equivalent state path so both preview and rollback refresh visible strings. Retain `t(key, vars, fallback)` for non-React callers. |
| [Single settings writer](https://github.com/unfoldingWord/translationCore4/blob/e50e70147bb06e3991f5981a16c971888a6b2872/src/state.jsx#L94) and [serialization](https://github.com/unfoldingWord/translationCore4/blob/e50e70147bb06e3991f5981a16c971888a6b2872/src/data/journal/opsLog.ts#L38) | Reuse the existing serialized read–modify–write. Add `appLocale` while preserving the rest of the latest document. Do not create an independent writer. |
| [Convenience settings helper](https://github.com/unfoldingWord/translationCore4/blob/e50e70147bb06e3991f5981a16c971888a6b2872/src/state.jsx#L3088) | `updateClientSettings()` swallows failures. Its successful resolution does not prove persistence. Apply must observe the existing writer's actual success or failure. |
| [Local client-settings methods](https://github.com/unfoldingWord/translationCore4/blob/e50e70147bb06e3991f5981a16c971888a6b2872/src/data/serverApi.ts#L603) | `getClientSettings` and `setClientSettings` already provide per-client, per-computer storage. Use these behind the existing writer, not project files, credentials, or a new storage location. |
| [Startup settings effect](https://github.com/unfoldingWord/translationCore4/blob/e50e70147bb06e3991f5981a16c971888a6b2872/src/state.jsx#L3005) | No locale bootstrap exists. Integrate with #514's completed preference loading. A delayed initial read must not overwrite a newer selection. |
| [App and global dialogs](https://github.com/unfoldingWord/translationCore4/blob/e50e70147bb06e3991f5981a16c971888a6b2872/src/App.jsx#L117) | Preserve the existing view/project identity. Add the dialog through the app's existing pattern. Add the entry to #514's actual menu rather than invent its placement from this older source. |
| [Modal](https://github.com/unfoldingWord/translationCore4/blob/e50e70147bb06e3991f5981a16c971888a6b2872/src/ds/components/surfaces/Modal.jsx#L21) and [Select](https://github.com/unfoldingWord/translationCore4/blob/e50e70147bb06e3991f5981a16c971888a6b2872/src/ds/components/forms/Select.jsx#L14) | Reuse tC4's controls. Modal routes close, Escape, and scrim dismissal through `onClose`; use one rollback path. Pass translated `closeLabel`, labels, and buttons. |

[PROPOSED — implementation guidance] Audit existing translation consumers. A
locale assignment or root rerender alone does not prove that cached labels or
memoized children refresh. Recompute displayed labels from the active locale;
avoid saving translated labels in long-lived state where practical. Use one
source of truth for the active preview, rather than unrelated resolver/reducer
values that can diverge. A four-entry local registry is enough; language search,
remote discovery, and a new localization library are not required.

Keep platform storage behind tC4's own interface and tC4's design controls, as
required by the [existing platform adoption decisions](https://github.com/unfoldingWord/translationCore4/blob/main/docs/DECISIONS.md).
Do not adopt platform visual controls or settle the separate provider-integration
issue [#222](https://github.com/unfoldingWord/translationCore4/issues/222).

## Acceptance criteria

- [ ] The account menu supplied by #514 includes **App language** wherever that
      menu already exists. This issue adds no menu locations or separate controls.
- [ ] The picker offers exactly the four installed catalogs listed above, with
      native names and the current applied choice selected.
- [ ] Selecting each non-English locale visibly translates an existing interface
      label before Apply. The dialog's own labels also follow the preview.
- [ ] Apply saves the selected language and closes only after successful
      persistence. A fresh app session uses that choice. First launch and an
      unreadable, invalid, or unsupported saved locale use English.
- [ ] Cancel, Escape, close, and scrim dismissal each restore the prior applied
      language and leave persisted settings unchanged. Restart during an unapplied
      preview uses the saved choice, not the preview.
- [ ] A failed Apply shows an error with preview retained and dialog open. Retry
      can succeed; Cancel can restore the prior applied language. No false success.
- [ ] While Apply is saving, selection, repeated Apply, and every dismissal path
      are disabled. After failure, retry and cancellation are available again.
- [ ] Every target catalog covers the implemented English source keys, has
      nonempty strings, and preserves placeholders and renderer tokens. English
      per-key fallback works when a target entry is deliberately absent in a test.
- [ ] Startup, menu opening, preview, cancellation, and Apply work without external
      requests or runtime translation calls. Local settings requests are allowed.
- [ ] Switching does not reset an in-progress verse or note edit, change the open
      project or text selection, write project-language settings, change Scripture
      direction or resource pins, or change #514's internet-confirmation preference.
- [ ] Keyboard selection, focus trapping, and focus return to the account trigger
      work. Labels fit and Hindi renders legibly in the installed app.
- [ ] The packaged app includes all catalogs. The PR records their installed and
      compressed sizes, the generation method, and executable verification evidence.

## Verify and evidence to attach

[PROPOSED] Follow the repository's
[agent testing instructions](https://github.com/unfoldingWord/translationCore4/blob/main/AGENTS.md):
write the E2E journeys before implementation. Use the existing
[rig setup](https://github.com/unfoldingWord/translationCore4/blob/main/dev-env/README.md#journeys-from-a-clean-clone).

Use the [shared journey fixture](https://github.com/unfoldingWord/translationCore4/blob/e50e70147bb06e3991f5981a16c971888a6b2872/e2e/helpers/test.ts#L1),
which drains pending rig writes and captures settings evidence. The
[settings helpers](https://github.com/unfoldingWord/translationCore4/blob/e50e70147bb06e3991f5981a16c971888a6b2872/e2e/helpers/rig.ts#L367)
provide `resetClientSettings()` and `readClientSettingsDoc()`. Read test locale
IDs and expected strings from the shipped registry/catalogs. Restore settings
and request interception after each failure test.

Tag the new journeys `@app-language`. Cover:

| Journey | Proof |
| --- | --- |
| Default and four-language preview | Each target changes a known catalog-backed label before Apply; capture the dialog and surrounding app. |
| Apply and restart | Assert `appLocale` in the settings artifact; start a fresh session and assert selected locale and translated label. |
| Each cancellation path and unapplied restart | Assert both rendered rollback and unchanged settings. Exercise a previously applied non-English language, not only English. |
| Failed Apply, retry, failed Apply then Cancel | Fail only the local settings write after startup; assert error, retained preview, unchanged applied choice, then each recovery path. |
| Existing edits and independent preferences | Preview/apply/cancel with a real in-progress edit; verify its text and selection survive and compare unrelated settings before/after. |
| Offline and keyboard use | Record browser requests and websocket attempts, exercise selection and dismissal by keyboard, and assert focus returns. |
| Catalog validation and fallback | Check current English key coverage and placeholders; deliberately omit an existing target key in a controlled test build, then assert its English fallback. |

Reuse [the existing browser request-recording pattern](https://github.com/unfoldingWord/translationCore4/blob/e50e70147bb06e3991f5981a16c971888a6b2872/e2e/internet-local.spec.ts#L124).
Browser logs do not observe platform-mediated outbound requests. Demonstrate that
this path loads only installed catalogs and uses local settings methods; retain
#514's platform protections. No new outbound-auditing framework is required.

Produce repeatable screenshots, request logs, and before/after client settings
artifacts with secrets excluded. Exercise the account menu at the locations
provided by #514. Verify the packaged app with external access unavailable, not
only Vite; catalogs must be installed rather than fetched from a previous cache.

```bash
npm run journeys -- --grep '@app-language|@internet-consent'
npm run verify
```

`npm run verify` does not run the Playwright journeys. Run any other journey
affected by changes to shared translation or settings behavior. Record commands,
results, artifact paths, and any verification that could not be run in the PR.

## Prior art and exclusions

[VERIFIED — source audit 2026-10-02] tC3's
[locale action](https://github.com/unfoldingWord/translationCore/blob/5729aa7b977ef85356139f73d957ee65a276460b/src/js/actions/LocaleActions.js#L83)
persists an app-wide language choice and loads local JSON. Joplin's
[translation build](https://github.com/laurent22/joplin/blob/b1c43ccce993370bb9a2dcf47014681c64ff9796/packages/tools/build-translation.ts#L194)
generates a static local catalog index. Element's
[language picker](https://github.com/element-hq/element-web/blob/775faae9f0309e9f070bf4f52ba511558b3050b3/apps/web/src/components/views/elements/LanguageDropdown.tsx#L22)
uses native language names. These source reads guide the local catalog and picker
shape; they are not runtime proofs of this implementation.

[decided 2026-10-02 — owner interview] Do not add automatic system-language
selection, Weblate correction functionality, Crowdin, downloadable language packs,
a plural engine, translated help documents, Scripture/resource translations,
general date/number/list formatting, or RTL app-frame mirroring. Import, project
settings, and internet consent change only in their translated display strings.
The four UI catalogs do not control the language or direction of project text.

Automatic selection is tracked separately in
[#525](https://github.com/unfoldingWord/translationCore4/issues/525). The broader support-policy
question [#167](https://github.com/unfoldingWord/translationCore4/issues/167) and
unused-key question [#37](https://github.com/unfoldingWord/translationCore4/issues/37)
remain separate. No Scripture Burrito format change is required.
