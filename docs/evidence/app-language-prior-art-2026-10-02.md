# App language prior art for issue 522

Observed on 2026-10-02. This is source-read evidence, not a runtime usability or
offline test. Recommendations are marked `[PROPOSED]`. The design is in
[`../plans/APP-LANGUAGE-522.md`](../plans/APP-LANGUAGE-522.md).

## Reproducible source snapshots

| Application | Snapshot read | Commit date | Version scope |
| --- | --- | --- | --- |
| tC3 | `c16e207818a2b4869a06ab14fde9249484256361` | 2026-01-08 | Both `v3.7.0` and `v3.7.0-lite` tags; released 2026-01-12 |
| tC3 development | `5729aa7b977ef85356139f73d957ee65a276460b` | 2026-07-16 | `develop`; not a shipped release |
| Joplin | `b1c43ccce993370bb9a2dcf47014681c64ff9796` | 2026-10-01 | Development source snapshot; no claim about an installed release |
| Zotero | `ae50d5258992b49d4eeac274e10996039b0bd909` | 2026-10-01 | Main source snapshot; no claim about an installed release |
| Element Web | `775faae9f0309e9f070bf4f52ba511558b3050b3` | 2026-10-02 | Development source snapshot; no claim about an installed release |

[VERIFIED — GitHub commit and release API, source read, 2026-10-02]
These hashes pin the findings below. The tC3 tags contain identical shell locale
trees. The [release record](https://github.com/unfoldingWord/translationCore/releases/tag/v3.7.0)
and [LITE release record](https://github.com/unfoldingWord/translationCore/releases/tag/v3.7.0-lite)
separate the shipped source from later development. Installer payloads were not
downloaded or inspected.

## tC3: application language is separate from checking content

[VERIFIED — tC3 development snapshot above, source read, 2026-10-02]
The Actions menu opens a locale dialog with a translate icon. The dialog has Save
and explains that this changes menus, dialogs and project setup. It separately
directs users to choose a Gateway Language for checks and helps. Saving dispatches
the locale change and persists `appLocale`; this path has no restart operation.
This verifies the code path, not all visible components reacting correctly.
Sources: [AppMenu](https://github.com/unfoldingWord/translationCore/blob/5729aa7b977ef85356139f73d957ee65a276460b/src/js/containers/AppMenu.js#L108),
[dialog](https://github.com/unfoldingWord/translationCore/blob/5729aa7b977ef85356139f73d957ee65a276460b/src/js/containers/LocaleSettingsDialogContainer.js#L46),
[English explanation](https://github.com/unfoldingWord/translationCore/blob/5729aa7b977ef85356139f73d957ee65a276460b/src/locale/English-en_US.json),
[setLanguage](https://github.com/unfoldingWord/translationCore/blob/5729aa7b977ef85356139f73d957ee65a276460b/src/js/actions/LocaleActions.js#L83).

[VERIFIED — same snapshot and method]
LocaleActions reads local JSON files. It initializes English (`en_US`) as the
default, takes the saved language when valid, otherwise attempts the OS locale,
and recognizes short language aliases. Region fallback can select another
catalog with the same language prefix. These aliases are based on enumeration
order; this is not evidence of a deliberate script-aware negotiation policy.
The action also changes Moment's locale. Sources:
[loadLocalization and fallback](https://github.com/unfoldingWord/translationCore/blob/5729aa7b977ef85356139f73d957ee65a276460b/src/js/actions/LocaleActions.js#L113),
[setActiveLanguageSafely](https://github.com/unfoldingWord/translationCore/blob/5729aa7b977ef85356139f73d957ee65a276460b/src/js/actions/LocaleActions.js#L242).

[VERIFIED — tC3 v3.7.0 source, source read, 2026-10-02]
The gulp Crowdin task uploads English. It does not download replacement catalogs.
No catalog download was found in the inspected build task. Therefore this audit
does not assume a hidden build-time service supplies more complete translations.
Source: [gulpfile](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/gulpfile.js#L44).
This records historical behavior; a translation service is not proposed for 522.

[PROPOSED] Preserve the distinction in tC4 with an explicit **App language** label
and a short explanation that project text and checking resources keep their own
languages. Do not reuse the project's target language as the UI preference.

## Joplin: generated offline catalogs and direct contributions

[VERIFIED — Joplin snapshot above, source read, 2026-10-02]
Joplin's locale layer loads a static module index. Its build script converts PO
catalogs to JSON and generates an index with literal local `require` calls. This
is an offline-friendly runtime structure. Unsupported locales match an exact
tag first, then the same language, then English. Missing/empty entries return the
source string. The picker labels prefer native names; regional labels distinguish
Chinese scripts and national variants. Sources:
[runtime locale functions](https://github.com/laurent22/joplin/blob/b1c43ccce993370bb9a2dcf47014681c64ff9796/packages/lib/locale.ts#L511),
[generated index builder](https://github.com/laurent22/joplin/blob/b1c43ccce993370bb9a2dcf47014681c64ff9796/packages/tools/build-translation.ts#L194).

[VERIFIED — same snapshot and method]
The `locale` setting is public, stores to a file, and is global across profiles.
Options can show catalog progress percentages. This source read does not establish
whether a desktop language change requires restart. Source:
[settings metadata](https://github.com/laurent22/joplin/blob/b1c43ccce993370bb9a2dcf47014681c64ff9796/packages/lib/models/settings/builtInMetadata.ts).

[VERIFIED — official documentation read 2026-10-02; unversioned]
Joplin's application translation instructions describe a direct contribution
workflow: edit a POT/PO with Poedit, choose language and country, then submit a
pull request. Application catalogs apply across desktop, mobile and terminal.
Source: [Joplin localisation](https://joplinapp.org/help/dev/localisation/).
The separate documentation translation workflow is not an application dependency.

[PROPOSED] Borrow the generated static index and catalog validation workflow, with
one reviewed source catalog per locale and checked generated outputs. Document
how to add a language by pull request. Partial catalogs should use English
fallback; file presence alone must not imply a language is complete.

## Zotero: explicit automatic mode, independent content locale, and restart

[VERIFIED — Zotero snapshot above, source read, 2026-10-02]
Zotero builds a General settings language menu from available locales. It offers
an explicit Automatic option, showing the currently resolved language when
matching the OS. Manual selection changes the requested locale preference.
A changed selection prompts for Restart now or Restart later. The handler also
sets a bidi UI preference for an RTL app locale. Source:
[refreshLocale/onLocaleChange](https://github.com/zotero/zotero/blob/ae50d5258992b49d4eeac274e10996039b0bd909/chrome/content/zotero/preferences/preferences_general.js#L61).

[VERIFIED — first-party documentation read 2026-10-02; unversioned]
Zotero documents independent language controls for its UI and for generated
citations/bibliographies. That domain boundary is comparable to UI language
versus Scripture/resource language. Source:
[language support](https://www.zotero.org/support/supported_languages).
Its navigation instructions mention Advanced, whereas the pinned current code
places the UI handler in General. Use the source for current placement.
No Zotero installer, fallback implementation or contributor build was tested.

[PROPOSED] Make automatic detection a distinct preference if tC4 offers it; do not
store its current resolution as if the user explicitly chose that language.
Only require reload/restart when the selected platform integration needs it.
Catalog loading by itself is not a reason to discard the current checking view.

## Element Web: searchable autonyms and device-local preference

[VERIFIED — Element Web snapshot above, source read, 2026-10-02]
The language dropdown sorts native names. Search matches the native label, the
current-language label, and exact locale code. Labels are produced with
`Intl.DisplayNames`. Its loading-error path offers English. Sources:
[LanguageDropdown](https://github.com/element-hq/element-web/blob/775faae9f0309e9f070bf4f52ba511558b3050b3/apps/web/src/components/views/elements/LanguageDropdown.tsx#L22),
[label construction](https://github.com/element-hq/element-web/blob/775faae9f0309e9f070bf4f52ba511558b3050b3/apps/web/src/i18n/utils.ts#L20).

[VERIFIED — same snapshot and method]
Element resolves an explicit saved preference before browser detection. Setting
a language registers its translations, changes the active locale, writes a
DEVICE setting, and installs English fallback. Catalog JSON is fetched from the
app's `i18n/` path with retries. This is useful picker and persistence prior art,
but not proof that any locale switch works offline before caching. Sources:
[settings](https://github.com/element-hq/element-web/blob/775faae9f0309e9f070bf4f52ba511558b3050b3/apps/web/src/i18n/settings.ts#L18),
[catalog fetch](https://github.com/element-hq/element-web/blob/775faae9f0309e9f070bf4f52ba511558b3050b3/apps/web/src/i18n/languages.ts#L27).
Caller reload behavior and full RTL layout support were not established here.

[PROPOSED] For a large language list, search both native and familiar names and
locale codes. Render each language label with its own `lang` and direction;
keep the locale code visually isolated. Use a stable English recovery option.
For tC4's offline requirement, statically include catalogs instead of inheriting
Element's fetch-on-demand path.

## Boundaries and design implications

[PROPOSED] Treat RTL as a layout and mixed-text requirement. Do not infer RTL UI
support from an Arabic catalog file. Use explicit locale metadata, logical CSS,
and bidi isolation for resource titles and codes. Keep Scripture text direction
independent from the surrounding application chrome.

[PROPOSED] Validate placeholders, plural forms and missing keys during catalog
generation. Include review metadata and coverage reports in contributor tooling.
Do not equate key coverage with translation quality or last file edit with the
last actual translation contribution. The tC3 audit below demonstrates why.

[VERIFIED — method limitation, 2026-10-02]
No application was installed or run for this note. It establishes implementation
patterns and documented workflows. It does not establish screen-reader behavior,
full layout mirroring, OS packaging behavior, or translator-reviewed quality.

## tC3 catalog coverage and meaningful history

[VERIFIED — source files and git history read at the pinned tC3 snapshots,
2026-10-02; audit executed with Python 3]
The latest published source release contains 24 non-English catalog files, plus
English. Odia and Oriya both use `or_IN`, so file count is not unique locale
count. The English reference contains **541 string leaves**, excluding `_`
metadata. English itself is the reference and is not ranked against itself.

This covers only `src/locale/*.json`: application shell menus, dialogs and
project setup. It does **not** measure the separately delivered translationNotes,
translationWords or wordAlignment tool catalogs, Gateway Language resources or
translated checking content. No overall tC3-language quality ranking follows
from these shell numbers. No installer payload or tool catalog pin was audited.

### Release-tag shell catalogs, v3.7.0 and v3.7.0-lite

`Different` means a nonempty string differs exactly from English at the same
key; `Same` means it equals English. Percent uses all 541 English keys. Neither
column judges linguistic correctness: names, abbreviations and borrowed words
can legitimately stay the same; punctuation or stale English can differ.
All audited catalogs have zero extra keys and zero blank strings. A missing key
is distinct from a blank or English-filled key.

| Catalog | Present / 541 | Different | Same | Different % | Missing | Latest substantive change in release history |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| [Ukrainian-uk_UA](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Ukrainian-uk_UA.json) | 536 | 536 | 0 | 99.1% | 5 | 2024-12-18 |
| [Russian-ru_RU](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Russian-ru_RU.json) | 536 | 534 | 2 | 98.7% | 5 | 2024-12-18 |
| [Portuguese, Brazilian-pt_BR](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Portuguese%2C%20Brazilian-pt_BR.json) | 536 | 525 | 11 | 97.0% | 5 | 2024-12-18 |
| [Spanish-es_ES](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Spanish-es_ES.json) | 536 | 522 | 14 | 96.5% | 5 | 2024-12-18 |
| [Indonesian-id_ID](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Indonesian-id_ID.json) | 536 | 511 | 25 | 94.5% | 5 | 2024-12-11 |
| [Bengali, India-bn_IN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Bengali%2C%20India-bn_IN.json) | 536 | 495 | 41 | 91.5% | 5 | 2022-02-15 |
| [Hindi-hi_IN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Hindi-hi_IN.json) | 536 | 495 | 41 | 91.5% | 5 | 2022-02-15 |
| [Gujarati-gu_IN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Gujarati-gu_IN.json) | 536 | 492 | 44 | 90.9% | 5 | 2022-02-15 |
| [Kannada-kn_IN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Kannada-kn_IN.json) | 536 | 492 | 44 | 90.9% | 5 | 2022-02-15 |
| [Marathi-mr_IN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Marathi-mr_IN.json) | 536 | 492 | 44 | 90.9% | 5 | 2022-02-15 |
| [Odia-or_IN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Odia-or_IN.json) | 536 | 492 | 44 | 90.9% | 5 | 2022-02-15 |
| [Oriya-or_IN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Oriya-or_IN.json) | 502 | 492 | 10 | 90.9% | 39 | 2019-09-25 |
| [Punjabi-pa_IN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Punjabi-pa_IN.json) | 536 | 492 | 44 | 90.9% | 5 | 2022-02-15 |
| [French-fr_FR](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/French-fr_FR.json) | 536 | 491 | 45 | 90.8% | 5 | 2024-12-18 |
| [Tamil-ta_IN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Tamil-ta_IN.json) | 536 | 491 | 45 | 90.8% | 5 | 2022-02-15 |
| [Malayalam-ml_IN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Malayalam-ml_IN.json) | 536 | 490 | 46 | 90.6% | 5 | 2022-02-15 |
| [Telugu-te_IN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Telugu-te_IN.json) | 536 | 482 | 54 | 89.1% | 5 | 2022-02-15 |
| [Naga Pidgin-nag_IN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Naga%20Pidgin-nag_IN.json) | 536 | 406 | 130 | 75.0% | 5 | 2022-02-15 |
| [Urdu-Devanagari-ur_deva_IN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Urdu-Devanagari-ur_deva_IN.json) | 536 | 11 | 525 | 2.0% | 5 | 2020-11-06 |
| [Persian-fa_IR](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Persian-fa_IR.json) | 536 | 5 | 531 | 0.9% | 5 | 2021-12-15 |
| [Assamese-as_IN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Assamese-as_IN.json) | 536 | 2 | 534 | 0.4% | 5 | 2019-12-02 |
| [Arabic-ar_SA](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Arabic-ar_SA.json) | 536 | 0 | 536 | 0.0% | 5 | 2018-01-24 (historical; none retained) |
| [Nepali-ne_NP](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Nepali-ne_NP.json) | 536 | 0 | 536 | 0.0% | 5 | 2019-08-09 (historical; none retained) |
| [Vietnamese-vi_VN](https://github.com/unfoldingWord/translationCore/blob/c16e207818a2b4869a06ab14fde9249484256361/src/locale/Vietnamese-vi_VN.json) | 536 | 0 | 536 | 0.0% | 5 | 2018-01-24 (historical; none retained) |

[VERIFIED — same audit]
By this proxy, **Ukrainian and Russian** lead. **Brazilian Portuguese and Spanish**
follow; **Indonesian** is next. These are the best source candidates to inspect
for reuse, subject to translator review. French has relatively recent work but
lower coverage. There is no one-dimensional winner for “most up to date”.

The standard non-English files have 536/541 keys (99.1% structural coverage).
Oriya has 502/541 (92.8%). The five missing keys in the standard catalogs all
belong to the newer project-export flow: `projects.export`, `export_project`,
`confirm_export`, `export_complete` and `export_failed`. Therefore even Ukrainian
is not complete against the latest English release source. “Recently edited”
and “all newest English features translated” are different questions.

### Substantive changes rather than file timestamps

The history scan compares parsed JSON with the first parent, not text diffs.
It excludes metadata, whitespace/formatting, punctuation/case-only changes,
and added or changed values that remain English after that normalization.
It searches the latest 50 non-merge commits touching each exact filename.
Dates report commit dates, not a translator's submission or approval date.
A historical change can have been overwritten later; the table marks the
catalogs with no retained differing strings. A translator has not reviewed this
mechanical “substantive” classification.

| Release-history activity | Languages | Source and observed change |
| --- | --- | --- |
| 2024-12-18 | Ukrainian, Russian, Brazilian Portuguese, Spanish, French | [a5b157d3d](https://github.com/unfoldingWord/translationCore/commit/a5b157d3db6e419775c7e39906a59f529648a6e4): translated content-list toggle hints; two changed differing strings in each except Ukrainian, which also changes the toggle label |
| 2024-12-11 | Indonesian | [944dc386b](https://github.com/unfoldingWord/translationCore/commit/944dc386bac718a6a0e5d1561b1647422da72949): 97 changed differing strings under the audit rule |
| 2022-02-15 | Bengali, Hindi, Gujarati, Kannada, Marathi, Odia, Punjabi, Tamil, Malayalam, Telugu, Naga Pidgin | [c53e47ccc](https://github.com/unfoldingWord/translationCore/commit/c53e47ccc015e2e5156db5afd457be11872b7ae1): one untranslated update-failure message replaced by a translated string |

The December 2024 last-file-edit date also appears on files that received only
English stubs. The June 2026 “translations” commits in development largely add
English export messages. Neither should be presented as a new translation
contribution without inspecting values. Nepali's February 2022 cleanup changes
an English colon to a period; the audit excludes it from substantive activity.

### Development source as of 2026-07-16

The development English reference has **549** string leaves. Every non-English
file has 548/549 keys, zero blanks and zero extras. The one missing key is
`buttons.rename_import`, added on July 10. The substantive differing counts
stay unchanged for every catalog except Vietnamese: **11** translated strings
were added on **2026-06-13**, verified by reading [aa063a6e0](https://github.com/unfoldingWord/translationCore/commit/aa063a6e09a9ea2f3cfa5732c2edd781c87225cf).
The commit title says “update jsdocs”, so titles alone miss this contribution.
Vietnamese is the most recent actual locale addition found, but remains only
2.0% different from English by this proxy and was not in v3.7.0.

| Leading catalogs | Release different / 541 | Development different / 549 |
| --- | ---: | ---: |
| Ukrainian-uk_UA | 536 (99.1%) | 536 (97.6%) |
| Russian-ru_RU | 534 (98.7%) | 534 (97.3%) |
| Portuguese, Brazilian-pt_BR | 525 (97.0%) | 525 (95.6%) |
| Spanish-es_ES | 522 (96.5%) | 522 (95.1%) |
| Indonesian-id_ID | 511 (94.5%) | 511 (93.1%) |

[PROPOSED] For 522, start translation reuse review with Ukrainian, Russian,
Brazilian Portuguese and Spanish; add Indonesian as a strong candidate.
Include French when maintainer availability or recent contributions matter.
Do not advertise zero/near-zero translated catalogs as localized UI choices
merely because their files exist. Confirm the initial published language list
and catalog quality with the owner before declaring it shipped.

### Exact audit used

The script below writes the per-file metrics and candidate history to JSON.
It reads a full-history temporary clone and does not modify tC3 source.
The release tags resolve to the same commit. The temporary clone's development
ref resolves to the pinned July 16 hash above. Network was used only to retrieve
public source/history. The resulting file lives at
`/private/tmp/tc3-locale-audit.json` during this session.

```python
import subprocess, json, pathlib
repo='/private/tmp/tc3-localization-prior-art'
def git(*args): return subprocess.check_output(['git','-C',repo,*args],text=True,stderr=subprocess.DEVNULL)
def substantive(value): return ''.join(c for c in value.casefold() if c.isalnum())
def flatten(x,p=''):
    if isinstance(x,dict):
        return {k2:v2 for k,v in x.items() if k!='_' for k2,v2 in flatten(v,p+'.'+k if p else k).items()}
    if isinstance(x,list):
        return {k2:v2 for i,v in enumerate(x) for k2,v2 in flatten(v,p+'.'+str(i)).items()}
    return {p:x} if isinstance(x,str) else {}
def read(ref,path):
    try:return flatten(json.loads(git('show',ref+':'+path)))
    except (subprocess.CalledProcessError,json.JSONDecodeError):return {}
result={}
for ref in ['v3.7.0','origin/develop']:
    english=read(ref,'src/locale/English-en_US.json')
    rows=[]
    paths=git('ls-tree','--name-only',ref,'src/locale/').splitlines()
    for path in paths:
        if not path.endswith('.json') or 'English-en_US' in path:continue
        data=read(ref,path); keys=set(english)&set(data)
        nonempty={k for k in keys if data[k].strip()}; same={k for k in nonempty if data[k]==english[k]}; differing=nonempty-same
        latest=None; meaningful=None; skipped=[]
        for line in git('log','--no-merges','-n','50','--format=%H|%cs|%s',ref,'--',path).splitlines():
            sha,date,subject=line.split('|',2)
            if latest is None:latest={'sha':sha,'date':date,'subject':subject}
            new=read(sha,path); old=read(sha+'^',path); eng=read(sha,'src/locale/English-en_US.json')
            changed=[k for k,v in new.items() if k in eng and v.strip() and substantive(v)!=substantive(eng[k]) and substantive(old.get(k,''))!=substantive(v)]
            if changed:
                meaningful={'sha':sha,'date':date,'subject':subject,'changed_differing':len(changed),'examples':changed[:3]};break
            skipped.append({'sha':sha,'date':date,'subject':subject})
        rows.append({'file':path,'present':len(keys),'missing':len(set(english)-set(data)),'extra':len(set(data)-set(english)),'empty':len(keys-nonempty),'same':len(same),'differing':len(differing),'pct_differing':round(100*len(differing)/len(english),1),'latest':latest,'meaningful':meaningful,'skipped':skipped})
        print(ref,path,len(differing),len(same),meaningful['date'] if meaningful else 'unknown',flush=True)
    result[ref]={'sha':git('rev-parse',ref).strip(),'english_strings':len(english),'rows':sorted(rows,key=lambda x:-x['differing'])}
pathlib.Path('/private/tmp/tc3-locale-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
```

