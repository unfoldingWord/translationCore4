// The English suite that ships with the install, as one module: the app state imports it,
// and tests import it for REAL pin identities (AGENTS.md: never invent test inputs).
// Moved out of state.jsx on 2026-09-04 (PR #165 review, P3).
// The English suite that ships with the install (§5 default #1). Real evidenced
// values — DCS sb-zip exports fetched + SHA-verified 2026-07-30 / 2026-07-31.
// Each entry is a §5.3 pin: {repoPath, version, flavor} + OPTIONAL 40-hex sha.
// D34 (2026-08-03): for the tW tool BOTH slots name `<lang>_tw`. That repo's
// sb-zip export carries the per-book TWL link TSVs AND the payload articles, so
// one pin and one fetch serve both tool inputs; `<lang>_twl` is never fetched.
const EN_TW = { repoPath: 'git.door43.org/unfoldingWord/en_tw', version: 'v87', sha: 'eaeb7bfefcf84132d0cbcbed185f3ea2be3d86dd', flavor: 'parascriptural/x-bcvarticles' };
export const EN_HELPS = {
  gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' },
  translationNotes: { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v86', sha: 'c354b8ae66a23c485bf6f38fd35bd8f7ef81e4e5', flavor: 'parascriptural/x-bcvnotes' },
  translationWordsLinks: { ...EN_TW },
  translationWords: { ...EN_TW },
  translationAcademy: { repoPath: 'git.door43.org/unfoldingWord/en_ta', version: 'v86', sha: 'c7caddfb474efd713f36b35a3ffc927866c7b180', flavor: 'peripheral/x-peripheralArticles' },
  // §5.3 1.10 OPTIONAL slots (D64, #110). tq sha = the v89 tag commit, equal to
  // the sb-zip export revision [VERIFIED 2026-08-27 — /sb/v89.zip metadata].
  // simplifiedText reuses the shipped en_ust identity (same pin as the 'ust'
  // extraScripture source-pane entry).
  translationQuestions: { repoPath: 'git.door43.org/unfoldingWord/en_tq', version: 'v89', sha: '97c0a13e3b84d46d0e643ba2e8e9f1c295547a58', flavor: 'parascriptural/x-bcvquestions' },
  simplifiedText: { repoPath: 'git.door43.org/unfoldingWord/en_ust', version: 'v89', sha: '37ec223166bbd73fb55abc7840be8310c0fee7f2', flavor: 'scripture/textTranslation' },
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
    // The old lexicon tags (en_ugl v2, en_uhl v1) never existed upstream —
    // en_ugl tops at v0.5 and en_uhl has no tags at all, so its pin is
    // sha-only (the version label is optional and never invented).
    originalLanguage: {
      nt: { repoPath: 'git.door43.org/unfoldingWord/el-x-koine_ugnt', version: 'v0.34', sha: 'fc95b2b8aad08bb65ab54628ab685413a1139e97', flavor: 'scripture/textTranslation' },
      ot: { repoPath: 'git.door43.org/unfoldingWord/hbo_uhb', version: 'v2.1.30', sha: '106a441a788d9465846cd427538ea80b8cec6770', flavor: 'scripture/textTranslation' },
    },
    lexicon: {
      nt: { repoPath: 'git.door43.org/unfoldingWord/en_ugl', version: 'v0.5', sha: '8fa6eb60c0fe7afa61a80264c7326d63db5f1e70', flavor: 'peripheral/x-lexicon' },
      ot: { repoPath: 'git.door43.org/unfoldingWord/en_uhl', sha: 'db0098f3582814066f1a69c0aa2743a3ad0e8c81', flavor: 'peripheral/x-lexicon' },
    },
  },
  extraScripture: [
    {
      id: 'ult',
      repoPath: 'git.door43.org/unfoldingWord/en_ult',
      version: 'v89',
      sha: '84c73ba00fc8a95a9033f9efb14bb905a2a52ee4',
      flavor: 'scripture/textTranslation',
    },
    {
      id: 'ust',
      repoPath: 'git.door43.org/unfoldingWord/en_ust',
      version: 'v89',
      sha: '37ec223166bbd73fb55abc7840be8310c0fee7f2',
      flavor: 'scripture/textTranslation',
    },
  ],
};

// The source-pane badge shows the actual pinned version, never a literal.
export const SUITE_VERSION = INSTALLED_SUITE.extraScripture[0].version;
