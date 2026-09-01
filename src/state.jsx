// App state over the live HttpStore (Increment 1: J1 create + J2 drafting slice).
// The raw book string is the editing source of truth (indexer + splice); the
// usfm-js parse is for display only (D8: usfm-js never re-serializes).
import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import usfm from 'usfm-js';
import { ServerApi } from './data/serverApi';
// The CANONICAL write boundary (issue #62): every project mutation goes through
// JournalingStore, which journals the action as an immutable §8.5 segment
// BEFORE any derived file changes. The raw HttpStore is never constructed here
// (test/noBypass.test.ts enforces it); read-only surfaces use ProjectReader.
import { StaleWriteError } from './data/httpStore';
import { JournalingStore, ProjectReader } from './data/journal/journalingStore';
import { SaveScheduler } from './data/saveScheduler';
import { spliceVerse, verseBody } from './data/usfm/splice';
import { indexBook } from './data/usfm/indexer';
import { RESOURCE_FRAME, forgetProjectFrames, resolveProjectFrame } from './data/projectFrame';
import { backfillCoverage } from './data/coverageBackfill';
import { mapReference } from './data/mapReference';
import { seedBookFromSource } from './data/seed';
import { BOOK_NAMES, bookName } from './data/bookNames';
import { GATEWAYS, gatewayKey, DCS_HOST, orgForRepoName } from './data/gateways';
import { fetchAndInstallPin, latestReleaseTag, identifyExistingInstall } from './data/resourceFetch';
import { isNotFoundError } from './data/serverApi';
import { readInstalled, recordInstalled, coverageFromLocal, languageSetFromInstalled, mergeOptionalPins, isPinLocal, unsatisfiedProjectPinFor, pinsPreferringInstalled, localRepoPathFromRepoPath, installedPathFor, discoverOnDisk, flavorOfMetadata } from './data/installed';
import { TOOL_SLOT, preflightToolBook, resolutionRecord, resolveToolBook, resolveSetSlot } from './data/resolve';
import {
  deriveForProject,
  mergeAndReattach,
  progressOf,
  scopeRangesFor,
} from './data/derive';
import { readTwArticle, readTaArticle } from './data/articles';
import { revalidateAgainstDraft, resolutionWarning } from './data/revalidate';
import { bootstrapVerse, linkWord, unlinkWord, moveWord, mergeAlignments, splitAlignment, stampTargetVerse, alignmentIsStale } from './data/align/edit';
import { consequencesOfGatewayChange, applyGatewayChange, uncoveredByChange } from './data/gatewayChange';
import { carryOverDecisions } from './data/carryOver';
import { TC_READY_TOPIC } from './data/serverApi';
import { t } from './i18n';

const AppCtx = createContext(null);
const STORAGE_ID = 'uw-tc4';

export const api = new ServerApi();

// The English suite that ships with the install (§5 default #1). Real evidenced
// values — DCS sb-zip exports fetched + SHA-verified 2026-07-30 / 2026-07-31.
// Each entry is a §5.3 pin: {repoPath, version, flavor} + OPTIONAL 40-hex sha.
// D34 (2026-08-03): for the tW tool BOTH slots name `<lang>_tw`. That repo's
// sb-zip export carries the per-book TWL link TSVs AND the payload articles, so
// one pin and one fetch serve both tool inputs; `<lang>_twl` is never fetched.
const EN_TW = { repoPath: 'git.door43.org/unfoldingWord/en_tw', version: 'v87', sha: 'eaeb7bfefcf84132d0cbcbed185f3ea2be3d86dd', flavor: 'parascriptural/x-bcvarticles' };
const EN_HELPS = {
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
const INSTALLED_SUITE = {
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

// ---- source-package rows (J3) ------------------------------------------------
// Role assignment uses the catalog's SB flavor where that flavor is
// unambiguous, and the repo-name suffix ONLY where it demonstrably is not:
// the RC catalog reports BOTH `<lang>_tw` and `<lang>_ta` as
// `x-peripheralArticles` [VERIFIED live 2026-08-03 — git.door43.org/
// unfoldingword: en_tw and en_ta share that flavor, while en_tw's own sb-zip
// export declares `x-bcvarticles`]. Flavor alone would label tW as tA.
const ROLE_BY_FLAVOR = {
  'x-bcvnotes': { k: 'notes', name: 'sources.roleNotes', bookScoped: true },
  'x-bcvquestions': { k: 'questions', name: 'sources.roleQuestions', bookScoped: true },
  textTranslation: { k: 'text', name: 'sources.roleText', bookScoped: true, fixed: true },
};
const ROLE_BY_SUFFIX = {
  _tw: { k: 'words', name: 'sources.roleWords', bookScoped: false },
  _ta: { k: 'academy', name: 'sources.roleAcademy', bookScoped: false },
  // tq rides on the suffix as well as the flavor: the RC catalog's flavor
  // labels are unreliable for TSV repos (the same ambiguity that forced the
  // _tw/_ta suffix rules above), and the questions download must not dead-end
  // on a label (D64, 2026-08-27 review finding).
  _tq: { k: 'questions', name: 'sources.roleQuestions', bookScoped: true },
};

/** The role a catalog repo plays, or null when tC4 does not use it.
 * `<lang>_twl` is deliberately NOT offered: under D34 the tW pin is
 * `<lang>_tw`, whose export already carries the links. */
const roleOf = (repo) => {
  const name = repo.name || '';
  if (/_twl$/.test(name) || /_obs(-|$)/.test(name)) return null;
  for (const [suffix, role] of Object.entries(ROLE_BY_SUFFIX)) {
    if (name.endsWith(suffix)) return role;
  }
  return ROLE_BY_FLAVOR[repo.flavor] ?? null;
};

/** Build the modal's package rows for ONE book from the platform's live
 * catalog. A repo is offered only when it carries the `tc-ready` topic AND —
 * for book-scoped resources — its own `book_codes` cover the book. Coverage
 * comes from the platform, so the rows never over-promise. */
export function packageRows(repos, book, exclude = {}) {
  const code = book.toUpperCase();
  const rows = [];
  for (const r of repos) {
    if (!Array.isArray(r.topics) || !r.topics.includes(TC_READY_TOPIC)) continue;
    const role = roleOf(r);
    if (!role) continue;
    const codes = (r.book_codes || []).map((c) => c.toUpperCase());
    if (role.bookScoped && codes.length > 0 && !codes.includes(code)) continue;
    const k = `${role.k}:${r.name}`;
    rows.push({
      k,
      name: t(role.name),
      repo: r.name,
      desc: r.description || '',
      fixed: !!role.fixed,
      on: role.fixed ? true : !exclude[k],
      books: codes.length,
    });
  }
  return rows;
}

// B10 — resolve a pin to the ACTUAL on-disk install path. Existing/seeded
// resources live at the legacy `_sideloaded_/<repo>` path; fresh installs use
// the owner-qualified `<owner>--<repo>` path (B9). Resolve by IDENTITY against
// what is actually installed — cached from the last resolutionContext — never
// by recomputing the path, which missed every legacy/seeded resource and made
// checking sessions time out. Falls back to the owner-qualified derivation for
// a pin that is not (yet) installed (a fresh download's target).
let installedCache = {};
const resolveReadPath = (pin) =>
  installedPathFor(installedCache, pin) ?? localRepoPathFromRepoPath(pin.repoPath);

// Resolution of a pin to its local repo, for READING. Delegates to the
// identity-based resolver above.
const localSourceRepo = (pin) => resolveReadPath(pin);

// The source-pane badge shows the actual pinned version, never a literal.
export const SUITE_VERSION = INSTALLED_SUITE.extraScripture[0].version;

// B7 — `checking/resources.json` is ONE shared whole-file document (every
// project pin). A read-modify-write that writes blindly loses a concurrent
// editor's change (W-5): two sessions each change a different pin, and the
// second save restores the first's pin to its stale value. Do it under
// compare-and-swap; on a refused (stale) write, re-read and re-apply the
// mutation against the fresh bytes so BOTH changes survive.
const updateResources = async (store, mutate, tries = 4) => {
  for (let attempt = 0; ; attempt += 1) {
    const { value, md5 } = await store.readResourcesWithMd5();
    const next = mutate(value ?? INSTALLED_SUITE);
    try {
      await store.writeResources(next, md5);
      return next;
    } catch (e) {
      if (e instanceof StaleWriteError && attempt < tries - 1) continue;
      throw e;
    }
  }
};

// Design fonts (owner's design project, translationCore.dc.html npFonts).
// Increment 1 records the choice in settings.json; bundling arrives with the
// packaging increment.
export const SCRIPT_FONTS = [
  'Noto Sans (default)',
  'Charis SIL',
  'Scheherazade New — Arabic script',
  'Awami Nastaliq — Nastaliq',
  'Padauk — Myanmar',
];

/** "chapter:verse" -> current draft text, for I-3 revalidation (C2.8). Reads
 * the raw book so it always reflects what is on disk right now. */
function verseTextIndex(bookRaw) {
  if (!bookRaw) return {};
  const chapters = parseChapters(bookRaw);
  const out = {};
  for (const e of indexBook(bookRaw)) {
    const body = bookRaw.slice(e.start, e.end).trim();
    if (body === '' || body === '___') continue;
    out[`${e.chapter}:${e.verseKey}`] = verseText(chapters[e.chapter]?.[e.verseKey]);
  }
  return out;
}

/** OT/NT split for choosing the original-language resource. BOOK_NAMES is in
 * canonical order, so the first 39 entries are the Old Testament. */
function isOldTestament(bookCode) {
  return Object.keys(BOOK_NAMES).indexOf(bookCode.toUpperCase()) < 39;
}

/** usfm-js verse objects for one verse of a source book — the aligner's input. */
function verseObjectsFor(usfmText, chapter, verse) {
  // Catch-to-absence sweep (D30): null = the text is PRESENT but could not
  // be parsed — the alignment surface states 'unreadable', never the false
  // "not on this computer" claim that sends the user to re-download.
  try {
    const json = usfm.toJSON(usfmText);
    return json?.chapters?.[String(chapter)]?.[String(verse)]?.verseObjects ?? [];
  } catch {
    return null;
  }
}

/** The first verse that actually has a draft — alignment needs target words. */
function firstDraftedRef(bookRaw) {
  const index = verseTextIndex(bookRaw);
  const keys = Object.keys(index);
  return keys.length ? keys[0] : null;
}

const initial = () => ({
  view: 'home', // home | read (Understand) | draft (Translate) | check | publish (Community Checking)
  projects: null, // null = loading; [] = none
  project: null, // ProjectSummary + repoPath
  book: null,
  chapter: 1,
  bookRaw: null, // raw USFM string — the editing source of truth
  bookError: null,
  sources: {}, // { ult: {raw, chapters}|'missing'|undefined, ust: … }
  sourceTab: 'ult',
  editing: null, // { key: "1:3", before: <body before this edit session> } | null
  saveState: 'saved', // saved | dirty | saving | error
  rail: true,
  helps: true,
  helpsTab: 'notes',
  // Helps-card focus (epic #104 fidelity, F3): the hovered and the clicked
  // card, each { verse, quote, occurrence, id } — the mockup's
  // hoverNote/activeNote pair. Hover wins while present; both are transient
  // UI state, never persisted.
  helpsHover: null,
  helpsActive: null,
  academy: null,
  // Understand (D63, #106): read-only helps for the open book, derived like a
  // check session (never stored), plus the translator's own comprehension
  // notes read back from the §8.5 journal.
  understand: null, // null | { loading } | { notes, questions, comprehension: {'c:v': text} }
  // D65: the comprehension-note SaveScheduler's state, mirrored the same way
  // saveState mirrors the verse scheduler (subscribe → dispatch on
  // transitions only). It survives leaving the Understand view (B1) and any
  // 'error' blocks navigation like a verse failure (FR-32).
  noteSaveState: 'saved',
  // Modals (the owner's design: creation, add-book, and settings are dialogs
  // over Home, not separate pages)
  modal: null, // null | 'newProject' | 'addBook' | 'settings' | 'sources'
  np: null, // New Bible form
  ab: null, // Add-a-book form
  st: null, // Project-settings form
  // Source-texts (J3): gateway is null on the language step. `rows` come from
  // the LIVE platform catalog for the chosen org, never from app config.
  src: { gateway: null, book: 'TIT', rows: [], loading: false, error: null, dl: null, exclude: {} },
  installedSrc: [], // [{ langKey, book }] packages this machine already has
  installEpoch: 0, // bumped on EVERY successful install (round 20 F2) — resource readiness re-derives even when resources.json is unchanged
  checkable: [], // gatewayKeys whose COMPLETE helps suite is installed (D30.2)
  checkableError: null, // catch-to-absence sweep: an identity-read outage, stated — never "no language checkable"
  preflightError: null, // catch-to-absence sweep: an identity-read outage on the Check preflight, stated
  gatewayError: null, // a failed gateway-change commit, shown in the dialogue
  netEnabled: false, // mirrors the platform's net gate (GET /net/status)
  projectPins: null, // the open project's resources.json (§5.3 v2 shape)
  projectPinsLoaded: false, // round 33: distinguishes pins LOADING (understand waits) from pins legally ABSENT (understand proceeds, slots unpinned)
  projectPinsError: null, // round 34: a REJECTED pins read — stated and retryable, never a false absence claim
  sourcePanes: null, // round 37: the open project's §5.3 extraScripture pane ids — null while the pins load, [] when the project legally has none
  preflight: null, // { [tool]: Preflight } for the open book (C2.2)
  gatewayPreview: null, // a proposed gateway change awaiting confirmation
  aligning: false, // the align surface is open
  alignIndex: null, // #129: { items: [{ref, text, status, placed, total}] } | { error } — the rail's derived verse list
  alignVerse: null, // "chapter:verse" being aligned, or null for the first drafted
  alignSession: null, // { record, armed, ref, … } — the open alignment surface
  checkTool: null, // the open checking tool, or null at the preflight screen
  checkSession: null, // { items, progress, resource, activeIndex } — derived, never stored
  progressByProject: {}, // repoPath -> { CODE: draftPct } (lazy Home cache)
  tick: 0,
});

/** Monotonic identity for check sessions (see patchCheckSession). */
let checkSessionSeq = 0;

/** #129 (PR #135 review round 1): align-session identity, the align rail's
 * read ordering, and the serialized §5.1 write queue — persistAlign never
 * rejects, so one failure cannot wedge the chain. */
let alignSessionSeq = 0;
let alignIndexSeq = 0;
let alignWriteQueue = Promise.resolve();

/** Atomic merge into the live check session (same hazard class as setSource):
 * the orig-book read and the article read resolve concurrently, and a
 * stale-snapshot spread in either would clobber the other's result. The seq
 * is the session's identity — a completion from a closed/replaced session
 * (even for the same tool and book, or another project) updates nothing. */
function patchCheckSession(state, a) {
  const cs = state.checkSession;
  if (!cs?.items || cs.seq !== a.seq) return state;
  return { ...state, checkSession: { ...cs, ...a.patch } };
}

/** One saved decision merged item-by-item (never a whole-array snapshot):
 * two decisions can be in flight through the store queue at once, and the
 * later completion of a stale array would overwrite the earlier item. */
function checkDecisionSaved(state, a) {
  const cs = state.checkSession;
  if (!cs?.items || cs.seq !== a.seq) return state;
  const items = cs.items.map((it, i) => (i === a.index ? a.item : it));
  return { ...state, checkSession: { ...cs, items, progress: progressOf(items), saveError: null } };
}

/** Check-session merge actions, table-dispatched ahead of the main switch. */
const CHECK_SESSION_CASES = { patchCheckSession, checkDecisionSaved };

function reducer(state, a) {
  const checkCase = CHECK_SESSION_CASES[a.type];
  if (checkCase) return checkCase(state, a);
  switch (a.type) {
    case 'set':
      return { ...state, ...a.patch };
    case 'toggle':
      return { ...state, [a.key]: !state[a.key] };
    case 'patchSrc':
      // Atomic merge into the source-texts form. Same hazard as `setSource`:
      // pickGateway dispatches and then awaits loadPackage, which dispatches
      // again BEFORE React re-renders — spreading a captured snapshot there
      // would clobber the gateway that was just set.
      return { ...state, src: { ...state.src, ...a.patch } };
    case 'setSource':
      // Atomic per-key merge: two source fetches can resolve in one batch, and
      // a read-modify-write through a stale snapshot would clobber the sibling.
      return { ...state, sources: { ...state.sources, [a.id]: a.value } };
    case 'noteSaved': {
      // Atomic merge of ONE persisted comprehension note (S1, adversarial
      // round 19): two per-target saves can complete in the same batch, and
      // building the whole `understand` from a captured stateRef snapshot
      // dropped the sibling's entry — the reducer's own state is the only
      // safe base (same hazard class as patchSrc/setSource above). A foreign
      // completion (project or book changed since the write was staged)
      // updates nothing.
      if (state.book !== a.book || state.project?.repoPath !== a.repoPath) return state;
      return {
        ...state,
        understand: {
          ...state.understand,
          saveError: null,
          comprehension: {
            ...state.understand?.comprehension,
            [a.key]: { text: a.text, ts: a.ts },
          },
        },
      };
    }
    case 'noteSaveState': {
      // D65: the note scheduler's state mirror, merged from the reducer's own
      // state (S1 hazard class — never a captured snapshot). The Understand
      // callout's failure message rides along and clears on recovery.
      const next = { ...state, noteSaveState: a.state };
      if (!state.understand) return next;
      return { ...next, understand: { ...state.understand, saveError: a.saveError } };
    }
    case 'bump':
      return { ...state, tick: state.tick + 1, ...(a.patch || {}) };
    default:
      return state;
  }
}

/** Test hook: the reducer's atomic noteSaved merge (S1) is unit-tested. */
export const __reducerForTests = reducer;

/** Test hook (round 20): the pinned-identity install path is unit-tested —
 * a project pin the catalog's latest release cannot satisfy must fetch its
 * OWN identity, never `latestReleaseTag`. */
export const __installPackageRowForTests = (...args) => installPackageRow(...args);

const parseChapters = (raw) => {
  // Display parse (whole-book: chapters + headers — PLATFORM-NOTES #4).
  const json = usfm.toJSON(raw);
  return json.chapters || {};
};

const verseText = (vObj) =>
  (vObj?.verseObjects || [])
    .map((vo) => vo.text || vo.children?.map((c) => c.text || '').join('') || '')
    .join('')
    .trim();

async function readTextIngredient(apiClient, repoPath, ipath) {
  // Round 31: only a true NOT-FOUND means "the resource has nothing here".
  // A transport or server failure PROPAGATES into settleHelp's error state
  // (D30 honesty) — swallowing it told the translator the installed
  // resource lacks the book, with no way to retry.
  try {
    return await apiClient.readIngredient(repoPath, ipath);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

async function readHelpArticle(apiClient, kind, set, category, slug) {
  // Round 35: null means CONFIRMED absent (the resource lacks the module —
  // ArticleView states that). A transport or server failure PROPAGATES to a
  // stated, retryable article error — labeling it "missing" told the
  // translator a linked article does not exist (D30).
  try {
    if (kind === 'tw' && set?.translationWords)
      return await readTwArticle(apiClient, resolveReadPath(set.translationWords), category, slug);
    if (kind === 'ta' && set?.translationAcademy)
      return await readTaArticle(apiClient, resolveReadPath(set.translationAcademy), slug);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
  return null;
}

async function storedGatewayDecisions(store, books) {
  const stored = [];
  const md5s = {};
  for (const book of books) {
    for (const tool of Object.keys(TOOL_SLOT)) {
      // Catch-to-absence sweep (D30): readDecisionsText already returns
      // {text:null} for a CONFIRMED absent file; a rejection here is a
      // transient failure that would silently drop the book from the
      // consequences the user consents to. Propagate to gatewayError.
      const got = await store.readDecisionsText(tool, book);
      if (got?.text == null) continue;
      stored.push({ tool, book, file: JSON.parse(got.text), raw: got.text });
      md5s[`${tool}/${book}`] = got.md5;
    }
  }
  return { stored, md5s };
}

async function gatewayChangePlan({ consequences, next, coverage, installed, stored, md5s, actions, blocked }) {
  const keyOf = (entry) => `${entry.tool}/${entry.book}`;
  const blockedSet = new Set(blocked.map(keyOf));
  const plan = [];
  for (const entry of consequences.affected) {
    if (blockedSet.has(keyOf(entry))) continue;
    const resolution = resolveToolBook(next, entry.tool, entry.book, coverage);
    if (!resolution.pin || !isPinLocal(installed, resolution.pin)) {
      blocked.push({ tool: entry.tool, book: entry.book });
      blockedSet.add(keyOf(entry));
      continue;
    }
    const source = stored.find((candidate) => candidate.tool === entry.tool && candidate.book === entry.book);
    const derived = await actions.deriveItemsFor(entry.tool, entry.book, resolution.pin);
    plan.push({
      tool: entry.tool,
      book: entry.book,
      expectMd5: md5s[`${entry.tool}/${entry.book}`] ?? null,
      ...carryOverDecisions(source.file, derived, resolutionRecord(resolution)),
    });
  }
  return { plan, blocked };
}

/** Derive one tool's check session: the item list, and the project-frame
 * verdict the compare panes need. #131 class: a non-eng-framed project
 * numbers its items in ITS frame, while the source books stay in their own —
 * the panes cannot line verses up until the mapping lands there. `partial`
 * marks the designed empty/warning session shapes, which carry no items. */
async function assembleCheckSession({ api, actions, store, stateRef, st, tool, book, pre, seq }) {
  const result = await deriveCheckItems({ apiClient: api, actions, st, tool, book, pre });
  // ONE frame verdict per session — the one the derivation itself used
  // (review round 3: a second projectFrame() call could disagree with it).
  // A missing-TSV session resolves no frame; it has no panes to gate.
  const { frame } = result;
  const crossFrame = frame ? frame.state !== 'ready' || frame.name !== 'eng' : false;
  if (result.session) return { session: { ...result.session, seq, crossFrame }, partial: true };
  const session = {
    ...(await completedCheckSession({
      store,
      st: stateRef.current,
      tool,
      book,
      pre,
      derived: result.derived,
      dropped: result.dropped,
    })),
    seq,
    crossFrame,
  };
  return { session, partial: false };
}

/** F1 (epic #104 fidelity): the ORIGINAL-language chapters behind the check
 * detail's compare card — one whole-book read + parse per session, from the
 * same pinned originalLanguage resource Align reads. Absence is a stated
 * state, never an error (D30). */
async function readCheckOrigChapters(store, pin, book) {
  const testament = isOldTestament(book) ? 'ot' : 'nt';
  if (!pin?.repoPath) return { state: 'unpinned', testament };
  try {
    const { usfm: usfmText } = await store.readSourceBook(resolveReadPath(pin), book);
    if (!usfmText) return { state: 'missing', testament };
    return { state: 'ready', testament, chapters: parseChapters(usfmText) };
  } catch (e) {
    if (isNotFoundError(e)) return { state: 'missing', testament };
    return { state: 'error', testament, error: String(e?.message || e) };
  }
}

async function prepareAlignmentSource(store, st, ref) {
  const testament = isOldTestament(st.book) ? 'ot' : 'nt';
  const pin = st.projectPins?.resources?.originalLanguage?.[testament];
  if (!pin?.repoPath) return { unavailable: 'unpinned' };
  let usfmText = null;
  // Catch-to-absence sweep (D30): 'missing' means the text is CONFIRMED not
  // on this computer (the screen sends the user to download it). A transient
  // read failure must not make that claim — it propagates to the alignment
  // surface's stated, retryable error.
  try {
    ({ usfm: usfmText } = await store.readSourceBook(resolveReadPath(pin), st.book));
  } catch (error) {
    if (!isNotFoundError(error)) throw error;
    usfmText = null;
  }
  if (!usfmText) return { unavailable: 'missing' };
  return { testament, pin, usfmText, ref };
}

async function buildAlignmentSession(store, st, ref, source, mapped, origObjects) {
  const targetText = verseTextIndex(st.bookRaw)[ref] ?? '';
  if (!origObjects.length || !targetText) return { unavailable: 'missing' };
  const { value: file, md5 } = await store.readAlignmentsWithMd5(st.book);
  const stored = file?.chapters?.[mapped.chapter]?.[mapped.verse];
  const sourceVersion = `dcs::${source.pin.repoPath.split('/').slice(-2).join('/')}@${source.pin.version}`;
  const record = stored ?? bootstrapVerse(targetText, origObjects, sourceVersion);
  return {
    loading: false,
    ref,
    book: st.book,
    record,
    md5,
    targetText,
    origObjects,
    sourceVersion,
    stale: alignmentIsStale(record, targetText),
    armed: null,
    targetDir: st.project?.scriptDirection === 'rtl' ? 'rtl' : 'ltr',
    origDir: source.testament === 'ot' ? 'rtl' : 'ltr',
    // #129: the editor's gateway lens needs the testament (mode labels) and
    // the project frame — an eng-framed project may index the gateway pane
    // by this ref; any other frame disables the lens (#131 class).
    testament: source.testament,
  };
}

function understandArticleSet(st, kind, rung) {
  const sets = st.projectPins?.languageSets;
  const slotName = kind === 'tw' ? 'translationWords' : 'translationAcademy';
  return [sets?.[rung ?? 'fallback'], sets?.fallback, sets?.primary]
    .find((candidate) => candidate?.[slotName]);
}

function isCurrentArticleRequest(now, seq, currentSeq, repoPath, key) {
  if (seq !== currentSeq) return false;
  if (now.project?.repoPath !== repoPath) return false;
  return now.understand?.article?.key === key;
}

/** #129: one verse's alignment status for the align rail. Mirrors the shared
 * check status model: 'valid' = every target word placed, 'invalid' = the
 * draft changed under the record (align.stale), 'todo' = unplaced words —
 * plus 'undrafted', which the other tools do not have. */
function alignVerseStatus(rec, text) {
  if (!text) return { status: 'undrafted', placed: 0, total: 0 };
  const placed = rec ? rec.alignments.reduce((n, x) => n + x.bottomWords.length, 0) : 0;
  const total = rec ? placed + rec.wordBank.length : 0;
  // §5.1's own re-review flag outranks the hash check — either means the
  // record no longer vouches for the draft (PR #135 review round 1).
  if (rec && (rec.invalid === true || alignmentIsStale(rec, text))) return { status: 'invalid', placed, total };
  if (rec && rec.wordBank.length === 0 && placed > 0) return { status: 'valid', placed, total };
  return { status: 'todo', placed, total };
}

/** The §5.1 file with one verse's record replaced (persistAlign's merge). */
function alignFileWith(current, book, ref, record) {
  const [chapter, verse] = ref.split(':');
  const file = current ?? { schemaVersion: 1, book: book.toUpperCase(), chapters: {} };
  return {
    ...file,
    chapters: {
      ...file.chapters,
      [chapter]: { ...(file.chapters?.[chapter] ?? {}), [verse]: record },
    },
  };
}

/** #129: the align rail's rows — every verse of the book in document order,
 * with the verse text and its derived status. */
function alignIndexItems(bookRaw, file) {
  const texts = verseTextIndex(bookRaw);
  const items = [];
  for (const e of indexBook(bookRaw)) {
    const ref = `${e.chapter}:${e.verseKey}`;
    const text = texts[ref] ?? '';
    const rec = file?.chapters?.[String(e.chapter)]?.[String(e.verseKey)];
    items.push({ ref, text, ...alignVerseStatus(rec, text) });
  }
  return items;
}

function emptyCheckSession(tool, book, resolution, empty, dropped = null) {
  return {
    loading: false,
    tool,
    book,
    items: [],
    empty,
    resource: resolutionRecord(resolution),
    ...(dropped ? { dropped } : {}),
  };
}

async function deriveCheckItems({ apiClient, actions, st, tool, book, pre }) {
  const tsv = await readTextIngredient(apiClient, resolveReadPath(pre.resolution.pin), `${book.toUpperCase()}.tsv`);
  if (tsv === null || tsv.startsWith('{"is_good":false'))
    return { session: emptyCheckSession(tool, book, pre.resolution, 'missing') };
  const frame = await actions.projectFrame();
  if (frame.state !== 'ready')
    return { session: emptyCheckSession(tool, book, pre.resolution, `versification-${frame.state}`), frame };
  const scopeRanges = scopeRangesFor(st.projectScope ?? {}, book.toUpperCase());
  const result = await deriveForProject({
    tsv,
    tool,
    bookId: book.toLowerCase(),
    from: RESOURCE_FRAME,
    to: frame.name,
    schemes: frame.schemes,
    scopeRanges,
  });
  const dropped = result.unplaceable.length
    ? {
        count: result.unplaceable.length,
        scheme: frame.name,
        reasons: [...new Set(result.unplaceable.map((entry) => entry.reason))].sort(),
      }
    : null;
  if (result.items.length === 0)
    return { session: emptyCheckSession(tool, book, pre.resolution, dropped ? 'all-dropped' : 'none', dropped), frame };
  return { derived: result.items, dropped, frame };
}

async function completedCheckSession({ store, st, tool, book, pre, derived, dropped }) {
  const savedFile = await store.readDecisions(tool, book);
  const saved = savedFile?.decisions ?? [];
  const slot = TOOL_SLOT[tool];
  const rungPins = ['primary', 'fallback']
    .map((rung) => st.projectPins?.languageSets?.[rung]?.[slot])
    .filter(Boolean)
    .map((pin) => ({ repoPath: pin.repoPath, version: pin.version, sha: pin.sha }));
  const warning = resolutionWarning(savedFile?.resource, pre.resolution, rungPins);
  const { items: merged, orphaned } = mergeAndReattach(derived, saved);
  const verses = verseTextIndex(st.bookRaw);
  const { items, invalidated } = revalidateAgainstDraft(merged, verses);
  return {
    loading: false,
    tool,
    book,
    items,
    progress: progressOf(items),
    resource: resolutionRecord(pre.resolution),
    categories: [...new Set(items.map((item) => item.category))].sort(),
    activeIndex: 0,
    invalidated,
    warning,
    orphaned,
    dropped,
    verses,
  };
}

async function identifyInstalledResource(apiClient, repoPath, target) {
  if ((await readInstalled(apiClient, STORAGE_ID))[target]) return;
  // Catch-to-absence sweep (D30): "unidentified" is honest only when DCS
  // CONFIRMS no tag names the revision (identifyExistingInstall → null). A
  // transient failure PROPAGATES to the caller's stated per-row failure —
  // the old swallow reported the row as done while the resource contributed
  // no coverage ("installed" and "not checkable" at once).
  const meta = await apiClient.getMetadataRaw(target);
  const revision = Object.values(meta?.identification?.primary?.dcs || {})[0]?.revision;
  const found = await identifyExistingInstall(repoPath, revision);
  if (found)
    await recordInstalled(apiClient, STORAGE_ID, target, {
      ...found,
      flavor: flavorOfMetadata(meta),
    });
}

/** Install the EXACT identity the open project pins (round 20): fetching the
 * catalog's latest release cannot satisfy a pin at another sha (D58), and the
 * only exposed recovery path would strand the project permanently. When the
 * canonical path is occupied by a different sha, the pinned identity installs
 * side by side — the importer refuses an existing target, and deleting the
 * occupant could orphan another project pinned to it. fetchAndInstallPin
 * verifies the export's declared revision against the pinned sha (D23b), so a
 * returned result IS the requested identity. */
async function installPinnedRow(apiClient, row, wanted, local, target) {
  const installPath = local.has(target) ? `${target}--${wanted.sha.slice(0, 12)}` : target;
  const result = await fetchAndInstallPin(
    { repoPath: wanted.repoPath, version: wanted.version, sha: wanted.sha, flavor: wanted.flavor ?? '' },
    { api: apiClient, targetRepoPath: installPath === target ? undefined : installPath },
  );
  // Catch-to-absence sweep (D30/A17): a pin recorded with flavor '' is
  // EXCLUDED from language sets (languageSetFromInstalled / mergeOptionalPins
  // filter on !!flavor) — the download would report success while the
  // language never becomes checkable. The metadata read is local and
  // immediately post-install: a failure is transient and PROPAGATES to the
  // stated per-row failure (a retry heals through the identify path).
  const flavor = wanted.flavor || flavorOfMetadata(await apiClient.getMetadataRaw(installPath));
  await recordInstalled(apiClient, STORAGE_ID, installPath, {
    repoPath: wanted.repoPath,
    ...(wanted.version ? { version: wanted.version } : {}),
    sha: result.revision,
    flavor,
  });
  return { done: `${row.repo} ${wanted.version ?? result.revision.slice(0, 12)}` };
}

async function installPackageRow(apiClient, originGateway, row, local, wanted = null) {
  const repoPath = `${DCS_HOST}/${originGateway.org}/${row.repo}`;
  const target = localRepoPathFromRepoPath(repoPath);
  try {
    if (wanted) return await installPinnedRow(apiClient, row, wanted, local, target);
    if (local.has(target)) {
      await identifyInstalledResource(apiClient, repoPath, target);
      return { done: row.repo };
    }
    const tag = await latestReleaseTag(repoPath);
    const result = await fetchAndInstallPin({ repoPath, version: tag, flavor: '' }, { api: apiClient });
    // A17: same rule as installPinnedRow — never record flavor '' from a
    // FAILED read; the row's stated failure + retry heals it.
    const flavor = flavorOfMetadata(await apiClient.getMetadataRaw(target));
    await recordInstalled(apiClient, STORAGE_ID, target, {
      repoPath,
      version: tag,
      sha: result.revision,
      flavor,
    });
    return { done: `${row.repo} ${tag}` };
  } catch (error) {
    return { failed: `${row.repo}: ${String(error?.message || error)}` };
  }
}

function recordInstalledPackage(stateRef, dispatch, gateway, book) {
  const langKey = gatewayKey(gateway);
  const already = stateRef.current.installedSrc.some(
    (entry) => entry.langKey === langKey && entry.book === book,
  );
  if (already) return;
  dispatch({
    type: 'set',
    patch: { installedSrc: [...stateRef.current.installedSrc, { langKey, book }] },
  });
}

async function adoptDownloadedPins({
  originStore,
  originRepoPath,
  originGateway,
  storeRef,
  stateRef,
  actions,
  dispatch,
}) {
  const sameProject =
    originStore &&
    originRepoPath &&
    storeRef.current === originStore &&
    stateRef.current.project?.repoPath === originRepoPath;
  if (!sameProject) return;
  try {
    const { installed, coverage } = await actions.resolutionContext();
    if (!mergeOptionalPins(stateRef.current.projectPins ?? {}, originGateway, installed)) return;
    const next = await updateResources(originStore, (current) => {
      const merged = mergeOptionalPins(current, originGateway, installed);
      return merged ? backfillCoverage(merged, coverage).resources : current;
    });
    if (stateRef.current.project?.repoPath === originRepoPath)
      dispatch({ type: 'set', patch: { projectPins: next } });
  } catch (error) {
    dispatch({
      type: 'patchSrc',
      patch: { error: t('sources.adoptFailed', { error: String(error?.message || error) }) },
    });
  }
}

function validateNewBible(form) {
  if (!form.name.trim()) return { error: t('wizard.nameRequired') };
  if (!form.code.trim()) return { error: t('wizard.codeRequired') };
  const slug = (value) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const abbr = slug(form.name) || slug(form.code);
  return abbr ? { abbr } : { error: t('wizard.abbrRequired') };
}

/** D65 (round-22 checkpoint): comprehension notes ride their own
 * SaveScheduler, so navigation drains are ONE discipline — flush-and-go, and
 * a retained failure refuses (FR-32).
 *
 * Round 23: bring BOTH schedulers to rest in a LOOP that re-checks both
 * states after every pass — the screen stays editable while a drain awaits,
 * so a note staged during the verse drain (or a verse edited during the note
 * drain) must be caught by another pass, never left for a later dispose to
 * discard (TOCTOU). Resolves true only when a full pass ends with both
 * schedulers reporting 'saved'. */
async function drainBothSchedulers({ schedulerRef, noteSchedulerRef }) {
  // Round 30/31: the reconcile-before-rest gate lives INSIDE the note
  // scheduler (a constructor-injected hook its own retry() runs on a
  // retained failure), so no drain path here — or anywhere — can bypass it.
  const restState = (sched) => (sched ? sched.getState() : 'saved');
  for (;;) {
    if (noteSchedulerRef.current && !(await noteSchedulerRef.current.drain())) return false;
    if (schedulerRef.current && !(await schedulerRef.current.drain())) return false;
    if (restState(noteSchedulerRef.current) === 'saved' && restState(schedulerRef.current) === 'saved')
      return true;
  }
}

/** Test hook (round 23): the drain loop is unit-tested — work staged while
 * the OTHER scheduler's drain awaited must flush before anything disposes. */
export const __drainBothSchedulersForTests = drainBothSchedulers;

/** Every blocker is checked BEFORE anything is disposed (C3). */
async function drainForProjectOpen({ schedulerRef, noteSchedulerRef }) {
  if (!(await drainBothSchedulers({ schedulerRef, noteSchedulerRef }))) return false;
  schedulerRef.current?.dispose();
  noteSchedulerRef.current?.dispose();
  return true;
}

async function projectPresentation(apiClient, store, repoPath, summary) {
  let scriptDirection = summary.scriptDirection;
  if (scriptDirection !== 'ltr' && scriptDirection !== 'rtl') {
    // Catch-to-absence sweep (D30): 'ltr' is the default for a project
    // GENUINELY without settings.json. A transient read failure must not
    // render an RTL project left-to-right — it aborts the open into the
    // stated bookError (performProjectOpen's catch).
    const settings = await store.readSettings().catch((error) => {
      if (isNotFoundError(error)) return null;
      throw error;
    });
    scriptDirection = settings?.textDirection === 'rtl' ? 'rtl' : 'ltr';
  }
  // A failed metadata read must not DEFAULT the scope: scopeRangesFor({})
  // means whole-book, silently disabling §4.2/D26 scope filtering — the
  // journal side refuses this exact defaulting (journalingStore: "seeding or
  // recovery with a defaulted scope would journal a widened scope
  // permanently"). Propagate to the stated bookError; an absent currentScope
  // key on a READABLE document stays {}.
  const meta = await apiClient.getMetadataRaw(repoPath);
  const projectScope = meta?.type?.flavorType?.currentScope ?? {};
  return { scriptDirection, projectScope };
}

function adoptInstalledResources(current, installed) {
  let next = current;
  for (const rung of Object.values(current.languageSets ?? {})) {
    const language = rung?.gatewayLanguage;
    if (!language?.languageId || !language?.owner) continue;
    const merged = mergeOptionalPins(
      next,
      { id: language.languageId, org: language.owner },
      installed,
    );
    if (merged) next = merged;
  }
  return next;
}

/** Round 25: open one project, SEQUENCED. Project cards stay clickable while
 * an open is in flight, so two opens can interleave — without a token the
 * earlier one resumes after the later one replaced storeRef and the
 * schedulers, dispatches ITS summary over the later project, and reads books
 * through the later project's refs (the UI names project A while writes
 * target project B). Every await is followed by a supersession check BEFORE
 * any shared ref is assigned or any state dispatched; a stale FAILURE is
 * dropped too (it must never route the successfully opened project Home). */
async function performProjectOpen(ctx, repoPath, bookCode) {
  const {
    openProjectSeqRef,
    schedulerRef,
    noteSchedulerRef,
    noteTargetsRef,
    storeRef,
    stateRef,
    understandSeqRef,
    dispatch,
    actions,
    apiClient,
    makeStore,
    markUsed,
  } = ctx;
  const seq = ++openProjectSeqRef.current;
  const superseded = () => seq !== openProjectSeqRef.current;
  // Never abandon unsaved work: drain BOTH schedulers first, and stay put if
  // a write failure remains (FR-32; B3/M1/M6; notes held to the same rule —
  // B1/D65).
  const canOpen = await drainForProjectOpen({ schedulerRef, noteSchedulerRef });
  if (!canOpen || superseded()) return;
  try {
    // R-E33-3: the versification frame cache is keyed by repoPath, which is
    // NOT unique across a delete-and-recreate inside one session. Clear it
    // on every open so a new project at a reused path never inherits the
    // previous project's frame — that would key every check in the wrong
    // numbering, and the journal keeps those keys permanently.
    forgetProjectFrames();
    const store = makeStore();
    // open() runs the issue-#62 recovery pipeline: replay staged intents,
    // classify derived state against the journal, seed a journal-less
    // project universally, reconcile out-of-band USFM — or STOP with a
    // diagnosable report (surfaced through bookError below).
    const summary = await store.open(repoPath);
    if (superseded()) return; // a newer open owns the refs
    storeRef.current = store;
    schedulerRef.current = new SaveScheduler({
      writeBook: (book, whole) => store.writeBook(book, whole),
      splice: spliceVerse,
    });
    schedulerRef.current.subscribe((saveState) => dispatch({ type: 'set', patch: { saveState } }));
    // D65: the comprehension-note scheduler — same discipline, its own
    // instance (a failing note must not park verse autosave: the failure
    // slot is per instance). Its key is the fully-scoped note identity; the
    // splice degenerates to the whole value.
    noteTargetsRef.current = new Map();
    noteSchedulerRef.current = new SaveScheduler({
      writeBook: makeNoteWriter({ noteTargetsRef, dispatch, apiClient }),
      splice: (_raw, _chapter, _verse, body) => body,
      // Round 31 hardening: the rest-claim gate lives IN the scheduler — a
      // retained failure reconciles the store's staged intents (a rejecting
      // reconcile keeps the failure standing, FR-32) and then REFRESHES the
      // notes the screen displays, so a recovered durable note is visible
      // before any Saved claim, on every retry/drain/navigation path alike.
      reconcile: async () => {
        await store.reconcileStaged();
        await actions.loadUnderstand();
      },
    });
    const noteSched = noteSchedulerRef.current;
    noteSched.subscribe((noteSaveState) => {
      // The mirror the indicator reads, plus the Understand callout's
      // message on failure (cleared when the state recovers). The understand
      // merge happens IN the reducer, from its own state — a snapshot spread
      // here would clobber a concurrent noteSaved merge (S1 hazard class).
      const failure = noteSched.getFailure();
      dispatch({
        type: 'noteSaveState',
        state: noteSaveState,
        saveError:
          noteSaveState === 'error'
            ? String(failure?.error?.message || failure?.error || noteSaveState)
            : null,
      });
    });
    apiClient.setCurrentProject(repoPath).catch(() => {});
    markUsed(repoPath); // fire-and-forget; ordering refreshes next Home visit
    // The platform summary reports script_direction "?" for app-created
    // projects; the wizard recorded the user's choice in settings.json.
    const { scriptDirection, projectScope } = await projectPresentation(apiClient, store, repoPath, summary);
    if (superseded()) return;
    // A2: the previous project's understand/pins must never survive into
    // this one — clear both with the new project, and invalidate any
    // in-flight loadUnderstand before its completion can land here.
    understandSeqRef.current++;
    dispatch({
      type: 'set',
      patch: {
        project: { ...summary, scriptDirection, repoPath },
        projectScope,
        view: 'draft',
        projectPins: null,
        projectPinsLoaded: false,
        projectPinsError: null,
        sourcePanes: null,
        understand: null,
      },
    });
    // The project's pins drive every check session (D30.3). Absent
    // resources.json reads as null — "no pins recorded" — which the
    // preflight reports distinctly from "pinned but not local".
    //
    // #16 / owner ruling 3c: on the way in, record book coverage on any pin
    // that lacks it and whose resource IS on this machine. Best-effort; a
    // failure never blocks opening. N1 (round 14): the detached chain binds
    // every dispatch to the originating store instance and repo path.
    loadProjectPins({ store, repoPath, storeRef, stateRef, actions, dispatch });
    // B12 — warm the install resolver BEFORE any book/source read, so
    // resolveReadPath's installedCache is populated on a cold open.
    await actions.resolutionContext().catch(() => {});
    if (superseded()) return;
    await actions.openBook(bookCode || summary.bookCodes[0]);
  } catch (e) {
    if (superseded()) return; // a stale failure must not route the OPEN project Home
    dispatch({
      type: 'set',
      patch: { bookError: e?.reason || e?.message || String(e), view: 'home' },
    });
  }
}

/** Test hook (round 25): out-of-order open completions are unit-tested — the
 * latest request exclusively owns the refs and the dispatched state. */
export const __performProjectOpenForTests = performProjectOpen;

/** Load the read-only helps for the open book (extracted round 33 for the
 * interleaving regressions): tN notes, tQ questions and tW links, each
 * resolved over the §5.3 ladder (D64) and derived exactly like a check
 * session — disposable, never stored (§4.2). The translator's own
 * comprehension notes are read back from the journal. */
async function performLoadUnderstand(ctx) {
  const { stateRef, storeRef, understandSeqRef, dispatch, actions, apiClient } = ctx;
  const st = stateRef.current;
  const book = st.book;
  // A2: while the pins are still LOADING, a previous project's
  // understand data must not keep rendering — clear and invalidate.
  // Round 33: pins LOADED-BUT-ABSENT is a legal state (D30.3, "no pins
  // recorded") — the journal's comprehension notes and the passage are
  // independent of the helps pins, so the screen proceeds with every
  // help slot honestly unpinned instead of loading forever.
  if (!book || (!st.projectPins && !st.projectPinsLoaded)) {
    understandSeqRef.current++;
    if (stateRef.current.understand) dispatch({ type: 'set', patch: { understand: null } });
    return;
  }
  // Sequence token: pins/net/project can change while a load is pending,
  // and two projects can both hold the same book code — a book-only
  // guard lets an OLDER completion (or failure) overwrite the newer
  // state. Only the latest call may dispatch, on BOTH paths.
  const seq = ++understandSeqRef.current;
  // P1 (adversarial round 16): a SAME-BOOK refresh (pins/net change)
  // keeps comprehension and sourceRefs standing — wiping them mid-edit
  // unmounts cross-frame units (falling back to same-frame display) and
  // discards unblurred drafts. A different book starts clean.
  dispatch({ type: 'set', patch: understandLoadingPatch(stateRef.current.understand, book) });
  // Built before the help slots and carried onto BOTH dispatch paths
  // (A3): a failing optional resource must never hide persisted notes
  // behind writable empty boxes. null = "not read" — the UI disables
  // the boxes rather than treating it as empty.
  let comprehension = null;
  // C1/N1: every read below binds to the store this load STARTED in.
  const store = storeRef.current;
  // For the round-33 catch-path re-read: the frame once established.
  let frameForNotes = null;
  // S3: only a CONFIRMED ready+eng frame may ever render same-frame.
  // Until that is established (or when the load throws first), the
  // failure path must not fall back to indexing the eng source with
  // project numbers — nor leave boxes editable over it.
  let safeSameFrame = false;
  try {
    const { installed, coverage, resolutionError } = await actions.resolutionContext();
    const frame = await actions.projectFrame();
    safeSameFrame = frame.state === 'ready' && frame.name === RESOURCE_FRAME;
    // A1: note identities are journaled in the PROJECT frame (§8.4/§5.2
    // identity discipline); the display buckets in SOURCE (eng) space.
    // Map stored keys back when the frames differ; the uW default is
    // same-frame and short-circuits.
    // J2 (adversarial round 10): comprehension is keyed by each note's
    // OWN project-frame chapter:verse — never re-mapped. Same-frame
    // units read it by numeric membership (identical spaces); a
    // cross-frame unit reads its EXACT project reference, so fan-out
    // targets (rsc NEH 7:67 vs 7:68) keep their distinct notes. A frame
    // that is not ready leaves comprehension null — boxes disabled,
    // matching the save path's refusal.
    comprehension = latestComprehension(store, book, frame);
    frameForNotes = frame;
    // H1 (adversarial round 8): the reading pane must NOT index the
    // eng-frame source with a PROJECT-frame chapter number (eng JON
    // 1:17 is rsc JON 2:1). For a cross-frame project, map every
    // project verse to its source reference once per load; the view
    // renders the mapped refs and states the unmappable ones. null =
    // same frame — the view indexes directly, the common path.
    const sourceRefs = await mappedSourceReferences(st, book, frame);
    if (dispatchResolutionDown({ resolutionError, seq, understandSeqRef, dispatch, book, store, frame, sourceRefs })) return;
    const scopeRanges = scopeRangesFor(st.projectScope ?? {}, book.toUpperCase());
    const sets = st.projectPins?.languageSets ?? {};
    // Round 33: with pins loaded-but-absent, every slot resolver sees an
    // EMPTY languageSets — each slot resolves to its honest none/unpinned
    // state instead of crashing on null.
    const stForSlots = st.projectPins ? st : { ...st, projectPins: { languageSets: {} } };
    const slotArgs = {
      apiClient,
      st: stForSlots,
      book,
      coverage,
      installed,
      frame,
      scopeRanges,
      sets,
    };
    const [notes, questions, words, simplified] = await Promise.all([
      // keepPlainNotes: the read-only surface shows EVERY note the
      // resource carries, incl. rows without a SupportReference that
      // checking rightly skips (deriveTnItems).
      settleHelp(loadUnderstandSlot({ ...slotArgs, slot: 'translationNotes', tool: 'translationNotes', deriveOpts: { keepPlainNotes: true } })),
      settleHelp(loadUnderstandSlot({ ...slotArgs, slot: 'translationQuestions', tool: 'translationQuestions' })),
      settleHelp(loadUnderstandSlot({ ...slotArgs, slot: 'translationWordsLinks', tool: 'translationWords' })),
      settleHelp(loadSimplifiedHelp({ store, st: stForSlots, book, coverage, installed, sets })),
    ]);
    if (seq !== understandSeqRef.current) return; // superseded
    // Round 33: `comprehension` was snapshotted BEFORE the help awaits —
    // a note saved while they ran would be clobbered by dispatching the
    // stale snapshot (the box follows the reverted stored text, and
    // re-editing it appends obsolete content). Re-read the store's fold
    // NOW, under the same sequence guard: readNotes is synchronous, and
    // a write still in flight re-merges through its own noteSaved echo.
    comprehension = latestComprehension(store, book, frame);
    dispatch({
      type: 'set',
      patch: { understand: { loading: false, book, notes, questions, words, simplified, comprehension, sourceRefs } },
    });
  } catch (e) {
    if (seq !== understandSeqRef.current) return; // a stale failure never replaces current state
    // Round 33: the failure patch replaces understand wholesale — the
    // same stale-snapshot hazard as the success path. Re-read when the
    // frame was established; before that, comprehension is still null.
    if (frameForNotes) comprehension = latestComprehension(store, book, frameForNotes);
    dispatch({ type: 'set', patch: understandFailurePatch({ safeSameFrame, error: e, comprehension, book }) });
  }
}

/** Round 35: with the summaries read down, coverage is EMPTY and every
 * installed help would resolve to a false absence (D30). State the outage on
 * each slot instead — the slot error is retryable in place (the round-31
 * Retry re-runs the load, and with it the summaries read). The passage and
 * comprehension stay fully usable. Returns true when it handled the load. */
function dispatchResolutionDown({ resolutionError, seq, understandSeqRef, dispatch, book, store, frame, sourceRefs }) {
  if (!resolutionError) return false;
  if (seq !== understandSeqRef.current) return true; // superseded — nothing to dispatch
  const errSlot = { state: 'error', error: t('understand.resolutionDown', { error: resolutionError }) };
  dispatch({
    type: 'set',
    patch: {
      understand: {
        loading: false,
        book,
        notes: errSlot,
        questions: errSlot,
        words: errSlot,
        simplified: errSlot,
        comprehension: latestComprehension(store, book, frame),
        sourceRefs,
      },
    },
  });
  return true;
}

/** Test hook (round 33): the load/save interleavings are unit-tested. */
export const __performLoadUnderstandForTests = performLoadUnderstand;

/** Round 37 (§5.3, normative): "Readers use `extraScripture` to fill the
 * source panes. Absence is legal." The panes therefore come from the OPEN
 * PROJECT's pins — resolving by identity (sha, via resolveReadPath/B10) —
 * never from the machine's INSTALLED_SUITE: a conforming imported project
 * with different source shas must see ITS text, and one that omits the
 * array gets a stated no-panes state, not the defaults. While the pins are
 * still LOADING the panes stay unknown (sourcePanes: null) and the reload
 * fires when they land. A failed read is 'missing' only when CONFIRMED
 * absent; anything else is a stated, retryable pane error (D30). */
function loadSourcePanes({ store, code, seq, openSeqRef, stateRef, dispatch, pins }) {
  const st = stateRef.current;
  // `pins` carries the JUST-READ document (loadProjectPins hands it over
  // directly — the state dispatch has not rendered yet, so stateRef still
  // holds the old value at that moment). Absent that, state decides.
  const havePins = pins !== undefined || st.projectPins || st.projectPinsLoaded;
  if (!havePins) return; // pins loading — reloadSourcePanes runs on arrival
  const effective = pins !== undefined ? pins : st.projectPins;
  const entries = effective?.extraScripture ?? [];
  const ids = entries.map((e) => e.id);
  dispatch({
    type: 'set',
    patch: {
      sourcePanes: ids,
      // Keep the tab valid: an imported project may name panes differently.
      ...(ids.length > 0 && !ids.includes(st.sourceTab) ? { sourceTab: ids[0] } : {}),
    },
  });
  for (const pin of entries) {
    store
      .readSourceBook(localSourceRepo(pin), code)
      .then(({ usfm: srcRaw }) => {
        if (seq !== openSeqRef.current) return;
        dispatch({
          type: 'setSource',
          id: pin.id,
          value: { raw: srcRaw, chapters: parseChapters(srcRaw), version: pin.version ?? null },
        });
      })
      .catch((error) => {
        if (seq !== openSeqRef.current) return;
        dispatch({
          type: 'setSource',
          id: pin.id,
          value: isNotFoundError(error) ? 'missing' : { error: String(error?.message || error) },
        });
      });
  }
}

/** Test hook (round 37): pane resolution is unit-tested — project pins win,
 * absence is a stated state, and pins-loading defers. */
export const __loadSourcePanesForTests = loadSourcePanes;

/** Round 37 (§5.3): seed a new book from the PROJECT's pinned source. A
 * project without extraScripture — or a source that confirms it lacks the
 * book / is structurally unseedable — keeps the SERVER SKELETON (the
 * documented state, issue #62), never the machine suite's text. A transient
 * read failure PROPAGATES (D30 sweep): journaling an unchunked skeleton is
 * permanent (§8.5 grow-only). */
async function seedInitialUsfm({ store, stateRef, code, projName }) {
  const seedPin = stateRef.current.projectPins?.extraScripture?.[0];
  if (!seedPin) return undefined;
  try {
    const src = await store.readSourceBook(localSourceRepo(seedPin), code);
    return seedBookFromSource(src.usfm, {
      bookCode: code,
      bookName: bookName(code),
      projectName: projName,
    });
  } catch (error) {
    if (!isNotFoundError(error) && !error?.seedUnusable) throw error;
    return undefined;
  }
}

function loadProjectPins({ store, repoPath, storeRef, stateRef, actions, dispatch }) {
  const stillCurrent = () =>
    storeRef.current === store && stateRef.current.project?.repoPath === repoPath;
  store.readResources()
    .then(async (pins) => {
      if (!stillCurrent()) return;
      dispatch({ type: 'set', patch: { projectPins: pins, projectPinsLoaded: true, projectPinsError: null } });
      // Round 37: the source panes are pin-driven — resolve them now that
      // the pins are known (openBook deferred while they were loading). The
      // document is handed over DIRECTLY: the dispatch above has not
      // rendered yet, so stateRef still holds the old pins.
      actions.reloadSourcePanes?.(pins);
      if (!pins) return;
      try {
        const { installed, coverage } = await actions.resolutionContext();
        const adopted = adoptInstalledResources(pins, installed);
        const wouldChange = backfillCoverage(adopted, coverage).changed || adopted !== pins;
        if (!wouldChange) return;
        const next = await updateResources(store, (current) =>
          backfillCoverage(adoptInstalledResources(current, installed), coverage).resources,
        );
        if (stillCurrent()) dispatch({ type: 'set', patch: { projectPins: next } });
      } catch {
        // Coverage stays underived; the resolver falls back to warning.
      }
    })
    .catch((error) => {
      // Round 34: a REJECTED pins read is not "no pins recorded" — reporting
      // it as loaded-but-absent told the translator the package lacks the
      // helps (a false absence claim, D30). It is a stated, retryable error;
      // understand keeps waiting rather than resolving every slot to none.
      if (stillCurrent())
        dispatch({
          type: 'set',
          patch: { projectPins: null, projectPinsLoaded: false, projectPinsError: String(error?.message || error) },
        });
    });
}

/** Catch-to-absence sweep (D30): one article read, failure STATED — never a
 * false "article missing" (the callers render error and found distinctly). */
async function settleArticleRead(apiClient, kind, sets, category, slug) {
  try {
    return { found: await readHelpArticle(apiClient, kind, sets, category, slug), error: null };
  } catch (error) {
    return { found: null, error: String(error?.message || error) };
  }
}

/** Test hook (round 34): the pins-read outcomes are unit-tested — resolved
 * null is loaded-but-absent; a rejection is a stated, retryable error. */
export const __loadProjectPinsForTests = loadProjectPins;

/** The loading-flag patch for a (re)load: a SAME-BOOK refresh keeps the
 * screen's working surface standing (P1); a different book starts clean. */
function understandLoadingPatch(prevU, book) {
  return { understand: { ...(prevU && prevU.book === book ? prevU : {}), loading: true } };
}

/** The failure patch (A3/S3): comprehension rides along only when same-frame
 * was CONFIRMED before the throw; otherwise cross-frame mode with zero refs
 * and disabled boxes — never an eng-numbered guess. */
function understandFailurePatch({ safeSameFrame, error, comprehension, book }) {
  const message = String(error?.message || error);
  return {
    understand: safeSameFrame
      ? { loading: false, error: message, comprehension }
      : { loading: false, error: message, book, comprehension: null, sourceRefs: {} },
  };
}

function latestComprehension(store, book, frame) {
  if (frame.state !== 'ready') return null;
  const built = {};
  for (const note of store?.readNotes?.(book) ?? []) {
    const key = `${note.chapter}:${note.verse}`;
    const previous = built[key];
    if (!previous || String(note.ts) > String(previous.ts))
      built[key] = { text: note.text, ts: note.ts };
  }
  return built;
}

async function mappedSourceReferences(st, book, frame) {
  // null = CONFIRMED same-frame (ready + eng): only then may the view index
  // the eng source with project numbers. Everything else — a known non-eng
  // frame, an unavailable one, an unknown one — is cross-frame mode; with no
  // usable mapping it returns {} (zero refs: the passage is SUPPRESSED, never
  // guessed) (S3, adversarial round 19; completes the round-18 finding).
  if (frame.state === 'ready' && frame.name === RESOURCE_FRAME) return null;
  if (frame.state !== 'ready') return {};
  const sourceRefs = {};
  for (const entry of indexBook(st.bookRaw ?? '')) {
    const list = (sourceRefs[String(entry.chapter)] ??= []);
    const mapped = await mapReference({
      from: frame.name,
      to: RESOURCE_FRAME,
      book,
      chapter: Number(entry.chapter),
      verse: /^\d+$/.test(String(entry.verseKey)) ? Number(entry.verseKey) : String(entry.verseKey),
      schemes: frame.schemes,
    });
    if (mapped.ok && mapped.reference.book.toUpperCase() !== book.toUpperCase())
      // Round 36: a cross-BOOK mapping (LXX EZR 11 -> eng NEH 1) must never
      // render THIS book's source at those numbers — that displays unrelated
      // scripture under a box that journals permanently. Stated, like the
      // unmapped case (owner precedent: round-32 stated limitation), until
      // cross-book source loading exists (#119).
      list.push({
        crossBook: `${entry.chapter}:${entry.verseKey}`,
        to: `${mapped.reference.book.toUpperCase()} ${mapped.reference.chapter}:${mapped.reference.verse}`,
      });
    else if (mapped.ok)
      list.push({
        c: mapped.reference.chapter,
        v: String(mapped.reference.verse),
        pc: entry.chapter,
        pv: String(entry.verseKey),
      });
    else list.push({ unmapped: `${entry.chapter}:${entry.verseKey}` });
  }
  return sourceRefs;
}

/** Test hook (round 36): cross-BOOK mappings are stated, never rendered as
 * this book's text at foreign numbers. */
export const __mappedSourceReferencesForTests = mappedSourceReferences;

function unavailableHelpSlot(st, resolved, sets, slot, installed) {
  if (!resolved.pin) {
    const anyPin = sets.primary?.[slot] ?? sets.fallback?.[slot];
    if (anyPin && !isPinLocal(installed, anyPin))
      return { state: st.netEnabled ? 'fetch' : 'unavailable', pin: anyPin };
    return { state: 'none' };
  }
  if (!isPinLocal(installed, resolved.pin))
    return {
      state: st.netEnabled ? 'fetch' : 'unavailable',
      pin: resolved.pin,
      rung: resolved.rung,
    };
  return null;
}

async function loadUnderstandSlot({
  apiClient,
  st,
  book,
  coverage,
  installed,
  frame,
  scopeRanges,
  sets,
  slot,
  tool,
  deriveOpts = {},
}) {
  const resolved = resolveSetSlot(st.projectPins, slot, book, coverage);
  const unavailable = unavailableHelpSlot(st, resolved, sets, slot, installed);
  if (unavailable) return unavailable;
  const primaryPin = sets.primary?.[slot];
  const unavailablePrimary =
    resolved.rung === 'fallback' && primaryPin && !isPinLocal(installed, primaryPin)
      ? primaryPin
      : null;
  const tsv = await readTextIngredient(
    apiClient,
    resolveReadPath(resolved.pin),
    `${book.toUpperCase()}.tsv`,
  );
  if (tsv === null || tsv.startsWith('{"is_good":false'))
    return { state: 'missing', pin: resolved.pin, rung: resolved.rung };
  if (frame.state !== 'ready') return { state: `versification-${frame.state}` };
  const { items, unplaceable } = await deriveForProject({
    tsv,
    tool,
    bookId: book.toLowerCase(),
    from: RESOURCE_FRAME,
    to: frame.name,
    schemes: frame.schemes,
    scopeRanges,
    ...deriveOpts,
  });
  return {
    state: 'ready',
    items,
    pin: resolved.pin,
    rung: resolved.rung,
    unavailablePrimary,
    dropped: unplaceable.length ? { count: unplaceable.length, scheme: frame.name } : null,
  };
}

async function loadSimplifiedHelp({ store, st, book, coverage, installed, sets }) {
  const resolved = resolveSetSlot(st.projectPins, 'simplifiedText', book, coverage);
  const pin = resolved.pin ?? sets.primary?.simplifiedText ?? sets.fallback?.simplifiedText;
  if (!pin) return { state: 'none' };
  if (!isPinLocal(installed, pin))
    return { state: st.netEnabled ? 'fetch' : 'unavailable', pin, rung: resolved.rung };
  // Round 36: the D41 warned fallback applies to the simplified text like
  // every other slot — English simplified text must never pass silently as
  // the project's primary gateway language.
  const primaryPin = sets.primary?.simplifiedText;
  const unavailablePrimary =
    resolved.rung === 'fallback' && primaryPin && !isPinLocal(installed, primaryPin)
      ? primaryPin
      : null;
  try {
    const { usfm: raw } = await store.readSourceBook(localSourceRepo(pin), book);
    return { state: 'ready', pin, rung: resolved.rung, unavailablePrimary, chapters: parseChapters(raw) };
  } catch (error) {
    // Round 31: absent book = missing; anything else (transport, parse)
    // propagates to settleHelp's stated error (D30 honesty).
    if (isNotFoundError(error)) return { state: 'missing', pin, rung: resolved.rung };
    throw error;
  }
}

/** Test hook (round 31): the missing-vs-error split is unit-tested — only a
 * true not-found reads as absence; transport failures propagate to the
 * stated, retryable error state. */
export const __helpReadsForTests = { readTextIngredient, loadSimplifiedHelp, readHelpArticle };

const settleHelp = (promise) =>
  promise.then(
    (value) => value,
    (error) => ({ state: 'error', error: String(error?.message || error) }),
  );

/** D65 (round-22 checkpoint): comprehension notes ride their OWN
 * SaveScheduler — one write path, one dirty/drain/indicator discipline, the
 * same one verses use. The scheduler key is the fully-scoped note identity
 * `repoPath|book|chapter:verse` (C2/F2); the buffer is a per-key latest-value
 * register, so a retry structurally replays only the NEWEST text (the round-21
 * class cannot exist), and the buffer itself is the draft store across
 * unmounts (the round-22 class cannot exist). Notes and verses do NOT share
 * an instance: the scheduler's failure slot is global, and a failing note
 * must not park verse autosave. */
export const noteKeyFor = (repoPath, book, chapter, verse) =>
  `${repoPath}|${book}|${chapter}:${verse}`;

/** The note scheduler's write function. The target registry carries what the
 * key alone cannot: the box's original (pre-mapping) reference and whether it
 * is already a verbatim PROJECT reference (I1/J2: cross-frame boxes save
 * their exact project ref and skip mapping). Same-frame saves resolve the
 * project frame and map at write time; an unmappable target THROWS so the
 * scheduler retains the buffer and shows the error (FR-32) — the §8.5 journal
 * never receives a guessed reference. On success the persisted text is echoed
 * through the noteSaved reducer action (S1 atomic merge). */
function makeNoteWriter({ noteTargetsRef, dispatch, apiClient }) {
  // The last text THIS writer journaled per key — what is durably at the
  // head. A refusal reports it back (round 24) so the scheduler's buffer
  // never records a refused snapshot as saved.
  const lastWritten = new Map();
  return async (key, text) => {
    // Round 23/24: G1's clear refusal must hold at the WRITE boundary too. A
    // race can leave an empty value dirty (clear a fresh note while its
    // first write is in flight: `persisted` advances to the in-flight text,
    // making the staged '' diverge) — the grow-only journal must never
    // receive it. REPORT the durable value instead of writing: the scheduler
    // adopts it as persisted (and as current when nothing newer was staged),
    // so the box shows the durable note again and a retype of the same text
    // compares clean — never a blank box over a durable note, never a
    // duplicate append (round 24).
    if (text.trim() === '') return lastWritten.get(key) ?? '';
    const target = noteTargetsRef.current.get(key);
    if (!target) throw new Error(`comprehension note target unknown: ${key}`);
    const { store, repoPath, book, chapter, verse, projectFrame } = target;
    // C1: the write is bound to the store/project it was staged in — a
    // project switch drains this scheduler and disposes it first (C3).
    let ref = { chapter, verse };
    if (!projectFrame) {
      const frame = await resolveProjectFrame(repoPath, { store, api: apiClient });
      if (frame.state !== 'ready') throw new Error(t('understand.saveUnmappable'));
      if (frame.name !== RESOURCE_FRAME) {
        const mapped = await mapReference({
          from: RESOURCE_FRAME,
          to: frame.name,
          book,
          chapter: Number(chapter),
          verse: /^\d+$/.test(String(verse)) ? Number(verse) : String(verse),
          schemes: frame.schemes,
        });
        if (!mapped.ok) throw new Error(t('understand.saveUnmappable'));
        ref = { chapter: mapped.reference.chapter, verse: mapped.reference.verse };
      }
    }
    await store.addNote(book, ref.chapter, ref.verse, text.trim());
    lastWritten.set(key, text.trim());
    dispatch({
      type: 'noteSaved',
      repoPath,
      book,
      key: `${chapter}:${verse}`,
      text: text.trim(),
      ts: `local-${Date.now()}`,
    });
  };
}

/** Test hook (D65): the note writer is unit-tested — frame mapping, the
 * unmappable refusal, and the persisted-text echo. */
export const __makeNoteWriterForTests = makeNoteWriter;

export function AppProvider({ children }) {
  const [s, dispatch] = useReducer(reducer, undefined, initial);
  const storeRef = useRef(null);
  const schedulerRef = useRef(null);
  const rawRef = useRef(null); // authoritative raw book text, updated synchronously
  const stateRef = useRef(null); // live state for async closures
  const openSeqRef = useRef(0); // openBook sequence token (review finding M2)
  const understandSeqRef = useRef(0); // loadUnderstand sequence token (2026-08-27 Codex review)
  // D65 (round-22 checkpoint): the comprehension-note SaveScheduler and the
  // registry mapping each note key to its write target. The scheduler's
  // buffer IS the draft store (survives unmounts) and its state IS the
  // dirty/saving/error truth the guards consult — the old parallel refs
  // (ledger, revisions, chains, in-flight counts, dirty set) are gone with
  // the defect classes they bred.
  const noteSchedulerRef = useRef(null);
  const noteTargetsRef = useRef(new Map());
  const openProjectSeqRef = useRef(0); // openProject sequence token (round 25): the latest open owns the refs
  const articleSeqRef = useRef(0); // help-article completion token (D3, adversarial round 4)

  // ---- derived display model -------------------------------------------------
  const model = useMemo(() => {
    if (!s.project || !s.book || s.bookRaw == null) return { book: null, progress: {} };
    const chapters = parseChapters(s.bookRaw);
    const entries = indexBook(s.bookRaw);
    const byChapter = {};
    for (const e of entries) {
      const body = s.bookRaw.slice(e.start, e.end).trim();
      const drafted = body !== '' && body !== '___';
      (byChapter[e.chapter] ||= []).push({
        n: e.verseKey,
        drafted,
        text: drafted ? verseText(chapters[e.chapter]?.[e.verseKey]) : '',
        body: drafted ? body : '',
      });
    }
    const chapterNums = Object.keys(byChapter)
      .map(Number)
      .sort((a, b) => a - b);
    const draftPct = entries.length
      ? Math.round(
          (entries.filter((e) => {
            const b = s.bookRaw.slice(e.start, e.end).trim();
            return b !== '' && b !== '___';
          }).length /
            entries.length) *
            100,
        )
      : 0;
    return { book: { code: s.book, byChapter, chapterNums, draftPct }, progress: {} };
  }, [s.project, s.book, s.bookRaw, s.tick]);

  const sourceModel = useMemo(() => {
    const src = s.sources[s.sourceTab];
    if (!src || src === 'missing') return src || null;
    return src.chapters;
  }, [s.sources, s.sourceTab]);

  // ---- boot: project list ----------------------------------------------------
  useEffect(() => {
    refreshProjects();
    // The platform's net gate drives the D30.4/D30.5 split (fetch vs
    // first-class unavailable), so it must be known from startup — not only
    // once the source-texts modal happens to open.
    api.getNetEnabled()
      .then((netEnabled) => dispatch({ type: 'set', patch: { netEnabled } }))
      .catch(() => dispatch({ type: 'set', patch: { netEnabled: false } }));
  }, []);

  // Silent-loss guard (review finding M5): warn before the window closes with
  // unsaved work, and attempt a best-effort flush when the page hides.
  useEffect(() => {
    const beforeUnload = (e) => {
      // Comprehension notes are project work too (A4): both schedulers must
      // be at rest before the window may close silently (D65 — the note
      // scheduler now carries what the old refs tracked).
      const unsaved = [schedulerRef.current, noteSchedulerRef.current].some(
        (sched) => sched && sched.getState() !== 'saved',
      );
      if (unsaved) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const onHide = () => {
      void schedulerRef.current?.drain();
      void noteSchedulerRef.current?.drain();
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  // Most-recently-USED ordering (owner, 2026-07-31; creation counts as use).
  // "Use" is user-machine state, so it lives in the platform's per-client
  // settings (0.18.4 endpoint, inside the D31 pin) — never in the project
  // (Phase-2 sync must not carry my open times) and never in localStorage.
  async function markUsed(repoPath) {
    try {
      const cs = await api.getClientSettings(STORAGE_ID);
      const lastUsed = { ...(cs.lastUsed || {}), [repoPath]: Date.now() };
      await api.setClientSettings(STORAGE_ID, { ...cs, lastUsed });
    } catch {
      /* rig without storage_id.json — ordering falls back to creation date */
    }
  }

  async function refreshProjects() {
    try {
      const reader = new ProjectReader({ api });
      const projects = await reader.listProjects();
      let lastUsed = {};
      try {
        lastUsed = (await api.getClientSettings(STORAGE_ID)).lastUsed || {};
      } catch {
        /* fall back to creation-date order from listProjects */
      }
      projects.sort(
        (a, b) =>
          Math.max(lastUsed[b.id] || 0, b.timestamp || 0) -
          Math.max(lastUsed[a.id] || 0, a.timestamp || 0),
      );
      // Review of the D30 sweep: a successful listing clears the LISTING
      // failure's banner (projects was null) — an open-failure banner from
      // performProjectOpen is left alone (projects was already an array).
      dispatch({
        type: 'set',
        patch: { projects, ...(stateRef.current.projects === null ? { bookError: null } : {}) },
      });
    } catch (e) {
      // Catch-to-absence sweep (D30): projects stays null (unknown), so the
      // "No projects yet — Select New Bible" empty state never renders over
      // a failed listing; the error banner + Retry state it instead.
      dispatch({ type: 'set', patch: { projects: null, bookError: String(e) } });
    }
  }

  // ---- actions ----------------------------------------------------------------
  const actions = useMemo(() => {
    const a = {
      go: async (view) => {
        // B1/D65: navigation drains the note scheduler — flush-and-go (owner
        // ruling 2026-08-28), and a FAILED write holds navigation exactly
        // like the verse scheduler does (FR-32). The failure is visible in
        // the Understand callout and the save indicator.
        if (noteSchedulerRef.current && !(await noteSchedulerRef.current.drain())) return;
        dispatch({ type: 'set', patch: { view } });
      },

      closeModal: () => dispatch({ type: 'set', patch: { modal: null, np: null, ab: null, st: null } }),

      // ---- Source texts (J3): book packages from Door43 ----
      // The platform has no catalog-wide search (0.18.5), so the org comes from
      // data/gateways.ts; EVERY version / coverage / flavor shown is live.
      sourceGateways: () => GATEWAYS.map((g) => ({ ...g, key: gatewayKey(g) })),

      installedCountFor: (g) => {
        const key = gatewayKey(g);
        return stateRef.current.installedSrc.filter((x) => x.langKey === key).length;
      },

      openSources: async () => {
        dispatch({ type: 'set', patch: { modal: 'sources' } });
        await Promise.all([a.refreshNet(), a.refreshCheckable()]);
      },

      /** Which gateway languages this machine can actually CHECK in — i.e. a
       * complete tn+tw+tA suite is installed (§5.3: a language set must be
       * coherent, so a partial suite is never offered). Recomputed rather than
       * assumed, because resources arrive by download, by rig seed, and by hand
       * sideload. */
      refreshCheckable: async () => {
        const { installed, resolutionError } = await a.resolutionContext();
        if (resolutionError) {
          // Catch-to-absence sweep (D30): an identity-read outage must not
          // present as "this machine can check in no language" — keep the
          // previous list standing and state the error.
          dispatch({ type: 'set', patch: { checkableError: resolutionError } });
          return stateRef.current.checkable;
        }
        const checkable = GATEWAYS.filter((g) => languageSetFromInstalled(installed, g))
          .map(gatewayKey);
        dispatch({ type: 'set', patch: { checkable: [...new Set(checkable)], checkableError: null } });
        return checkable;
      },

      refreshNet: async () => {
        try {
          dispatch({ type: 'set', patch: { netEnabled: await api.getNetEnabled() } });
        } catch {
          dispatch({ type: 'set', patch: { netEnabled: false } });
        }
      },

      /** Going online is the USER's action — never a side effect of opening a
       * screen (the platform boots net-disabled by design). */
      goOnline: async () => {
        try {
          await api.enableNet();
        } catch { /* surfaced by the refresh below staying false */ }
        await a.refreshNet();
        const g = stateRef.current.src.gateway;
        if (g) await a.loadPackage(g, stateRef.current.src.book);
      },

      pickGateway: async (g) => {
        dispatch({ type: 'patchSrc', patch: { gateway: g, dl: null } });
        await a.loadPackage(g, stateRef.current.src.book);
      },

      changeGateway: () => dispatch({
        type: 'patchSrc',
        patch: { gateway: null, rows: [], error: null, dl: null },
      }),

      setSourceBook: async (book) => {
        const src = stateRef.current.src;
        dispatch({ type: 'patchSrc', patch: { book, dl: null } });
        if (src.gateway) await a.loadPackage(src.gateway, book);
      },

      /** Ask the platform for the org's repos and build the package rows for
       * ONE book. Coverage is the catalog's own `book_codes` — no TSV scan. */
      loadPackage: async (g, book) => {
        dispatch({ type: 'patchSrc', patch: { loading: true, error: null, rows: [] } });
        try {
          const repos = await api.remoteRepos(DCS_HOST, g.org);
          const rows = packageRows(repos, book, stateRef.current.src.exclude);
          dispatch({ type: 'patchSrc', patch: { loading: false, rows } });
        } catch (e) {
          dispatch({
            type: 'patchSrc',
            patch: {
              loading: false,
              rows: [],
              error: t('sources.catalogError', { reason: String(e?.message || e) }),
            },
          });
        }
      },

      toggleSourceRow: (k) => {
        const src = stateRef.current.src;
        const exclude = { ...src.exclude, [k]: !src.exclude[k] };
        dispatch({
          type: 'patchSrc',
          patch: {
            exclude, dl: null,
            rows: src.rows.map((r) => (r.k === k ? { ...r, on: !exclude[k] } : r)),
          },
        });
      },

      /** Count what a gateway-language change would cost, BEFORE committing.
       * §5 default #2 (D23a) / D30.2: the change is explicit and the app shows
       * the consequences — so the user can decline. Partial coverage needs no
       * change at all (the ladder resolves per book), so this is only ever
       * reached from a deliberate settings action. */
      previewGatewayChange: async (gateway) => {
        const store = storeRef.current;
        const st = stateRef.current;
        if (!store || !st.project) throw new Error('no project is open');
        // Recorded installs PLUS what is simply on disk — the same picture the
        // readiness check uses. Reading only the record made a seeded or
        // hand-sideloaded suite invisible, so a language the app had just
        // offered could not be pinned.
        const { installed, coverage, resolutionError } = await a.resolutionContext();
        // Catch-to-absence sweep (D30): an identity-read outage must not be
        // reported as "the suite is incomplete" for a complete suite — throw
        // the outage itself (askGatewayChange states it as gatewayError).
        if (resolutionError) throw new Error(resolutionError);
        const proposedPrimary = languageSetFromInstalled(installed, gateway);
        if (!proposedPrimary) throw new Error(t('sources.suiteIncomplete', { lang: gateway.name }));
        const { value: currentResources, md5: resourcesMd5 } = await store.readResourcesWithMd5();
        const current = currentResources ?? INSTALLED_SUITE;
        const next = backfillCoverage(applyGatewayChange(current, proposedPrimary), coverage).resources;
        const primary = next.languageSets.primary;

        // Read every stored decision file this project has, so the count is
        // real rather than estimated.
        const { stored, md5s } = await storedGatewayDecisions(store, st.project.bookCodes ?? []);
        // Affectedness is judged against the POST-CHANGE resolution (D30's
        // per-(tool, book) ladder), so the counting needs the coverage map.
        const consequences = consequencesOfGatewayChange(
          stored,
          { primary, fallback: next.languageSets.fallback ?? primary },
          coverage,
        );

        // The resource is the primary key (tC3 precedent, 2026-08-04): the
        // check list derived from the NEW resource is the work. Compute that
        // list HERE, so the dialogue states the exact outcome — how many
        // decisions carry over and how many checks come back — instead of a
        // count "at risk". The new suite is installed (languageSetFromInstalled
        // proved it), so every derive below reads local bytes.
        // An affected book NEITHER rung covers after the change BLOCKS it
        // (official review round 7): writing its file would leave a §5.2
        // record matching no rung — a state the conformance rules forbid —
        // and there is no ratified unresolved state for pins to move it to.
        // The dialogue names the books; confirm is refused while any exist.
        //
        // The plan below is COMMITTED verbatim (each entry's `file` is
        // journaled by applyGatewayChange), so it must be derived in the
        // project's real frame. A frame that cannot map (unavailable/unknown)
        // would derive eng-framed identities and journal them permanently —
        // wrongful invalidations included — so a not-ready frame blocks every
        // affected book, the same refusal openCheckTool makes. A change with
        // no affected decisions carries no plan and stays safe regardless.
        // A frame-blocked entry carries WHY (`reason`), because the remedy
        // differs: a coverage block is fixed by installing a suite, a
        // versification block by reconnecting (unavailable) or recording the
        // scheme (unknown) — telling an offline user to install a suite
        // cannot unblock them. Coverage-blocked entries carry no reason.
        const frame = await a.projectFrame();
        const initiallyBlocked = frame.state === 'ready'
          ? uncoveredByChange(consequences.affected, next, coverage)
          : consequences.affected.map((entry) => ({
              tool: entry.tool,
              book: entry.book,
              reason: `versification-${frame.state}`,
            }));
        const { plan, blocked } = await gatewayChangePlan({
          consequences,
          next,
          coverage,
          installed,
          stored,
          md5s,
          actions: a,
          blocked: initiallyBlocked,
        });
        const carried = plan.reduce((n, p) => n + p.carried, 0);
        const invalidated = plan.reduce((n, p) => n + p.invalidated, 0);
        return { gateway, primary, consequences, next, plan, blocked, carried, invalidated, resourcesMd5 };
      },

      /** Derive one book's check list from a given pin. Returns [] when the
       * pinned resource says nothing about the book — a designed state (C2.9),
       * not an error. Derived lists are disposable and never stored (§4.2). */
      deriveItemsFor: async (tool, book, pin) => {
        const localRepo = resolveReadPath(pin);
        let tsv;
        // Catch-to-absence sweep (D30): [] means the resource CONFIRMS it
        // says nothing about this book (C2.9). A transient read failure must
        // PROPAGATE — during a gateway change, [] flows into
        // carryOverDecisions and permanently journals every stored decision
        // as invalidated; the callers' stated error paths (gatewayError,
        // checkSession.error) are the honest destination.
        try {
          tsv = await api.readIngredient(localRepo, `${book.toUpperCase()}.tsv`);
        } catch (error) {
          if (isNotFoundError(error)) return [];
          throw error;
        }
        if (tsv === null || tsv.startsWith('{"is_good":false')) return [];
        // §4.2 (D26): derivation MUST filter to the project scope — an out-of-scope
        // item is never derived, counted or shown. `[]` = whole book.
        const ranges = scopeRangesFor(stateRef.current.projectScope ?? {}, book.toUpperCase());
        // #15: map into the project's versification frame BEFORE scope filtering.
        // An eng project (the default, and the whole resource suite's frame)
        // short-circuits inside deriveForProject and is byte-identical to the
        // old unmapped path.
        const frame = await a.projectFrame();
        // R-E33-8 (amended): the gateway-change plan is committed verbatim, so
        // previewGatewayChange BLOCKS every affected book while the frame is
        // not ready — this path is only reached with a ready frame. A silent
        // eng fallback here would derive eng-framed identities for a non-eng
        // project, and the caller journals them permanently. Refuse loudly so
        // any future caller fails instead of corrupting the journal.
        if (frame.state !== 'ready') {
          throw new Error(
            `deriveItemsFor: versification frame is '${frame.state}', not ready (R-E33-8)`,
          );
        }
        const to = frame.name;
        const { items } = await deriveForProject({
          tsv,
          tool,
          bookId: book.toLowerCase(),
          from: RESOURCE_FRAME,
          to,
          schemes: frame.schemes,
          scopeRanges: ranges,
        });
        return items;
      },

      /** Open the confirmation dialogue for a proposed gateway language. */
      askGatewayChange: async (gateway) => {
        // Catch-to-absence sweep (D30): the preview now PROPAGATES transient
        // read failures (deriveItemsFor / readDecisionsText) instead of
        // understating consequences — state them in the dialogue's error.
        let preview;
        try {
          preview = await a.previewGatewayChange(gateway);
        } catch (error) {
          dispatch({ type: 'set', patch: { gatewayError: String(error?.message || error) } });
          return null;
        }
        const current = stateRef.current.projectPins?.languageSets?.primary?.gatewayLanguage;
        dispatch({
          type: 'set',
          patch: { gatewayPreview: { ...preview, currentName: current?.languageId } },
        });
        return preview;
      },

      cancelGatewayChange: () =>
        dispatch({ type: 'set', patch: { gatewayPreview: null, gatewayError: null } }),

      confirmGatewayChange: async (preview) => {
        // A failed commit must stay VISIBLE: the dialogue used to swallow the
        // rejection, leaving an open dialogue that ignored its confirm button
        // (found 2026-08-22, rig journey run).
        dispatch({ type: 'set', patch: { gatewayError: null } });
        // Defense in depth for the round-7 block: never trust the disabled
        // button alone — a blocked change is refused here too.
        if (preview?.blocked?.length) {
          dispatch({
            type: 'set',
            patch: { gatewayError: t('gateway.blockedError', { books: preview.blocked.map((b) => b.book).join(', ') }) },
          });
          return;
        }
        try {
          await a.commitGatewayChange(preview);
        } catch (e) {
          dispatch({ type: 'set', patch: { gatewayError: e?.reason || e?.message || String(e) } });
          return;
        }
        dispatch({ type: 'set', patch: { gatewayPreview: null, gatewayError: null } });
      },

      /** Commit a previewed change. Takes the preview so the user confirms
       * exactly what was described to them, not a re-derived guess — including
       * the per-book carry-over already computed there.
       *
       * The change is ONE coordinated journal action (issue #62): the store
       * validates every precondition (resources.json and EVERY planned decision
       * file must still hash to what the preview read), computes the complete
       * multi-event action across all affected decision records and resource
       * pins, publishes it once, and regenerates the derived files from the
       * fold. Published decision events are permanent, so a post-publication
       * failure recovers FORWARD on the next open — the pre-#62 byte-rollback
       * path is retired from this flow (test/noBypass.test.ts enforces it). */
      commitGatewayChange: async (preview) => {
        const store = storeRef.current;
        if (!store) throw new Error('no project is open');
        await store.applyGatewayChange({
          resources: preview.next,
          resourcesMd5: preview.resourcesMd5 ?? null,
          decisions: (preview.plan ?? []).map((p) => ({
            tool: p.tool,
            book: p.book,
            file: p.file,
            expectMd5: p.expectMd5 ?? null,
          })),
        });
        dispatch({ type: 'set', patch: { projectPins: preview.next } });
        if (stateRef.current.book) await a.runPreflight();
        return preview.next;
      },

      /** Set (or change) the project's gateway language — an explicit,
       * whole-project action (D30.2), never a per-book or per-user preference
       * (D30.3). Writes `languageSets.primary` from the pins this machine has
       * actually installed; the `fallback` rung stays the installed English
       * suite. Refuses when the org's suite is incomplete: a language set must
       * be coherent (§5.3), so a partial suite is never pinned. */
      setProjectGateway: async (gateway) => {
        const store = storeRef.current;
        if (!store) throw new Error('no project is open');
        const { installed, coverage, resolutionError } = await a.resolutionContext();
        // Review of the D30 sweep: an identity-read outage must not report a
        // complete suite as incomplete (mirrors previewGatewayChange).
        if (resolutionError) throw new Error(resolutionError);
        const primary = languageSetFromInstalled(installed, gateway);
        if (!primary) {
          throw new Error(t('sources.suiteIncomplete', { lang: gateway.name }));
        }
        const next = await updateResources(
          store,
          (current) =>
            backfillCoverage(
              {
                ...current,
                schemaVersion: 2,
                languageSets: { ...current.languageSets, primary },
              },
              coverage,
            ).resources,
        );
        dispatch({ type: 'set', patch: { projectPins: next } });
        return next;
      },

      /** C2.2 — run the session preflight for the open book, one verdict per
       * tool. Pure read: it never fetches or changes anything. */
      runPreflight: async () => {
        const st = stateRef.current;
        if (!st.book) return;
        const { installed, coverage, resolutionError } = await a.resolutionContext();
        if (resolutionError) {
          // Catch-to-absence sweep (D30): an identity-read outage must not
          // present every tool as 'unavailable'/'unpinned' — state it,
          // retryable (the preflight re-runs on the next visit or retry).
          dispatch({ type: 'set', patch: { preflight: null, preflightError: resolutionError } });
          return null;
        }
        const online = st.netEnabled;
        const out = {};
        for (const tool of Object.keys(TOOL_SLOT)) {
          out[tool] = preflightToolBook(st.projectPins, tool, st.book, {
            coverage,
            isLocal: (pin) => isPinLocal(installed, pin),
            online,
          });
        }
        dispatch({ type: 'set', patch: { preflight: out, preflightError: null } });
        return out;
      },

      // ---- Align (C2.11, J5) --------------------------------------------
      /** Open the alignment surface for one verse. Reads the ORIGINAL-language
       * text from the project's pinned originalLanguage resource, and the draft
       * from the open book, then loads the stored §5.1 record or bootstraps a
       * fresh one. Unavailability is a designed state, never an error. */
      openAlign: async () => {
        const st = stateRef.current;
        const store = storeRef.current;
        if (!st.book || !store) return;
        // Session identity (PR #135 review round 1): rapid rail selection
        // starts overlapping opens — only the LATEST one may dispatch, or a
        // slower stale load would display (and then edit) the wrong verse.
        const seq = ++alignSessionSeq;
        // The seq travels ON the session too: persistAlign's success and
        // failure dispatches check it, so a completion from a replaced
        // session can never overwrite a newer one (review round 2).
        const settle = (alignSession) => {
          if (seq === alignSessionSeq) dispatch({ type: 'set', patch: { alignSession: { ...alignSession, seq } } });
        };
        const ref = st.alignVerse ?? firstDraftedRef(st.bookRaw);
        if (!ref) return settle({ unavailable: 'undrafted' });
        settle({ loading: true });
        // Catch-to-absence sweep review: the try covers the WHOLE load —
        // frame resolution, reference mapping, and the stored-record read
        // can all reject transiently, and each used to strand the surface
        // at {loading:true} with an unhandled rejection. Any failure is a
        // stated, retryable error — never the 'missing' download prompt.
        try {
        // Read AFTER every queued write lands (review round 2): reopening a
        // verse whose write is still in flight must load the written record,
        // not the stale file. The queue never rejects.
        await alignWriteQueue;
        const source = await prepareAlignmentSource(store, st, ref);
        if (source.unavailable) return settle({ unavailable: source.unavailable });
        const frame = await a.projectFrame();
        if (frame.state !== 'ready') return settle({ unavailable: `versification-${frame.state}` });
        const [chapter, verse] = ref.split(':');
        const srcRef = await mapReference({
          from: frame.name,
          to: RESOURCE_FRAME,
          book: st.book,
          chapter: Number(chapter),
          verse,
          schemes: frame.schemes,
        });
        if (!srcRef.ok || String(srcRef.reference.verse).includes('-')) {
          return settle({ unavailable: 'no-counterpart' });
        }
        const origObjects = verseObjectsFor(
          source.usfmText,
          srcRef.reference.chapter,
          srcRef.reference.verse,
        );
        if (origObjects === null) {
          // The text is present but unparseable — say that (D30).
          return settle({ unavailable: 'unreadable' });
        }
        const mapped = { chapter, verse, reference: srcRef.reference };
        const session = await buildAlignmentSession(store, st, ref, source, mapped, origObjects);
        settle(session.unavailable ? session : { ...session, frameName: frame.name });
        } catch (error) {
          settle({ error: String(error?.message || error) });
        }
      },

      startAligning: () => {
        alignSessionSeq++;
        dispatch({ type: 'set', patch: { aligning: true, alignSession: null } });
      },

      closeAlign: () => {
        alignSessionSeq++; // invalidate in-flight opens and persist refreshes
        dispatch({ type: 'set', patch: { aligning: false, alignSession: null, alignVerse: null, alignIndex: null } });
      },

      /** #129: the align rail's per-verse item list — every verse of the open
       * book with its derived alignment status. Derived from the §5.1 sidecar
       * and the draft, never stored (§4.2). One read per call; the workspace
       * refreshes it on verse switch so rail dots track the edits. */
      loadAlignIndex: async () => {
        const st = stateRef.current;
        const store = storeRef.current;
        if (!st.book || !store || !st.bookRaw) return;
        // Only the latest read may land (PR #135 review round 1): the
        // workspace refires this on verse switches and completed edits, and
        // an older sidecar read finishing last would regress the rail dots.
        const seq = ++alignIndexSeq;
        const book = st.book;
        let alignIndex;
        try {
          await alignWriteQueue; // the rail must reflect every landed write
          const { value: file } = await store.readAlignmentsWithMd5(book);
          alignIndex = { items: alignIndexItems(st.bookRaw, file) };
        } catch (error) {
          // Catch-to-absence sweep (D30): a failed read is stated, retryable.
          alignIndex = { error: String(error?.message || error) };
        }
        const now = stateRef.current;
        if (seq !== alignIndexSeq || now.book !== book || !now.aligning) return;
        dispatch({ type: 'set', patch: { alignIndex } });
      },

      /** #129: the rail picks the verse; the session effect re-opens on it. */
      setAlignVerse: (ref) => {
        alignSessionSeq++; // the old verse's in-flight completions are foreign now
        dispatch({ type: 'set', patch: { alignVerse: ref, alignSession: null } });
      },

      /** Select (or clear) the banked word the next card click will place. */
      armAlignWord: (word) => {
        const a2 = stateRef.current.alignSession;
        if (a2) dispatch({ type: 'set', patch: { alignSession: { ...a2, armed: word } } });
      },

      /** #129 (PR #135 review round 1) — ONE path for every alignment edit.
       * The session record updates optimistically and synchronously, so each
       * successive edit builds on the previous one instead of a stale render
       * snapshot; the §5.1 writes are SERIALIZED through one queue, so two
       * rapid edits can never interleave their read-modify-write and clobber
       * each other or trip the compare-and-swap (#17). */
      applyAlignEdit: (mutate, disarm = false) => {
        const a2 = stateRef.current.alignSession;
        if (!a2?.record) return;
        const next = mutate(a2.record);
        if (next === a2.record) return;
        const optimistic = { ...a2, ...(disarm ? { armed: null } : {}), record: next };
        dispatch({ type: 'set', patch: { alignSession: optimistic } });
        // The STORE is bound at enqueue time (review round 2): a queued write
        // must land in the project it was made in, never in whichever store
        // happens to be current when the queue reaches it.
        const store = storeRef.current;
        alignWriteQueue = alignWriteQueue.then(() => a.persistAlign(optimistic, store));
      },

      placeAlignWord: (cardIndex) => {
        const armed = stateRef.current.alignSession?.armed;
        if (!armed) return;
        a.applyAlignEdit((record) => linkWord(record, cardIndex, armed), true);
      },

      unplaceAlignWord: (cardIndex, word) =>
        a.applyAlignEdit((record) => unlinkWord(record, cardIndex, word)),

      /** #129 drag-and-drop: place a banked word without the arm step. */
      placeAlignWordAt: (cardIndex, word) =>
        a.applyAlignEdit((record) => linkWord(record, cardIndex, word), true),

      /** #129 drag-and-drop: move a placed word between cards in one step. */
      moveAlignWord: (fromIndex, toIndex, word) =>
        a.applyAlignEdit((record) => moveWord(record, fromIndex, toIndex, word)),

      /** #129 phrase alignment: merge two ADJACENT cards / split a phrase. */
      mergeAlignCards: (fromIndex, toIndex) =>
        a.applyAlignEdit((record) => mergeAlignments(record, fromIndex, toIndex)),

      splitAlignCard: (cardIndex) =>
        a.applyAlignEdit((record) => splitAlignment(record, cardIndex)),

      /** Write the §5.1 sidecar under compare-and-swap (#17). The record is
       * re-stamped against the draft it was edited on (I-3). Never throws —
       * it runs on the serialized queue, where a rejection would wedge every
       * later write. A superseded write (the session already carries a newer
       * record) completes on disk but leaves the session refresh to its
       * successor; a failure is a stated, retryable session error unless the
       * user has already moved on. */
      persistAlign: async (session, boundStore) => {
        const store = boundStore ?? storeRef.current;
        const book = session.book;
        if (!store || !book) return;
        try {
          const record = stampTargetVerse(session.record, session.targetText);
          const { value: current, md5 } = await store.readAlignmentsWithMd5(book);
          await store.writeAlignments(book, alignFileWith(current, book, session.ref, record), md5);
          const after = await store.readAlignmentsWithMd5(book);
          const cur = stateRef.current.alignSession;
          if (cur?.seq === session.seq && cur.ref === session.ref && cur.record === session.record) {
            dispatch({
              type: 'set',
              patch: { alignSession: { ...cur, record, md5: after.md5, stale: false } },
            });
          }
        } catch (e) {
          // A failure surfaces ONLY on the session and record it belongs to
          // (review round 2): each queued write carries the verse's FULL
          // record, so a failed intermediate is superseded by its successor,
          // and a stale failure must never erase a newer session. The stated
          // error's retry reloads from disk — the un-persisted edit is
          // announced as lost, never silently kept as false UI state.
          const cur = stateRef.current.alignSession;
          if (cur?.seq === session.seq && cur.record === session.record) {
            dispatch({ type: 'set', patch: { alignSession: { error: String(e?.message || e), seq: session.seq } } });
          }
        }
      },

      /** C2.3/C2.4 — open a checking session for one tool on the open book.
       * Derives the check list from the RESOLVED pin's own TSV (never a
       * fixture), merges the stored §5.2 decisions, and reports progress.
       * Derived lists are disposable and never stored (§4.2). */
      openCheckTool: async (tool) => {
        const st = stateRef.current;
        const pre = st.preflight?.[tool];
        if (!pre || pre.state !== 'ready' || !pre.resolution?.pin) return;
        const book = st.book;
        // The seq is this session's identity, taken BEFORE any await: a stale
        // open's completion (or failure) must never replace a newer session,
        // and closing the tool or the project invalidates in-flight opens.
        const seq = ++checkSessionSeq;
        dispatch({ type: 'set', patch: { checkTool: tool, checkSession: { loading: true, seq } } });
        try {
          const { session, partial } = await assembleCheckSession({
            api, actions: a, store: storeRef.current, stateRef, st, tool, book, pre, seq,
          });
          if (seq !== checkSessionSeq) return; // a newer open or close won
          dispatch({ type: 'set', patch: { checkTool: tool, checkSession: session } });
          if (partial) return;
          a.loadActiveArticle(session);
          a.loadCheckOrigSource(session);
        } catch (e) {
          if (seq !== checkSessionSeq) return;
          dispatch({
            type: 'set',
            patch: { checkSession: { loading: false, error: String(e?.message || e), seq } },
          });
        }
      },

      closeCheckTool: () => {
        checkSessionSeq++; // invalidate any in-flight open or completion
        dispatch({ type: 'set', patch: { checkTool: null, checkSession: null } });
      },

      setCheckIndex: (activeIndex) => {
        const cs = stateRef.current.checkSession;
        if (!cs) return;
        // Reducer-side merge: a concurrently-landing orig/article result must
        // not be clobbered by this snapshot (patchCheckSession hazard note).
        dispatch({ type: 'patchCheckSession', seq: cs.seq, patch: { activeIndex } });
        a.loadActiveArticle({ ...cs, activeIndex });
      },

      /** C2.5 — the help article behind the active item, read from the
       * INSTALLED burrito. tW articles live in the same repo the links came
       * from (D34); a tN item's groupId is a tA module slug. A module the
       * pinned tA release does not carry reports absence rather than
       * rendering an empty panel. */
      // `session` is passed explicitly by callers that have just dispatched:
      // stateRef still holds the pre-render snapshot at that moment (the same
      // stale read-modify-write hazard the patchSrc reducer note describes).
      loadActiveArticle: async (session) => {
        const st = stateRef.current;
        const cs = session ?? st.checkSession;
        const item = cs?.items?.[cs.activeIndex];
        if (!item) return;
        const rung = cs.resource?.languageSet;
        const sets = st.projectPins?.languageSets?.[rung];
        const key = `${cs.tool}:${item.contextId.groupId}:${item.category}`;
        if (cs.article?.key === key && !cs.article.error) return;
        // Reducer-side merges (patchCheckSession): the orig-book read resolves
        // concurrently, and a stale-snapshot spread here dropped its result.
        dispatch({ type: 'patchCheckSession', seq: cs.seq, patch: { article: { key, loading: true } } });
        const kind = cs.tool === 'translationWords' ? 'tw' : 'ta';
        // Catch-to-absence sweep (D30): readHelpArticle now PROPAGATES
        // transient failures (round 35) — without the settle the un-awaited
        // call was an unhandled rejection and the panel spun forever. A
        // failure is a stated, retryable article error, like Understand's.
        const { found, error } = await settleArticleRead(api, kind, sets, item.category, item.contextId.groupId);
        const now = stateRef.current.checkSession;
        if (now?.article?.key !== key) return; // the user moved on
        dispatch({
          type: 'patchCheckSession',
          seq: cs.seq,
          patch: { article: { key, loading: false, found, error } },
        });
      },

      /** F1 (epic #104 fidelity): the ORIGINAL-language verse row of the
       * check detail's compare card. One whole-book read + parse per session,
       * from the same pinned originalLanguage resource Align reads (D30 —
       * absence is a stated state, never an error). */
      loadCheckOrigSource: async (session) => {
        const cs = session ?? stateRef.current.checkSession;
        const store = storeRef.current;
        if (!cs?.items || !store) return;
        const { book } = cs;
        const testament = isOldTestament(book) ? 'ot' : 'nt';
        if (cs.crossFrame) {
          // #131 class: the source book is numbered in its own frame — no
          // verse-by-verse lookup until the mapping lands. Skip the read.
          dispatch({ type: 'patchCheckSession', seq: cs.seq, patch: { orig: { state: 'cross-frame', testament } } });
          return;
        }
        const pin = stateRef.current.projectPins?.resources?.originalLanguage?.[testament];
        const orig = await readCheckOrigChapters(store, pin, book);
        // Reducer-side merge (patchCheckSession): the article read resolves
        // concurrently, and a stale-snapshot spread here would clobber it.
        dispatch({ type: 'patchCheckSession', seq: cs.seq, patch: { orig } });
      },

      /** C2.6 — write one decision through the store. The full §5.2 record is
       * written, with the resolution record stamped on the file. */
      recordDecision: async (patch) => {
        const cs = stateRef.current.checkSession;
        if (!cs?.items) return;
        const item = cs.items[cs.activeIndex];
        const next = {
          ...item,
          ...patch,
          modifiedTimestamp: new Date().toISOString(),
        };
        try {
          await storeRef.current.upsertDecision(cs.tool, cs.book, next, cs.resource ?? undefined);
        } catch (e) {
          // D59 §3: the store REFUSES a decision write whose session resolution
          // disagrees (by sha) with the file's stored §5.2 record — surface the
          // refusal on the session; the way through is the gateway-change flow.
          dispatch({
            type: 'patchCheckSession',
            seq: cs.seq,
            patch: { saveError: String(e?.message ?? e) },
          });
          return;
        }
        // Item-level merge (checkDecisionSaved): two decisions can be in
        // flight at once, and a stale whole-array snapshot from the later
        // completion would overwrite the earlier item.
        dispatch({ type: 'checkDecisionSaved', seq: cs.seq, index: cs.activeIndex, item: next });
      },

      /** The resolver's inputs for THIS machine + THIS project: what is
       * installed, and which books each installed pin actually covers. */
      /** #15: the project's versification frame, resolved once and cached.
       * `eng` — the default and the whole resource suite's frame — needs no
       * scheme fetch, because the mapper short-circuits before reading one. */
      projectFrame: async () => {
        const repoPath = stateRef.current.project?.id;
        // No open project: an inert frame. `state` MUST be present (consumers
        // branch on it) — an eng-default 'ready' so a caller with no project
        // never trips the unavailable path.
        if (!repoPath) return { name: 'eng', source: 'recorded', schemes: {}, state: 'ready' };
        return resolveProjectFrame(repoPath, { store: storeRef.current, api });
      },

      resolutionContext: async () => {
        // Round 35 + catch-to-absence sweep (D30): an outage in ANY of the
        // three identity reads (the install record, the summaries, the
        // on-disk discovery) must be REPORTED, not swallowed — each collapse
        // makes installed resources read as a false "this machine lacks it"
        // absence. The context stays usable (tolerant callers keep working),
        // but carries ONE resolutionError for readiness-driving callers
        // (Understand slots, refreshCheckable, runPreflight, the gateway
        // change) to surface as a stated, retryable state.
        let resolutionError = null;
        const noteFailure = (error) => {
          resolutionError = resolutionError ?? String(error?.message || error);
        };
        const [recorded, summaries] = await Promise.all([
          readInstalled(api, STORAGE_ID).catch((error) => {
            noteFailure(error);
            return {};
          }),
          api.getSummaries().catch((error) => {
            noteFailure(error);
            return {};
          }),
        ]);
        // Resources can be present without a record — a bundled install, a rig
        // seed, a hand sideload. Identify those from their own metadata so the
        // machine's real contents drive readiness (works offline).
        const installed = await discoverOnDisk(api, summaries, recorded, orgForRepoName, noteFailure);
        // Cache for resolveReadPath: reads resolve a pin to its ACTUAL on-disk
        // path by identity, not by recomputing (B10).
        installedCache = installed;
        return { installed, coverage: coverageFromLocal(summaries, installed), resolutionError };
      },

      /** C2.1 — fetch each selected resource's sb-zip, verify the SHA the
       * export declares, and install it as a sideloaded burrito. A resource
       * that is already installed is skipped (the importer refuses an existing
       * target, PLATFORM-NOTES #26). Failures are reported per resource; a failure
       * never leaves a half-installed package silently behind. */
      downloadPackage: async () => {
        const src = stateRef.current.src;
        const chosen = src.rows.filter((r) => r.fixed || r.on);
        if (chosen.length === 0) return;
        // M1 (adversarial round 13): the adoption finalizer runs AFTER long
        // downloads, and the modal stays closable meanwhile — bind the whole
        // operation to what was open when the user clicked Download.
        const originStore = storeRef.current;
        const originRepoPath = stateRef.current.project?.repoPath ?? null;
        const originGateway = stateRef.current.src.gateway;
        // Round 27: the pins consulted per row are the ORIGINATING project's,
        // snapshotted when Download starts — the modal stays closable during
        // long downloads, and reading live state after the awaits below could
        // resolve a row against ANOTHER project's pinned sha (fetching the
        // wrong artifact for the project the user clicked from).
        const originPins = stateRef.current.projectPins;
        const originBook = src.book;
        if (!originGateway) return;
        dispatch({ type: 'patchSrc', patch: { dl: 'run', error: null, progress: null } });

        const local = new Set(await api.listLocalRepos().catch(() => []));
        // Round 20: the download must satisfy the OPEN project's pinned
        // identities (D58) — resolve what the machine actually holds once, up
        // front, so a pin the catalog's latest release cannot satisfy fetches
        // its own version instead. A failed resolve degrades to the
        // no-open-project behavior (latest release), never to a refusal.
        const { installed } = await a.resolutionContext().catch(() => ({ installed: {} }));
        const done = [];
        const failed = [];
        for (const row of chosen) {
          const target = localRepoPathFromRepoPath(`${DCS_HOST}/${originGateway.org}/${row.repo}`);
          const wanted = unsatisfiedProjectPinFor(originPins, target, installed);
          if (wanted || !local.has(target))
            dispatch({ type: 'patchSrc', patch: { progress: t('sources.progress', { repo: row.repo }) } });
          const result = await installPackageRow(api, originGateway, row, local, wanted);
          if (result.done) done.push(result.done);
          if (result.failed) failed.push(result.failed);
        }
        dispatch({
          type: 'patchSrc',
          patch: {
            dl: failed.length ? null : 'done',
            progress: null,
            error: failed.length ? t('sources.someFailed', { list: failed.join(' · ') }) : null,
          },
        });
        if (done.length) {
          recordInstalledPackage(stateRef, dispatch, originGateway, originBook);
          // Round 20 (F2): a successful install may change NOTHING in
          // resources.json — the pin already existed and only the machine's
          // holdings changed — so pin adoption below dispatches nothing. Bump
          // the epoch Understand's loader watches so readiness reflects every
          // successful install.
          dispatch({ type: 'set', patch: { installEpoch: stateRef.current.installEpoch + 1 } });
          // A download can COMPLETE a suite, which is what makes a language
          // offerable as the project's checking language.
          await a.refreshCheckable();
          await adoptDownloadedPins({
            originStore,
            originRepoPath,
            originGateway,
            storeRef,
            stateRef,
            actions: a,
            dispatch,
          });
        }
      },

      // ---- New Bible modal (design: creation collects the project facts;
      //      books are added in the SEPARATE Add-a-book dialog) ----
      openNewProject: async () => {
        let versifications = ['eng'];
        let versificationsError = null;
        try {
          versifications = await api.getVersifications();
        } catch (error) {
          // Catch-to-absence sweep (D30): a one-entry picker presented a
          // failed listing as "the platform supports one scheme" — and the
          // chosen scheme is journaled at creation, permanently. Keep the
          // safe default usable but STATE the truncation in the dialog.
          versificationsError = String(error?.message || error);
        }
        dispatch({
          type: 'set',
          patch: {
            modal: 'newProject',
            np: {
              name: '',
              langName: '',
              code: '',
              dir: 'ltr',
              font: SCRIPT_FONTS[0],
              versification: 'eng',
              versifications,
              versificationsError,
              showAdvanced: false,
              busy: false,
              error: null,
            },
          },
        });
      },
      patchNp: (patch) =>
        dispatch({ type: 'set', patch: { np: { ...stateRef.current.np, ...patch } } }),

      createBible: async () => {
        const w = stateRef.current.np;
        if (w.busy) return; // reentrancy guard: one create at a time
        const validation = validateNewBible(w);
        if (validation.error) return a.patchNp({ error: validation.error });
        const { abbr } = validation;
        a.patchNp({ busy: true, error: null });
        const store = new JournalingStore({ api });
        // Friendly-name pre-check only: the boundary's createProject does its
        // own MANDATORY existence pre-check and debris cleanup (PLATFORM-NOTES
        // #28) before the server call — this read is for the specific message.
        const target = `_local_/_local_/${abbr}`;
        let existing;
        try {
          existing = await api.listLocalRepos();
        } catch {
          return a.patchNp({ busy: false, error: t('wizard.error') });
        }
        if (existing.includes(target)) {
          return a.patchNp({ busy: false, error: t('wizard.nameInUse', { abbr }) });
        }
        try {
          const { repoPath } = await store.createProject({
            content_name: w.name.trim(),
            content_abbr: abbr,
            content_language_code: w.code.trim(),
            content_language_name: w.code.trim().startsWith('x-')
              ? w.langName.trim() || w.name.trim()
              : null,
            add_book: false,
            book_code: null,
            book_title: null,
            book_abbr: null,
            add_cv: null,
            versification: w.versification,
            branch_name: null,
          });
          await store.open(repoPath);
          // Pin the versions this machine actually holds, when it holds them
          // (a newer local release beats the shipped default — see
          // preferInstalledVersion); otherwise the shipped defaults stand.
          // A fresh project: resources.json must not exist yet. `expectMd5: null`
          // makes a create/create race a refused write, not a silent clobber (B7).
          // #16 / D41: record each pin's book coverage AT PIN TIME, while the
          // resource is local and its real contents can be read. This is the
          // primary mechanism — a pin written here never needs the backfill, and
          // the resolver can tell "does not have this book" from "not downloaded
          // yet" from the first session onward.
          const freshPins = pinsPreferringInstalled(
            INSTALLED_SUITE,
            await readInstalled(api, STORAGE_ID),
          );
          const { coverage: pinCoverage } = await a.resolutionContext();
          await store.writeResources(backfillCoverage(freshPins, pinCoverage).resources, null);
          // textDirection/font live in settings.json: metadata is not writable
          // over HTTP (D28 addendum) and the platform records no direction, so
          // the app reads these back from here.
          await store.writeSettings({
            schemaVersion: 1,
            checkingLanguage: 'en',
            textDirection: w.dir,
            textFont: w.font,
            languageName: w.langName.trim() || null,
          });
          await store.commit('Project created (tC4 Increment 1)');
          await markUsed(repoPath); // creation counts as use (owner, 2026-07-31)
          await refreshProjects();
          // Design flow: "You'll add books next" — straight into Add-a-book.
          a.openAddBook({ id: repoPath, name: w.name.trim(), bookCodes: [] });
        } catch (e) {
          a.patchNp({ busy: false, error: e?.reason || e?.message || t('wizard.error') });
        }
      },

      // ---- Add-a-book modal (design: method step, then pick step; one book
      //      at a time with an optional several-at-once grid — owner 2026-07-31) ----
      openAddBook: (project) => {
        const existing = project.bookCodes || [];
        // Default pick: the first canonical book NOT already in the project
        // (existing books are greyed out — owner, 2026-07-31).
        const firstFree = Object.keys(BOOK_NAMES).find((c) => !existing.includes(c)) || 'GEN';
        dispatch({
          type: 'set',
          patch: {
            modal: 'addBook',
            np: null,
            ab: {
              repoPath: project.id,
              projName: project.name,
              existing,
              step: 'method',
              book: firstFree,
              multi: false,
              books: {},
              busy: false,
              error: null,
            },
          },
        });
      },
      patchAb: (patch) =>
        dispatch({ type: 'set', patch: { ab: { ...stateRef.current.ab, ...patch } } }),

      addBooks: async () => {
        const f = stateRef.current.ab;
        if (f.busy) return;
        // Existing books are greyed out in the dialog AND filtered here —
        // adding must never touch a book that carries drafts (owner,
        // 2026-07-31: deletion/replacement is a later decision).
        const codes = (f.multi ? Object.keys(f.books).filter((k) => f.books[k]) : [f.book]).filter(
          (c) => !(f.existing || []).includes(c),
        );
        if (!codes.length) return a.patchAb({ error: t('addBook.pickOne') });
        a.patchAb({ busy: true, error: null });
        try {
          const store = new JournalingStore({ api });
          const summary = await store.open(f.repoPath);
          for (const code of codes) {
            if (summary.bookCodes.includes(code)) continue; // fresh server truth wins
            // Seed client-side from the pinned ULT structure (pre-chunked;
            // PLATFORM-NOTES #19), computed FIRST so addBook journals ONE
            // self-contained §8.5 book.add carrying the book's REAL initial
            // state (issue #62). A book missing from the source journals the
            // server skeleton instead — absence is a state, not an error.
            const initialUsfm = await seedInitialUsfm({ store, stateRef, code, projName: f.projName });
            await store.addBook({
              book_code: code,
              book_title: bookName(code),
              book_abbr: code,
              add_cv: true,
              initialUsfm,
            });
          }
          await store.commit(`Add ${codes.join(', ')} (tC4)`);
          await refreshProjects();
          a.closeModal();
          await a.openProject(f.repoPath, codes[0]);
        } catch (e) {
          a.patchAb({ busy: false, error: e?.reason || e?.message || t('wizard.error') });
        }
      },

      // ---- Project settings modal (Increment 1: direction + font are
      //      editable via settings.json; name/language/code display-only —
      //      metadata is not writable over HTTP, D28 addendum) ----
      openSettings: async (project) => {
        dispatch({
          type: 'set',
          patch: {
            modal: 'settings',
            st: {
              repoPath: project.id,
              projName: project.name,
              name: project.name,
              langName: '',
              code: project.languageTag,
              dir: project.scriptDirection === 'rtl' ? 'rtl' : 'ltr',
              font: SCRIPT_FONTS[0],
              bookCount: (project.bookCodes || []).length,
              busy: false,
              loaded: false,
              error: null,
            },
          },
        });
        try {
          const reader = new ProjectReader({ api });
          await reader.open(project.id);
          const settings = (await reader.readSettings()) || {};
          a.patchSt({
            dir: settings.textDirection === 'rtl' ? 'rtl' : 'ltr',
            font: settings.textFont || SCRIPT_FONTS[0],
            langName: settings.languageName || '',
            loaded: true,
          });
        } catch (error) {
          // Catch-to-absence sweep (D30, writable variant): claiming
          // loaded:true over hard-coded defaults let Save WRITE those
          // defaults over the project's real direction/font (an RTL project
          // silently became LTR). State the failure; Save stays disabled
          // while unloaded.
          a.patchSt({ loaded: false, error: String(error?.message || error) });
        }
      },
      patchSt: (patch) =>
        dispatch({ type: 'set', patch: { st: { ...stateRef.current.st, ...patch } } }),

      saveSettings: async () => {
        const f = stateRef.current.st;
        if (f.busy) return;
        a.patchSt({ busy: true, error: null });
        try {
          const store = new JournalingStore({ api });
          await store.open(f.repoPath);
          const settings = (await store.readSettings()) || { schemaVersion: 1 };
          await store.writeSettings({
            ...settings,
            schemaVersion: 1,
            textDirection: f.dir,
            textFont: f.font,
          });
          await store.commit('Update settings (tC4)');
          await refreshProjects();
          a.closeModal();
        } catch (e) {
          a.patchSt({ busy: false, error: e?.reason || e?.message || t('wizard.error') });
        }
      },

      // ---- Home: lazy per-book draft progress (design shows a bar per tile) ----
      loadProgress: async (project) => {
        // Review of the D30 sweep: a cached map with UNKNOWN (null) entries
        // must not block a re-read — one transient failure would pin the
        // tiles to em-dash for the whole session. Only a fully-known map is
        // final.
        const cached = stateRef.current.progressByProject[project.id];
        if (cached && !Object.values(cached).includes(null)) return;
        if ((project.bookCodes || []).length === 0 || project.bookCodes.length > 12) return;
        // Read-only: the Home tiles must not run open-recovery or claim the
        // shell's current-project slot (ProjectReader does neither).
        const reader = new ProjectReader({ api });
        try {
          await reader.open(project.id);
        } catch {
          // Catch-to-absence sweep (D30), reviewed: cache NOTHING on a
          // failed open — Home already renders missing entries as unknown
          // (em-dash), and the next render retries.
          return;
        }
        const pcts = {};
        for (const code of project.bookCodes) {
          try {
            const { usfm: raw } = await reader.readBook(code);
            const entries = indexBook(raw);
            const drafted = entries.filter((e) => {
              const b = raw.slice(e.start, e.end).trim();
              return b !== '' && b !== '___';
            }).length;
            pcts[code] = entries.length ? Math.round((drafted / entries.length) * 100) : 0;
          } catch {
            pcts[code] = null;
          }
        }
        dispatch({
          type: 'set',
          patch: {
            progressByProject: {
              ...stateRef.current.progressByProject,
              [project.id]: pcts,
            },
          },
        });
      },

      openProject: (repoPath, bookCode) =>
        performProjectOpen(
          {
            openProjectSeqRef,
            schedulerRef,
            noteSchedulerRef,
            noteTargetsRef,
            storeRef,
            stateRef,
            understandSeqRef,
            dispatch,
            actions: a,
            apiClient: api,
            makeStore: () => new JournalingStore({ api }),
            markUsed,
          },
          repoPath,
          bookCode,
        ),

      openBook: async (code) => {
        // F2/D65/round 34: a book switch is a navigation like any other —
        // bring BOTH schedulers to rest in the re-checking loop (a note
        // staged while the verse drain awaited is caught by the next pass,
        // never carried out of its book's context), and refuse while a
        // failure stands (FR-32; B3/M1: loading over unsaved work
        // resurrects stale bytes).
        const store = storeRef.current;
        if (!store) return;
        if (!(await drainBothSchedulers({ schedulerRef, noteSchedulerRef }))) return;
        const scheduler = schedulerRef.current;
        // Sequence token: two rapid opens must not interleave (finding M2) —
        // only the latest open may install its bytes and sources.
        const seq = ++openSeqRef.current;
        dispatch({ type: 'set', patch: { book: code, chapter: 1, bookRaw: null, bookError: null, sources: {}, editing: null, helpsHover: null, helpsActive: null } });
        let raw;
        try {
          ({ usfm: raw } = await store.readBook(code));
        } catch (e) {
          if (seq === openSeqRef.current) {
            dispatch({ type: 'set', patch: { bookError: e?.reason || e?.message || String(e) } });
          }
          return;
        }
        if (seq !== openSeqRef.current) return; // superseded by a later open
        rawRef.current = raw;
        scheduler?.loadBook(code, raw);
        dispatch({ type: 'set', patch: { bookRaw: raw } });
        // Round 37 (spec §5.3): the source panes come from the PROJECT's own
        // extraScripture pins — never the machine suite. Deferred while the
        // pins are still loading; loadProjectPins reloads on arrival.
        loadSourcePanes({ store, code, seq, openSeqRef, stateRef, dispatch });
      },

      /** Round 37: re-resolve the open book's source panes (the pins landed
       * after openBook, or changed). Bound to the CURRENT open sequence —
       * never a new one, so a book switch mid-reload wins. */
      reloadSourcePanes: (pins) => {
        const store = storeRef.current;
        const code = stateRef.current.book;
        if (!store || !code) return;
        loadSourcePanes({ store, code, seq: openSeqRef.current, openSeqRef, stateRef, dispatch, pins });
      },

      // ---- Understand (D63, #106) ---------------------------------------
      /** Load the read-only helps for the open book: tN notes, tQ questions
       * and tW links, each resolved over the §5.3 ladder (D64) and derived
       * exactly like a check session — disposable, never stored (§4.2). The
       * translator's own comprehension notes are read back from the journal. */
      loadUnderstand: () =>
        performLoadUnderstand({ stateRef, storeRef, understandSeqRef, dispatch, actions: a, apiClient: api }),

      /** The Understand screen's ONLY write (#106, owner ruling 2026-08-27),
       * now staged through the note SaveScheduler (D65). The box calls this
       * on every divergent edit: the buffer coalesces keystrokes per target
       * (latest value wins), the debounce autosaves, blur flushes. An emptied
       * box is never staged (G1 — the caller gates it); staging the STORED
       * text reconciles the buffer back to clean (replaces the old
       * dismissNoteError/revision machinery — K1). The unchanged-text
       * comparison lives in the ComprehensionBox against the note it actually
       * DISPLAYS (unit-membership retrieval, M2). */
      stageNote: ({ chapter, verse, projectFrame = false, stored = '' }, text) => {
        const st = stateRef.current;
        const store = storeRef.current;
        const sched = noteSchedulerRef.current;
        const book = st.book;
        const repoPath = st.project?.repoPath;
        if (!store || !sched || !book || !repoPath) return;
        const key = noteKeyFor(repoPath, book, chapter, verse);
        // C1: the target is bound to the store/project it was staged in.
        noteTargetsRef.current.set(key, {
          store,
          repoPath,
          book,
          chapter,
          verse,
          projectFrame: !!projectFrame,
        });
        // First touch seeds `persisted` with the DISPLAYED stored note, so a
        // revert-to-stored compares clean and re-blur writes nothing.
        sched.seedIfAbsent(key, stored);
        sched.markDirty(key, chapter, verse, text);
      },

      /** The buffered DRAFT for a note target, or null. Only a DIRTY buffer
       * value is a draft (round 28): a clean value equals what the scheduler
       * believes persisted, and restore paths must prefer the stored/durable
       * note over it. The buffer survives unmounts and identity flips (O1/P1
       * are structural now). */
      stagedNote: ({ chapter, verse }) => {
        const st = stateRef.current;
        const repoPath = st?.project?.repoPath;
        const sched = noteSchedulerRef.current;
        if (!repoPath || !st.book || !sched) return null;
        const key = noteKeyFor(repoPath, st.book, chapter, verse);
        return sched.isDirty(key) ? sched.bookText(key) : null;
      },

      /** G1's clear refusal, version-aware (round 32): revert the target to
       * the scheduler's latest PERSISTED value — never stage the render-time
       * stored snapshot, which an in-flight write can make stale (journaling
       * the OLD text over the newer one). A never-staged target is a no-op. */
      revertNote: ({ chapter, verse }) => {
        const st = stateRef.current;
        const repoPath = st?.project?.repoPath;
        if (!repoPath || !st.book) return;
        noteSchedulerRef.current?.revertToPersisted(noteKeyFor(repoPath, st.book, chapter, verse));
      },

      /** Blur: flush the note buffer now (verse discipline — flushOnBlur). */
      flushNotes: () => noteSchedulerRef.current?.flushOnBlur() ?? Promise.resolve(),

      /** Retry after a failed note write. Reconcile the STORE first
       * (round 28): a lost-response accept keeps its stage (round 27), and a
       * cleared fresh draft leaves the buffer clean — retry() alone would
       * clear the failure without ever running the replay that surfaces the
       * durable note, and Saved would show over hidden accepted work. Then
       * retry the buffer (the LATEST text — a stale payload structurally
       * cannot exist, round 21) and refresh the notes the screen displays. */
      /** Round 34: re-run the failed pins read (bound to the OPEN project's
       * store); the error clears optimistically and returns if the read
       * fails again. */
      /** Catch-to-absence sweep (D30): retry a failed project listing. */
      refreshProjects: () => refreshProjects(),

      retryProjectPins: () => {
        const store = storeRef.current;
        const repoPath = stateRef.current.project?.repoPath;
        if (!store || !repoPath) return;
        dispatch({ type: 'set', patch: { projectPinsError: null } });
        loadProjectPins({ store, repoPath, storeRef, stateRef, actions: a, dispatch });
      },

      retryNoteSave: () =>
        // Rounds 29-31: the reconcile-before-rest gate (and the notes
        // refresh a recovery needs) runs INSIDE the scheduler's retry — a
        // rejecting reconcile keeps the failure standing (FR-32).
        noteSchedulerRef.current?.retry() ?? Promise.resolve(),

      /** A help article behind an Understand card (tW word or tA module),
       * read from the INSTALLED burrito like C2.5; absence is stated. */
      loadHelpArticle: async ({ kind, category, slug, rung }) => {
        const st = stateRef.current;
        // The article set must actually CARRY the slot: a primary set can
        // resolve the notes while only the fallback pins tA/tW — take the
        // resolved rung's set first, then the first set holding the pin
        // (2026-08-27 review; readTw/TaArticle still state absence when the
        // repo lacks the module).
        const set = understandArticleSet(st, kind, rung);
        const key = `${kind}:${category ?? ''}:${slug}`;
        // Same-key guard — but an ERRORED article stays re-requestable
        // (round 35): its Retry re-runs this exact request in place.
        if (st.understand?.article?.key === key && !st.understand.article.error) return;
        // D3 (adversarial round 4): the same slug exists across projects and
        // pins, so a key-only guard lets a DELAYED read from a previous
        // project land as this project's article. Completion requires the
        // sequence token AND the originating project to still match.
        const seq = ++articleSeqRef.current;
        const repoPath = st.project?.repoPath;
        const request = { kind, category, slug, rung };
        dispatch({
          type: 'set',
          patch: { understand: { ...st.understand, article: { key, seq, loading: true, request } } },
        });
        let found = null;
        let articleError = null;
        try {
          found = await readHelpArticle(api, kind, set, category, slug);
        } catch (error) {
          // Round 35: a failed read is a stated, retryable error — never
          // "this article does not exist" (D30).
          articleError = String(error?.message || error);
        }
        const now = stateRef.current;
        if (!isCurrentArticleRequest(now, seq, articleSeqRef.current, repoPath, key)) return;
        dispatch({
          type: 'set',
          patch: { understand: { ...now.understand, article: { key, seq, loading: false, found, error: articleError, request } } },
        });
      },

      closeHelpArticle: () => {
        const now = stateRef.current;
        dispatch({ type: 'set', patch: { understand: { ...now.understand, article: null } } });
      },

      setChapter: async (chapter) => {
        // L1/D65: a chapter click is a navigation for the comprehension
        // boxes too — flush the note buffer and stay put only on a failure
        // (FR-32).
        if (noteSchedulerRef.current && !(await noteSchedulerRef.current.drain())) return;
        // F3: a helps focus names a verse in THIS chapter — carrying it across
        // would highlight an unrelated verse that shares the number.
        dispatch({ type: 'set', patch: { chapter, editing: null, helpsHover: null, helpsActive: null } });
      },
      setSourceTab: async (sourceTab) => {
        // N2/D65: a tab switch re-chunks the passage — flush the note buffer
        // first so a draft can never be re-marked under a different target
        // mid-flight; a failure stays put (FR-32).
        if (noteSchedulerRef.current && !(await noteSchedulerRef.current.drain())) return;
        dispatch({ type: 'set', patch: { sourceTab } });
      },
      toggleRail: () => dispatch({ type: 'toggle', key: 'rail' }),
      toggleHelps: () => dispatch({ type: 'toggle', key: 'helps' }),
      setHelpsTab: (helpsTab) => dispatch({ type: 'set', patch: { helpsTab } }),
      // F3: hover is transient; click toggles the sticky focus (mockup
      // hoverNote/activeNote). Payload: { verse, quote, occurrence, id }|null.
      hoverHelp: (helpsHover) => dispatch({ type: 'set', patch: { helpsHover } }),
      focusHelp: (item) =>
        dispatch({
          type: 'set',
          patch: { helpsActive: stateRef.current.helpsActive?.id === item?.id ? null : item },
        }),
      openAcademy: (id) => dispatch({ type: 'set', patch: { academy: id } }),
      closeAcademy: () => dispatch({ type: 'set', patch: { academy: null } }),

      startVerse: (chapter, verseKey) => {
        // Remember the pre-edit body so Cancel (design's editing card) can
        // restore it through the same splice path.
        const before = verseBody(rawRef.current, chapter, verseKey) ?? '___';
        dispatch({ type: 'set', patch: { editing: { key: `${chapter}:${verseKey}`, before } } });
      },
      editVerse: (chapter, verseKey, text) => {
        // Synchronous local splice keeps the raw string authoritative in-session;
        // the scheduler owns the debounced whole-file write (W-5). An emptied
        // verse returns to the platform stub convention `___` (§4.1).
        const body = text.trim() === '' ? '___' : text;
        rawRef.current = spliceVerse(rawRef.current, chapter, verseKey, body);
        schedulerRef.current.markDirty(stateRef.current.book, chapter, verseKey, body);
        dispatch({ type: 'set', patch: { bookRaw: rawRef.current } });
      },
      blurVerse: () => {
        dispatch({ type: 'set', patch: { editing: null } });
        schedulerRef.current?.flushOnBlur();
      },
      cancelVerse: (chapter, verseKey) => {
        // Restore the pre-edit body (still the one splice path), then close.
        const e = stateRef.current.editing;
        if (e && e.key === `${chapter}:${verseKey}`) {
          const body = e.before.trim() === '' ? '___' : e.before;
          rawRef.current = spliceVerse(rawRef.current, chapter, verseKey, body);
          schedulerRef.current.markDirty(stateRef.current.book, chapter, verseKey, body);
        }
        dispatch({ type: 'set', patch: { editing: null, bookRaw: rawRef.current } });
        schedulerRef.current?.flushOnBlur();
      },
      retrySave: () => schedulerRef.current?.retry(),
      backToProjects: async () => {
        // Never navigate away from unsaved work or a visible failure (FR-32).
        // EVERY blocker is checked BEFORE anything is disposed (C3,
        // adversarial round 3): a refused exit must leave the project fully
        // working — both schedulers included — or the next edit throws.
        // Round 23: the loop re-checks both after each pass, so a note staged
        // while the verse drain awaited can never be disposed unflushed.
        if (!(await drainBothSchedulers({ schedulerRef, noteSchedulerRef }))) return;
        // #129 (PR #135 review round 2): the alignment write queue drains the
        // same way — flush-and-go — so a queued §5.1 write can never execute
        // after this project's store is gone (or worse, into the next
        // project's). The queue never rejects, so the await is safe.
        await alignWriteQueue;
        schedulerRef.current?.dispose();
        schedulerRef.current = null;
        noteSchedulerRef.current?.dispose();
        noteSchedulerRef.current = null;
        noteTargetsRef.current = new Map();
        storeRef.current = null;
        // A2 (2026-08-27 adversarial review): understand + projectPins are
        // PROJECT state — leaving them set lets project B render (and journal
        // into!) project A's data. Invalidate any in-flight load as well.
        // The check session is the same class (PR #132 review round 2):
        // clear it and invalidate its in-flight completions.
        understandSeqRef.current++;
        checkSessionSeq++;
        alignSessionSeq++;
        dispatch({
          type: 'set',
          patch: { view: 'home', project: null, book: null, bookRaw: null, sources: {}, saveState: 'saved', noteSaveState: 'saved', projectPins: null, projectPinsLoaded: false, projectPinsError: null, sourcePanes: null, understand: null, checkTool: null, checkSession: null, aligning: false, alignSession: null, alignVerse: null, alignIndex: null },
        });
        refreshProjects(); // re-order: the project just left goes to the top
      },
    };
    return a;
  }, []);

  stateRef.current = s;

  const value = { s, ...model, sourceModel, actions, BOOK_NAMES };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export const useApp = () => useContext(AppCtx);
