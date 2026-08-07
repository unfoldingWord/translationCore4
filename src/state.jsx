// App state over the live HttpStore (Increment 1: J1 create + J2 drafting slice).
// The raw book string is the editing source of truth (indexer + splice); the
// usfm-js parse is for display only (D8: usfm-js never re-serializes).
import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import usfm from 'usfm-js';
import { ServerApi } from './data/serverApi';
import { HttpStore, StaleWriteError } from './data/httpStore';
import { SaveScheduler } from './data/saveScheduler';
import { spliceVerse, verseBody } from './data/usfm/splice';
import { indexBook } from './data/usfm/indexer';
import { seedBookFromSource } from './data/seed';
import { BOOK_NAMES, bookName } from './data/bookNames';
import { GATEWAYS, gatewayKey, DCS_HOST, orgForRepoName } from './data/gateways';
import { fetchAndInstallPin, latestReleaseTag, identifyExistingInstall } from './data/resourceFetch';
import { readInstalled, recordInstalled, coverageFromLocal, languageSetFromInstalled, isPinLocal, pinsPreferringInstalled, localRepoPathFromRepoPath, installedPathFor, discoverOnDisk } from './data/installed';
import { TOOL_SLOT, preflightToolBook, resolutionRecord, resolveToolBook } from './data/resolve';
import {
  deriveTnItems,
  deriveTwlItems,
  filterToScope,
  mergeAndReattach,
  progressOf,
  scopeRangesFor,
} from './data/derive';
import { readTwArticle, readTaArticle } from './data/articles';
import { revalidateAgainstDraft, resolutionWarning } from './data/revalidate';
import { bootstrapVerse, linkWord, unlinkWord, stampTargetVerse, alignmentIsStale } from './data/align/edit';
import { consequencesOfGatewayChange, applyGatewayChange } from './data/gatewayChange';
import { carryOverDecisions } from './data/carryOver';
import { TC_READY_TOPIC } from './data/serverApi';
import { t } from './i18n';

const AppCtx = createContext(null);

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
    originalLanguage: {
      nt: { repoPath: 'git.door43.org/unfoldingWord/el-x-koine_ugnt', version: 'v0.34', flavor: 'scripture/textTranslation' },
      ot: { repoPath: 'git.door43.org/unfoldingWord/hbo_uhb', version: 'v2.1.30', flavor: 'scripture/textTranslation' },
    },
    lexicon: {
      nt: { repoPath: 'git.door43.org/unfoldingWord/en_ugl', version: 'v2', flavor: 'peripheral/x-lexicon' },
      ot: { repoPath: 'git.door43.org/unfoldingWord/en_uhl', version: 'v1', flavor: 'peripheral/x-lexicon' },
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
  try {
    const json = usfm.toJSON(usfmText);
    return json?.chapters?.[String(chapter)]?.[String(verse)]?.verseObjects ?? [];
  } catch {
    return [];
  }
}

/** The first verse that actually has a draft — alignment needs target words. */
function firstDraftedRef(bookRaw) {
  const index = verseTextIndex(bookRaw);
  const keys = Object.keys(index);
  return keys.length ? keys[0] : null;
}

const initial = () => ({
  view: 'home', // home | draft | check | publish
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
  helps: false,
  helpsTab: 'notes',
  academy: null,
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
  checkable: [], // gatewayKeys whose COMPLETE helps suite is installed (D30.2)
  netEnabled: false, // mirrors the platform's net gate (GET /net/status)
  projectPins: null, // the open project's resources.json (§5.3 v2 shape)
  preflight: null, // { [tool]: Preflight } for the open book (C2.2)
  gatewayPreview: null, // a proposed gateway change awaiting confirmation
  aligning: false, // the align surface is open
  alignVerse: null, // "chapter:verse" being aligned, or null for the first drafted
  alignSession: null, // { record, armed, ref, … } — the open alignment surface
  checkTool: null, // the open checking tool, or null at the preflight screen
  checkSession: null, // { items, progress, resource, activeIndex } — derived, never stored
  progressByProject: {}, // repoPath -> { CODE: draftPct } (lazy Home cache)
  tick: 0,
});

function reducer(state, a) {
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
    case 'bump':
      return { ...state, tick: state.tick + 1, ...(a.patch || {}) };
    default:
      return state;
  }
}

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

export function AppProvider({ children }) {
  const [s, dispatch] = useReducer(reducer, undefined, initial);
  const storeRef = useRef(null);
  const schedulerRef = useRef(null);
  const rawRef = useRef(null); // authoritative raw book text, updated synchronously
  const stateRef = useRef(null); // live state for async closures
  const openSeqRef = useRef(0); // openBook sequence token (review finding M2)

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
      const sched = schedulerRef.current;
      if (sched && sched.getState() !== 'saved') {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const onHide = () => {
      void schedulerRef.current?.drain();
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
  const STORAGE_ID = 'uw-tc4';
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
      const store = new HttpStore({ api });
      const projects = await store.listProjects();
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
      dispatch({ type: 'set', patch: { projects } });
    } catch (e) {
      dispatch({ type: 'set', patch: { projects: [], bookError: String(e) } });
    }
  }

  // ---- actions ----------------------------------------------------------------
  const actions = useMemo(() => {
    const a = {
      go: (view) => dispatch({ type: 'set', patch: { view } }),

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
        const { installed } = await a.resolutionContext();
        const checkable = GATEWAYS.filter((g) => languageSetFromInstalled(installed, g))
          .map(gatewayKey);
        dispatch({ type: 'set', patch: { checkable: [...new Set(checkable)] } });
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
        const { installed } = await a.resolutionContext();
        const primary = languageSetFromInstalled(installed, gateway);
        if (!primary) throw new Error(t('sources.suiteIncomplete', { lang: gateway.name }));
        const { value: currentResources, md5: resourcesMd5 } = await store.readResourcesWithMd5();
        const current = currentResources ?? INSTALLED_SUITE;

        // Read every stored decision file this project has, so the count is
        // real rather than estimated.
        const stored = [];
        const md5s = {};
        for (const book of st.project.bookCodes ?? []) {
          for (const tool of Object.keys(TOOL_SLOT)) {
            // Read the RAW bytes (B21): parse for the carry-over computation, but
            // keep the exact text so a failed commit can restore it verbatim.
            const got = await store.readDecisionsText(tool, book).catch(() => null);
            if (got?.text != null) {
              stored.push({ tool, book, file: JSON.parse(got.text), raw: got.text });
              md5s[`${tool}/${book}`] = got.md5;
            }
          }
        }
        const consequences = consequencesOfGatewayChange(stored, {
          primary,
          fallback: current.languageSets?.fallback ?? primary,
        });
        const next = applyGatewayChange(current, primary);

        // The resource is the primary key (tC3 precedent, 2026-08-04): the
        // check list derived from the NEW resource is the work. Compute that
        // list HERE, so the dialogue states the exact outcome — how many
        // decisions carry over and how many checks come back — instead of a
        // count "at risk". The new suite is installed (languageSetFromInstalled
        // proved it), so every derive below reads local bytes.
        const { coverage } = await a.resolutionContext();
        const plan = [];
        for (const entry of consequences.affected) {
          const resolution = resolveToolBook(next, entry.tool, entry.book, coverage);
          if (!resolution.pin) continue; // uncovered by both rungs: nothing to derive against
          const derived = await a.deriveItemsFor(entry.tool, entry.book, resolution.pin);
          const record = resolutionRecord(resolution);
          const source = stored.find((s) => s.tool === entry.tool && s.book === entry.book);
          const result = carryOverDecisions(source.file, derived, record);
          plan.push({
            tool: entry.tool,
            book: entry.book,
            expectMd5: md5s[`${entry.tool}/${entry.book}`] ?? null,
            // The pre-migration file (parsed) + its EXACT original bytes, kept
            // so a later-book failure rolls back byte-identically (B11 + B21).
            originalFile: source.file,
            originalRaw: source.raw,
            ...result,
          });
        }
        const carried = plan.reduce((n, p) => n + p.carried, 0);
        const invalidated = plan.reduce((n, p) => n + p.invalidated, 0);
        return { gateway, primary, consequences, next, plan, carried, invalidated, resourcesMd5 };
      },

      /** Derive one book's check list from a given pin. Returns [] when the
       * pinned resource says nothing about the book — a designed state (C2.9),
       * not an error. Derived lists are disposable and never stored (§4.2). */
      deriveItemsFor: async (tool, book, pin) => {
        const localRepo = resolveReadPath(pin);
        let tsv;
        try {
          tsv = await api.readIngredient(localRepo, `${book.toUpperCase()}.tsv`);
        } catch {
          return [];
        }
        if (tsv === null || tsv.startsWith('{"is_good":false')) return [];
        // §4.2 (D26): derivation MUST filter to the project scope — an out-of-scope
        // item is never derived, counted or shown. `[]` = whole book.
        const ranges = scopeRangesFor(stateRef.current.projectScope ?? {}, book.toUpperCase());
        return filterToScope(
          tool === 'translationNotes'
            ? deriveTnItems(tsv, book.toLowerCase())
            : deriveTwlItems(tsv, book.toLowerCase()),
          ranges,
        );
      },

      /** Open the confirmation dialogue for a proposed gateway language. */
      askGatewayChange: async (gateway) => {
        const preview = await a.previewGatewayChange(gateway);
        const current = stateRef.current.projectPins?.languageSets?.primary?.gatewayLanguage;
        dispatch({
          type: 'set',
          patch: { gatewayPreview: { ...preview, currentName: current?.languageId } },
        });
        return preview;
      },

      cancelGatewayChange: () => dispatch({ type: 'set', patch: { gatewayPreview: null } }),

      confirmGatewayChange: async (preview) => {
        await a.commitGatewayChange(preview);
        dispatch({ type: 'set', patch: { gatewayPreview: null } });
      },

      /** Commit a previewed change. Takes the preview so the user confirms
       * exactly what was described to them, not a re-derived guess — including
       * the per-book carry-over already computed there.
       *
       * The commit is all-or-nothing (B11). FIRST every precondition is
       * validated — resources.json and EVERY planned decision file must still
       * hash to what the preview read. Only if all hold does any write happen,
       * so a book that moved under us aborts the whole migration before any
       * file changes. If a write still fails mid-way (a narrow race after
       * validation), the already-migrated decision files are rolled back to
       * their pre-migration content, so the project is never left with some
       * books reconciled to the new resource while the pins stay old. */
      commitGatewayChange: async (preview) => {
        const store = storeRef.current;
        if (!store) throw new Error('no project is open');
        const plan = preview.plan ?? [];

        // 1) Validate ALL preconditions before touching anything.
        const { md5: nowMd5 } = await store.readResourcesWithMd5();
        if ((preview.resourcesMd5 ?? null) !== nowMd5) {
          throw new StaleWriteError(
            'checking/resources.json',
            preview.resourcesMd5 ?? '(absent)',
            nowMd5 ?? '(absent)',
          );
        }
        for (const p of plan) {
          const { md5: cur } = await store.readDecisionsWithMd5(p.tool, p.book);
          if ((p.expectMd5 ?? null) !== (cur ?? null)) {
            throw new StaleWriteError(
              `checking/${p.tool}/${p.book}`,
              p.expectMd5 ?? '(absent)',
              cur ?? '(absent)',
            );
          }
        }

        // 2) Write, rolling back already-migrated books if a later write fails.
        const migrated = [];
        try {
          for (const p of plan) {
            // writeDecisions returns the md5 of EXACTLY the bytes it wrote,
            // captured under the store's write lock (B15) — never a read-back,
            // which could adopt a concurrent edit's bytes and then let the
            // rollback CAS clobber that edit.
            const wroteMd5 = await store.writeDecisions(p.tool, p.book, p.file, p.expectMd5);
            migrated.push({ ...p, wroteMd5 });
          }
          await store.writeResources(preview.next, nowMd5);
        } catch (e) {
          for (const p of migrated) {
            try {
              // B14 — CAS the rollback on the bytes WE wrote. If another writer
              // edited this book after our migration, the restore is refused and
              // their edit stands: a rollback must never force-clobber a
              // concurrent change (only undo our own partial migration).
              // B21 — restore the EXACT original bytes (not the parsed file
              // re-normalized), so a failed transaction leaves the sidecar
              // byte-identical and the tree clean.
              await store.restoreDecisionsText(p.tool, p.book, p.originalRaw, p.wroteMd5);
            } catch (rollbackErr) {
              if (!(rollbackErr instanceof StaleWriteError)) throw rollbackErr;
              // Concurrent edit landed → it is the current truth; leave it.
            }
          }
          throw e;
        }
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
        const { installed } = await a.resolutionContext();
        const primary = languageSetFromInstalled(installed, gateway);
        if (!primary) {
          throw new Error(t('sources.suiteIncomplete', { lang: gateway.name }));
        }
        const next = await updateResources(store, (current) => ({
          ...current,
          schemaVersion: 2,
          languageSets: { ...current.languageSets, primary },
        }));
        dispatch({ type: 'set', patch: { projectPins: next } });
        return next;
      },

      /** C2.2 — run the session preflight for the open book, one verdict per
       * tool. Pure read: it never fetches or changes anything. */
      runPreflight: async () => {
        const st = stateRef.current;
        if (!st.book) return;
        const { installed, coverage } = await a.resolutionContext();
        const online = st.netEnabled;
        const out = {};
        for (const tool of Object.keys(TOOL_SLOT)) {
          out[tool] = preflightToolBook(st.projectPins, tool, st.book, {
            coverage,
            isLocal: (pin) => isPinLocal(installed, pin),
            online,
          });
        }
        dispatch({ type: 'set', patch: { preflight: out } });
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
        const ref = st.alignVerse ?? firstDraftedRef(st.bookRaw);
        if (!ref) {
          dispatch({ type: 'set', patch: { alignSession: { unavailable: 'undrafted' } } });
          return;
        }
        dispatch({ type: 'set', patch: { alignSession: { loading: true } } });

        const testament = isOldTestament(st.book) ? 'ot' : 'nt';
        const origPin = st.projectPins?.resources?.originalLanguage?.[testament];
        if (!origPin?.repoPath) {
          dispatch({ type: 'set', patch: { alignSession: { unavailable: 'unpinned' } } });
          return;
        }
        let origUsfm = null;
        try {
          const local = resolveReadPath(origPin);
          ({ usfm: origUsfm } = await store.readSourceBook(local, st.book));
        } catch {
          origUsfm = null;
        }
        if (!origUsfm) {
          dispatch({ type: 'set', patch: { alignSession: { unavailable: 'missing' } } });
          return;
        }

        const [chapter, verse] = ref.split(':');
        const origObjects = verseObjectsFor(origUsfm, chapter, verse);
        const targetText = verseTextIndex(st.bookRaw)[ref] ?? '';
        if (!origObjects.length || !targetText) {
          dispatch({ type: 'set', patch: { alignSession: { unavailable: 'missing' } } });
          return;
        }

        const { value: file, md5 } = await store.readAlignmentsWithMd5(st.book);
        const stored = file?.chapters?.[chapter]?.[verse];
        const sourceVersion = `dcs::${origPin.repoPath.split('/').slice(-2).join('/')}@${origPin.version}`;
        const record = stored ?? bootstrapVerse(targetText, origObjects, sourceVersion);
        dispatch({
          type: 'set',
          patch: {
            alignSession: {
              loading: false, ref, record, md5, targetText, origObjects, sourceVersion,
              stale: alignmentIsStale(record, targetText),
              armed: null,
              targetDir: st.project?.scriptDirection === 'rtl' ? 'rtl' : 'ltr',
              origDir: testament === 'ot' ? 'rtl' : 'ltr',
            },
          },
        });
      },

      startAligning: () => dispatch({ type: 'set', patch: { aligning: true, alignSession: null } }),

      closeAlign: () =>
        dispatch({ type: 'set', patch: { aligning: false, alignSession: null, alignVerse: null } }),

      /** Select (or clear) the banked word the next card click will place. */
      armAlignWord: (word) => {
        const a2 = stateRef.current.alignSession;
        if (a2) dispatch({ type: 'set', patch: { alignSession: { ...a2, armed: word } } });
      },

      placeAlignWord: async (cardIndex) => {
        const a2 = stateRef.current.alignSession;
        if (!a2?.armed) return;
        const next = linkWord(a2.record, cardIndex, a2.armed);
        if (next === a2.record) return;
        await a.persistAlign({ ...a2, record: next, armed: null });
      },

      unplaceAlignWord: async (cardIndex, word) => {
        const a2 = stateRef.current.alignSession;
        if (!a2) return;
        const next = unlinkWord(a2.record, cardIndex, word);
        if (next === a2.record) return;
        await a.persistAlign({ ...a2, record: next });
      },

      /** Write the §5.1 sidecar under compare-and-swap (#17). The record is
       * re-stamped against the draft it was edited on (I-3). */
      persistAlign: async (session) => {
        const st = stateRef.current;
        const store = storeRef.current;
        const [chapter, verse] = session.ref.split(':');
        const record = stampTargetVerse(session.record, session.targetText);
        const { value: current, md5 } = await store.readAlignmentsWithMd5(st.book);
        const file = current ?? { schemaVersion: 1, book: st.book.toUpperCase(), chapters: {} };
        file.chapters = {
          ...file.chapters,
          [chapter]: { ...(file.chapters?.[chapter] ?? {}), [verse]: record },
        };
        await store.writeAlignments(st.book, file, md5);
        const after = await store.readAlignmentsWithMd5(st.book);
        dispatch({
          type: 'set',
          patch: {
            alignSession: { ...session, record, md5: after.md5, stale: false },
          },
        });
      },

      /** C2.3/C2.4 — open a checking session for one tool on the open book.
       * Derives the check list from the RESOLVED pin's own TSV (never a
       * fixture), merges the stored §5.2 decisions, and reports progress.
       * Derived lists are disposable and never stored (§4.2). */
      openCheckTool: async (tool) => {
        const st = stateRef.current;
        const pre = st.preflight?.[tool];
        if (!pre || pre.state !== 'ready' || !pre.resolution?.pin) return;
        const pin = pre.resolution.pin;
        const book = st.book;
        dispatch({ type: 'set', patch: { checkTool: tool, checkSession: { loading: true } } });
        try {
          const localRepo = resolveReadPath(pin);
          // C2.9 — a resource can be pinned, local, and still have nothing to
          // say about this book. That is a designed state, not an error: the
          // catalog's book_codes and the resource's actual files can disagree.
          let tsv;
          try {
            tsv = await api.readIngredient(localRepo, `${book.toUpperCase()}.tsv`);
          } catch {
            tsv = null;
          }
          if (tsv === null || tsv.startsWith('{"is_good":false')) {
            dispatch({
              type: 'set',
              patch: {
                checkTool: tool,
                checkSession: {
                  loading: false, tool, book, items: [], empty: 'missing',
                  resource: resolutionRecord(pre.resolution),
                },
              },
            });
            return;
          }
          // §4.2 (D26): filter to the project scope before anything counts or shows it.
          const scopeRanges = scopeRangesFor(
            stateRef.current.projectScope ?? {},
            book.toUpperCase(),
          );
          const derived = filterToScope(
            tool === 'translationNotes'
              ? deriveTnItems(tsv, book.toLowerCase())
              : deriveTwlItems(tsv, book.toLowerCase()),
            scopeRanges,
          );
          if (derived.length === 0) {
            dispatch({
              type: 'set',
              patch: {
                checkTool: tool,
                checkSession: {
                  loading: false, tool, book, items: [], empty: 'none',
                  resource: resolutionRecord(pre.resolution),
                },
              },
            });
            return;
          }
          const savedFile = await storeRef.current.readDecisions(tool, book);
          const saved = savedFile?.decisions ?? [];
          // C2.8 (2) — D17: has the resource behind this file changed?
          // Safety net only: pass BOTH rungs so a file recorded against the
          // other rung (the ladder working) is silent. The consequences of a
          // real gateway change are shown at the change (D23a/D30.2).
          const slot = TOOL_SLOT[tool];
          const rungPins = ['primary', 'fallback']
            .map((r) => st.projectPins?.languageSets?.[r]?.[slot])
            .filter(Boolean)
            .map((p2) => ({ repoPath: p2.repoPath, version: p2.version }));
          const warning = resolutionWarning(savedFile?.resource, pre.resolution, rungPins);

          // Identity key first, then D17's cross-language fallback for whatever
          // it could not place. Unconditional by design — see mergeAndReattach.
          const { items: merged, orphaned } = mergeAndReattach(derived, saved);

          // C2.8 (1) — the draft may have moved under stored selections (I-3).
          // Verse text comes from the model the drafting view already builds,
          // so revalidation reads the SAME bytes the translator sees.
          // Built from the live raw book, not from `model`: the actions memo
          // has empty deps, so a `model` reference here would capture the first
          // render's empty book (the stale-closure hazard this file already
          // guards against elsewhere with stateRef).
          const verses = verseTextIndex(stateRef.current.bookRaw);
          const { items, invalidated } = revalidateAgainstDraft(merged, verses);

          const session = {
            loading: false, tool, book, items,
            progress: progressOf(items),
            resource: resolutionRecord(pre.resolution),
            categories: [...new Set(items.map((i) => i.category))].sort(),
            activeIndex: 0,
            invalidated,
            warning,
            orphaned,
            // Per-verse target text for the tN/tW selection UI (B23). Kept on the
            // SESSION, never on the items — recordDecision spreads the item into
            // the §5.2 write, so target text must not ride along and pollute it.
            verses,
          };
          dispatch({ type: 'set', patch: { checkSession: session } });
          a.loadActiveArticle(session);
        } catch (e) {
          dispatch({
            type: 'set',
            patch: { checkSession: { loading: false, error: String(e?.message || e) } },
          });
        }
      },

      closeCheckTool: () => dispatch({ type: 'set', patch: { checkTool: null, checkSession: null } }),

      setCheckIndex: (activeIndex) => {
        const cs = stateRef.current.checkSession;
        if (!cs) return;
        const next = { ...cs, activeIndex };
        dispatch({ type: 'set', patch: { checkSession: next } });
        a.loadActiveArticle(next);
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
        if (cs.article?.key === key) return;
        dispatch({ type: 'set', patch: { checkSession: { ...cs, article: { key, loading: true } } } });
        let found = null;
        try {
          if (cs.tool === 'translationWords' && sets?.translationWords) {
            found = await readTwArticle(
              api,
              resolveReadPath(sets.translationWords),
              item.category,
              item.contextId.groupId,
            );
          } else if (sets?.translationAcademy) {
            found = await readTaArticle(
              api,
              resolveReadPath(sets.translationAcademy),
              item.contextId.groupId,
            );
          }
        } catch { /* reported as absence below */ }
        const now = stateRef.current.checkSession;
        if (now?.article?.key !== key) return; // the user moved on
        dispatch({
          type: 'set',
          patch: { checkSession: { ...now, article: { key, loading: false, found } } },
        });
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
        await storeRef.current.upsertDecision(cs.tool, cs.book, next, cs.resource ?? undefined);
        const items = cs.items.map((it, i) => (i === cs.activeIndex ? next : it));
        dispatch({
          type: 'set',
          patch: { checkSession: { ...cs, items, progress: progressOf(items) } },
        });
      },

      /** The resolver's inputs for THIS machine + THIS project: what is
       * installed, and which books each installed pin actually covers. */
      resolutionContext: async () => {
        const [recorded, summaries] = await Promise.all([
          readInstalled(api, STORAGE_ID),
          api.getSummaries().catch(() => ({})),
        ]);
        // Resources can be present without a record — a bundled install, a rig
        // seed, a hand sideload. Identify those from their own metadata so the
        // machine's real contents drive readiness (works offline).
        const installed = await discoverOnDisk(api, summaries, recorded, orgForRepoName);
        // Cache for resolveReadPath: reads resolve a pin to its ACTUAL on-disk
        // path by identity, not by recomputing (B10).
        installedCache = installed;
        return { installed, coverage: coverageFromLocal(summaries, installed) };
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
        dispatch({ type: 'patchSrc', patch: { dl: 'run', error: null, progress: null } });

        const local = new Set(await api.listLocalRepos().catch(() => []));
        const done = [];
        const failed = [];
        for (const row of chosen) {
          const repoPath = `${DCS_HOST}/${stateRef.current.src.gateway.org}/${row.repo}`;
          // Owner-qualified target (B9): `Xenizo/fr_tn` and `MVHS/fr_tn` get
          // DISTINCT local paths, so selecting the second gateway no longer
          // collides with the first and is no longer skipped as "installed".
          const target = localRepoPathFromRepoPath(repoPath);
          if (local.has(target)) {
            // Already on disk. If nothing recorded which release it is (rig
            // seeds, older installs), identify it from its own metadata
            // revision + the DCS tag list — evidence, not assumption.
            if (!(await readInstalled(api, STORAGE_ID))[target]) {
              try {
                const meta = await api.getMetadataRaw(target);
                const rev = Object.values(meta?.identification?.primary?.dcs || {})[0]?.revision;
                const found = await identifyExistingInstall(repoPath, rev);
                if (found) await recordInstalled(api, STORAGE_ID, target, found);
              } catch { /* stays unidentified — contributes no coverage */ }
            }
            done.push(row.repo);
            continue;
          }
          dispatch({ type: 'patchSrc', patch: { progress: t('sources.progress', { repo: row.repo }) } });
          try {
            const tag = await latestReleaseTag(repoPath);
            const result = await fetchAndInstallPin(
              { repoPath, version: tag, flavor: '' },
              { api },
            );
            done.push(`${row.repo} ${tag}`);
            // The export's own revision becomes this resource's pinned SHA,
            // recorded per MACHINE (an install is shared by every project).
            await recordInstalled(api, STORAGE_ID, target, {
              repoPath, version: tag, sha: result.revision, flavor: '',
            });
          } catch (e) {
            failed.push(`${row.repo}: ${String(e?.message || e)}`);
          }
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
          const langKey = gatewayKey(stateRef.current.src.gateway);
          const book = stateRef.current.src.book;
          const already = stateRef.current.installedSrc.some(
            (x) => x.langKey === langKey && x.book === book,
          );
          if (!already) {
            dispatch({
              type: 'set',
              patch: { installedSrc: [...stateRef.current.installedSrc, { langKey, book }] },
            });
          }
          // A download can COMPLETE a suite, which is what makes a language
          // offerable as the project's checking language.
          await a.refreshCheckable();
        }
      },

      // ---- New Bible modal (design: creation collects the project facts;
      //      books are added in the SEPARATE Add-a-book dialog) ----
      openNewProject: async () => {
        let versifications = ['eng'];
        try {
          versifications = await api.getVersifications();
        } catch {
          /* offline rig without the endpoint — keep the default */
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
        if (!w.name.trim()) return a.patchNp({ error: t('wizard.nameRequired') });
        if (!w.code.trim()) return a.patchNp({ error: t('wizard.codeRequired') });
        // The folder name derives from the name (no separate field — owner,
        // 2026-07-31); a non-Latin name falls back to the language code.
        const slug = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
        const abbr = slug(w.name) || slug(w.code);
        if (!abbr) return a.patchNp({ error: t('wizard.abbrRequired') });
        a.patchNp({ busy: true, error: null });
        const store = new HttpStore({ api });
        // Pre-check the name: a failed create leaves a git-init'd debris repo
        // (validation runs AFTER init — PLATFORM-NOTES #28), so never attempt a
        // create over an existing path. The pre-check is MANDATORY: the
        // failure-path cleanup below deletes `target`, which is only safe when
        // this listing POSITIVELY confirmed the path did not exist (review
        // finding B2, 2026-07-30) — so a listing failure aborts the create.
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
        let created = false;
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
          await store.writeResources(
            pinsPreferringInstalled(INSTALLED_SUITE, await readInstalled(api, STORAGE_ID)),
            null,
          );
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
          created = true;
          await store.commit('Project created (tC4 Increment 1)');
          await markUsed(repoPath); // creation counts as use (owner, 2026-07-31)
          await refreshProjects();
          // Design flow: "You'll add books next" — straight into Add-a-book.
          a.openAddBook({ id: repoPath, name: w.name.trim(), bookCodes: [] });
        } catch (e) {
          if (!created) {
            // Our failed attempt may have left a git-init'd debris repo. The
            // mandatory pre-check above CONFIRMED the path was absent before
            // the attempt, so deleting it can only remove our own debris,
            // never pre-existing work (PLATFORM-NOTES #28; review finding B2).
            api.deleteRepo(target).catch(() => {});
          }
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
          const store = new HttpStore({ api });
          const summary = await store.open(f.repoPath);
          for (const code of codes) {
            if (summary.bookCodes.includes(code)) continue; // fresh server truth wins
            await store.addBook({
              book_code: code,
              book_title: bookName(code),
              book_abbr: code,
              add_cv: true,
            });
            // Seed client-side from the pinned ULT structure (pre-chunked;
            // PLATFORM-NOTES #19). A book missing from the source keeps the server
            // skeleton — absence is a state, not an error. Seeding only ever
            // runs here, on a book this call just created as stubs.
            try {
              const src = await store.readSourceBook(
                localSourceRepo(INSTALLED_SUITE.extraScripture[0]),
                code,
              );
              const seeded = seedBookFromSource(src.usfm, {
                bookCode: code,
                bookName: bookName(code),
                projectName: f.projName,
              });
              await store.writeBook(code, seeded);
            } catch {
              /* keep the server skeleton */
            }
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
          const store = new HttpStore({ api });
          await store.open(project.id);
          const settings = (await store.readSettings()) || {};
          a.patchSt({
            dir: settings.textDirection === 'rtl' ? 'rtl' : 'ltr',
            font: settings.textFont || SCRIPT_FONTS[0],
            langName: settings.languageName || '',
            loaded: true,
          });
        } catch {
          a.patchSt({ loaded: true });
        }
      },
      patchSt: (patch) =>
        dispatch({ type: 'set', patch: { st: { ...stateRef.current.st, ...patch } } }),

      saveSettings: async () => {
        const f = stateRef.current.st;
        if (f.busy) return;
        a.patchSt({ busy: true, error: null });
        try {
          const store = new HttpStore({ api });
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
        if (stateRef.current.progressByProject[project.id]) return;
        if ((project.bookCodes || []).length === 0 || project.bookCodes.length > 12) return;
        const store = new HttpStore({ api });
        try {
          await store.open(project.id);
        } catch {
          return;
        }
        const pcts = {};
        for (const code of project.bookCodes) {
          try {
            const { usfm: raw } = await store.readBook(code);
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

      openProject: async (repoPath, bookCode) => {
        // Never abandon unsaved work: drain the old scheduler first, and stay
        // put if a write failure remains (FR-32; review findings B3/M1/M6).
        if (schedulerRef.current) {
          const clean = await schedulerRef.current.drain();
          if (!clean) return;
          schedulerRef.current.dispose();
        }
        try {
          const store = new HttpStore({ api });
          const summary = await store.open(repoPath);
          storeRef.current = store;
          schedulerRef.current = new SaveScheduler({
            writeBook: (book, whole) => store.writeBook(book, whole),
            splice: spliceVerse,
          });
          schedulerRef.current.subscribe((saveState) =>
            dispatch({ type: 'set', patch: { saveState } }),
          );
          api.setCurrentProject(repoPath).catch(() => {});
          markUsed(repoPath); // fire-and-forget; ordering refreshes next Home visit
          // The platform summary reports script_direction "?" for app-created
          // projects; the wizard recorded the user's choice in settings.json.
          let scriptDirection = summary.scriptDirection;
          if (scriptDirection !== 'ltr' && scriptDirection !== 'rtl') {
            const settings = await store.readSettings().catch(() => null);
            scriptDirection = settings?.textDirection === 'rtl' ? 'rtl' : 'ltr';
          }
          // §4.2 (D26): the project scope gates every derived list. It lives in
          // metadata `type.flavorType.currentScope`. Absent or unreadable metadata
          // reads as {} — whole book for every code, which is the pre-D26 behaviour.
          let projectScope = {};
          try {
            const meta = await api.getMetadataRaw(repoPath);
            projectScope = meta?.type?.flavorType?.currentScope ?? {};
          } catch {
            projectScope = {};
          }
          dispatch({
            type: 'set',
            patch: {
              project: { ...summary, scriptDirection, repoPath },
              projectScope,
              view: 'draft',
            },
          });
          // The project's pins drive every check session (D30.3). Absent
          // resources.json reads as null — "no pins recorded" — which the
          // preflight reports distinctly from "pinned but not local".
          store.readResources()
            .then((pins) => dispatch({ type: 'set', patch: { projectPins: pins } }))
            .catch(() => dispatch({ type: 'set', patch: { projectPins: null } }));
          // B12 — warm the install resolver BEFORE any book/source read. openBook
          // resolves its source panes through resolveReadPath, which needs
          // installedCache populated; on a cold project open the cache is empty,
          // so every seeded resource resolves to the wrong (owner-qualified) path
          // and the ULT/UST panes never render. Installs are machine-scoped, so
          // one warm-up here also covers later book switches. resolutionContext
          // is self-healing (it swallows its own read failures), so this is safe
          // offline. Awaited so the cache is ready before openBook reads.
          await a.resolutionContext().catch(() => {});
          await a.openBook(bookCode || summary.bookCodes[0]);
        } catch (e) {
          dispatch({
            type: 'set',
            patch: { bookError: e?.reason || e?.message || String(e), view: 'home' },
          });
        }
      },

      openBook: async (code) => {
        const store = storeRef.current;
        if (!store) return;
        // Drain before switching: loading over unsaved work resurrects stale
        // bytes (review finding B3). A retained failure keeps us on the
        // current book with the error visible (FR-32; finding M1).
        const scheduler = schedulerRef.current;
        if (scheduler && !(await scheduler.drain())) return;
        // Sequence token: two rapid opens must not interleave (finding M2) —
        // only the latest open may install its bytes and sources.
        const seq = ++openSeqRef.current;
        dispatch({ type: 'set', patch: { book: code, chapter: 1, bookRaw: null, bookError: null, sources: {}, editing: null } });
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
        // Load both source panes lazily; absence is a designed state.
        const pins = INSTALLED_SUITE.extraScripture;
        for (const pin of pins) {
          store
            .readSourceBook(localSourceRepo(pin), code)
            .then(({ usfm: srcRaw }) => {
              if (seq !== openSeqRef.current) return;
              dispatch({
                type: 'setSource',
                id: pin.id,
                value: { raw: srcRaw, chapters: parseChapters(srcRaw) },
              });
            })
            .catch(() => {
              if (seq !== openSeqRef.current) return;
              dispatch({ type: 'setSource', id: pin.id, value: 'missing' });
            });
        }
      },

      setChapter: (chapter) => dispatch({ type: 'set', patch: { chapter, editing: null } }),
      setSourceTab: (sourceTab) => dispatch({ type: 'set', patch: { sourceTab } }),
      toggleRail: () => dispatch({ type: 'toggle', key: 'rail' }),
      toggleHelps: () => dispatch({ type: 'toggle', key: 'helps' }),
      setHelpsTab: (helpsTab) => dispatch({ type: 'set', patch: { helpsTab } }),
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
        if (schedulerRef.current) {
          const clean = await schedulerRef.current.drain();
          if (!clean) return;
          schedulerRef.current.dispose();
          schedulerRef.current = null;
        }
        storeRef.current = null;
        dispatch({
          type: 'set',
          patch: { view: 'home', project: null, book: null, bookRaw: null, sources: {}, saveState: 'saved' },
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
