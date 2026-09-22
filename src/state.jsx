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
import { STORY_FILE, refusalCodeOf } from './data/journal/runtime';
import { JournalingStore, ProjectReader } from './data/journal/journalingStore';
import { SaveScheduler } from './data/saveScheduler';
import { StoryScheduler, normalizeStoryUnit } from './data/storyScheduler';
import { createObsPackCache, readObsStoryPresentation } from './data/obsStory';
import { recordRecentStory } from './data/obsRecency';
import { modeOf, placeKey, recordPlace } from './data/place';
import { gapMarkerOf, spliceSection, spliceVerse, spliceVerseGap, verseBody } from './data/usfm/splice';
import { indexBook } from './data/usfm/indexer';
import { RESOURCE_FRAME, forgetProjectFrames, resolveProjectFrame } from './data/projectFrame';
import { backfillCoverage } from './data/coverageBackfill';
import { mapReference } from './data/mapReference';
import { seedBookFromSource } from './data/seed';
import { SOURCE_MISSING, SOURCE_NOT_INSTALLED, isSourceAbsent } from './data/sourceState';
import { BOOK_NAMES, bookName } from './data/bookNames';
import { GATEWAYS, gatewayKey, DCS_HOST, orgForRepoName } from './data/gateways';
import { fetchAndInstallPin, latestReleaseTag, identifyExistingInstall, rezip, unwrapExport, verifySideload } from './data/resourceFetch';
import { isNotFoundError } from './data/serverApi';
import { readInstalled, recordInstalled, coverageFromLocal, languageSetFromInstalled, mergeOptionalPins, isPinLocal, unsatisfiedProjectPinFor, pinsPreferringInstalled, localRepoPathFromRepoPath, installedPathFor, discoverOnDisk, flavorOfMetadata } from './data/installed';
import { OBS_TOOL_SLOT, TOOL_SLOT, coverageFor, preflightObsTool, preflightToolBook, recordMatchesResolution, resolutionRecord, resolveObsSetSlot, resolveToolBook, resolveSetSlot, samePath } from './data/resolve';
import {
  deriveForProject,
  deriveObsItems,
  isDecided,
  mergeAndReattach,
  progressOf,
  referenceParts,
  scopeRangesFor,
  textKeyOf,
} from './data/derive';
import { readTwArticle, readTaArticle } from './data/articles';
import { revalidateAgainstDraft, resolutionWarning } from './data/revalidate';
import { bootstrapVerse, linkWord, unlinkWord, moveWord, mergeAlignments, splitAlignment, stampTargetVerse, alignmentIsStale, reflowAlignment, settleDone, markDone } from './data/align/edit';
import { linksFor, rebindSuggestions, sessionInputFor, trainingVersesFor } from './data/align/suggest';
import { consequencesOfGatewayChange, applyGatewayChange, uncoveredByChange } from './data/gatewayChange';
import { carryOverDecisions } from './data/carryOver';
import { applyUpgrade, latestReleasesForSet, offerForSet, offerIsStale, repinOffer } from './data/upgrade';
import { LADDER } from './data/burritoStore';
import { TC_READY_TOPIC } from './data/serverApi';
import { t } from './i18n';
import { checkpointMessage } from './data/checkpoint';
import { INSTALLED_SUITE, SUITE_VERSION } from './data/installedSuite';
import { obsFrameSetMismatch } from './data/obsFrameSet';
import { parseStory, storyIpath } from './data/journal/runtime';
export { SUITE_VERSION }; // the AddBook badge imports it from here

const AppCtx = createContext(null);
const STORAGE_ID = 'uw-tc4';

/** #94: release the fold worker of the store a ref holds, if any. */
const disposeStore = (ref) => {
  ref.current?.dispose?.();
};

/** #94: release a store that never became (or no longer is) the project's — a
 * superseded or failed open, a throwaway store — without touching the one the
 * ref holds. */
const disposeUnless = (store, ref) => {
  if (store && ref.current !== store) store.dispose?.();
};

/** J12 (#256): the upgrade slice at rest — the value it resets to when a
 * project opens or closes, so an offer never outlives the project it was
 * computed for (Codex review round 1). */
const UPGRADE_IDLE = { checking: false, offers: null, offersFor: null, error: null, installing: null, progress: null, preview: null };

export const api = new ServerApi();
// The mode a view is, for a checkpoint message (#183). Views not listed keep their id.
const MODE_NAME = { read: 'Understand', draft: 'Translate', check: 'Check', publish: 'Community Checking' };
// A leave-project checkpoint still running after its store was torn down
// (#183), by repoPath. An open of the same project waits for it, so it never
// reads a half-regenerated tree.
const leaveCheckpoints = new Map();

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
const roleOf = (repo, kind = 'bible') => {
  const name = repo.name || '';
  if (kind === 'obs') {
    if (/_obs$/.test(name)) return { k: 'obs', name: 'sources.roleObsText', bookScoped: false, fixed: true };
    if (/_obs-tn$/.test(name)) return { k: 'obs-notes', name: 'sources.roleNotes', bookScoped: false };
    if (/_obs-twl$/.test(name)) return { k: 'obs-words', name: 'sources.roleWords', bookScoped: false };
    if (repo.flavor === 'x-obsimages') return { k: 'obs-images', name: 'sources.roleObsImages', bookScoped: false };
    if (/_tq$|_tn$|_twl$|_(?:ust|gst)$/.test(name) || repo.flavor === 'textTranslation') return null;
  } else if (/_twl$/.test(name) || /_obs(?:-|$)/.test(name)) return null;
  for (const [suffix, role] of Object.entries(ROLE_BY_SUFFIX)) {
    if (name.endsWith(suffix)) return role;
  }
  return ROLE_BY_FLAVOR[repo.flavor] ?? null;
};

/** Build the modal's package rows for ONE book from the platform's live
 * catalog. A repo is offered only when it carries the `tc-ready` topic AND —
 * for book-scoped resources — its own `book_codes` cover the book. Coverage
 * comes from the platform, so the rows never over-promise. */
export function packageRows(repos, book, exclude = {}, kind = 'bible') {
  const code = book.toUpperCase();
  const rows = [];
  for (const r of repos) {
    if (!Array.isArray(r.topics) || !r.topics.includes(TC_READY_TOPIC)) continue;
    const role = roleOf(r, kind);
    if (!role) continue;
    const codes = (r.book_codes || []).map((c) => c.toUpperCase());
    if (role.bookScoped && codes.length > 0 && !codes.includes(code)) continue;
    const k = `${role.k}:${r.name}`;
    rows.push({
      k,
      name: role.name.includes('.') ? t(role.name) : role.name,
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
let installedCache = null; // null until resolutionContext has run once (B12); then the InstalledMap, possibly empty
const resolveReadPath = (pin) =>
  installedPathFor(installedCache ?? {}, pin) ?? localRepoPathFromRepoPath(pin.repoPath);

// Resolution of a pin to its local repo, for READING. Delegates to the
// identity-based resolver above.
const localSourceRepo = (pin) => resolveReadPath(pin);


// B7 — `checking/resources.json` is ONE shared whole-file document (every
// project pin). A read-modify-write that writes blindly loses a concurrent
// editor's change (W-5): two sessions each change a different pin, and the
// second save restores the first's pin to its stale value. Do it under
// compare-and-swap; on a refused (stale) write, re-read and re-apply the
// mutation against the fresh bytes so BOTH changes survive.
// `stillCurrent` (#189): re-checked after the md5 read, right before the
// write — the project may have been left during that read, and a write then
// would land behind its leave checkpoint (#183). Returns null when it declines.
const updateResources = async (store, mutate, tries = 4, stillCurrent = () => true) => {
  for (let attempt = 0; ; attempt += 1) {
    const { value, md5 } = await store.readResourcesWithMd5();
    if (!stillCurrent()) return null;
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

/** #63: a check item is keyed by its resource verse. When the draft holds
 * that verse inside a span ("2:9-10"), the span's text is the verse's text —
 * so the item can be re-checked against the span, and a decision on it
 * revalidates against the words it can actually see. */
function withSpanMembers(index) {
  const out = { ...index };
  for (const [ref, text] of Object.entries(index)) {
    const [chapter, key] = ref.split(':');
    const m = /^(\d+)-(\d+)$/.exec(key);
    if (!m) continue;
    for (let n = Number(m[1]); n <= Number(m[2]); n++) out[`${chapter}:${n}`] ??= text;
  }
  return out;
}

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
export function isOldTestament(bookCode) {
  return Object.keys(BOOK_NAMES).indexOf(bookCode.toUpperCase()) < 39;
}

/** usfm-js verse objects for one verse of a source book — the aligner's
 * input. A span ("9-10", #63) is its member verses' objects in order: the
 * span's draft is aligned against both original verses as one text. */
function verseObjectsFor(usfmText, chapter, verse) {
  // Catch-to-absence sweep (D30): null = the text is PRESENT but could not
  // be parsed — the alignment surface states 'unreadable', never the false
  // "not on this computer" claim that sends the user to re-download.
  try {
    const verses = usfm.toJSON(usfmText)?.chapters?.[String(chapter)] ?? {};
    const m = /^(\d+)-(\d+)$/.exec(String(verse));
    const members = m ? Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => String(Number(m[1]) + i)) : [String(verse)];
    return members.flatMap((v) => verses[v]?.verseObjects ?? []);
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
  // Issue #95: the open in flight, or null. { repoPath, stage: 'journal' |
  // 'state' | 'prepare', done, total, startedAt }. The OpenProgress view shows
  // it only after a show-threshold, so a fast open flashes nothing.
  opening: null,
  book: null,
  chapter: 1,
  bookRaw: null, // raw USFM string — the editing source of truth
  bookError: null,
  // OBS story editing is a separate model: story numbers are not Bible books.
  storyNumbers: [],
  storyNumber: null,
  story: null,
  sourceStory: null,
  storyImages: {},
  storyImageNote: null,
  storyLoading: false,
  storyError: null,
  storySource: null,
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
  // #100: the align and check SaveSchedulers' states, mirrored the same way.
  // The indicator folds all four (worst wins); every navigation gate drains
  // all four (saveRefs), so a failed alignment or decision write blocks a
  // switch exactly like a failed verse write (FR-32).
  alignSaveState: 'saved',
  checkSaveState: 'saved',
  storySaveState: 'saved',
  storySaveError: null,
  // #183: a checkpoint commit (D9: leaving the project, switching mode) that
  // failed. Shown in the save indicator's error state with a Retry; a commit
  // never blocks navigation.
  commitError: null,
  // The repoPath that owes a checkpoint after leaving it failed (#183). The
  // checkpoint is retried when that project opens again; no store is opened
  // for a project that is not current (open() sets the shell's current project).
  commitErrorRepo: null,
  // Modals (the owner's design: creation, add-book, and settings are dialogs
  // over Home, not separate pages)
  modal: null, // null | 'newProject' | 'addBook' | 'settings' | 'sources' | 'fix'
  np: null, // New Bible form
  ab: null, // Add-a-book form
  st: null, // Project-settings form
  // #9: the guided fix screen for a pinned resource this machine lacks —
  // { tool, pin, candidates: ResourcePin[], busy: 'fetch'|'sideload'|null, error, progress }
  fix: null,
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
  // J12 (#256): the on-demand resource upgrade. `offers` is per rung after a
  // "Check for updates" and is bound to the project it was computed for
  // (`offersFor`); `installing` names the rung whose release is being
  // downloaded; `preview` is the confirmation awaiting the user (D72 point 5).
  upgrade: UPGRADE_IDLE,
  aligning: false, // the align surface is open
  alignIndex: null, // #129: { items: [{ref, text, status, placed, total}] } | { error } — the rail's derived verse list
  alignVerse: null, // "chapter:verse" being aligned, or null for the first drafted
  alignSession: null, // { record, armed, ref, … } — the open alignment surface
  checkTool: null, // the open checking tool, or null at the preflight screen
  checkSession: null, // { items, progress, resource, activeIndex } — derived, never stored
  pickerProgress: null, // #136 (D3d): { seq, [tool]: {done,total,dropped,nextItem}|{error}, align: {…,nextRef} } — derived on picker open, never stored
  toolPos: {}, // #136: in-memory only — "your place is saved in each tool", keyed `${tool}:${book}`; dies with the app (§4.2)
  progressByProject: {}, // repoPath -> { CODE: draftPct } (lazy Home cache)
  // Last OBS story per project; user-machine state, never project data.
  obsStoryByProject: {},
  // The stories edited most recently per project on this machine (#328): the
  // collapsed Home card's tiles, newest first. User-machine state, never the project.
  obsRecentByProject: {},
  // Where the user last worked per book and per story (#329): mode, chapter or
  // story, verse or frame, Check tool. A Home tile returns there. Per client.
  placeByProject: {},
  // The frame in focus on the story screens (0 the title); the tile restore sets it.
  storyFrame: null,
  draftUnits: {}, // repoPath -> 'section' | 'verse'
  alignSuggestions: {}, // #1: repoPath -> true when the suggestions switch is on (per client, never in the project)
  // #1: the suggestion engine's state for the open project — status 'off' |
  // 'training' | 'ready' | 'none' | 'few' | 'error'; `testament` names the model
  // the status is about (one model per original language, owner ruling 2026-09-12).
  alignSuggest: { status: 'off', testament: null, verses: 0, error: null },
  lastEdit: null, // { repoPath, book, chapter, verse, snippet, at, mode?, tool? } — the Home Resume card; per-client settings, never the project. mode: 'read'|'draft'|'check'; tool only when mode is 'check'.
  tick: 0,
});

/** Monotonic identity for check sessions (see patchCheckSession). */
let checkSessionSeq = 0;
/** §10.5 (#291): the book position of an OBS project's check session and
 * decision sidecar (`checking/<toolId>/OBS.json`); the session itself is
 * scoped to the open story, as a Bible session is to the open book. */
const STORY_BOOK = STORY_FILE;
const isObsProject = (st) => st.project?.flavor === 'textStories';
/** The book position the note and check writers key on: the open book, or
 * `OBS` for a story project (#290: one note path for both kinds). */
const unitBookOf = (st) => (isObsProject(st) ? STORY_BOOK : st.book);
/** Does this project still hold what the Resume record points at? A Bible
 * record names one of the project's book codes; a story project has no book
 * codes at all, and its record names the `OBS` position (#290). The two forms
 * never cross: a Bible record can never resume a story project, and a story
 * record can never resume a Bible one. A record for a project that no longer
 * exists must not offer a Resume into nothing, so the caller matches the
 * repository path as well. */
export const resumeRecordHolds = (lastEdit, project) =>
  (project?.flavor === 'textStories'
    ? lastEdit?.book === STORY_BOOK
    : (project?.bookCodes || []).includes(lastEdit?.book));
let fixSeq = 0; // #9: identity of the open guided-fix screen (completions bind to it)

/** #129 (PR #135 review round 1): align-session identity and the align
 * rail's read ordering. The §5.1 writes themselves ride the align
 * SaveScheduler since #100 (one write discipline, D65); the old module-level
 * promise chain is gone with it. */
let alignSessionSeq = 0;
let alignIndexSeq = 0;
let pickerProgressSeq = 0;
let storyOpenSeq = 0;

/** #136 (D3d): one picker-progress derivation run's identity. The seq is
 * stored ON state.pickerProgress, and the reducer merge refuses entries from
 * any other run — three tools settle concurrently, and a stale run's entry
 * (book switched, picker re-entered) must never land. */
function pickerToolEntry(state, a) {
  if (state.pickerProgress?.seq !== a.seq) return state;
  return { ...state, pickerProgress: { ...state.pickerProgress, [a.tool]: a.entry } };
}

/** #136: the card's numbers, taken from the SAME assembled session the tool
 * would open — one counting rule (isDecided/progressOf), never a second. */
function pickerEntryFromSession(session) {
  return {
    done: session.progress.decided,
    total: session.progress.total,
    dropped: session.dropped ?? null,
    nextItem: session.items.find((it) => !isDecided(it)) ?? null,
  };
}

/** #136: the Align card's numbers, from the same derivation as the align
 * rail (alignIndexItems). Verses count when drafted; done = fully placed. */
function alignPickerEntry(items) {
  const drafted = items.filter((it) => it.status !== 'undrafted');
  return {
    done: drafted.filter((it) => it.status === 'valid').length,
    total: drafted.length,
    dropped: null,
    nextRef: drafted.find((it) => it.status === 'todo' || it.status === 'invalid')?.ref ?? null,
  };
}

/** #136: one item's remembered position — content identity, not an index,
 * so a re-derived (or re-ordered) list still finds the same check. */
const checkPosOf = (item) => ({
  ...referenceParts(item.contextId.reference),
  groupId: item.contextId.groupId,
  occurrence: item.contextId.occurrence ?? 1,
});
const samePos = (item, pos) => {
  const p = checkPosOf(item);
  return p.c === pos.c && p.v === pos.v && p.groupId === pos.groupId && p.occurrence === pos.occurrence;
};

/** #136: where a tool opens — remembered place, else first undecided, else
 * item 1. */
function checkStartIndex(items, pos) {
  const byPos = pos ? items.findIndex((it) => samePos(it, pos)) : -1;
  if (byPos >= 0) return byPos;
  const todo = items.findIndex((it) => !isDecided(it));
  return todo >= 0 ? todo : 0;
}

/** Test hooks (#136): the picker card model is unit-tested. */
export const __pickerEntryFromSessionForTests = pickerEntryFromSession;
export const __alignPickerEntryForTests = alignPickerEntry;
export const __checkStartIndexForTests = checkStartIndex;
export const __checkPosOfForTests = checkPosOf;

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

/** One decision merged item-by-item (never a whole-array snapshot): two
 * decisions can be in flight at once, and a stale array would overwrite the
 * earlier item. Since #100 the merge is OPTIMISTIC (the write rides the check
 * scheduler); the session's saveError is owned by the checkSaveState mirror,
 * which clears it when the scheduler recovers — never by a later decision. */
function checkDecisionSaved(state, a) {
  const cs = state.checkSession;
  if (!cs?.items || cs.seq !== a.seq) return state;
  const items = cs.items.map((it, i) => (i === a.index ? a.item : it));
  return { ...state, checkSession: { ...cs, items, progress: progressOf(items) } };
}

/** #100: the align scheduler's state mirror. */
function alignSaveState(state, a) {
  return { ...state, alignSaveState: a.state };
}

/** #100: the check scheduler's mirror. A retained failure names its key
 * (tool|book|checkId) so the session marks the RIGHT item after the fact
 * (D59 refusal); recovery clears both. Merged from the reducer's own state
 * (S1 hazard class), like noteSaveState. */
function checkSaveState(state, a) {
  const next = { ...state, checkSaveState: a.state };
  if (!state.checkSession?.items) return next;
  return {
    ...next,
    checkSession: { ...state.checkSession, saveError: a.saveError ?? null, saveErrorKey: a.saveErrorKey ?? null },
  };
}

/** J12 (#256): atomic merge into the upgrade slice — same hazard as patchSrc
 * (an action awaits between dispatches, so a captured snapshot would clobber). */
function patchUpgrade(state, a) {
  return { ...state, upgrade: { ...state.upgrade, ...a.patch } };
}

/** Check-session, save-mirror and slice merge actions, table-dispatched ahead
 * of the main switch. */
const CHECK_SESSION_CASES = { patchCheckSession, checkDecisionSaved, pickerToolEntry, alignSaveState, checkSaveState, patchUpgrade };

function setSourceEntry(state, a) {
  if (a.value === undefined || a.value === null) {
    const next = { ...state.sources };
    delete next[a.id];
    return { ...state, sources: next };
  }
  return { ...state, sources: { ...state.sources, [a.id]: a.value } };
}

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
      return setSourceEntry(state, a);
    case 'noteSaved': {
      // Atomic merge of ONE persisted comprehension note (S1, adversarial
      // round 19): two per-target saves can complete in the same batch, and
      // building the whole `understand` from a captured stateRef snapshot
      // dropped the sibling's entry — the reducer's own state is the only
      // safe base (same hazard class as patchSrc/setSource above). A foreign
      // completion (project or book changed since the write was staged)
      // updates nothing.
      if (unitBookOf(state) !== a.book || state.project?.repoPath !== a.repoPath) return state;
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

/** An OBS project's draft percentage (D74): frames with a non-empty paragraph
 * over the fixed frame total of the fifty stories, read through the story
 * parser; the title (frame 0) is not a frame. Any drafted frame shows as at
 * least 1% — one frame of the ~600 rounds to 0, and a first save must move the
 * tile. null when a read failed: unknown, never a false 0% (D30). */
async function obsDraftPercent(reader) {
  return (await obsStoryProgress(reader)).OBS;
}

/** The percentage of one story's frames, on the same rule (#328). */
const storyPercent = (drafted, frames) => (drafted === 0 || frames === 0 ? 0 : Math.max(1, Math.round((drafted / frames) * 100)));

/** Per-story draft progress for Home's story tiles (#328), and the project's
 * percentage over every frame (D74). A story whose read fails is `pct: null`
 * (unknown, never a false 0%, D30) and leaves the project percentage null too.
 * `sourceTitle(n)` supplies the gateway title for a story with no drafted
 * title; absent, the tile shows the number alone. */
async function obsStoryProgress(reader, sourceTitle = async (_n) => '') {
  let numbers;
  try {
    numbers = await reader.listStories();
  } catch {
    return { OBS: null, stories: [] };
  }
  const stories = [];
  let frames = 0;
  let drafted = 0;
  let unknown = false;
  for (const n of numbers) {
    try {
      const { story } = await reader.readStory(n);
      const done = story.frames.filter((f) => f.text !== '').length;
      frames += story.frames.length;
      drafted += done;
      let title = story.title;
      if (!title) {
        try { title = (await sourceTitle(n)) || ''; } catch { title = ''; }
      }
      stories.push({ number: n, title, pct: storyPercent(done, story.frames.length), frames: story.frames.length, drafted: done });
    } catch {
      unknown = true;
      stories.push({ number: n, title: '', pct: null, frames: 0, drafted: 0 });
    }
  }
  return { OBS: unknown ? null : storyPercent(drafted, frames), stories };
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

async function assertObsSourceCompatible(apiClient, store, pin, installed) {
  const local = installedPathFor(installed, pin);
  if (!local) throw new Error(`OBS source ${pin.repoPath}@${pin.sha} is not installed`);
  const projectNumbers = await store.listStories();
  const sourceNumbers = (await apiClient.listPaths(local))
    .map((ipath) => /^content\/(\d{2})\.md$/.exec(ipath)?.[1])
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
  const current = await Promise.all(projectNumbers.map((number) => store.readStory(number).then((got) => got.story)));
  const incoming = await Promise.all(sourceNumbers.map(async (number) =>
    parseStory(await apiClient.readIngredient(local, storyIpath(number)))));
  const mismatch = obsFrameSetMismatch(current, incoming);
  if (mismatch) throw new Error(`OBS source frame set is incompatible: ${mismatch}`);
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
    return { state: 'ready', testament, raw: usfmText, chapters: parseChapters(usfmText) };
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

/** #1: the training corpus for one testament — every verse with a placed
 * word across the project's books of that testament, as the engine's
 * positional view (suggest.ts). The open book reads from the live draft and
 * the align buffer; the other books from disk. */
async function collectTrainingVerses({ store, sched, project, book, bookRaw, testament }) {
  const codes = (project?.bookCodes || []).filter((code) => (isOldTestament(code) ? 'ot' : 'nt') === testament);
  const out = [];
  for (const code of codes) {
    const raw = code === book ? bookRaw : (await store.readBook(code)).usfm;
    const { file } = code === book ? await alignFileFor(store, sched, code) : await alignFileFor(store, null, code);
    out.push(...trainingVersesFor(code, file, verseTextIndex(raw)));
  }
  return out;
}

/** #213: reflow the alignment records of the verses a draft save changed.
 * One buffered read of the §5.1 file, then one staged record per verse that
 * has links to keep or drop; a verse the reflow cannot account for (or that
 * the save did not change) is not staged, so its record stays byte-identical
 * and the I-3 hash keeps reporting it invalid-and-retained. */
async function reflowAlignedVerses({ store, sched, book, bookRaw, stillCurrent = () => true }, refs) {
  const texts = verseTextIndex(bookRaw);
  const { file } = await alignFileFor(store, sched, book);
  // The read awaited; leaving the project meanwhile drained and disposed this
  // scheduler (#100 teardown) — staging now would write project A's sidecar
  // through its torn-down store, after the D9 leave checkpoint. Refuse.
  if (!stillCurrent()) return;
  for (const ref of refs) {
    const [chapter, verse] = ref.split(':');
    const next = reflowAlignment(file?.chapters?.[chapter]?.[verse], texts[ref] ?? '');
    if (next) sched.markDirty(book, chapter, verse, JSON.stringify(next));
  }
}

/** The §5.1 record is keyed by the PROJECT-frame ref — the draft's own
 * chapter:verse, the key applyAlignEdit writes under. The eng-frame mapping
 * that fetched `origObjects` is a lookup for the source text only and never
 * reaches this read (#134; test/align-session-frame.test.ts). */
async function buildAlignmentSession(store, sched, st, ref, source, origObjects) {
  const targetText = verseTextIndex(st.bookRaw)[ref] ?? '';
  if (!origObjects.length || !targetText) return { unavailable: 'missing' };
  const { file, md5 } = await alignFileFor(store, sched, st.book);
  const [chapter, verse] = ref.split(':');
  const stored = file?.chapters?.[chapter]?.[verse];
  const sourceVersion = `dcs::${source.pin.repoPath.split('/').slice(-2).join('/')}@${source.pin.version}`;
  // A stored record with no alignments — the §8.5 removal form, or the
  // `invalid` record a span create/break leaves on the new key (#63) — has
  // nothing to edit: the editor starts from the bootstrap; the file keeps
  // its flag until the translator saves an alignment.
  const record = stored?.alignments?.length ? stored : bootstrapVerse(targetText, origObjects, sourceVersion);
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
 * check status model: 'valid' = the record says `done` (#271, D73 — set when
 * every word is placed, or by Mark valid), 'invalid' = the draft changed
 * under the record (align.stale), 'todo' = otherwise — plus 'undrafted',
 * which the other tools do not have. */
function alignVerseStatus(rec, text) {
  if (!text) return { status: 'undrafted', placed: 0, total: 0 };
  const placed = rec ? rec.alignments.reduce((n, x) => n + x.bottomWords.length, 0) : 0;
  const total = rec ? placed + rec.wordBank.length : 0;
  // §5.1's own re-review flag outranks the hash check — either means the
  // record no longer vouches for the draft (PR #135 review round 1).
  if (rec && (rec.invalid === true || alignmentIsStale(rec, text))) return { status: 'invalid', placed, total };
  if (rec && rec.done === true) return { status: 'valid', placed, total };
  return { status: 'todo', placed, total };
}
export const __alignVerseStatusForTests = alignVerseStatus;

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

/** The current frame text (frame 0 the title) keyed by `textKeyOf` for I-3
 * revalidation of a story session (§10.4, #291) — the same shape as
 * verseTextIndex, read from the open story, under the story key grammar
 * (#310) so a frame never reads as a verse. */
function frameTextIndex(story) {
  if (!story) return {};
  const out = { [textKeyOf({ story: story.number, frame: 0 })]: story.title };
  story.frames.forEach((frame, i) => { out[textKeyOf({ story: story.number, frame: i + 1 })] = frame.text; });
  return out;
}

async function deriveCheckItems({ apiClient, actions, st, tool, book, pre }) {
  const tsv = await readTextIngredient(apiClient, resolveReadPath(pre.resolution.pin), `${book.toUpperCase()}.tsv`);
  if (tsv === null || tsv.startsWith('{"is_good":false'))
    return { session: emptyCheckSession(tool, book, pre.resolution, 'missing') };
  if (isObsProject(st)) {
    // §10.5 (#291): the OBS helps are ONE story-keyed file (`OBS.tsv`); a
    // story project has no versification frame and no scope — the fifty
    // stories are always in scope (R-10.2.2). The session is the open story.
    const derived = deriveObsItems(tsv, tool, st.storyNumber ?? undefined);
    if (derived.length === 0) return { session: emptyCheckSession(tool, book, pre.resolution, 'none') };
    return { derived, dropped: null, frame: null };
  }
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
  const obs = isObsProject(st);
  const slot = obs ? OBS_TOOL_SLOT[tool] : TOOL_SLOT[tool];
  const rungPins = ['primary', 'fallback']
    .map((rung) => st.projectPins?.languageSets?.[rung]?.[slot])
    .filter(Boolean)
    .map((pin) => ({ repoPath: pin.repoPath, version: pin.version, sha: pin.sha }));
  const warning = resolutionWarning(savedFile?.resource, pre.resolution, rungPins);
  // #63: with the file's resource unchanged there was no re-pin, so a saved
  // `invalidated` is the journal's structural one — kept until re-checked.
  const { items: merged, orphaned } = mergeAndReattach(derived, saved, {
    keepInvalidated: recordMatchesResolution(savedFile?.resource, pre.resolution),
  });
  // #291: a story session revalidates against the open story's frames — the
  // J6 rule applied to frames (a decision's selections that the edited frame
  // no longer carries are flagged, never discarded).
  const verses = obs ? frameTextIndex(st.story) : withSpanMembers(verseTextIndex(st.bookRaw));
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

/** J12 (#256): install every resource of a set's new release, all or nothing.
 * Each repo goes through installPinnedRow — the D23b sha gate, the occupied-
 * path rule and the install record are the same as a project-pin download. A
 * release identity this machine already holds is not fetched again (it was
 * verified when it was installed). The FIRST failure throws with the repo
 * named, and the caller has written nothing to the project yet: the pins, the
 * decision files and the old release's install are all as they were (D72). */
async function installReleaseSet(apiClient, upgrades, local, installed, onProgress = () => {}) {
  for (const u of upgrades) {
    if (isPinLocal(installed, u.to)) continue;
    const repo = u.repoPath.split('/').pop();
    onProgress(repo);
    const target = localRepoPathFromRepoPath(u.repoPath);
    try {
      await installPinnedRow(apiClient, { repo }, u.to, local, target);
    } catch (error) {
      throw new Error(`${repo} ${u.to.version ?? ''}: ${String(error?.message || error)}`.trim());
    }
  }
}
export const __installReleaseSetForTests = (...args) => installReleaseSet(...args);

/** The offer must still describe THIS project's set (Codex round 1): computed
 * for another project, or for pins that have since moved, it is refused
 * before anything is downloaded. */
function assertOfferCurrent(st, offer, currentResources) {
  if (!currentResources) throw new Error('the project has no pin file');
  // A re-pin offer (#9) is built from the open project's pins on the spot, so
  // it carries no "checked for" project; its currency is the pin match alone.
  const bound = offer.kind === 'repin' || st.upgrade.offersFor === st.project?.repoPath;
  if (!bound || offerIsStale(offer, currentResources.languageSets?.[offer.rung])) {
    throw new Error(t('upgrade.stale'));
  }
}

const projectPathOf = (st) => st.project?.repoPath ?? null;

/** #9: which rung pins `pin` in `slot` (D58 identity), or null. */
function rungPinning(resources, slot, pin) {
  return LADDER.find((rung) => {
    const p = resources?.languageSets?.[rung]?.[slot];
    return !!p && samePath(p.repoPath, pin.repoPath) && p.sha === pin.sha;
  }) ?? null;
}

/** Why a previewed upgrade may not be applied now, as the slice patch to
 * dispatch — or null when it may. The preview was planned against ONE
 * project's store and pins and is applied only there (Codex round 2); a
 * blocked book refuses it exactly as confirmGatewayChange refuses. */
function upgradeRefusal(preview, store, st) {
  if (preview.store !== store || preview.repoPath !== projectPathOf(st)) {
    return { preview: null, error: t('upgrade.failed', { reason: t('upgrade.stale') }) };
  }
  if (preview.blocked?.length) {
    return { error: t('gateway.blockedError', { books: preview.blocked.map((b) => b.book).join(', ') }) };
  }
  return null;
}

/** After a confirmed upgrade this set is at the release it was offered; the
 * other set's offer stands. */
function offersAfterUpgrade(offers, preview) {
  return {
    ...(offers ?? {}),
    [preview.rung]: {
      rung: preview.rung,
      upgrades: [],
      current: preview.offer.upgrades.map((u) => u.repoPath).concat(preview.offer.current),
    },
  };
}

/** The new release is on disk: resolve again so coverage and the installed
 * map include it, then plan the D36 carry-over against the upgraded pins. */
async function planUpgradeAfterInstall(a, offer, currentResources) {
  const { installed, coverage, resolutionError } = await a.resolutionContext();
  if (resolutionError) throw new Error(resolutionError);
  const next = upgradedResources(currentResources, offer, coverage);
  const planned = await a.planResourcesChange({ next, installed, coverage });
  return { next, planned };
}

/** The pin file after ONE set's upgrade. Coverage is recorded for the NEW
 * pins only (D41): the other set's pins, the groups and extraScripture stay
 * the very objects the file holds, so an upgrade of one set leaves the rest
 * byte-identical (D72, #256 AC). */
function upgradedResources(currentResources, offer, coverage) {
  const filled = backfillCoverage(applyUpgrade(currentResources, offer), coverage).resources;
  return {
    ...filled,
    languageSets: { ...currentResources.languageSets, [offer.rung]: filled.languageSets[offer.rung] },
    ...(currentResources.resources !== undefined ? { resources: currentResources.resources } : {}),
    ...(currentResources.extraScripture !== undefined ? { extraScripture: currentResources.extraScripture } : {}),
  };
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
  const sameProject = () =>
    originStore &&
    originRepoPath &&
    storeRef.current === originStore &&
    stateRef.current.project?.repoPath === originRepoPath;
  if (!sameProject()) return;
  try {
    const { installed, coverage } = await actions.resolutionContext();
    // #189: the project may have been left during that await; a write now
    // would land behind its leave checkpoint (#183), or beside a new store.
    if (!sameProject()) return;
    if (!mergeOptionalPins(stateRef.current.projectPins ?? {}, originGateway, installed)) return;
    const next = await updateResources(originStore, (current) => {
      const merged = mergeOptionalPins(current, originGateway, installed);
      return merged ? backfillCoverage(merged, coverage).resources : current;
    }, 4, sameProject);
    if (next && sameProject()) dispatch({ type: 'set', patch: { projectPins: next } });
  } catch (error) {
    // #189: a failure that arrives after the project was left belongs to no
    // screen; shown, it would land in Home or in the next project's Sources.
    if (!sameProject()) return;
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

/** The book scheduler's writer (#63). A book flagged by a section save that
 * created or broke a verse span goes through the ONE §8.5 action with
 * `intent: 'spans'`; every other write is the per-verse path (writeBook
 * refuses a slot-set change by design, #62). The store derives the key
 * mapping from what IT projects at write time, so the flag is all the app
 * keeps: taken before the write, put back when the write fails (the retry
 * carries the same buffer), re-set by any later span save. */
async function writeBookOrStructure({ store, structuralRef, alignSchedulerRef }, book, whole) {
  if (!structuralRef.current.has(book)) return store.writeBook(book, whole);
  structuralRef.current.delete(book);
  try {
    await store.applyStructuralEdit(book, whole, { intent: 'spans' });
  } catch (error) {
    structuralRef.current.add(book);
    throw error;
  }
  // #100 (Codex round 1): the structural edit rewrote the alignment sidecar
  // outside the align scheduler — refresh its clean buffer from disk now.
  await alignFileFor(store, alignSchedulerRef?.current, book);
}

/** #63: stage a section save whose verse keys changed (a span created or
 * broken, D70). The book is rewritten ONCE over the affected verses — never
 * spliced verse by verse, which would pass through a slot set no action
 * describes — and the book is flagged for the scheduler's writer. */
function stageStructuralSection({ rawRef, schedulerRef, structuralRef, stateRef, dispatch }, chapter, keys, texts, newKeys) {
  const book = stateRef.current.book;
  const verses = newKeys.map((key) => ({ key, body: (texts[key] ?? '').trim() }));
  rawRef.current = spliceSection(rawRef.current, chapter, keys, verses);
  structuralRef.current.add(book);
  schedulerRef.current.replaceBook(book, rawRef.current);
  dispatch({ type: 'set', patch: { bookRaw: rawRef.current } });
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
async function drainSchedulers(refs) {
  // Round 30/31: the reconcile-before-rest gate lives INSIDE each scheduler
  // (a constructor-injected hook its own retry() runs on a retained
  // failure), so no drain path here — or anywhere — can bypass it.
  // #100: ONE registry (saveRefs: verse, note, align, check) feeds every
  // drain, dispose and navigation gate, so a new scheduler can never be left
  // out of a gate by a call site that forgot it.
  const restState = (sched) => (sched ? sched.getState() : 'saved');
  for (;;) {
    for (const ref of refs) {
      if (ref.current && !(await ref.current.drain())) return false;
    }
    if (refs.every((ref) => restState(ref.current) === 'saved')) return true;
  }
}

/** The pre-#100 shape, kept for the round-23 test and any two-scheduler caller. */
async function drainBothSchedulers({ schedulerRef, noteSchedulerRef }) {
  return drainSchedulers([noteSchedulerRef, schedulerRef]);
}

/** Test hook (round 23): the drain loop is unit-tested — work staged while
 * the OTHER scheduler's drain awaited must flush before anything disposes. */
export const __drainBothSchedulersForTests = drainBothSchedulers;
export const __drainSchedulersForTests = drainSchedulers;

/** The scheduler registry of an open context — older test callers may pass
 * only the verse and note refs; production passes all five schedulers. */
const saveRefsOf = (ctx) =>
  [ctx.schedulerRef, ctx.noteSchedulerRef, ctx.alignSchedulerRef, ctx.checkSchedulerRef, ctx.storySchedulerRef].filter(Boolean);

/** #100: aligning and checking ride the same discipline as verses and notes,
 * each on its own instance (a failing decision must not park alignment
 * saves, and neither parks verses). The align buffer holds the whole §5.1
 * file as JSON, one key per book; the check buffer holds one decision per
 * key (tool|book|checkId), like notes. Both reconcile the store's staged
 * intents before any rest-claim (round 31), inside the machine. */
function installAlignCheckSchedulers({ alignSchedulerRef, checkSchedulerRef, checkTargetsRef, dispatch }, store) {
  if (alignSchedulerRef) {
    const alignSched = new SaveScheduler({
      writeBook: makeAlignWriter({ store }),
      splice: spliceAlignRecord,
      reconcile: () => store.reconcileStaged(),
    });
    alignSchedulerRef.current = alignSched;
    alignSched.subscribe((state) => dispatch({ type: 'alignSaveState', state }));
  }
  if (checkSchedulerRef) {
    checkTargetsRef.current = new Map();
    const checkSched = new SaveScheduler({
      writeBook: makeCheckWriter({ store, checkTargetsRef }),
      splice: (_raw, _chapter, _verse, body) => body,
      reconcile: () => store.reconcileStaged(),
    });
    checkSchedulerRef.current = checkSched;
    checkSched.subscribe((state) => {
      const failure = checkSched.getFailure();
      dispatch({
        type: 'checkSaveState',
        state,
        saveError: state === 'error' ? String(failure?.error?.message || failure?.error || state) : null,
        saveErrorKey: state === 'error' ? (failure?.book ?? null) : null,
      });
    });
  }
}

/** #100: a decision the store REFUSED (D59) for this tool and book is
 * released when the tool re-opens — the way through a refusal is the
 * gateway-change flow, after which the user decides again. The refused
 * decision reverts to what is on disk, and the retry writes whatever else
 * was buffered behind it: a policy refusal must never park navigation
 * forever. */
async function releaseParkedDecision(checkSched, tool, book) {
  const parked = checkSched?.getFailure();
  if (!parked || !parked.book.startsWith(`${tool}|${book}|`)) return;
  // Codex round 1: only a D59 refusal is released by reverting. An ordinary
  // write failure (I/O, a stale file) keeps its payload; the retry carries it.
  if (isDecisionRefusal(parked.error)) checkSched.revertToPersisted(parked.book);
  await checkSched.retry();
}

/** The banner text of a failed store operation (#156): the thrown diagnosis
 * (paths, hashes, mismatches — the #62 diagnosable stop), then the recovery
 * sentence the catalog holds for the refusal code, `refusal.<code>`, when it
 * holds one. The catalog holds none yet: the recovery sentences wait for the
 * owner's copy, so today every banner shows the diagnosis alone. A code without
 * an entry never renders its key. */
const failureText = (e) => {
  const detail = e?.reason || e?.message || String(e);
  const code = refusalCodeOf(e);
  if (code === null) return detail;
  const recoveryKey = 'refusal.' + code;
  const recovery = t(recoveryKey, undefined, '');
  return recovery ? `${detail} ${recovery}` : detail;
};

/** The store's D59 refusal (journalingStore.upsertDecision) ends its message
 * with the decision reference; nothing else the writer throws does. */
const isDecisionRefusal = (error) => /\(D36\/D59\)/.test(String(error?.message ?? error));

/** Every blocker is checked BEFORE anything is disposed (C3). */
async function drainForProjectOpen({ saveRefs }) {
  if (!(await drainSchedulers(saveRefs))) return false;
  for (const ref of saveRefs) ref.current?.dispose();
  return true;
}

async function projectPresentation(apiClient, store, repoPath, summary) {
  let scriptDirection = summary.scriptDirection;
  const directionKnown = scriptDirection === 'ltr' || scriptDirection === 'rtl';
  // Catch-to-absence sweep (D30): 'ltr' is the default for a project
  // GENUINELY without settings.json. A transient read failure must not
  // render an RTL project left-to-right — it aborts the open into the
  // stated bookError (performProjectOpen's catch). The script FONT rides
  // on the same read; when the direction is already known a failed read
  // only costs the font (the scripture face is its default), never the open.
  const settings = await Promise.resolve()
    .then(() => store.readSettings())
    .catch((error) => {
      if (isNotFoundError(error) || directionKnown) return null;
      throw error;
    });
  if (!directionKnown) scriptDirection = settings?.textDirection === 'rtl' ? 'rtl' : 'ltr';
  const textFont = settings?.textFont ?? null;
  // A failed metadata read must not DEFAULT the scope: scopeRangesFor({})
  // means whole-book, silently disabling §4.2/D26 scope filtering — the
  // journal side refuses this exact defaulting (journalingStore: "seeding or
  // recovery with a defaulted scope would journal a widened scope
  // permanently"). Propagate to the stated bookError; an absent currentScope
  // key on a READABLE document stays {}.
  const meta = await apiClient.getMetadataRaw(repoPath);
  const projectScope = meta?.type?.flavorType?.currentScope ?? {};
  return { scriptDirection, textFont, projectScope };
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
/** A checkpoint commit (D9, #183): commit the project's pending changes with
 * a message derived from them, or do nothing when the tree is clean (the
 * platform records an empty commit otherwise — PLATFORM-NOTES #9). The store
 * queue runs status and commit as one step behind any save in flight. Returns
 * the message it committed, or null. Throws on failure; the caller decides
 * where that shows. */
async function checkpointCommit(store, reason) {
  return store.commitPending((changes) => checkpointMessage(reason, changes));
}

/** Start a checkpoint without awaiting it: the screen moves on at once, the
 * store queue runs the commit behind any save in flight, and the outcome lands
 * in commitError only while that store is still the current one. */
function startCheckpoint({ store, storeRef, dispatch }, reason) {
  checkpointCommit(store, reason)
    .then(() => { if (storeRef.current === store) dispatch({ type: 'set', patch: { commitError: null } }); })
    .catch((e) => { if (storeRef.current === store) dispatch({ type: 'set', patch: { commitError: failureText(e) } }); });
}

/** The project just opened owes the checkpoint that failed when it was left
 * (#183): retry it now, through the store that is open. */
function retryOwedCheckpoint({ store, storeRef, stateRef, dispatch }, repoPath) {
  if (stateRef.current.commitErrorRepo !== repoPath) return;
  dispatch({ type: 'set', patch: { commitErrorRepo: null } });
  startCheckpoint({ store, storeRef, dispatch }, 'retry');
}

/** The leave-project checkpoint (D9, #183), started after the store was torn
 * down: the captured store still owns its per-project queue, so the commit
 * runs behind every drained write, and the screen never waits on it. On
 * failure the project owes the checkpoint (commitErrorRepo) and retries it
 * when opened again; the banner shows on Home, or in that project if it is
 * already open again. Only the latest failure is remembered: an earlier
 * project's pending work is durable in its journal and commits at its own
 * next checkpoint. */
function startLeaveCheckpoint({ store, repoPath, stateRef, dispatch }) {
  const run = checkpointCommit(store, 'leaving the project')
    .then(() => {
      if (stateRef.current.commitErrorRepo === repoPath) dispatch({ type: 'set', patch: { commitError: null, commitErrorRepo: null } });
    })
    .catch((e) => {
      const st = stateRef.current;
      const visible = st.view === 'home' || st.project?.repoPath === repoPath;
      const message = `${t('app.commitError')}: ${failureText(e)}`;
      dispatch({ type: 'set', patch: { commitErrorRepo: repoPath, ...(visible ? { commitError: message } : {}) } });
    })
    .finally(() => { if (leaveCheckpoints.get(repoPath) === run) leaveCheckpoints.delete(repoPath); });
  leaveCheckpoints.set(repoPath, run);
}

/** The drain gate before an open. Never abandon unsaved work: drain BOTH
 * schedulers first, and stay put if a write failure remains (FR-32; B3/M1/M6;
 * notes held to the same rule — B1/D65). Returns true when the open may
 * proceed. A refusal or a throwing drain ends the request; when that request
 * is still the latest one, no open proceeds, so an earlier request's progress
 * record (superseded before it could clear its own) is cleared here, and a
 * thrown error is surfaced in the Home banner (#95, Codex rounds 1 and 3). */
async function gateProjectOpen({ saveRefs, dispatch, superseded }) {
  let canOpen;
  try {
    canOpen = await drainForProjectOpen({ saveRefs });
  } catch (e) {
    if (!superseded())
      dispatch({ type: 'set', patch: { bookError: e?.reason || e?.message || String(e), view: 'home', opening: null } });
    return false;
  }
  if (!canOpen) {
    if (!superseded()) dispatch({ type: 'set', patch: { opening: null } });
    return false;
  }
  return !superseded();
}

function writeStoryUnit(store, unit, text) {
  const writers = {
    title: () => store.writeTitle(unit.story, text),
    ref: () => store.writeRef(unit.story, text),
    frame: () => store.writeFrame(unit.story, unit.frame, text),
  };
  return writers[unit.kind]();
}

/** The story scheduler of an open OBS project. A durable numbered-frame write
 * changes the project's draft percentage (D74), so it drops Home's cached
 * value; the title (frame 0) and the reference line do not count (#289). */
function installStoryScheduler({ storySchedulerRef, store, dispatch, onFrameSaved, onStorySaved = undefined }) {
  if (!storySchedulerRef) return;
  storySchedulerRef.current = new StoryScheduler({
    write: async (unit, text) => {
      await writeStoryUnit(store, unit, text);
      onStorySaved?.(unit, text);
      if (unit.kind === 'frame') onFrameSaved?.(unit, text);
    },
  });
  const storySched = storySchedulerRef.current;
  storySched.subscribe((storySaveState) => {
    const failure = storySched.getFailure();
    dispatch({
      type: 'set',
      patch: {
        storySaveState,
        storySaveError: storySaveState === 'error'
          ? String(failure?.error?.message || failure?.error || storySaveState)
          : null,
      },
    });
  });
}

function activeStoryForReload({ originStore, originRepoPath, storeRef, stateRef }) {
  const current = stateRef.current;
  if (originStore !== storeRef.current) return null;
  if (originRepoPath !== current.project?.repoPath) return null;
  if (current.project?.flavor !== 'textStories') return null;
  return current.storyNumber == null ? null : current.storyNumber;
}

async function reloadActiveStoryAfterDownload({ originStore, originRepoPath, storeRef, stateRef, actions }) {
  const storyNumber = activeStoryForReload({ originStore, originRepoPath, storeRef, stateRef });
  if (storyNumber == null) return;
  // #312: no override — the open derives the pins from the state, and states
  // no source condition while they are unknown (a failed or pending read).
  await actions.openStory(storyNumber);
}

async function openProjectContent({ summary, store, repoPath, scriptDirection, textFont, bookCode, superseded, dispatch, actions, stateRef, pinsReady = Promise.resolve({ pins: undefined, failed: false }) }) {
  if (summary.flavor !== 'textStories') {
    await actions.openBook(bookCode || summary.bookCodes[0]);
    if (superseded()) return;
    return;
  }
  const numbers = await store.listStories();
  if (superseded()) return;
  dispatch({ type: 'set', patch: { storyNumbers: numbers } });
  // #328: a Home story tile names its story where a book tile names its book;
  // else the story this client last had open here; else the first.
  const remembered = stateRef.current.obsStoryByProject?.[repoPath];
  const asked = Number(bookCode);
  const first = numbers.includes(asked) ? asked : numbers.includes(Number(remembered)) ? Number(remembered) : numbers[0];
  // #312: the story opens ONCE, with the pins known. A story read before the
  // pins arrive states "no gateway story is pinned" for a moment and is then
  // read again; the screen must never state a source condition the pins have
  // not decided. `pinsReady` is loadProjectPins' read; when it FAILED the
  // pins are unknown, and the story opens with its source unstated until the
  // read is retried (loadProjectPins reopens the story on arrival).
  const { pins, failed } = await pinsReady;
  if (superseded()) return;
  if (first !== undefined) await actions.openStory?.(first, failed ? undefined : pins, {
    store,
    project: { ...summary, scriptDirection, textFont, repoPath },
    storyNumbers: numbers,
    pinsKnown: !failed,
  });
}

function obsStoryOpenContext({ storyNumber, context, stateRef, storeRef }) {
  const state = stateRef.current;
  const store = context.store ?? storeRef.current;
  const project = context.project ?? state.project;
  const repoPath = project?.repoPath;
  const number = Number(storyNumber);
  const storyNumbers = context.storyNumbers ?? state.storyNumbers;
  if (!store || !repoPath || project?.flavor !== 'textStories' || !Number.isInteger(number)) return null;
  if (storyNumbers.length && !storyNumbers.includes(number)) return null;
  return { store, project, repoPath, number, storyNumbers };
}

function isCurrentObsStory({ seq, store, repoPath, storeRef, stateRef }) {
  return seq === storyOpenSeq
    && storeRef.current === store
    && stateRef.current.project?.repoPath === repoPath;
}

function seedObsStory(scheduler, presentation, number) {
  if (!scheduler) return;
  scheduler.seed({ kind: 'title', story: number }, presentation.story.title);
  presentation.story.frames.forEach((frame, index) => scheduler.seed({ kind: 'frame', story: number, frame: index + 1 }, frame.text));
  scheduler.seed({ kind: 'ref', story: number }, presentation.story.ref || '');
}

async function loadObsStory({ api, resolveContext, store, repoPath, number, resources, pinsKnown, packCache, scheduler, seq, storeRef, stateRef, dispatch, rememberObsStory, rememberPlaceForStory = undefined }) {
  try {
    const { installed } = await resolveContext();
    const presentation = await readObsStoryPresentation({ api, store, projectRepo: repoPath, storyNumber: number, resources, installed, packCache, pinsKnown });
    if (!isCurrentObsStory({ seq, store, repoPath, storeRef, stateRef })) return;
    seedObsStory(scheduler, presentation, number);
    // #291: a check session is scoped to one story — a loaded story closes
    // any open session and its picker counts (the book-switch rule).
    checkSessionSeq++;
    dispatch({ type: 'set', patch: { storyNumber: number, story: presentation.story, sourceStory: presentation.sourceStory, storyImages: presentation.images, storyImageNote: presentation.imageNote, storySource: presentation.source, storyLoading: false, storyError: null, checkTool: null, checkSession: null, pickerProgress: null, storyFrame: 1 } });
    rememberObsStory(repoPath, number);
    rememberPlaceForStory?.(number);
  } catch (error) {
    if (isCurrentObsStory({ seq, store, repoPath, storeRef, stateRef }))
      dispatch({ type: 'set', patch: { storyLoading: false, storyError: String(error?.message || error) } });
  }
}

async function openObsStory({ storyNumber, resourcesOverride, context, stateRef, storeRef, saveRefs, dispatch, api, resolveContext, scheduler, rememberObsStory, packCache = undefined, rememberPlaceForStory = undefined }) {
  const target = obsStoryOpenContext({ storyNumber, context, stateRef, storeRef });
  if (!target) return;
  if (!(await drainSchedulers(saveRefs))) return;
  const seq = ++storyOpenSeq;
  dispatch({ type: 'set', patch: { storyNumber: target.number, story: null, sourceStory: null, storyImages: {}, storyImageNote: null, storyLoading: true, storyError: null, storySource: null } });
  await loadObsStory({
    api,
    resolveContext,
    store: target.store,
    repoPath: target.repoPath,
    number: target.number,
    resources: resourcesOverride ?? stateRef.current.projectPins,
    // #312: pins handed over directly are known; otherwise the state says
    // whether the read has landed (a failed read leaves projectPinsLoaded false).
    pinsKnown: context.pinsKnown ?? (resourcesOverride !== undefined || stateRef.current.projectPinsLoaded === true),
    packCache,
    scheduler,
    seq,
    storeRef,
    stateRef,
    dispatch,
    rememberObsStory,
    rememberPlaceForStory,
  });
}

async function performProjectOpen(ctx, repoPath, bookCode) {
  const {
    openProjectSeqRef,
    schedulerRef,
    structuralRef,
    noteSchedulerRef,
    noteTargetsRef,
    alignSchedulerRef,
    storySchedulerRef,
    storeRef,
    stateRef,
    understandSeqRef,
    dispatch,
    actions,
    apiClient,
    makeStore,
    markUsed,
    recordLastEdit,
    invalidateProgress,
    rememberObsEdit,
  } = ctx;
  const saveRefs = saveRefsOf(ctx);
  const seq = ++openProjectSeqRef.current;
  // Invalidate any story read from the project that is being left, even
  // before the replacement store has finished opening.
  storyOpenSeq++;
  const superseded = () => seq !== openProjectSeqRef.current;
  if (!(await gateProjectOpen({ saveRefs, dispatch, superseded }))) return;
  // Issue #95: the open's progress record. Every stage transition and every
  // ~1% of the journal read lands here; the view decides whether to show it.
  const startedAt = Date.now();
  const progress = (stage, done = 0, total = 0) => ({ repoPath, stage, done, total, startedAt });
  let lastReported = -1;
  const onProgress = (p) => {
    if (superseded()) return;
    const step = Math.max(1, Math.floor(p.total / 100));
    if (p.stage === 'journal' && p.done !== p.total && p.done - lastReported < step) return;
    lastReported = p.done;
    dispatch({ type: 'set', patch: { opening: progress(p.stage, p.done, p.total) } });
  };
  dispatch({ type: 'set', patch: { opening: progress('journal') } });
  let store = null;
  try {
    // R-E33-3: the versification frame cache is keyed by repoPath, which is
    // NOT unique across a delete-and-recreate inside one session. Clear it
    // on every open so a new project at a reused path never inherits the
    // previous project's frame — that would key every check in the wrong
    // numbering, and the journal keeps those keys permanently.
    forgetProjectFrames();
    store = makeStore();
    // #183: the leave-checkpoint of this same project may still be regenerating
    // its shared files; open behind it, never against a half-written tree.
    await leaveCheckpoints.get(repoPath);
    if (superseded()) return disposeUnless(store, storeRef);
    // open() runs the issue-#62 recovery pipeline: replay staged intents,
    // classify derived state against the journal, seed a journal-less
    // project universally, reconcile out-of-band USFM — or STOP with a
    // diagnosable report (surfaced through bookError below).
    const summary = await store.open(repoPath, { onProgress });
    if (superseded()) return disposeUnless(store, storeRef); // a newer open owns the refs
    dispatch({ type: 'set', patch: { opening: progress('prepare') } });
    disposeStore(storeRef); // #94: the previous project's fold worker
    storeRef.current = store;
    structuralRef.current = new Set();
    schedulerRef.current = new SaveScheduler({
      writeBook: (book, whole) => writeBookOrStructure({ store, structuralRef, alignSchedulerRef }, book, whole),
      splice: spliceVerse,
    });
    schedulerRef.current.subscribe((saveState) => dispatch({ type: 'set', patch: { saveState } }));
    // D65: the comprehension-note scheduler — same discipline, its own
    // instance (a failing note must not park verse autosave: the failure
    // slot is per instance). Its key is the fully-scoped note identity; the
    // splice degenerates to the whole value.
    noteTargetsRef.current = new Map();
    noteSchedulerRef.current = new SaveScheduler({
      writeBook: makeNoteWriter({ noteTargetsRef, dispatch, apiClient, recordLastEdit }),
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
    installStoryScheduler({
      storySchedulerRef,
      store,
      dispatch,
      onFrameSaved: (unit, text) => {
        invalidateProgress?.(repoPath);
        // #290: a durable frame write is a Resume target (mode 'draft'), as a verse save is.
        recordLastEdit?.({ repoPath, book: STORY_BOOK, chapter: unit.story, verse: unit.frame, snippet: text.trim().slice(0, 90), mode: 'draft', at: Date.now() });
      },
      // #328: every durable story write (title, frame, reference) is an edit of
      // that story for the Home card's recency.
      onStorySaved: (unit) => rememberObsEdit?.(repoPath, unit.story, Date.now()),
    });
    installAlignCheckSchedulers(ctx, store);
    apiClient.setCurrentProject(repoPath).catch(() => {});
    markUsed(repoPath); // fire-and-forget; ordering refreshes next Home visit
    // The platform summary reports script_direction "?" for app-created
    // projects; the wizard recorded the user's choice in settings.json.
    const { scriptDirection, textFont, projectScope } = await projectPresentation(apiClient, store, repoPath, summary);
    if (superseded()) return;
    // A2: the previous project's understand/pins must never survive into
    // this one — clear both with the new project, and invalidate any
    // in-flight loadUnderstand before its completion can land here.
    understandSeqRef.current++;
    dispatch({
      type: 'set',
      patch: {
        project: { ...summary, scriptDirection, textFont, repoPath },
        projectScope,
        view: 'draft',
        projectPins: null,
        projectPinsLoaded: false,
        projectPinsError: null,
        sourcePanes: null,
        understand: null,
        storyNumbers: [],
        storyNumber: null,
        story: null,
        sourceStory: null,
        storyImages: {},
        storyImageNote: null,
        storyLoading: false,
        storyError: null,
        storySource: null,
        storySaveError: null,
        upgrade: UPGRADE_IDLE,
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
    const pinsReady = loadProjectPins({ store, repoPath, storeRef, stateRef, actions, dispatch });
    // B12 — warm the install resolver BEFORE any book/source read, so
    // resolveReadPath's installedCache is populated on a cold open.
    await actions.resolutionContext().catch(() => {});
    if (superseded()) return;
    // OBS projects have story ingredients, not a Bible book. Their screen is
    // supplied by #289; opening the project must still finish so its stored
    // resource pins can load and survive reopen.
    await openProjectContent({
      summary,
      store,
      repoPath,
      scriptDirection,
      textFont,
      bookCode,
      superseded,
      dispatch,
      actions,
      stateRef,
      pinsReady,
    });
    if (superseded()) return;
    // #183: the Home banner for a failed leave-checkpoint is cleared once a
    // project is open (a failed open keeps it beside the open error). When the
    // project opened is the one that owes that checkpoint, the checkpoint is
    // retried now, through its store; a failure shows in the save indicator.
    dispatch({ type: 'set', patch: { opening: null, commitError: null } });
    retryOwedCheckpoint({ store, storeRef, stateRef, dispatch }, repoPath);
  } catch (e) {
    disposeUnless(store, storeRef); // #94: a failed open's store is never adopted
    if (superseded()) return; // a stale failure must not route the OPEN project Home
    // A failed open surfaces its diagnosable report and never a stuck bar (#95).
    dispatch({
      type: 'set',
      patch: { bookError: failureText(e), view: 'home', opening: null },
    });
  }
}

/** Test hook (round 25): out-of-order open completions are unit-tested — the
 * latest request exclusively owns the refs and the dispatched state. */
export const __performProjectOpenForTests = performProjectOpen;
/** Test hook (#291): the story check session, from the derivation to the revalidated session. */
export const __obsCheckForTests = { deriveCheckItems, completedCheckSession, frameTextIndex };
/** Test hook (#289): the OBS routing, resume, story switch, save and progress
 * paths are unit-tested against the fake rig. */
export const __obsStoryForTests = { openProjectContent, obsStoryOpenContext, openObsStory, installStoryScheduler, writeStoryUnit, obsDraftPercent, obsStoryProgress };

/** Load the read-only helps for the open book (extracted round 33 for the
 * interleaving regressions): tN notes, tQ questions and tW links, each
 * resolved over the §5.3 ladder (D64) and derived exactly like a check
 * session — disposable, never stored (§4.2). The translator's own
 * comprehension notes are read back from the journal. */
/** #290 (J25): the story Understand load. The OBS notes and word links of the
 * OPEN story come from the shared derivation (#291, deriveObsItems), the frame
 * comments from the journal (note.add {story, frame}, read under the `OBS`
 * position). No versification frame and no source panes: the passage is the
 * story itself (s.story / s.sourceStory). Same sequence discipline as the
 * book load: only the latest call may dispatch, on both paths. */
async function performLoadStoryUnderstand(ctx) {
  const { stateRef, storeRef, understandSeqRef, dispatch, actions, apiClient } = ctx;
  const st = stateRef.current;
  const story = st.storyNumber;
  if (story == null || (!st.projectPins && !st.projectPinsLoaded)) {
    understandSeqRef.current++;
    if (stateRef.current.understand) dispatch({ type: 'set', patch: { understand: null } });
    return;
  }
  const seq = ++understandSeqRef.current;
  const store = storeRef.current;
  const prev = st.understand;
  const same = prev && prev.book === STORY_BOOK && prev.story === story;
  dispatch({ type: 'set', patch: { understand: { ...(same ? prev : {}), loading: true, book: STORY_BOOK, story } } });
  const comprehension = () => latestComprehension(store, STORY_BOOK, { state: 'ready' });
  try {
    const { installed, resolutionError } = await actions.resolutionContext();
    const slot = async (tool) => {
      if (resolutionError) return { state: 'error', error: t('understand.resolutionDown', { error: resolutionError }) };
      const pre = preflightObsTool(st.projectPins, tool, { isLocal: (pin) => isPinLocal(installed, pin), online: st.netEnabled });
      const pin = pre.resolution?.pin ?? null;
      const rung = pre.resolution?.rung ?? null;
      if (pre.state !== 'ready') return { state: pre.state === 'unpinned' ? 'none' : pre.state, pin, rung };
      const tsv = await readTextIngredient(apiClient, resolveReadPath(pin), `${STORY_BOOK}.tsv`);
      if (tsv === null || tsv.startsWith('{"is_good":false')) return { state: 'missing', pin, rung };
      return { state: 'ready', items: deriveObsItems(tsv, tool, story), pin, rung, unavailablePrimary: null, dropped: null };
    };
    // #331: the OBS questions are the third read-only help, from the `obs-tq` member (R-10.6.3).
    const [notes, words, questions] = await Promise.all([settleHelp(slot('translationNotes')), settleHelp(slot('translationWords')), settleHelp(slot('translationQuestions'))]);
    if (seq !== understandSeqRef.current) return; // superseded
    dispatch({ type: 'set', patch: { understand: { loading: false, book: STORY_BOOK, story, notes, words, questions, comprehension: comprehension() } } });
  } catch (e) {
    if (seq !== understandSeqRef.current) return;
    dispatch({ type: 'set', patch: { understand: { loading: false, book: STORY_BOOK, story, error: String(e?.message || e), comprehension: comprehension() } } });
  }
}

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
/** Test hook (#290): the story Understand load is unit-tested on the fake rig. */
export const __performLoadStoryUnderstandForTests = performLoadStoryUnderstand;

function loadOrigPane({ store, origPin, code, seq, openSeqRef, stateRef, dispatch, testament }) {
  if (stateRef?.current?.sources?.orig) {
    dispatch({ type: 'setSource', id: 'orig', value: undefined });
  }
  if (!origPin) return;
  readCheckOrigChapters(store, origPin, code)
    .then((res) => {
      if (seq !== openSeqRef.current) return;
      if (res.state === 'ready') {
        dispatch({
          type: 'setSource',
          id: 'orig',
          value: { raw: res.raw, chapters: res.chapters, version: origPin.version ?? null, testament },
        });
      } else if (res.state === 'missing') {
        dispatch({
          type: 'setSource',
          id: 'orig',
          value: sourceAbsence(origPin),
        });
      } else if (res.state === 'error') {
        dispatch({
          type: 'setSource',
          id: 'orig',
          value: { error: res.error },
        });
      }
    })
    .catch((error) => {
      if (seq !== openSeqRef.current) return;
      dispatch({
        type: 'setSource',
        id: 'orig',
        value: { error: String(error?.message || error) },
      });
    });
}

function loadExtraScripturePanes({ store, entries, code, seq, openSeqRef, dispatch }) {
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
          value: isNotFoundError(error) ? sourceAbsence(pin) : { error: String(error?.message || error) },
        });
      });
  }
}

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
  const testament = isOldTestament(code) ? 'ot' : 'nt';
  const origPin = effective?.resources?.originalLanguage?.[testament];
  dispatch({
    type: 'set',
    patch: {
      sourcePanes: ids,
      // Keep the tab valid: an imported project may name panes differently.
      ...(ids.length > 0 && !ids.includes(st.sourceTab) && !(st.sourceTab === 'orig' && origPin) ? { sourceTab: ids[0] } : {}),
    },
  });
  loadOrigPane({ store, origPin, code, seq, openSeqRef, stateRef, dispatch, testament });
  loadExtraScripturePanes({ store, entries, code, seq, openSeqRef, dispatch });
}

/** Test hook (round 37): pane resolution is unit-tested — project pins win,
 * absence is a stated state, and pins-loading defers. */
export const __loadSourcePanesForTests = loadSourcePanes;

/** #164: which absence a CONFIRMED not-found pane read means. The platform answers
 * "no such repository" and "no such book" with the same not-found, so the pin is
 * looked up in the install resolver's cache (evidence for the platform claim: the
 * [VERIFIED] tag in src/data/sourceState.ts): absent there (and the cache HAS run)
 * = the source is not on this computer; present = it lacks the book. Before the
 * resolver has run the answer is unknown and the older, weaker statement stands. */
const sourceAbsence = (pin) =>
  installedCache !== null && installedPathFor(installedCache, pin) == null ? SOURCE_NOT_INSTALLED : SOURCE_MISSING;
export const __setInstalledCacheForTests = (installed) => {
  installedCache = installed;
};

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

/** Returns the outcome of the pins read, `{ pins, failed }` (never rejects), so
 * a story open can wait for it (#312): `pins` is the document or null when
 * absent; `failed` marks a rejected read, whose pins are unknown. The
 * dispatches below run before that promise settles for the caller. */
function loadProjectPins({ store, repoPath, storeRef, stateRef, actions, dispatch }) {
  const stillCurrent = () =>
    storeRef.current === store && stateRef.current.project?.repoPath === repoPath;
  const read = store.readResources();
  read
    .then(async (pins) => {
      if (!stillCurrent()) return;
      dispatch({ type: 'set', patch: { projectPins: pins, projectPinsLoaded: true, projectPinsError: null } });
      // Round 37: the source panes are pin-driven — resolve them now that
      // the pins are known (openBook deferred while they were loading). The
      // document is handed over DIRECTLY: the dispatch above has not
      // rendered yet, so stateRef still holds the old pins.
      actions.reloadSourcePanes?.(pins);
      if (stateRef.current.project?.flavor === 'textStories' && stateRef.current.storyNumber != null)
        void actions.openStory?.(stateRef.current.storyNumber, pins);
      if (!pins) return;
      try {
        const { installed, coverage } = await actions.resolutionContext();
        if (!stillCurrent()) return; // #189: left during the await — no write behind the leave checkpoint
        const adopted = adoptInstalledResources(pins, installed);
        const wouldChange = backfillCoverage(adopted, coverage).changed || adopted !== pins;
        if (!wouldChange) return;
        const next = await updateResources(store, (current) =>
          backfillCoverage(adoptInstalledResources(current, installed), coverage).resources,
        4, stillCurrent);
        if (next && stillCurrent()) {
          dispatch({ type: 'set', patch: { projectPins: next } });
          // #312: the adopted document can add the OBS members (D75) the
          // story was read without — the open story follows the pins.
          if (stateRef.current.project?.flavor === 'textStories' && stateRef.current.storyNumber != null)
            void actions.openStory?.(stateRef.current.storyNumber, next);
        }
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
  return read.then((pins) => ({ pins, failed: false }), () => ({ pins: null, failed: true }));
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
export const __adoptDownloadedPinsForTests = adoptDownloadedPins;

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
function makeNoteWriter({ noteTargetsRef, dispatch, apiClient, recordLastEdit = undefined }) {
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
    // #268: an Understand comment is a Resume target (mode 'read').
    recordLastEdit?.({
      repoPath,
      book,
      chapter: ref.chapter,
      verse: ref.verse,
      snippet: text.trim().slice(0, 90),
      mode: 'read',
      at: Date.now(),
    });
  };
}

/** Test hook (D65): the note writer is unit-tested — frame mapping, the
 * unmappable refusal, and the persisted-text echo. */
export const __makeNoteWriterForTests = makeNoteWriter;

/** #100: the align scheduler's buffer value — the §5.1 file as JSON. An
 * absent file starts as the empty file for the book, so the first record
 * lands in a well-formed file and a later verse's record never wipes it. */
export const alignFileJson = (file, book) =>
  JSON.stringify(file ?? { schemaVersion: 1, book: book.toUpperCase(), chapters: {} });

/** The align scheduler's splice: one verse's record into the buffered file
 * (alignFileWith is the merge persistAlign used). Rapid edits on several
 * verses coalesce into one write; the journal diffs the whole file into one
 * align.verse.set per changed verse (journalingStore.alignmentEvents). */
function spliceAlignRecord(json, chapter, verse, recordJson) {
  const file = JSON.parse(json);
  return JSON.stringify(alignFileWith(file, file.book, `${chapter}:${verse}`, JSON.parse(recordJson)));
}

/** The align scheduler's write: the compare-and-swap of #17, chained on the
 * md5 read right before the write. The scheduler serializes writes per
 * instance, so each write edits the state the previous one left; a stale
 * file (StaleWriteError) is a retained failure with Retry, never a silent
 * overwrite. Bound to the store of the project it was made in (C1). */
/** #100 (Codex round 1): the align buffer is the truth for the open book only
 * while it holds work — an edit in flight, or one retained after a failed
 * write (FR-32), which the disk cannot show yet. At rest it is reloaded from
 * disk on every read, because a §8.5 structural edit (#63: a span created or
 * broken) rewrites the alignment sidecar outside this scheduler; a clean but
 * stale buffer would write the old file over that edit with a fresh md5 and
 * pass the compare-and-swap. `loadBook` cannot throw at rest. */
async function alignFileFor(store, sched, book) {
  if (!sched) {
    const { value: disk, md5 } = await store.readAlignmentsWithMd5(book);
    return { file: disk, md5 };
  }
  // Codex round 3: reads are serialized per scheduler, so an older read can
  // never land its bytes after a newer one — the newer read (the refresh
  // after a structural edit included) starts only when the older has landed.
  const prev = alignReadChains.get(sched) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(() => alignFileForSerial(store, sched, book));
  alignReadChains.set(sched, run);
  return run;
}

const alignReadChains = new WeakMap();

async function alignFileForSerial(store, sched, book) {
  const restBefore = sched.getState() === 'saved';
  const textBefore = sched.bookText(book);
  const { value: disk, md5 } = await store.readAlignmentsWithMd5(book);
  const fresh = alignFileJson(disk, book);
  // Codex round 2: reload only when nothing moved during the read — at rest
  // before and after, and the buffer text unchanged. An edit staged or a
  // save landed meanwhile is newer than the bytes this read returned.
  const stillAtRest = restBefore && sched.getState() === 'saved' && sched.bookText(book) === textBefore;
  if (stillAtRest) sched.loadBook(book, fresh);
  else sched.seedIfAbsent(book, fresh);
  return { file: JSON.parse(sched.bookText(book)), md5 };
}

function makeAlignWriter({ store }) {
  return async (book, json) => {
    const { md5 } = await store.readAlignmentsWithMd5(book);
    await store.writeAlignments(book, JSON.parse(json), md5);
  };
}

/** #268: the previous Resume record's verse/snippet, reused only when that
 * record names this project and book; otherwise nothing. */
function priorEditFor(lastEdit, repoPath, book) {
  if (!lastEdit || lastEdit.repoPath !== repoPath || lastEdit.book !== book) return {};
  return { verse: lastEdit.verse, snippet: lastEdit.snippet };
}

/** Preflight entry is ready to open a Check tool (pin resolved). */
function isCheckToolReady(pre) {
  return Boolean(pre && pre.state === 'ready' && pre.resolution?.pin);
}

/** #268: openProject's pin load is detached — Resume into Check waits for it. */
function waitForProjectPins(stateRef, ms = 20_000) {
  const deadline = Date.now() + ms;
  return new Promise((resolve) => {
    const tick = () => {
      if (stateRef.current.projectPinsLoaded || Date.now() >= deadline) {
        resolve();
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

/** #268: after pins land, re-run preflight until the tool is ready (or timeout). */
async function waitForToolPreflightReady(runPreflight, stateRef, tool, ms = 20_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    await runPreflight();
    if (stateRef.current.preflight?.[tool]?.state === 'ready') return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return stateRef.current.preflight?.[tool]?.state === 'ready';
}

/** #136/#268: land an assembled check session — place, dispatch, Resume record, loads. */
function settleOpenedCheckSession({ a, dispatch, tool, book, session, partial, toolPos, recordCheckLastEdit }) {
  // #136: open at the remembered in-memory position, else the first
  // undecided item, else item 1 ("your place is saved in each tool").
  if (!partial) {
    session.activeIndex = checkStartIndex(session.items, toolPos?.[`${tool}:${book}`]);
  }
  dispatch({ type: 'set', patch: { checkTool: tool, checkSession: session } });
  // #268: opening a Check tool is a Resume target (mode + tool).
  recordCheckLastEdit(tool, session.items?.[session.activeIndex]);
  if (partial) return;
  a.loadActiveArticle(session);
  a.loadCheckOrigSource(session);
}

/** The check scheduler's key: one live register per decision (§8.5). */
export const checkKeyFor = (tool, book, checkId) => `${tool}|${book}|${checkId}`;

/** The check scheduler's write: one §5.2 decision through the store, with
 * the session's resolution from the target registry (the note-writer
 * pattern). A D59 refusal throws; the scheduler retains the decision and
 * the mirror names the key, so the refusal reaches the RIGHT item after the
 * fact and later decisions stay buffered, never lost (FR-32). */
function makeCheckWriter({ store, checkTargetsRef }) {
  return async (key, json) => {
    const target = checkTargetsRef.current.get(key);
    if (!target) throw new Error(`decision target unknown: ${key}`);
    await store.upsertDecision(target.tool, target.book, JSON.parse(json), target.resource ?? undefined);
  };
}

/** Test hooks (#100): the two writers and the align splice are unit-tested
 * against the real scheduler — N rapid saves, md5 chaining, the D59 refusal
 * landing on its key with later decisions retained. */
export const __alignSaveForTests = { makeAlignWriter, spliceAlignRecord, makeCheckWriter, alignFileFor, releaseParkedDecision };
/** Test hook (#134): the session build, driven on a cross-frame project so the
 * read key and the write key are proven to be the same project-frame ref. */
export const __buildAlignmentSessionForTests = buildAlignmentSession;
/** Test hook (#213): the reflow over the real align scheduler — changed verses
 * staged, untouched verses byte-identical. */
export const __reflowAlignedVersesForTests = reflowAlignedVerses;

function buildChapterVerses(bookRaw, chapters, entries) {
  const byChapter = {};
  const PARA_IN_GAP = /\\(?:p|m|pi\d?|pm|pmo|nb|b|q\d?|li\d?|lh|lf|lim\d?)\b/;
  let prev = null;
  for (const e of entries) {
    const body = bookRaw.slice(e.start, e.end).trim();
    const drafted = body !== '' && body !== '___';
    const sameCh = prev && prev.chapter === e.chapter;
    const gap = sameCh ? bookRaw.slice(prev.end, e.start) : '';
    const para = !sameCh || PARA_IN_GAP.test(gap);
    const format = sameCh ? gapMarkerOf(gap) : null;
    (byChapter[e.chapter] ||= []).push({
      n: e.verseKey,
      drafted,
      para,
      format,
      text: drafted ? verseText(chapters[e.chapter]?.[e.verseKey]) : '',
      body: drafted ? body : '',
    });
    prev = e;
  }
  return byChapter;
}

function calcDraftPct(entries, bookRaw) {
  if (!entries.length) return 0;
  const draftedCount = entries.filter((e) => {
    const b = bookRaw.slice(e.start, e.end).trim();
    return b !== '' && b !== '___';
  }).length;
  return Math.round((draftedCount / entries.length) * 100);
}

export function AppProvider({ children }) {
  const [s, dispatch] = useReducer(reducer, undefined, initial);
  const storeRef = useRef(null);
  const schedulerRef = useRef(null);
  // #63: the books whose next write is a verse-span change (a section save
  // that changed the verse set), for the scheduler's writer (writeBookOrStructure).
  const structuralRef = useRef(new Set());
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
  // #100: the align and check schedulers and the decision target registry.
  // saveRefs is THE list every drain, dispose and gate iterates.
  const alignSchedulerRef = useRef(null);
  // #1: the suggestion engine's Web Worker (one per open project) and the
  // request counter that lets a stale reply be ignored.
  const suggestWorkerRef = useRef(null);
  const suggestSeqRef = useRef(0);
  const suggestRetrainRef = useRef(null);
  // One training in flight at a time; a request that arrives meanwhile is
  // remembered once and runs after (a training is minutes, not milliseconds).
  const suggestTrainingRef = useRef(false);
  const suggestPendingRef = useRef(false);
  const checkSchedulerRef = useRef(null);
  const checkTargetsRef = useRef(new Map());
  const storySchedulerRef = useRef(null);
  const saveRefs = useRef([schedulerRef, noteSchedulerRef, alignSchedulerRef, checkSchedulerRef, storySchedulerRef]).current;
  const openProjectSeqRef = useRef(0); // openProject sequence token (round 25): the latest open owns the refs
  // #312: the picture-pack listings of the open project. Keyed by the open
  // (a reopen lists again) and by installEpoch (an install lists again).
  const obsPackCacheRef = useRef({ key: null, packs: null });
  // #329: the place records as this session last folded them, and the debounced
  // write's timer. Refs, not state: two observations in one tick (a restore's
  // chapter, then its mode) must fold onto each other, and stateRef lags a
  // dispatch until the next render.
  const placesRef = useRef(null);
  const placeTimerRef = useRef(null);
  const obsPackCache = () => {
    const key = `${openProjectSeqRef.current}|${stateRef.current.installEpoch}`;
    if (obsPackCacheRef.current.key !== key) obsPackCacheRef.current = { key, packs: createObsPackCache() };
    return obsPackCacheRef.current.packs;
  };
  const articleSeqRef = useRef(0); // help-article completion token (D3, adversarial round 4)

  // ---- derived display model -------------------------------------------------
  const model = useMemo(() => {
    if (!s.project || !s.book || s.bookRaw == null) return { book: null, progress: {} };
    const chapters = parseChapters(s.bookRaw);
    const entries = indexBook(s.bookRaw);
    const byChapter = buildChapterVerses(s.bookRaw, chapters, entries);
    const chapterNums = Object.keys(byChapter)
      .map(Number)
      .sort((a, b) => a - b);
    const draftPct = calcDraftPct(entries, s.bookRaw);
    return { book: { code: s.book, byChapter, chapterNums, draftPct }, progress: {} };
  }, [s.project, s.book, s.bookRaw, s.tick]);

  const sourceModel = useMemo(() => {
    const src = s.sources[s.sourceTab];
    if (!src || isSourceAbsent(src)) return src || null;
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
      // #356: under the desktop shell the close decision belongs to the
      // Electron main process (setCanClose below drives its "Unsaved
      // changes" dialog). A beforeunload cancel there shows no prompt: it
      // silently refuses the close, and a standing save failure made the
      // window unclosable. Only a browser gets the cancel.
      if (window.electronAPI?.setCanClose) return;
      // Comprehension notes, alignments and decisions are project work too
      // (A4, #100): every scheduler must be at rest before the window may
      // close silently.
      const unsaved = saveRefs.some((ref) => ref.current && ref.current.getState() !== 'saved');
      if (unsaved) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const onHide = () => {
      for (const ref of saveRefs) void ref.current?.drain();
      void flushLastEdit();
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('pagehide', onHide);
    };
  }, []);

  // #356: the desktop shell's close path. The Pankosmia Electron template
  // asks "Unsaved changes — close anyway?" only while the client has told it
  // the work is not saved (preload `electronAPI.setCanClose`). Mirror the
  // five schedulers' rest into it on every transition, so a retained failure
  // (FR-32) still lets the window close through that dialog, never through
  // Task Manager. Absent bridge (a browser): nothing to do.
  useEffect(() => {
    const allSaved = [s.saveState, s.noteSaveState, s.alignSaveState, s.checkSaveState, s.storySaveState]
      .every((state) => (state ?? 'saved') === 'saved');
    window.electronAPI?.setCanClose?.(allSaved);
  }, [s.saveState, s.noteSaveState, s.alignSaveState, s.checkSaveState, s.storySaveState]);

  // Most-recently-USED ordering (owner, 2026-07-31; creation counts as use).
  // "Use" is user-machine state, so it lives in the platform's per-client
  // settings (0.18.4 endpoint, inside the D31 pin) — never in the project
  // (Phase-2 sync must not carry my open times) and never in localStorage.
  // ONE writer for the per-client settings document (Codex review of #138):
  // every mutation is a read-modify-write of the LATEST document, applied in
  // order, so lastUsed and lastEdit can never clobber each other and a slow
  // earlier write can never land after a later one.
  let settingsChain = Promise.resolve();
  function updateClientSettings(mutate) {
    const run = settingsChain
      .then(async () => {
        const cs = await api.getClientSettings(STORAGE_ID);
        await api.setClientSettings(STORAGE_ID, mutate(cs));
      })
      .catch(() => {
        /* rig without storage_id.json — the record lives for this session only */
      });
    settingsChain = run;
    return run;
  }

  function markUsed(repoPath) {
    return updateClientSettings((cs) => ({ ...cs, lastUsed: { ...(cs.lastUsed || {}), [repoPath]: Date.now() } }));
  }

  // OBS has no Bible book/chapter identity. Keep the last story in the same
  // per-client settings document as the Home ordering, keyed by project.
  function rememberObsStory(repoPath, storyNumber) {
    if (!repoPath || !Number.isInteger(Number(storyNumber))) return;
    const story = Number(storyNumber);
    const next = { ...(stateRef.current.obsStoryByProject || {}), [repoPath]: story };
    dispatch({ type: 'set', patch: { obsStoryByProject: next } });
    updateClientSettings((cs) => ({
      ...cs,
      obsStoryByProject: { ...(cs.obsStoryByProject || {}), [repoPath]: story },
    }));
  }

  // #328: the stories edited most recently in a project, newest first, in the
  // same per-client settings document. One entry per story; three kept.
  function rememberObsEdit(repoPath, storyNumber, at) {
    if (!repoPath || !Number.isInteger(Number(storyNumber))) return;
    const story = Number(storyNumber);
    const current = stateRef.current.obsRecentByProject || {};
    const next = { ...current, [repoPath]: recordRecentStory(current[repoPath], story, at) };
    dispatch({ type: 'set', patch: { obsRecentByProject: next } });
    updateClientSettings((cs) => ({
      ...cs,
      obsRecentByProject: { ...(cs.obsRecentByProject || {}), [repoPath]: recordRecentStory(cs.obsRecentByProject?.[repoPath], story, at) },
    }));
  }

  // The Home Resume card's target: the same per-client settings record as
  // lastUsed (user-machine state, never the project). Debounced, because
  // editVerse fires per keystroke and the settings write is a server call.
  // The write reads the NEWEST pending record when it runs (never a captured
  // older one), and flushLastEdit forces it before anything reads the document.
  let lastEditTimer = null;
  let pendingLastEdit = null;
  function flushLastEdit() {
    clearTimeout(lastEditTimer);
    lastEditTimer = null;
    if (!pendingLastEdit) return settingsChain;
    return updateClientSettings((cs) => {
      const rec = pendingLastEdit;
      pendingLastEdit = null;
      return rec ? { ...cs, lastEdit: rec } : cs;
    });
  }
  // Home's progress cache for one project: dropped, with a generation bump so
  // an older in-flight loadProgress cannot repopulate it (Codex review of #138).
  const progressGen = new Map();
  function invalidateProgress(repoPath) {
    progressGen.set(repoPath, (progressGen.get(repoPath) || 0) + 1);
    const progressByProject = { ...stateRef.current.progressByProject };
    delete progressByProject[repoPath];
    dispatch({ type: 'set', patch: { progressByProject } });
  }
  // #329: one observation of where the user is, folded into the per-unit place
  // record: the caller names what it knows (a mode switch names the mode, a
  // chapter click the chapter, a frame click the frame); the rest is kept.
  function rememberPlace(next = {}) {
    const st = stateRef.current;
    const repoPath = st.project?.repoPath || st.project?.id;
    if (!repoPath) return;
    const obs = next.story !== undefined ? next.story !== null : isObsProject(st);
    const key = placeKey(obs ? { story: next.story ?? st.storyNumber } : { book: next.book ?? st.book });
    const mode = next.mode ?? modeOf(st.view);
    if (!key || !mode) return;
    const base = placesRef.current ?? st.placeByProject ?? {};
    const prior = base[repoPath]?.[key];
    // What the caller does not name comes from the record, not from the state:
    // the state lags a dispatch, and a restore names the chapter (or frame) in
    // one call and the mode in the next.
    const chapter = next.chapter ?? prior?.chapter ?? (obs ? st.storyNumber : st.chapter);
    const tool = mode === 'check' ? (next.tool ?? prior?.tool ?? st.checkTool ?? undefined) : undefined;
    const places = recordPlace(base, repoPath, key, { mode, chapter, verse: next.verse, tool, at: Date.now() });
    placesRef.current = places;
    dispatch({ type: 'set', patch: { placeByProject: places } });
    clearTimeout(placeTimerRef.current);
    placeTimerRef.current = setTimeout(() => {
      void updateClientSettings((cs) => ({
        ...cs,
        placeByProject: { ...(cs.placeByProject || {}), [repoPath]: { ...((cs.placeByProject || {})[repoPath] || {}), ...places[repoPath] } },
      }));
    }, 500);
  }
  function recordLastEdit(rec) {
    // #329: an edit is the sharpest observation of the place: mode, chapter, verse (or story, frame).
    rememberPlace(rec.book === STORY_BOOK
      ? { story: Number(rec.chapter), mode: rec.mode, chapter: rec.chapter, verse: rec.verse, tool: rec.tool }
      : { book: rec.book, mode: rec.mode, chapter: rec.chapter, verse: rec.verse, tool: rec.tool });
    // The edit changes this project's draft percentages, so its cached Home
    // progress is stale; Home re-reads it on the next visit.
    invalidateProgress(rec.repoPath);
    dispatch({ type: 'set', patch: { lastEdit: rec } });
    pendingLastEdit = rec;
    clearTimeout(lastEditTimer);
    lastEditTimer = setTimeout(() => { void flushLastEdit(); }, 1000);
  }
  // #268: Check open / decision — same Resume record shape, mode 'check' + tool.
  function recordCheckLastEdit(tool, item) {
    const st = stateRef.current;
    const repoPath = st.project?.repoPath || st.project?.id;
    // #290: a story session records under `OBS` with the story as the
    // chapter and the frame as the verse — the shape Home's Resume reads.
    const book = unitBookOf(st);
    if (!repoPath || !book) return;
    const prior = priorEditFor(st.lastEdit, repoPath, book);
    const ref = item?.contextId?.reference;
    recordLastEdit({
      repoPath,
      book,
      chapter: isObsProject(st) ? st.storyNumber : st.chapter,
      verse: (ref ? referenceParts(ref).v : undefined) ?? prior.verse ?? '1',
      snippet: prior.snippet ?? '',
      mode: 'check',
      tool,
      at: Date.now(),
    });
  }

  async function readHomeSettings() {
    const fallback = { lastUsed: {}, lastEdit: null, draftUnits: {}, alignSuggestions: {}, obsStoryByProject: {}, obsRecentByProject: {}, placeByProject: {} };
    try {
      // A pending Resume record is written before the document is read, so
      // a Home visit within the debounce never reads an older record.
      await flushLastEdit();
      const cs = await api.getClientSettings(STORAGE_ID);
      return {
        lastUsed: cs.lastUsed || {},
        lastEdit: cs.lastEdit || null,
        draftUnits: cs.draftUnits || {},
        alignSuggestions: cs.alignSuggestions || {},
        obsStoryByProject: cs.obsStoryByProject || {},
        obsRecentByProject: cs.obsRecentByProject || {},
        placeByProject: cs.placeByProject || {},
      };
    } catch {
      /* fall back to creation-date order from listProjects */
      return fallback;
    }
  }

  /** The persisted places under this session's (a record made here is newer). */
  function mergePlaces(local, persisted) {
    const out = { ...(persisted || {}) };
    for (const [repoPath, units] of Object.entries(local || {})) out[repoPath] = { ...(out[repoPath] || {}), ...units };
    return out;
  }

  function mergeObsStoryHistory(persisted) {
    return { ...(stateRef.current.obsStoryByProject || {}), ...persisted };
  }

  async function refreshProjects() {
    try {
      const reader = new ProjectReader({ api });
      const projects = await reader.listProjects();
      const { lastUsed, lastEdit: persistedLastEdit, draftUnits, alignSuggestions, obsStoryByProject, obsRecentByProject, placeByProject } = await readHomeSettings();
      let lastEdit = persistedLastEdit;
      // Never regress the in-session record to an older persisted one (a rig
      // without client settings keeps the session's record).
      const local = stateRef.current.lastEdit;
      if (local && (!lastEdit || (local.at || 0) >= (lastEdit.at || 0))) lastEdit = local;
      projects.sort(
        (a, b) =>
          Math.max(lastUsed[b.id] || 0, b.timestamp || 0) -
          Math.max(lastUsed[a.id] || 0, a.timestamp || 0),
      );
      // A record for a project that no longer exists (deleted, other rig)
      // must not offer a Resume into nothing (resumeRecordHolds).
      const resumable = lastEdit && projects.some((p) => p.id === lastEdit.repoPath && resumeRecordHolds(lastEdit, p));
      // Review of the D30 sweep: a successful listing clears the LISTING
      // failure's banner (projects was null) — an open-failure banner from
      // performProjectOpen is left alone (projects was already an array).
      dispatch({
        type: 'set',
        patch: { projects, lastEdit: resumable ? lastEdit : null, draftUnits, alignSuggestions, obsStoryByProject: mergeObsStoryHistory(obsStoryByProject), obsRecentByProject: { ...(stateRef.current.obsRecentByProject || {}), ...obsRecentByProject }, placeByProject: (placesRef.current = mergePlaces(placesRef.current ?? stateRef.current.placeByProject, placeByProject)), ...(stateRef.current.projects === null ? { bookError: null } : {}) },
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
        // B1/D65: navigation is flush-and-go (owner ruling 2026-08-28), and a
        // FAILED write holds navigation (FR-32). #100: every scheduler — an
        // alignment or decision made before the switch is on disk before the
        // checkpoint below reads the project, and the failure is visible in
        // the save indicator.
        if (!(await drainSchedulers(saveRefs))) return;
        const st = stateRef.current;
        const from = st.view;
        dispatch({ type: 'set', patch: { view } });
        if (view !== 'home') rememberPlace({ mode: modeOf(view) });
        // #183 (D9): a mode switch is a checkpoint. Started, not awaited: a
        // failure lands in commitError, never in the way.
        if (st.project && storeRef.current && from !== view && from !== 'home') {
          const store = storeRef.current;
          startCheckpoint({ store, storeRef, dispatch }, `leaving ${MODE_NAME[from] ?? from}`);
        }
      },

      /** Retry the last failed checkpoint commit (#183). */
      retryCheckpoint: async () => {
        const st = stateRef.current;
        const store = storeRef.current;
        if (!st.project || !store) return;
        try {
          await checkpointCommit(store, 'retry');
          dispatch({ type: 'set', patch: { commitError: null } });
        } catch (e) {
          dispatch({ type: 'set', patch: { commitError: failureText(e) } });
        }
      },

      closeModal: () => dispatch({ type: 'set', patch: { modal: null, np: null, ab: null, st: null, fix: null } }),

      setDraftUnit: (unit) => {
        const st = stateRef.current;
        const key = st.project?.repoPath || st.project?.id;
        if (!key) return;
        dispatch({ type: 'set', patch: { draftUnits: { ...st.draftUnits, [key]: unit } } });
        return updateClientSettings((cs) => ({ ...cs, draftUnits: { ...(cs.draftUnits || {}), [key]: unit } }));
      },
      /** #1: the suggestions switch — per client per project, in the platform's
       * client-settings record like draftUnits; nothing about it enters the
       * project. Turning it on starts training; turning it off drops the
       * engine and any standing proposals. */
      setAlignSuggestions: (on) => {
        const st = stateRef.current;
        const key = st.project?.repoPath || st.project?.id;
        if (!key) return;
        const alignSuggestions = { ...st.alignSuggestions };
        if (on) alignSuggestions[key] = true;
        else delete alignSuggestions[key];
        dispatch({ type: 'set', patch: { alignSuggestions } });
        if (on) a.trainAlignSuggestions();
        else a.stopAlignSuggestions();
        return updateClientSettings((cs) => ({ ...cs, alignSuggestions }));
      },

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
        // A missing OBS source is actionable from the story screen. Reuse the
        // project's pinned gateway when it is known, so the Sources modal
        // opens directly on the OBS package rows instead of making the user
        // choose a language and a Bible book that OBS does not use.
        const current = stateRef.current;
        const primaryGateway = current.project?.flavor === 'textStories'
          ? current.projectPins?.languageSets?.primary?.gatewayLanguage
          : null;
        const gateway = primaryGateway
          ? GATEWAYS.find((candidate) => candidate.id === primaryGateway.languageId && samePath(candidate.org, primaryGateway.owner))
          : null;
        if (gateway) {
          dispatch({ type: 'patchSrc', patch: { gateway, rows: [], loading: false, error: null, dl: null } });
        }
        await Promise.all([a.refreshNet(), a.refreshCheckable()]);
        if (gateway) await a.loadPackage(gateway, current.src.book);
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
        const kind = stateRef.current.project?.flavor === 'textStories' ? 'obs' : 'bible';
        const checkable = GATEWAYS.filter((g) => languageSetFromInstalled(installed, g, kind))
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
          const kind = stateRef.current.project?.flavor === 'textStories' ? 'obs' : 'bible';
          const rows = packageRows(repos, book, stateRef.current.src.exclude, kind);
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
        const kind = st.project.flavor === 'textStories' ? 'obs' : 'bible';
        const proposedPrimary = languageSetFromInstalled(installed, gateway, kind);
        if (!proposedPrimary) throw new Error(t('sources.suiteIncomplete', { lang: gateway.name }));
        const { value: currentResources, md5: resourcesMd5 } = await store.readResourcesWithMd5();
        const current = currentResources ?? INSTALLED_SUITE;
        if (kind === 'obs') await assertObsSourceCompatible(api, store, proposedPrimary.obs, installed);
        const next = backfillCoverage(applyGatewayChange(current, proposedPrimary), coverage).resources;
        const primary = next.languageSets.primary;
        const planned = await a.planResourcesChange({ next, installed, coverage });
        const imageChange = kind === 'obs' ? {
          from: current.languageSets.primary['obs-images'] ?? null,
          to: proposedPrimary['obs-images'] ?? null,
        } : null;
        return { gateway, primary, next, resourcesMd5, imageChange, ...planned };
      },

      /** The D36 carry-over plan for ANY change of the pin file — a gateway
       * change (D23a) or a release upgrade of one set (J12, #256) — computed
       * against the POST-CHANGE resolution, so the dialogue states the exact
       * outcome per (tool, book). Every pin `next` names must be installed:
       * the derives below read local bytes. */
      planResourcesChange: async ({ next, installed, coverage }) => {
        const store = storeRef.current;
        const st = stateRef.current;
        const primary = next.languageSets.primary;
        // Read every stored decision file this project has, so the count is
        // real rather than estimated.
        const decisionUnits = st.project?.flavor === 'textStories' ? ['OBS'] : (st.project?.bookCodes ?? []);
        const { stored, md5s } = await storedGatewayDecisions(store, decisionUnits);
        // Affectedness is judged against the POST-CHANGE resolution (D30's
        // per-(tool, book) ladder), so the counting needs the coverage map.
        const consequences = consequencesOfGatewayChange(
          stored,
          { primary, fallback: next.languageSets.fallback ?? primary },
          coverage,
          st.project?.flavor === 'textStories' ? 'obs' : 'bible',
        );

        // The resource is the primary key (tC3 precedent, 2026-08-04): the
        // check list derived from the NEW resource is the work. Compute that
        // list HERE, so the dialogue states the exact outcome — how many
        // decisions carry over and how many checks come back — instead of a
        // count "at risk". The new suite is installed (the caller proved it),
        // so every derive below reads local bytes.
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
        const obsProject = st.project?.flavor === 'textStories';
        const initiallyBlocked = obsProject || frame.state === 'ready'
          ? uncoveredByChange(consequences.affected, next, coverage, obsProject ? 'obs' : 'bible')
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
        return { consequences, plan, blocked, carried, invalidated };
      },

      // ---- J12 (#256): upgrade a language set to a newer release ---------
      /** Ask DCS for the newest release of every repo each set pins, and
       * offer what differs from the pin — per set, on demand, online only
       * (D72 point 5). Nothing here writes: an offer is a fact on screen. */
      checkForUpdates: async () => {
        const st = stateRef.current;
        const pins = st.projectPins;
        if (!pins?.languageSets) return null;
        if (!st.netEnabled) {
          dispatch({ type: 'patchUpgrade', patch: { error: t('upgrade.offline') } });
          return null;
        }
        const offersFor = st.project?.repoPath ?? null;
        dispatch({ type: 'patchUpgrade', patch: { checking: true, error: null, offers: null, offersFor } });
        try {
          const offers = {};
          for (const rung of LADDER) {
            const set = pins.languageSets[rung];
            if (!set) continue;
            const latest = await latestReleasesForSet(set);
            offers[rung] = offerForSet(rung, set, latest);
          }
          // Bound to the project the check was made for (Codex round 1): a
          // project switch during the awaits above drops the answer.
          if (stateRef.current.project?.repoPath !== offersFor) return null;
          dispatch({ type: 'patchUpgrade', patch: { checking: false, offers } });
          return offers;
        } catch (error) {
          dispatch({
            type: 'patchUpgrade',
            patch: { checking: false, error: t('upgrade.checkFailed', { reason: String(error?.message || error) }) },
          });
          return null;
        }
      },

      /** Accept one set's offer: install every resource of the release (sha-
       * verified, all or nothing), then compute the D36 carry-over against
       * the new pins and open the confirmation. The pins move only in
       * confirmUpgrade, after the user has read the counts. */
      upgradeSet: async (rung) => {
        const st = stateRef.current;
        const offer = st.upgrade.offers?.[rung];
        if (!offer?.upgrades.length) return null;
        return a.applyOffer(offer);
      },

      /** Install what an offer needs, then plan the D36 carry-over against the
       * moved pins and open the confirmation. Shared by the release upgrade
       * (#256) and the guided fix's re-pin (#9), whose offer names a release
       * this machine already holds. The pins move only in confirmUpgrade. */
      applyOffer: async (offer) => {
        const store = storeRef.current;
        const st = stateRef.current;
        const rung = offer.rung;
        if (!store) return null;
        // The downloads are long and the modal stays closable: a project
        // switch meanwhile makes every later step stale (Codex round 2, the
        // #213 stillCurrent pattern). A stale completion dispatches nothing —
        // the installs it made are harmless machine holdings.
        const repoPath = projectPathOf(st);
        const stillCurrent = () => storeRef.current === store && projectPathOf(stateRef.current) === repoPath;
        dispatch({ type: 'patchUpgrade', patch: { installing: rung, error: null, progress: null } });
        try {
          const { value: currentResources, md5: resourcesMd5 } = await store.readResourcesWithMd5();
          assertOfferCurrent(st, offer, currentResources);
          const local = new Set(await api.listLocalRepos());
          const before = await a.resolutionContext();
          if (before.resolutionError) throw new Error(before.resolutionError);
          await installReleaseSet(api, offer.upgrades, local, before.installed, (repo) => {
            if (stillCurrent()) dispatch({ type: 'patchUpgrade', patch: { progress: t('sources.progress', { repo }) } });
          });
          if (!stillCurrent()) return null;
          const { next, planned } = await planUpgradeAfterInstall(a, offer, currentResources);
          if (!stillCurrent()) return null;
          if (st.project?.flavor === 'textStories' && offer.upgrades.some((u) => u.slots.includes('obs'))) {
            const after = await a.resolutionContext();
            if (after.resolutionError) throw new Error(after.resolutionError);
            await assertObsSourceCompatible(api, store, next.languageSets[rung].obs, after.installed);
          }
          dispatch({
            type: 'patchUpgrade',
            patch: { installing: null, progress: null, preview: { rung, offer, next, resourcesMd5, store, repoPath, ...planned } },
          });
          dispatch({ type: 'set', patch: { installEpoch: stateRef.current.installEpoch + 1 } });
          return next;
        } catch (error) {
          if (stillCurrent()) {
            dispatch({
              type: 'patchUpgrade',
              patch: { installing: null, progress: null, error: t('upgrade.failed', { reason: String(error?.message || error) }) },
            });
          }
          return null;
        }
      },

      cancelUpgrade: () => dispatch({ type: 'patchUpgrade', patch: { preview: null } }),

      // ---- #9: the guided fix screen for a pinned resource this machine lacks --
      /** Open the fix screen for a tool whose preflight found the pinned
       * resource missing. It names the pin and offers the three ways out
       * (D72 point 6): fetch it, re-pin to an installed version of the same
       * repo, or sideload it from a file. Nothing is written by opening. */
      openFix: async (tool) => {
        const st = stateRef.current;
        const pre = st.preflight?.[tool];
        if (!pre) return;
        await a.refreshNet();
        const { installed, coverage, resolutionError } = await a.resolutionContext();
        // The pin to fix: what the preflight said it must fetch, else the pin it
        // resolved to, else — offline, with the pinned copy's coverage unknown
        // (the preflight's `unfetched` branch names nothing) — the pin THAT
        // branch would have named: the first slot pin of the ladder whose
        // coverage is unknown and which this machine lacks (Codex round 1: a
        // pin recorded as NOT covering the book must never be offered).
        const slot = TOOL_SLOT[tool];
        const pin = pre.needs ?? pre.resolution?.pin
          ?? LADDER.map((rung) => st.projectPins?.languageSets?.[rung]?.[slot])
            .filter((p) => p && coverageFor(coverage, p).source === 'none')
            .find((p) => !isPinLocal(installed, p))
          ?? null;
        if (!pin) return;
        const rung = rungPinning(st.projectPins, slot, pin) ?? 'primary';
        // The re-pin candidates: installed copies of the SAME repo at another
        // commit (D58 identity). An identity-read outage is stated, not "none".
        // One dispatch: the slice must exist before any patchFix can land.
        const candidates = Object.values(installed).filter(
          (p) => samePath(p.repoPath, pin.repoPath) && !!p.sha && p.sha !== pin.sha,
        );
        // `id` binds every later completion to THIS screen (Codex round 1): a
        // fetch that finishes after the user closed it and opened another
        // dialog must not close or patch that dialog.
        dispatch({
          type: 'set',
          patch: { modal: 'fix', fix: { id: ++fixSeq, tool, pin, rung, candidates, busy: null, error: resolutionError ?? null, progress: null } },
        });
      },

      /** Patch the fix screen — only while it is still the screen `id` names. */
      patchFix: (id, patch) => {
        const fix = stateRef.current.fix;
        if (fix && fix.id === id) dispatch({ type: 'set', patch: { fix: { ...fix, ...patch } } });
      },

      /** Fetch the pinned identity itself (sb-zip + D23b sha gate), through the
       * same install path a project-pin download takes. */
      fixFetch: async () => {
        const fix = stateRef.current.fix;
        if (!fix || fix.busy) return;
        const { id } = fix;
        if (!stateRef.current.netEnabled) {
          a.patchFix(id, { error: t('fix.offline') });
          return;
        }
        a.patchFix(id, { busy: 'fetch', error: null, progress: t('sources.progress', { repo: fix.pin.repoPath.split('/').pop() }) });
        try {
          const local = new Set(await api.listLocalRepos());
          await installPinnedRow(api, { repo: fix.pin.repoPath.split('/').pop() }, fix.pin, local, localRepoPathFromRepoPath(fix.pin.repoPath));
          await a.finishFix(id);
        } catch (error) {
          a.patchFix(id, { busy: null, progress: null, error: t('fix.failed', { reason: String(error?.message || error) }) });
        }
      },

      /** Sideload: a Scripture Burrito zip from a file. Verified against the
       * pin BEFORE anything is installed (verifySideload); a wrapped DCS
       * export or a flat archive both unwrap. */
      fixSideload: async (file) => {
        const fix = stateRef.current.fix;
        if (!fix || fix.busy || !file) return;
        const { id } = fix;
        a.patchFix(id, { busy: 'sideload', error: null, progress: t('fix.sideload.reading', { name: file.name }) });
        try {
          const unwrapped = unwrapExport(new Uint8Array(await file.arrayBuffer()));
          verifySideload(fix.pin, unwrapped);
          const local = new Set(await api.listLocalRepos());
          const target = localRepoPathFromRepoPath(fix.pin.repoPath);
          // Same occupied-path rule as installPinnedRow (round 20): the exact
          // identity installs side by side rather than over another commit.
          const installPath = local.has(target) ? `${target}--${fix.pin.sha.slice(0, 12)}` : target;
          await api.postZippedBurrito(installPath, rezip(unwrapped.files));
          const flavor = fix.pin.flavor || flavorOfMetadata(await api.getMetadataRaw(installPath));
          await recordInstalled(api, STORAGE_ID, installPath, {
            repoPath: fix.pin.repoPath,
            ...(fix.pin.version ? { version: fix.pin.version } : {}),
            sha: fix.pin.sha,
            flavor,
          });
          await a.finishFix(id);
        } catch (error) {
          a.patchFix(id, { busy: null, progress: null, error: t('fix.failed', { reason: String(error?.message || error) }) });
        }
      },

      /** Re-pin: move the slot(s) pinning the missing identity onto an
       * installed version of the same repo — the #256 offer flow, so the
       * D36 counts are shown and confirmed before the pins move. The fix
       * screen stays open until the confirmation exists (Codex round 1): a
       * planning failure is shown HERE, with the other two ways still at hand. */
      fixRepin: async (candidate) => {
        const store = storeRef.current;
        const fix = stateRef.current.fix;
        if (!store || !fix || fix.busy) return;
        const { id } = fix;
        a.patchFix(id, { busy: 'repin', error: null });
        const current = await store.readResources().catch(() => null);
        const offer = current ? repinOffer(current, fix.rung, fix.pin, candidate) : null;
        if (!offer?.upgrades.length) {
          a.patchFix(id, { busy: null, error: t('upgrade.stale') });
          return;
        }
        const next = await a.applyOffer(offer);
        if (!next) {
          a.patchFix(id, { busy: null, error: stateRef.current.upgrade.error ?? t('upgrade.stale') });
          return;
        }
        // The confirmation exists: it takes over from this screen (one dialogue
        // at a time — two stacked layers fight over focus and scroll).
        if (stateRef.current.modal === 'fix' && stateRef.current.fix?.id === id) a.closeModal();
      },

      /** The resource is on this machine now: refresh what the machine holds
       * and the preflight so the tool card turns ready; close the screen only
       * if it is still the one this operation started from. */
      finishFix: async (id) => {
        dispatch({ type: 'set', patch: { installEpoch: stateRef.current.installEpoch + 1 } });
        await a.refreshCheckable();
        await a.runPreflight();
        if (stateRef.current.modal === 'fix' && stateRef.current.fix?.id === id) a.closeModal();
      },

      /** Move the set's pins and reconcile the decisions — ONE journal action,
       * the same one the gateway change publishes (issue #62). Refused while
       * any book is blocked, exactly as confirmGatewayChange refuses. */
      confirmUpgrade: async (preview) => {
        const store = storeRef.current;
        if (!store || !preview) return;
        const refusal = upgradeRefusal(preview, store, stateRef.current);
        if (refusal) {
          dispatch({ type: 'patchUpgrade', patch: refusal });
          return;
        }
        try {
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
        } catch (e) {
          dispatch({ type: 'patchUpgrade', patch: { error: t('upgrade.failed', { reason: e?.reason || e?.message || String(e) }) } });
          return;
        }
        dispatch({ type: 'set', patch: { projectPins: preview.next } });
        dispatch({
          type: 'patchUpgrade',
          patch: { preview: null, error: null, offers: offersAfterUpgrade(stateRef.current.upgrade.offers, preview) },
        });
        if (stateRef.current.book) await a.runPreflight();
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
        const kind = stateRef.current.project?.flavor === 'textStories' ? 'obs' : 'bible';
        const primary = languageSetFromInstalled(installed, gateway, kind);
        if (!primary) {
          throw new Error(t('sources.suiteIncomplete', { lang: gateway.name }));
        }
        if (kind === 'obs') await assertObsSourceCompatible(api, store, primary.obs, installed);
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
        if (!st.book && st.project?.flavor !== 'textStories') return;
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
          out[tool] = st.project?.flavor === 'textStories'
            ? preflightObsTool(st.projectPins, tool, {
                isLocal: (pin) => isPinLocal(installed, pin), online,
              })
            : preflightToolBook(st.projectPins, tool, st.book, {
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
        // #100: the align scheduler's buffer is the truth for the open book —
        // buildAlignmentSession reads the buffered file (edits pending, or a
        // retained failure) over the disk file, so reopening a verse whose
        // write is still in flight loads the edited record, never the stale one.
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
        // A span counterpart ("9-10") is aligned as one text (#63): its
        // member verses' objects, in order (verseObjectsFor).
        if (!srcRef.ok) return settle({ unavailable: 'no-counterpart' });
        const origObjects = verseObjectsFor(
          source.usfmText,
          srcRef.reference.chapter,
          srcRef.reference.verse,
        );
        if (origObjects === null) {
          // The text is present but unparseable — say that (D30).
          return settle({ unavailable: 'unreadable' });
        }
        const session = await buildAlignmentSession(store, alignSchedulerRef.current, st, ref, source, origObjects);
        settle(session.unavailable ? session : { ...session, frameName: frame.name });
        } catch (error) {
          settle({ error: String(error?.message || error) });
        }
      },

      startAligning: () => {
        alignSessionSeq++;
        // #136: open at the remembered verse, else the picker's next
        // unaligned verse, else the default (first drafted, via openAlign).
        // A remembered verse whose draft was since emptied is skipped
        // (review round 1) — resuming it would open an unavailable session
        // instead of falling through the chain.
        const st = stateRef.current;
        const texts = verseTextIndex(st.bookRaw);
        const alignVerse =
          [st.toolPos?.[`align:${st.book}`], st.pickerProgress?.align?.nextRef].find(
            (ref) => ref && texts[ref],
          ) ?? null;
        dispatch({ type: 'set', patch: { aligning: true, alignSession: null, alignVerse } });
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
          // #100: the rail reflects every edit, landed or buffered.
          const { file } = await alignFileFor(store, alignSchedulerRef.current, book);
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
        const st = stateRef.current;
        dispatch({
          type: 'set',
          patch: {
            alignVerse: ref,
            alignSession: null,
            // #136: remember the place per book — in memory only (§4.2).
            toolPos: { ...st.toolPos, [`align:${st.book}`]: ref },
          },
        });
      },

      /** Select (or clear) the banked word the next card click will place. */
      armAlignWord: (word) => {
        const a2 = stateRef.current.alignSession;
        if (a2) dispatch({ type: 'set', patch: { alignSession: { ...a2, armed: word } } });
      },

      /** #129 (PR #135 review round 1) — ONE path for every alignment edit.
       * The session record updates optimistically and synchronously, so each
       * successive edit builds on the previous one instead of a stale render
       * snapshot. #100: the record is stamped against the draft it was edited
       * on (I-3) and STAGED on the align scheduler — the edit returns at once;
       * the scheduler serializes the §5.1 writes per instance, so two rapid
       * edits can never interleave their read-modify-write or trip the
       * compare-and-swap (#17), and a failed write is retained with Retry. */
      applyAlignEdit: (mutate, disarm = false) => {
        const a2 = stateRef.current.alignSession;
        const sched = alignSchedulerRef.current;
        if (!a2?.record || !sched || !sched.bookText(a2.book)) return;
        const next = mutate(a2.record);
        if (next === a2.record) return;
        // #271: `done` follows the edit — set when the verse is now fully
        // aligned, removed otherwise (an edit takes back Mark valid).
        const record = settleDone(stampTargetVerse(next, a2.targetText));
        // #1: a proposal for a word this edit placed is spent; the rest are
        // re-bound to their card by its first original word (a merge or split
        // moved the indexes) and dropped when that card is gone.
        const suggestions = rebindSuggestions(record, a2.suggestions);
        const optimistic = { ...a2, ...(disarm ? { armed: null } : {}), record, stale: false, suggestions, refusal: null };
        dispatch({ type: 'set', patch: { alignSession: optimistic } });
        const [chapter, verse] = a2.ref.split(':');
        sched.markDirty(a2.book, chapter, verse, JSON.stringify(record));
        // D72: the engine learns from every confirmed save.
        a.retrainAlignSuggestionsSoon();
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

      /** #271 — Mark valid: the translator declares this verse's alignment
       * done, words in the bank or not (D73). The record is restamped to the
       * current draft (I-3) and carries `done: true`, through the same staged
       * write as every other alignment edit. */
      markAlignValid: () => {
        const a2 = stateRef.current.alignSession;
        const sched = alignSchedulerRef.current;
        if (!a2?.record || !sched || !sched.bookText(a2.book)) return;
        // #1 (D72): refused while any suggestion stands — a proposal is not the
        // translator's decision, and "done" must not vouch for one.
        if (a2.suggestions?.length) {
          dispatch({ type: 'set', patch: { alignSession: { ...a2, refusal: 'suggestions' } } });
          return;
        }
        const record = markDone(a2.record, a2.targetText);
        dispatch({ type: 'set', patch: { alignSession: { ...a2, record, stale: false, refusal: null } } });
        const [chapter, verse] = a2.ref.split(':');
        sched.markDirty(a2.book, chapter, verse, JSON.stringify(record));
      },

      // ---- Alignment suggestions (#1, D72 point 3) --------------------------
      // The engine runs in a Web Worker (suggestWorker.ts), one model per
      // testament, trained on this project's own confirmed alignments. A
      // suggestion lives ONLY in alignSession.suggestions: it is never written,
      // never counted, and vanishes when the verse changes or the translator
      // rejects it. Confirming one is a linkWord edit like any other.

      /** The worker for the open project — created on first use, dropped by
       * stopAlignSuggestions (switch off) and by the project teardown. */
      ensureSuggestWorker: () => {
        if (suggestWorkerRef.current) return suggestWorkerRef.current;
        const worker = new Worker(new URL('./data/align/suggestWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event) => a.onSuggestReply(event.data);
        worker.onerror = (event) => {
          dispatch({ type: 'set', patch: { alignSuggest: { status: 'error', testament: stateRef.current.alignSuggest.testament, verses: 0, error: String(event?.message || 'worker') } } });
          // The worker is dead: drop it BEFORE settling, so a pending retrain
          // gets a fresh worker from ensureSuggestWorker instead of posting
          // into the corpse and waiting forever (Codex round 3).
          if (suggestWorkerRef.current === worker) {
            worker.terminate();
            suggestWorkerRef.current = null;
          }
          a.settleTraining(suggestSeqRef.current); // the running training died with the worker
        };
        suggestWorkerRef.current = worker;
        return worker;
      },

      stopAlignSuggestions: () => {
        suggestWorkerRef.current?.terminate();
        suggestWorkerRef.current = null;
        suggestSeqRef.current++;
        clearTimeout(suggestRetrainRef.current);
        suggestTrainingRef.current = false;
        suggestPendingRef.current = false;
        storyOpenSeq++;
        const a2 = stateRef.current.alignSession;
        dispatch({
          type: 'set',
          patch: {
            alignSuggest: { status: 'off', verses: 0, error: null },
            ...(a2?.record ? { alignSession: { ...a2, suggestions: null, refusal: null } } : {}),
          },
        });
      },

      /** Train the open book's testament on every confirmed alignment in the
       * project. Reads each book's draft and sidecar once; fire-and-forget. */
      trainAlignSuggestions: () => {
        const st = stateRef.current;
        const store = storeRef.current;
        const key = st.project?.repoPath || st.project?.id;
        if (!store || !st.book || !key || !st.alignSuggestions?.[key]) return;
        // Coalesce: a training already runs in the worker — remember that one
        // more is wanted and let the running one finish (Codex round 1).
        if (suggestTrainingRef.current) {
          suggestPendingRef.current = true;
          return;
        }
        suggestTrainingRef.current = true;
        suggestPendingRef.current = false;
        const testament = isOldTestament(st.book) ? 'ot' : 'nt';
        const id = ++suggestSeqRef.current;
        dispatch({ type: 'set', patch: { alignSuggest: { status: 'training', testament, verses: 0, error: null } } });
        void collectTrainingVerses({ store, sched: alignSchedulerRef.current, project: st.project, book: st.book, bookRaw: rawRef.current, testament })
          .then((verses) => {
            // An obsolete collection (the switch was cycled, or the project
            // left) owns no lock any more — a newer training may hold it
            // (Codex round 2). Only the CURRENT training settles.
            if (id !== suggestSeqRef.current || storeRef.current !== store) return;
            if (!verses.length) {
              dispatch({ type: 'set', patch: { alignSuggest: { status: 'none', testament, verses: 0, error: null } } });
              a.settleTraining(id);
              return;
            }
            a.ensureSuggestWorker().postMessage({ type: 'train', id, testament, verses });
          })
          .catch((e) => {
            if (id !== suggestSeqRef.current) return;
            dispatch({ type: 'set', patch: { alignSuggest: { status: 'error', testament, verses: 0, error: String(e?.message || e) } } });
            a.settleTraining(id);
          });
      },

      /** The CURRENT training ended (any way): release the lock and run the
       * one that was asked for meanwhile. A stale id releases nothing. */
      settleTraining: (id) => {
        if (id !== suggestSeqRef.current) return;
        suggestTrainingRef.current = false;
        if (suggestPendingRef.current) {
          suggestPendingRef.current = false;
          a.trainAlignSuggestions();
        }
      },

      /** After a confirmed save: retrain once the saves settle (debounced). */
      retrainAlignSuggestionsSoon: () => {
        const st = stateRef.current;
        const key = st.project?.repoPath || st.project?.id;
        if (!key || !st.alignSuggestions?.[key]) return;
        clearTimeout(suggestRetrainRef.current);
        suggestRetrainRef.current = setTimeout(() => a.trainAlignSuggestions(), 3000);
      },

      onSuggestReply: (reply) => {
        if (reply.type === 'trained' || reply.type === 'error') a.settleTraining(reply.id);
        if (reply.id !== suggestSeqRef.current) return; // a stale train/suggest — ignore
        if (reply.type === 'trained') {
          const status = reply.verses ? 'ready' : reply.tooFew ? 'few' : 'none';
          dispatch({ type: 'set', patch: { alignSuggest: { status, testament: reply.testament, verses: reply.verses, error: null } } });
          return;
        }
        if (reply.type === 'error') {
          dispatch({ type: 'set', patch: { alignSuggest: { status: 'error', testament: stateRef.current.alignSuggest.testament, verses: 0, error: reply.message } } });
          return;
        }
        // Bound to the verse and session that asked (Codex round 1): a reply
        // for a verse the translator has since left is discarded, never mapped
        // onto the verse now open.
        const a2 = stateRef.current.alignSession;
        if (!a2?.record || a2.ref !== reply.ref || a2.seq !== reply.session) return;
        const links = linksFor(a2.record, a2.targetText, reply.links);
        dispatch({ type: 'set', patch: { alignSession: { ...a2, suggestions: links, suggesting: false, refusal: null } } });
      },

      /** Suggest: ask the trained model for this verse's unplaced words. */
      suggestAlign: () => {
        const st = stateRef.current;
        const a2 = st.alignSession;
        const worker = suggestWorkerRef.current;
        const testament = isOldTestament(a2?.book ?? '') ? 'ot' : 'nt';
        // Only a model trained for THIS book's testament may be asked.
        if (!a2?.record || !worker || st.alignSuggest.status !== 'ready' || st.alignSuggest.testament !== testament) return;
        const id = suggestSeqRef.current;
        dispatch({ type: 'set', patch: { alignSession: { ...a2, suggesting: true, refusal: null } } });
        worker.postMessage({ type: 'suggest', id, testament, input: sessionInputFor(a2.record, a2.targetText), ref: a2.ref, session: a2.seq });
      },

      /** Confirm one proposal: the same linkWord edit a manual placement makes. */
      acceptAlignSuggestion: (cardIndex, word) =>
        a.applyAlignEdit((record) => linkWord(record, cardIndex, word), true),

      /** Accept all: one edit placing every proposed word, one staged write. */
      acceptAllAlignSuggestions: () => {
        const a2 = stateRef.current.alignSession;
        if (!a2?.suggestions?.length) return;
        const links = a2.suggestions;
        a.applyAlignEdit((record) => links.reduce((r, s) => linkWord(r, s.cardIndex, s.word), record), true);
      },

      /** Reject all / Reset: every proposed word is back in the bank — it never
       * left the record, so there is nothing to undo on disk. */
      rejectAlignSuggestions: () => {
        const a2 = stateRef.current.alignSession;
        if (!a2?.record) return;
        dispatch({ type: 'set', patch: { alignSession: { ...a2, suggestions: null, refusal: null } } });
      },

      /** C2.3/C2.4 — open a checking session for one tool on the open book.
       * Derives the check list from the RESOLVED pin's own TSV (never a
       * fixture), merges the stored §5.2 decisions, and reports progress.
       * Derived lists are disposable and never stored (§4.2). */
      openCheckTool: async (tool) => {
        const st = stateRef.current;
        const pre = st.preflight?.[tool];
        if (!isCheckToolReady(pre)) return;
        // #291: a story session writes under the `OBS` book position (§10.5).
        const book = isObsProject(st) ? STORY_BOOK : st.book;
        // The seq is this session's identity, taken BEFORE any await: a stale
        // open's completion (or failure) must never replace a newer session,
        // and closing the tool or the project invalidates in-flight opens.
        const seq = ++checkSessionSeq;
        await releaseParkedDecision(checkSchedulerRef.current, tool, book); // #100
        if (seq !== checkSessionSeq) return; // a newer open or close won during the release
        dispatch({ type: 'set', patch: { checkTool: tool, checkSession: { loading: true, seq } } });
        rememberPlace({ mode: 'check', tool });
        try {
          const { session, partial } = await assembleCheckSession({
            api, actions: a, store: storeRef.current, stateRef, st, tool, book, pre, seq,
          });
          if (seq !== checkSessionSeq) return; // a newer open or close won
          settleOpenedCheckSession({
            a, dispatch, tool, book, session, partial,
            toolPos: stateRef.current.toolPos,
            recordCheckLastEdit,
          });
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

      /** #268: Resume into a Check tool — wait for pins, then preflight until
       * ready, then open. openProject loads pins in the background. */
      resumeCheckTool: async (tool) => {
        const repoPath = stateRef.current.project?.repoPath || stateRef.current.project?.id;
        const book = stateRef.current.book;
        await waitForProjectPins(stateRef);
        if (!(await waitForToolPreflightReady(a.runPreflight, stateRef, tool))) return;
        const cur = stateRef.current.project?.repoPath || stateRef.current.project?.id;
        if (cur !== repoPath || stateRef.current.book !== book) return;
        await a.openCheckTool(tool);
      },

      /** #136 (D3d, ruled 2026-09-01): per-tool progress for the picker
       * cards, derived on demand — NEVER stored (§4.2). Each ready tool
       * assembles the SAME session the tool would open (one counting rule);
       * Align reuses the rail's derivation. Entries land through a
       * seq-guarded reducer merge, so a stale run cannot regress a newer
       * one; a failed derivation is a stated per-card error and never
       * blocks opening the tool (D30). */
      loadPickerProgress: async () => {
        const st = stateRef.current;
        const store = storeRef.current;
        const obs = isObsProject(st);
        // bookRaw is required (review round 1): revalidation against a
        // not-yet-loaded draft would misreport every decided count. A story
        // session needs the open story for the same reason (#291).
        if (!store || !st.preflight) return;
        if (obs ? !st.story : (!st.book || !st.bookRaw)) return;
        const book = obs ? STORY_BOOK : st.book;
        const seq = ++pickerProgressSeq;
        dispatch({ type: 'set', patch: { pickerProgress: { seq } } });
        const entry = (tool, value) => dispatch({ type: 'pickerToolEntry', seq, tool, entry: value });
        const toolRuns = Object.entries(st.preflight)
          .filter(([, pre]) => pre?.state === 'ready' && pre.resolution?.pin)
          .map(async ([tool, pre]) => {
            try {
              const result = await deriveCheckItems({ apiClient: api, actions: a, st, tool, book, pre });
              if (result.session) {
                entry(tool, { done: 0, total: 0, dropped: result.session.dropped ?? null, nextItem: null, empty: result.session.empty });
                return;
              }
              const session = await completedCheckSession({
                store, st: stateRef.current, tool, book, pre,
                derived: result.derived, dropped: result.dropped,
              });
              entry(tool, pickerEntryFromSession(session));
            } catch (e) {
              entry(tool, { error: String(e?.message || e) });
            }
          });
        const alignRun = (async () => {
          try {
            if (!st.bookRaw || obs) return; // D74: no Align tool for stories
            const { value: file } = await store.readAlignmentsWithMd5(book);
            entry('align', alignPickerEntry(alignIndexItems(st.bookRaw, file)));
          } catch (e) {
            entry('align', { error: String(e?.message || e) });
          }
        })();
        await Promise.all([...toolRuns, alignRun]);
      },

      setCheckIndex: (activeIndex) => {
        const cs = stateRef.current.checkSession;
        if (!cs) return;
        // Reducer-side merge: a concurrently-landing orig/article result must
        // not be clobbered by this snapshot (patchCheckSession hazard note).
        dispatch({ type: 'patchCheckSession', seq: cs.seq, patch: { activeIndex } });
        // #136: remember the place per (tool, book) — in memory only (§4.2).
        const item = cs.items?.[activeIndex];
        if (item) {
          const st2 = stateRef.current;
          dispatch({
            type: 'set',
            patch: { toolPos: { ...st2.toolPos, [`${cs.tool}:${cs.book}`]: checkPosOf(item) } },
          });
        }
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
        // #291: a story has no original-language text (D74: no alignment
        // layer); the compare card shows the gateway story frame instead.
        if (!cs?.items || !store || cs.book === STORY_BOOK) return;
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
      /** C2.6 / #100 — record one decision: the item merges at once and the
       * §5.2 write rides the check scheduler, so the checker's next click
       * never waits on the previous save. A D59 refusal (the store refuses a
       * write whose session resolution disagrees by sha with the stored
       * record) is retained by the scheduler and named on the session's
       * saveErrorKey after the fact; the way through is the gateway-change
       * flow. Later decisions stay buffered behind it, never lost. */
      recordDecision: (patch) => {
        const cs = stateRef.current.checkSession;
        const sched = checkSchedulerRef.current;
        if (!cs?.items || !sched) return;
        const item = cs.items[cs.activeIndex];
        const next = {
          ...item,
          ...patch,
          modifiedTimestamp: new Date().toISOString(),
        };
        const key = checkKeyFor(cs.tool, cs.book, item.contextId.checkId);
        checkTargetsRef.current.set(key, { tool: cs.tool, book: cs.book, resource: cs.resource ?? null });
        // The item as the session holds it is the buffer's persisted value:
        // a refused write reverts to it (openCheckTool), and an unchanged
        // decision compares clean.
        sched.seedIfAbsent(key, JSON.stringify(item));
        // Item-level merge (checkDecisionSaved): two decisions can be in
        // flight at once, and a stale whole-array snapshot would overwrite
        // the earlier item.
        dispatch({ type: 'checkDecisionSaved', seq: cs.seq, index: cs.activeIndex, item: next });
        sched.markDirty(key, 0, '0', JSON.stringify(next)); // whole-value key: chapter/verse are inert
        // #268: a Check decision is a Resume target (mode + tool).
        recordCheckLastEdit(cs.tool, next);
        // A decision is a completed act, like a verse blur: it flushes at
        // once (serialized behind any write in flight), not after the idle
        // window. Not awaited — the checker's next click never waits on it.
        void sched.flushOnBlur();
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
          // A story screen can be the caller of Sources. Once the exact OBS
          // pin is installed, reload the active story so its gateway frame
          // and image pack become usable without making the translator leave
          // and reopen the project.
          await reloadActiveStoryAfterDownload({ originStore, originRepoPath, storeRef, stateRef, actions: a });
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

      // ---- New Open Bible Stories (J20, #287; D74): language, name and the
      //      gateway set — no books, no stories, no versification ----
      openNewObs: () =>
        dispatch({
          type: 'set',
          patch: {
            modal: 'newObs',
            np: { kind: 'obs', name: '', langName: '', code: '', dir: 'ltr', font: SCRIPT_FONTS[0], busy: false, error: null },
          },
        }),

      createObs: async () => {
        const w = stateRef.current.np;
        if (w.busy) return; // reentrancy guard: one create at a time
        const validation = validateNewBible(w);
        if (validation.error) return a.patchNp({ error: validation.error });
        const { abbr } = validation;
        a.patchNp({ busy: true, error: null });
        const store = new JournalingStore({ api });
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
          const { repoPath } = await store.createObsProject({
            content_name: w.name.trim(),
            content_abbr: abbr,
            content_language_code: w.code.trim(),
          });
          await store.open(repoPath);
          // The same pins and settings a Bible project gets at creation: the
          // bundled English suite (which carries the OBS members, #288 / D75)
          // with coverage recorded at pin time, and the language settings the
          // platform does not record (D28 addendum).
          const freshPins = pinsPreferringInstalled(
            INSTALLED_SUITE,
            await readInstalled(api, STORAGE_ID),
          );
          const { coverage: pinCoverage } = await a.resolutionContext();
          await store.writeResources(backfillCoverage(freshPins, pinCoverage).resources, null);
          await store.writeSettings({
            schemaVersion: 1,
            checkingLanguage: 'en',
            textDirection: w.dir,
            textFont: w.font,
            languageName: w.langName.trim() || null,
          }, null);
          await store.commit('Project created (tC4 Increment 7)');
          await markUsed(repoPath); // creation counts as use (owner, 2026-07-31)
          await refreshProjects();
          a.closeModal(); // the story screen is J21 (#289): Home shows the new tile
        } catch (e) {
          a.patchNp({ busy: false, error: e?.reason || e?.message || t('wizard.error') });
        } finally {
          store.dispose(); // #94: a throwaway store's fold worker
        }
      },

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
          }, null); // #9: a first write — the file must still be absent
          await store.commit('Project created (tC4 Increment 1)');
          await markUsed(repoPath); // creation counts as use (owner, 2026-07-31)
          await refreshProjects();
          // Design flow: "You'll add books next" — straight into Add-a-book.
          a.openAddBook({ id: repoPath, name: w.name.trim(), bookCodes: [] });
        } catch (e) {
          a.patchNp({ busy: false, error: e?.reason || e?.message || t('wizard.error') });
        } finally {
          store.dispose(); // #94: a throwaway store's fold worker
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
        const store = new JournalingStore({ api });
        try {
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
          invalidateProgress(f.repoPath); // the new book's tile must not stay unknown
          await refreshProjects();
          a.closeModal();
          await a.openProject(f.repoPath, codes[0]);
        } catch (e) {
          a.patchAb({ busy: false, error: e?.reason || e?.message || t('wizard.error') });
        } finally {
          store.dispose(); // #94: a throwaway store's fold worker
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
        const store = new JournalingStore({ api });
        try {
          await store.open(f.repoPath);
          // #9: compare-and-swap like every other sidecar — the md5 of what
          // was read travels with the write, and a concurrent editor's
          // change is refused (StaleWriteError), never overwritten.
          const { value: current, md5 } = await store.readSettingsWithMd5();
          const settings = current || { schemaVersion: 1 };
          await store.writeSettings({
            ...settings,
            schemaVersion: 1,
            textDirection: f.dir,
            textFont: f.font,
          }, md5);
          await store.commit('Update settings (tC4)');
          await refreshProjects();
          a.closeModal();
        } catch (e) {
          a.patchSt({ busy: false, error: e?.reason || e?.message || t('wizard.error') });
        } finally {
          store.dispose(); // #94: a throwaway store's fold worker
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
        // An invalidation during the read (an edit, a new book) must win over
        // these soon-stale percentages.
        const gen = progressGen.get(project.id) || 0;
        // An OBS project (D74): one percentage over the fifty stories.
        const loadObs = async () => {
          const reader = new ProjectReader({ api });
          try {
            await reader.open(project.id);
          } catch {
            return;
          }
          // #328: an undrafted story's tile carries the gateway title, read
          // from the pinned OBS source when it is on this machine.
          let sourceTitle = async () => '';
          try {
            const [pins, { installed }] = await Promise.all([reader.readResources(), a.resolutionContext()]);
            const pin = pins ? resolveObsSetSlot(pins, 'obs').pin : null;
            const local = pin ? installedPathFor(installed, pin) : null;
            if (local) sourceTitle = async (n) => parseStory(await api.readIngredient(local, storyIpath(n))).title;
          } catch {
            // No gateway on this machine: the tiles show the numbers alone.
          }
          const progress = await obsStoryProgress(reader, sourceTitle);
          if ((progressGen.get(project.id) || 0) !== gen) return;
          dispatch({
            type: 'set',
            patch: { progressByProject: { ...stateRef.current.progressByProject, [project.id]: progress } },
          });
        };
        if (project.flavor === 'textStories') return loadObs();
        // No upper bound on book count: a project with more than 12 books
        // shows only its in-progress books by default, and that filter needs
        // every book's progress.
        if ((project.bookCodes || []).length === 0) return;
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
        if ((progressGen.get(project.id) || 0) !== gen) return;
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

      /** #329: the frame in focus on the story screens; the place record follows it. */
      setStoryFrame: (frame) => {
        const n = Number(frame);
        if (!Number.isInteger(n) || n < 0) return;
        if (stateRef.current.storyFrame === n) return;
        dispatch({ type: 'set', patch: { storyFrame: n } });
        rememberPlace({ verse: n });
      },

      /** #329: open a book or a story from its Home tile and return to where the
       * user last worked in it: the mode, the chapter or story, the verse or
       * frame, the Check tool. Never opened before: the plain open. */
      openProjectAt: async (repoPath, unit) => {
        const before = stateRef.current;
        const project = (before.projects || []).find((p) => p.id === repoPath);
        const story = project?.flavor === 'textStories';
        const key = placeKey(story ? { story: Number(unit) } : { book: unit });
        const place = key ? before.placeByProject?.[repoPath]?.[key] : undefined;
        await a.openProject(repoPath, unit == null ? undefined : String(unit));
        if (!place || stateRef.current.project?.repoPath !== repoPath) return;
        if (story) {
          if (place.verse != null) a.setStoryFrame(Number(place.verse));
        } else if (place.chapter && Number(place.chapter) !== 1) {
          await a.setChapter(place.chapter);
        }
        if (place.mode === 'read') await a.go('read');
        if (place.mode === 'check') {
          await a.go('check');
          if (place.tool) await a.resumeCheckTool(place.tool);
        }
      },

      openProject: (repoPath, bookCode) =>
        performProjectOpen(
          {
            openProjectSeqRef,
            schedulerRef,
            structuralRef,
            noteSchedulerRef,
            noteTargetsRef,
            alignSchedulerRef,
            checkSchedulerRef,
            storySchedulerRef,
            checkTargetsRef,
            storeRef,
            stateRef,
            understandSeqRef,
            dispatch,
            actions: a,
            apiClient: api,
            makeStore: () => new JournalingStore({ api }),
            markUsed,
            recordLastEdit,
            invalidateProgress,
            rememberObsEdit,
          },
          repoPath,
          bookCode,
        ),

      /** Open one OBS story from the catalog returned by the project store. */
      openStory: async (storyNumber, resourcesOverride = undefined, context = {}) => {
        return openObsStory({
          storyNumber,
          resourcesOverride,
          context,
          stateRef,
          storeRef,
          saveRefs,
          dispatch,
          api,
          resolveContext: a.resolutionContext,
          scheduler: storySchedulerRef.current,
          rememberObsStory,
          packCache: obsPackCache(),
          rememberPlaceForStory: (number) => rememberPlace({ story: number, chapter: number, verse: 1 }),
        });
      },

      /** Stage an OBS title, frame, or reference in the durable story buffer. */
      stageStoryUnit: (unit, text) => {
        const st = stateRef.current;
        const sched = storySchedulerRef.current;
        if (!sched || st.project?.flavor !== 'textStories' || !st.story || st.story.number !== unit.story) return;
        const value = String(text ?? '');
        // R-10.3.3: no operation removes the reference line. An emptied
        // reference shows on screen (the field is controlled) but stages no
        // write; blurStoryUnit restores the kept text when focus leaves.
        if (!(unit.kind === 'ref' && value === '')) sched.markDirty(unit, value);
        const next = { ...st.story };
        if (unit.kind === 'title') next.title = value;
        else if (unit.kind === 'ref') next.ref = value || null;
        else next.frames = next.frames.map((frame, index) => index + 1 === unit.frame ? { ...frame, text: value } : frame);
        dispatch({ type: 'set', patch: { story: next } });
      },

      /** Normalize and flush one OBS field when focus leaves it. */
      blurStoryUnit: async (unit) => {
        const st = stateRef.current;
        const story = st.story;
        const sched = storySchedulerRef.current;
        if (!sched || !story || story.number !== unit.story) return;
        const current = unit.kind === 'title' ? story.title : unit.kind === 'ref' ? (story.ref || '') : (story.frames[unit.frame - 1]?.text || '');
        const normalized = normalizeStoryUnit(unit, current);
        if (unit.kind === 'ref' && normalized === '') {
          dispatch({ type: 'set', patch: { story: { ...story, ref: sched.value(unit) || null } } });
        } else if (normalized !== current) a.stageStoryUnit(unit, normalized);
        await sched.flushOnBlur();
      },

      openBook: async (code) => {
        // F2/D65/round 34: a book switch is a navigation like any other —
        // bring BOTH schedulers to rest in the re-checking loop (a note
        // staged while the verse drain awaited is caught by the next pass,
        // never carried out of its book's context), and refuse while a
        // failure stands (FR-32; B3/M1: loading over unsaved work
        // resurrects stale bytes).
        const store = storeRef.current;
        if (!store) return;
        if (!(await drainSchedulers(saveRefs))) return;
        const scheduler = schedulerRef.current;
        // Sequence token: two rapid opens must not interleave (finding M2) —
        // only the latest open may install its bytes and sources.
        const seq = ++openSeqRef.current;
        dispatch({ type: 'set', patch: { book: code, chapter: 1, bookRaw: null, bookError: null, sources: {}, editing: null, helpsHover: null, helpsActive: null, pickerProgress: null } });
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
        (isObsProject(stateRef.current) ? performLoadStoryUnderstand : performLoadUnderstand)({ stateRef, storeRef, understandSeqRef, dispatch, actions: a, apiClient: api }),

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
        const book = unitBookOf(st); // a story comment keys under `OBS` (#290)
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
        const book = unitBookOf(st);
        if (!repoPath || !book || !sched) return null;
        const key = noteKeyFor(repoPath, book, chapter, verse);
        return sched.isDirty(key) ? sched.bookText(key) : null;
      },

      /** G1's clear refusal, version-aware (round 32): revert the target to
       * the scheduler's latest PERSISTED value — never stage the render-time
       * stored snapshot, which an in-flight write can make stale (journaling
       * the OLD text over the newer one). A never-staged target is a no-op. */
      revertNote: ({ chapter, verse }) => {
        const st = stateRef.current;
        const repoPath = st?.project?.repoPath;
        const book = unitBookOf(st);
        if (!repoPath || !book) return;
        noteSchedulerRef.current?.revertToPersisted(noteKeyFor(repoPath, book, chapter, verse));
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
        rememberPlace({ chapter, verse: null });
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
        const st = stateRef.current;
        const repoPath = st.project?.repoPath || st.project?.id;
        if (repoPath && st.book) {
          recordLastEdit({ repoPath, book: st.book, chapter, verse: verseKey, snippet: body === '___' ? '' : text.trim().slice(0, 90), mode: 'draft', at: Date.now() });
        }
      },
      blurVerse: () => {
        const editing = stateRef.current.editing;
        dispatch({ type: 'set', patch: { editing: null } });
        schedulerRef.current?.flushOnBlur();
        // #213: the verse card's text is committed — keep the alignment links
        // its words still carry. A section key (`c:s<k>`) is reflowed by
        // saveSection per changed verse, not here.
        if (editing?.key && !editing.keys) a.reflowAlignedVerses([editing.key]);
      },
      /** #213: after a verse edit, keep the alignment links whose target words
       * are still in the new text and return the rest to the bank, through the
       * align scheduler (the one §5.1 save path). Fire-and-forget: the draft
       * save never waits on the sidecar read. A write that fails after staging
       * is the scheduler's retained failure (Retry). A read that fails BEFORE
       * staging stages nothing: the record stays as it was, the I-3 hash keeps
       * the verse `invalid` on the rail, and the translator re-links it — the
       * pre-#213 outcome, never a lost draft (Codex round 1, P2). */
      reflowAlignedVerses: (refs) => {
        const store = storeRef.current;
        const sched = alignSchedulerRef.current;
        const book = stateRef.current.book;
        if (!store || !sched || !book) return;
        const stillCurrent = () => storeRef.current === store && alignSchedulerRef.current === sched;
        void reflowAlignedVerses({ store, sched, book, bookRaw: rawRef.current, stillCurrent }, refs).catch(() => {});
      },
      // #141: the section editing card. It holds its own text until Save, so
      // opening it writes nothing; `keys` are the section's verse keys.
      startSection: (chapter, keys) => {
        dispatch({ type: 'set', patch: { editing: { key: `${chapter}:s${keys[0]}`, keys } } });
      },
      // Save a section: the saved verses equal what the card shows. Each
      // CHANGED verse goes through editVerse — the one splice path, the
      // scheduler owns the write (W-5) — then the blur flush. A verse whose
      // text equals its stored body is not touched, so the file outside the
      // edited verses stays byte-identical. `texts` maps verse key to text; a
      // section verse with no text in the card returns to the `___` stub
      // (editVerse's empty rule) — never a stale copy beside the moved words.
      // `newKeys` (#63): the verse keys the card produced; a changed list is a
      // verse span created or broken — one structural action, not splices.
      saveSection: (chapter, keys, texts, newKeys = keys, formats = {}) => {
        if (newKeys.join('\n') !== keys.join('\n')) {
          stageStructuralSection({ rawRef, schedulerRef, structuralRef, stateRef, dispatch }, chapter, keys, texts, newKeys);
        } else {
          const changed = [];
          for (const verseKey of keys) {
            const stored = verseBody(rawRef.current, chapter, verseKey);
            if (stored == null) continue;
            const current = stored.trim() === '___' ? '' : stored.trim();
            const text = texts[verseKey] ?? '';
            if (text.trim() === current) continue;
            a.editVerse(chapter, verseKey, text);
            changed.push(`${chapter}:${verseKey}`);
          }
          // #213: only the verses this save changed — an untouched verse keeps
          // its alignment record byte for byte.
          if (changed.length) a.reflowAlignedVerses(changed);
        }
        let entries = indexBook(rawRef.current);
        for (const [key, marker] of Object.entries(formats)) {
          const next = spliceVerseGap(rawRef.current, chapter, key, marker, entries);
          if (next !== rawRef.current) {
            rawRef.current = next;
            entries = indexBook(rawRef.current);
          }
        }
        schedulerRef.current?.replaceBook(stateRef.current.book, rawRef.current);
        dispatch({ type: 'set', patch: { bookRaw: rawRef.current } });
        a.blurVerse();
      },
      cancelVerse: (chapter, verseKey) => {
        // Restore the pre-edit body (still the one splice path), then close.
        const e = stateRef.current.editing;
        if (e && e.key === `${chapter}:${verseKey}`) {
          const body = e.before.trim() === '' ? '___' : e.before;
          rawRef.current = spliceVerse(rawRef.current, chapter, verseKey, body);
          schedulerRef.current.markDirty(stateRef.current.book, chapter, verseKey, body);
          // The Resume snippet follows the restored text, never the cancelled
          // draft (Codex review of #138).
          const st = stateRef.current;
          const repoPath = st.project?.repoPath || st.project?.id;
          if (repoPath && st.lastEdit?.repoPath === repoPath && st.lastEdit?.book === st.book
            && String(st.lastEdit.verse) === String(verseKey) && Number(st.lastEdit.chapter) === Number(chapter)) {
            recordLastEdit({ ...st.lastEdit, snippet: e.before.trim().slice(0, 90), at: Date.now() });
          }
        }
        dispatch({ type: 'set', patch: { editing: null, bookRaw: rawRef.current } });
        schedulerRef.current?.flushOnBlur();
      },
      // #100: the indicator's Retry re-attempts every scheduler holding a
      // failure (each retry reconciles inside the machine, round 31).
      retrySave: () =>
        Promise.all(saveRefs.map((ref) => (ref.current?.getFailure() ? ref.current.retry() : Promise.resolve()))),
      backToProjects: async () => {
        // Never navigate away from unsaved work or a visible failure (FR-32).
        // EVERY blocker is checked BEFORE anything is disposed (C3,
        // adversarial round 3): a refused exit must leave the project fully
        // working — both schedulers included — or the next edit throws.
        // Round 23: the loop re-checks both after each pass, so a note staged
        // while the verse drain awaited can never be disposed unflushed.
      // #100/#289: all five schedulers (verse, note, align, check, story) drain in the
        // one loop, so a buffered §5.1 or §5.2 write can never execute after
        // this project's store is gone (#129 rounds 2–3 kept their guarantee
        // through the registry, not a second queue). From the drain to the
        // store teardown below is synchronous, so nothing can stage in between.
        if (!(await drainSchedulers(saveRefs))) return;
        // #183 (D9): leaving the project is a checkpoint. It is started AFTER
        // this synchronous teardown, on the captured store (startLeaveCheckpoint):
        // an await here would reopen the window the drain just closed.
        const leaving = stateRef.current.project;
        const leavingStore = storeRef.current;
        for (const ref of saveRefs) {
          ref.current?.dispose();
          ref.current = null;
        }
        // #1: the suggestion engine belongs to the project being left.
        clearTimeout(suggestRetrainRef.current);
        suggestWorkerRef.current?.terminate();
        suggestWorkerRef.current = null;
        suggestSeqRef.current++;
        suggestTrainingRef.current = false;
        suggestPendingRef.current = false;
        checkTargetsRef.current = new Map();
        noteTargetsRef.current = new Map();
        disposeStore(storeRef); // #94: the fold worker goes with the project
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
          patch: { view: 'home', project: null, book: null, bookRaw: null, sources: {}, storyNumbers: [], storyNumber: null, story: null, sourceStory: null, storyImages: {}, storyImageNote: null, storyLoading: false, storyError: null, storySource: null, saveState: 'saved', noteSaveState: 'saved', alignSaveState: 'saved', checkSaveState: 'saved', storySaveState: 'saved', storySaveError: null, commitError: null, projectPins: null, projectPinsLoaded: false, projectPinsError: null, sourcePanes: null, understand: null, checkTool: null, checkSession: null, aligning: false, alignSession: null, alignVerse: null, alignIndex: null, alignSuggest: { status: 'off', verses: 0, error: null }, pickerProgress: null, toolPos: {}, upgrade: UPGRADE_IDLE },
        });
        refreshProjects(); // re-order: the project just left goes to the top
        if (leaving && leavingStore) startLeaveCheckpoint({ store: leavingStore, repoPath: leaving.repoPath, stateRef, dispatch });
      },
    };
    return a;
  }, []);

  stateRef.current = s;

  const value = { s, ...model, sourceModel, actions, BOOK_NAMES };
  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export const useApp = () => useContext(AppCtx);
