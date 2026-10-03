// The English suite that ships with the install, as one module: the app state imports it,
// and tests import it for REAL pin identities (AGENTS.md: never invent test inputs).
// Moved out of state.jsx on 2026-09-04 (PR #165 review, P3).
// The English suite that ships with the install (§5 default #1). Real evidenced
// values — DCS sb-zip exports fetched + SHA-verified. The six English repos moved
// to v91 on 2026-10-01 (#504): each sha is the commit the DCS tags API names for
// the v91 tag, equal to the revision the /sb/v91.zip export metadata declares
// [VERIFIED 2026-10-01 — dev-env/scripts/cache-resource.zsh with the expected sha].
// Each entry is a §5.3 pin: {repoPath, version, flavor} + OPTIONAL 40-hex sha.
// The weekly pin check (.github/workflows/pin-check.yml) reports when a pin is
// older than the latest Door43 release; change the pins together with
// scripts/package-desktop.zsh and the copies docs/PACKAGING.md names.
// D34 (2026-08-03): for the tW tool BOTH slots name `<lang>_tw`. That repo's
// sb-zip export carries the per-book TWL link TSVs AND the payload articles, so
// one pin and one fetch serve both tool inputs; `<lang>_twl` is never fetched.
const EN_TW = { repoPath: 'git.door43.org/unfoldingWord/en_tw', version: 'v91', sha: 'ff5b3852c27c3a0d01b109e482eb26047dcd20e2', flavor: 'parascriptural/x-bcvarticles' };
export const EN_HELPS = {
  gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
  translationNotes: { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v91', sha: 'e586762e330f482a60c52aedd1c7b3a2f155df8a', flavor: 'parascriptural/x-bcvnotes' },
  translationWordsLinks: { ...EN_TW },
  translationWords: { ...EN_TW },
  translationAcademy: { repoPath: 'git.door43.org/unfoldingWord/en_ta', version: 'v91', sha: 'ce9a1bb9431317ca888e8c1f9620caa7f5fe45fd', flavor: 'peripheral/x-peripheralArticles' },
  // §5.3 1.10 OPTIONAL slots (D64, #110). tq sha = the v91 tag commit, equal to
  // the sb-zip export revision [VERIFIED 2026-10-01 — /sb/v91.zip metadata].
  // simplifiedText reuses the shipped en_ust identity (same pin as the 'ust'
  // extraScripture source-pane entry).
  translationQuestions: { repoPath: 'git.door43.org/unfoldingWord/en_tq', version: 'v91', sha: '8be02772584ff5a5fea893a392b4f019e3efcc77', flavor: 'parascriptural/x-bcvquestions' },
  simplifiedText: { repoPath: 'git.door43.org/unfoldingWord/en_ust', version: 'v91', sha: '85f274a74245cb418f85266e1a5b524bc3e91e9c', flavor: 'scripture/textTranslation' },
  // §10.6 / D75 (#288): the complete bundled English OBS help set. tW and
  // tA above are shared with Bible projects. The default image pack is stored
  // separately below, so projects need no obs-images override pin.
  obs: { repoPath: 'git.door43.org/unfoldingWord/en_obs', version: 'v9', sha: 'd39a1dc7a7557ac54e4a8fecc3462147fe7eec3b', flavor: 'gloss/textStories' },
  'obs-tn': { repoPath: 'git.door43.org/unfoldingWord/en_obs-tn', version: 'v13', sha: 'e86138ea13f619f09f7a6dcaa60592716d407fe4', flavor: 'peripheral/x-obsnotes' },
  'obs-twl': { repoPath: 'git.door43.org/unfoldingWord/en_obs-twl', version: 'v3', sha: '44ebc9fafe8101665f985007d566f5036a2be85b', flavor: 'parascriptural/x-bcvarticles' },
  // The OBS questions (#331, D75 amendment): the fourth OPTIONAL member, read like tQ.
  // Flavor and sha from the DCS sb-zip export's metadata at tag v10, read 2026-09-18.
  'obs-tq': { repoPath: 'git.door43.org/unfoldingWord/en_obs-tq', version: 'v10', sha: '01b92fe8793d62cff3a2221f5174c768cbad3dc1', flavor: 'peripheral/x-obsquestions' },
};

export const EN_OBS_IMAGES = {
  repoPath: 'git.door43.org/uW/obs_images_360',
  sha: '7146d5b504f6b63b9e11f7dc0b18c594d0ae179d',
  flavor: 'peripheral/x-obsimages',
};

// Increment 2: pins are the normative BURRITO-SPEC §5.3 **schemaVersion 2**
// two-language-set shape (D17/D30, landed 2026-07-31 — OPEN-QUESTIONS #28):
// `languageSets` holds exactly `primary` (the project's gateway language) and
// `fallback` (the installed English suite). At creation the project has not
// chosen a gateway language yet, so primary === fallback — the §5.3 migration
// rule's initial state; picking a gateway language rewrites `primary` only.
// `originalLanguage`/`lexicon` are set-independent; `extraScripture` is the
// top-level source-pane array (NOT nested inside `resources`).
export const INSTALLED_SUITE = {
  schemaVersion: 2,
  languageSets: {
    primary: { ...EN_HELPS },
    fallback: { ...EN_HELPS },
  },
  resources: {
    // Real identities, sha-verified against the DCS tags API 2026-08-22 (D58).
    // hbo_uhb v3.0.0 (2026-10-01, #504): the Hebrew Bible en_tn v91 and en_ult
    // v91 declare (`hbo/uhb?v=3.0.0` in both manifests). Its Qere readings are
    // footnotes and its main text is the Ketiv; the sha is the v3.0.0 tag commit
    // [VERIFIED 2026-10-01 — /sb/v3.0.0.zip metadata].
    originalLanguage: {
      nt: { repoPath: 'git.door43.org/unfoldingWord/el-x-koine_ugnt', version: 'v0.34', sha: 'fc95b2b8aad08bb65ab54628ab685413a1139e97', flavor: 'scripture/textTranslation' },
      ot: { repoPath: 'git.door43.org/unfoldingWord/hbo_uhb', version: 'v3.0.0', sha: '74022f0fed012a3ef169886f595dd98e7b200543', flavor: 'scripture/textTranslation' },
    },
    // D71 (#218): the lexicons are the `uW`-org burritos (flavor
    // peripheral/x-lexicon, tC3's Strong's JSON under ingredients/content/).
    // Neither repo has a tag, so both pins are sha-only (the version label is
    // never invented) and are fetched as commit archives. Master heads
    // [VERIFIED 2026-09-08 — DCS branches API]. Hardcoded until the December
    // 2026 Greek New Testament release brings its own lexicon.
    lexicon: {
      nt: { repoPath: 'git.door43.org/uW/en_ugl', sha: 'd9d29e2d589258ce27f92b59f753a3af03ab7a72', flavor: 'peripheral/x-lexicon' },
      ot: { repoPath: 'git.door43.org/uW/en_uhl', sha: '72df5ac25acf9d51e826b20e3ad883a5a657ef4e', flavor: 'peripheral/x-lexicon' },
    },
  },
  extraScripture: [
    {
      id: 'ult',
      repoPath: 'git.door43.org/unfoldingWord/en_ult',
      version: 'v91',
      sha: '35d215957f3203fd2e2fac5702ce14902d417f9d',
      flavor: 'scripture/textTranslation',
    },
    {
      id: 'ust',
      repoPath: 'git.door43.org/unfoldingWord/en_ust',
      version: 'v91',
      sha: '85f274a74245cb418f85266e1a5b524bc3e91e9c',
      flavor: 'scripture/textTranslation',
    },
  ],
};

// The source-pane badge shows the actual pinned version, never a literal.
export const SUITE_VERSION = INSTALLED_SUITE.extraScripture[0].version;
