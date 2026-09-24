// @vitest-environment jsdom
// #108 (epic #104, D63): Publish is retired as a top-level tab. It must not be
// reachable from the top navigation, and it must be reachable from Check's
// Community Checking card, which opens the typeset preview with the export
// menu (#375), which states when the exports arrive while it has no producer.
import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { indexBook } from '../src/data/usfm/indexer';
import { DEFAULT_PAGE_SETUP } from '../src/data/export/pageSetup';
import type { ExportProducer } from '../src/data/export/kernel';
import { assertProjectUnchanged } from './helpers/export';

const go = vi.fn();
const unexpectedAction = vi.fn();
// Set by the #381 cases: the export action they route to the real kernel.
let exportFile: ((...args: never[]) => unknown) | null = null;
const fs = process.getBuiltinModule('node:fs');
const os = process.getBuiltinModule('node:os');
const path = process.getBuiltinModule('node:path');
const { execFileSync } = process.getBuiltinModule('node:child_process');
const sampleBook = fs.readFileSync(path.resolve(process.cwd(), 'test/fixtures/sample-burrito/TIT.usfm'), 'utf8');
const sampleEntries = indexBook(sampleBook);
const sampleByChapter = Object.fromEntries(
  [...new Set(sampleEntries.map((entry) => entry.chapter))].map((chapter) => [
    chapter,
    sampleEntries.filter((entry) => entry.chapter === chapter).map((entry) => {
      const body = sampleBook.slice(entry.start, entry.end).trim();
      return { n: entry.verseKey, drafted: body !== '' && body !== '___', text: body === '___' ? '' : body };
    }),
  ]),
);
const sampleChapterNums = Object.keys(sampleByChapter).map(Number).sort((a, b) => a - b);

const baseState = {
  view: 'check',
  project: { id: 'p1', name: 'Equipo Ejemplo', languageTag: 'es-419', scriptDirection: 'ltr', bookCodes: ['TIT'] },
  saveState: 'saved',
  book: 'TIT',
  chapter: 1,
  // Two resolvable tools in a designed non-ready state — enough for the picker
  // to render its cards without a platform.
  preflight: {
    translationWords: { state: 'unpinned' },
    translationNotes: { state: 'unpinned' },
  },
  checkTool: null,
  checkSession: null,
  aligning: false,
  modal: null,
  np: null,
  ab: null,
  st: null,
  src: { gateway: null, rows: [] },
  gatewayPreview: null,
  bookError: null,
  progressByProject: {},
  projects: [],
  netEnabled: false,
  noteSaveState: 'saved',
};

const bookModel = {
  code: 'TIT',
  chapterNums: sampleChapterNums,
  draftPct: 50,
  byChapter: sampleByChapter,
};

let state = { ...baseState };

vi.mock('../src/state.jsx', () => ({
  useApp: () => ({
    s: state,
    book: bookModel,
    sourceModel: null,
    actions: new Proxy({}, {
      get: (_, name) => (name === 'go' ? go : name === 'exportFile' && exportFile ? exportFile : (...args: unknown[]) => unexpectedAction(name, args)),
    }),
  }),
  AppProvider: ({ children }: { children: unknown }) => children,
  SCRIPT_FONTS: ['Noto Sans (default)'],
  SUITE_VERSION: 'v89',
}));

import App from '../src/App.jsx';

describe('#108 — Publish moves into Check as Community Checking', () => {
  beforeEach(() => {
    cleanup();
    go.mockClear();
    unexpectedAction.mockClear();
    state = { ...baseState };
  });

  it('the top navigation offers Translate and Check, and no Publish tab', () => {
    render(<App />);
    expect(screen.getByRole('tab', { name: 'Translate' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Check' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull();
    expect(screen.queryByText('Publish')).toBeNull();
  });

  it("Check's picker shows the Community Checking card, and opening it goes to the publish view", () => {
    render(<App />);
    expect(screen.getByTestId('community-checking-card')).toBeTruthy();
    fireEvent.click(screen.getByTestId('open-community-checking'));
    expect(go).toHaveBeenCalledWith('publish');
  });

  it('every checking tool is a PEER in one card grid — the two derived tools, Align and Community Checking', () => {
    render(<App />);
    // The mockup lays the picker out as one responsive grid (App.jsx L445), so
    // the cards must be siblings in a single container. They used to be three
    // stacked blocks, which no arrangement of that container could line up.
    const cards = [
      screen.getByTestId('preflight-translationWords'),
      screen.getByTestId('preflight-translationNotes'),
      screen.getByTestId('align-card'),
      screen.getByTestId('community-checking-card'),
    ];
    const parents = new Set(cards.map((c) => c.parentElement));
    expect(parents.size).toBe(1);
    expect([...parents][0]?.style.display).toBe('grid');
  });

  it('a READY tool card says what the tool does — no state badge, no resource citation (owner ruling, #108)', () => {
    state = {
      ...baseState,
      preflight: {
        translationWords: { state: 'ready', resolution: { pin: { repoPath: 'git.door43.org/es-419_gl/es-419_tw', version: 'v37' }, rung: 'primary' } },
        translationNotes: { state: 'unpinned' },
      },
    } as never;
    render(<App />);
    const readyCard = screen.getByTestId('preflight-translationWords');
    // A checking resource is local in the normal flow, so saying so is noise.
    expect(readyCard.textContent).toContain('Check the key terms');
    // The description must not promise completeness the derivation does not
    // deliver: tN skips rows without a SupportReference (derive.ts:208; 49 of
    // 206 rows in en_tn Titus v86) and both tools derive within project scope.
    expect(readyCard.textContent).not.toMatch(/every key term|every note/);
    expect(readyCard.textContent).not.toContain('Ready');
    expect(readyCard.textContent).not.toContain('on this computer');
    expect(readyCard.textContent).not.toContain('git.door43.org');
    // …but a card that needs something still states it, with its citation.
    const problemCard = screen.getByTestId('preflight-translationNotes');
    expect(problemCard.textContent).toContain('No resources pinned');
  });

  it('a WARNED FALLBACK still names the resource the checks derive from, even though it is ready (D41/B20)', () => {
    // The substitute is local, so the state is 'ready' — but suppressing the
    // citation here would leave the user checking against English with only
    // the MISSING primary named. Both identities have to be visible.
    state = {
      ...baseState,
      preflight: {
        translationWords: { state: 'unpinned' },
        translationNotes: {
          state: 'ready',
          resolution: { pin: { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v89' }, rung: 'fallback', usedFallback: true },
          unavailablePrimary: { repoPath: 'git.door43.org/es-419_gl/es-419_tn', version: 'v66' },
        },
      },
    } as never;
    render(<App />);
    const card = screen.getByTestId('preflight-translationNotes');
    expect(card.textContent).toContain('git.door43.org/es-419_gl/es-419_tn'); // missing primary
    expect(card.textContent).toContain('git.door43.org/unfoldingWord/en_tn'); // what is actually used
    expect(card.textContent).toContain('English fallback');
  });

  it('a failed comprehension write surfaces on the GLOBAL save indicator with its own retry (B1/D65)', () => {
    state = { ...baseState, noteSaveState: 'error' } as never;
    render(<App />);
    const indicator = screen.getByTestId('save-indicator');
    expect(indicator.getAttribute('data-state')).toBe('error');
    expect(screen.getByTestId('retry-note-save')).toBeTruthy();
  });

  it("the indicator never claims Saved while the note scheduler holds work — the WORST of the two schedulers wins (Q2/D65)", () => {
    state = { ...baseState, noteSaveState: 'dirty' } as never;
    render(<App />);
    expect(screen.getByTestId('save-indicator').getAttribute('data-state')).toBe('dirty');
    cleanup();
    state = { ...baseState, noteSaveState: 'saving' } as never;
    render(<App />);
    expect(screen.getByTestId('save-indicator').getAttribute('data-state')).toBe('saving');
    cleanup();
    // and the verse scheduler's worse state wins symmetrically
    state = { ...baseState, noteSaveState: 'dirty', saveState: 'error' } as never;
    render(<App />);
    expect(screen.getByTestId('save-indicator').getAttribute('data-state')).toBe('error');
  });

  it('the publish view is the typeset preview with the export menu, which offers the Scripture Burrito zip', () => {
    state = { ...baseState, view: 'publish' };
    render(<App />);
    expect(screen.getByTestId('community-checking')).toBeTruthy();
    fireEvent.click(screen.getByTestId('export-menu-trigger'));
    expect(screen.getByRole('menuitem', { name: 'Scripture Burrito (.zip)' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Export / })).toBeNull();
    // The preview renders the project's own text, not fixture copy.
    expect(screen.getByText(/Pablo, siervo de Dios y apóstol/)).toBeTruthy();
    // An undrafted verse is stated, never silently skipped in the preview.
    expect(screen.getAllByText(/verse not yet drafted/).length).toBeGreaterThan(0);
  });

  it('the preview leaves out a chapter with no drafted verse, and says so when the book has none (#20)', () => {
    state = { ...baseState, view: 'publish' };
    render(<App />);
    expect(sampleChapterNums.length).toBeGreaterThan(1); // the sample has undrafted chapters to leave out
    expect(screen.getAllByTestId('cc-chapter')).toHaveLength(1);
    expect(screen.queryByTestId('cc-nothing-drafted')).toBeNull();
    cleanup();

    const saved = bookModel.byChapter;
    bookModel.byChapter = Object.fromEntries(Object.entries(saved).map(([c, verses]) => [c, verses.map((v) => ({ ...v, drafted: false, text: '' }))]));
    try {
      render(<App />);
      expect(screen.queryAllByTestId('cc-chapter')).toHaveLength(0);
      expect(screen.getByTestId('cc-nothing-drafted').textContent).toBe('Nothing is drafted in this book yet.');
    } finally {
      bookModel.byChapter = saved;
    }
  });

  it('the Bible page setup switches every preview chapter between Single and Double spacing', () => {
    state = { ...baseState, view: 'publish' };
    const before = JSON.stringify(state);
    render(<App />);

    const single = screen.getByRole('button', { name: 'Single' });
    const double = screen.getByRole('button', { name: 'Double' });
    const chapters = screen.getAllByTestId('cc-chapter');
    expect(chapters.length).toBe(1); // only chapter 1 of the sample has a drafted verse (#20)
    expect(single.getAttribute('aria-pressed')).toBe('true');
    expect(double.getAttribute('aria-pressed')).toBe('false');
    expect(chapters.every((chapter) => (chapter as HTMLElement).style.lineHeight === 'var(--lh-community-checking-single)')).toBe(true);

    fireEvent.click(double);
    expect(single.getAttribute('aria-pressed')).toBe('false');
    expect(double.getAttribute('aria-pressed')).toBe('true');
    expect(chapters.every((chapter) => (chapter as HTMLElement).style.lineHeight === 'var(--lh-community-checking-double)')).toBe(true);

    fireEvent.click(single);
    expect(single.getAttribute('aria-pressed')).toBe('true');
    expect(double.getAttribute('aria-pressed')).toBe('false');
    expect(chapters.every((chapter) => (chapter as HTMLElement).style.lineHeight === 'var(--lh-community-checking-single)')).toBe(true);
    expect(unexpectedAction).not.toHaveBeenCalled();
    expect(go).not.toHaveBeenCalled();
    expect(JSON.stringify(state)).toBe(before);
  });
});

// ---- #291 (D74 §8, §10): an OBS project gets Check and Community Checking.
const STORY = {
  number: 1,
  title: 'La Creación',
  frames: [
    { image: '![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg)', text: 'Así fue como Dios hizo todo.' },
    { image: '![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-02.jpg)', text: '' },
  ],
  ref: 'Una historia bíblica de: Génesis 1-2',
};
const obsState = {
  ...baseState,
  project: { id: 'p2', name: 'Historias', languageTag: 'es', scriptDirection: 'ltr', flavor: 'textStories', bookCodes: [] },
  book: null,
  bookRaw: null,
  storyNumber: 1,
  story: STORY,
  storyImages: { '1': { uri: 'local://obs-en-01-01.jpg' } },
};

describe('#291 — an OBS project checks the open story', () => {
  beforeEach(() => {
    cleanup();
    go.mockClear();
  });

  it('the top navigation offers Understand, Translate and Check (#290, #291)', () => {
    state = obsState as never;
    render(<App />);
    expect(screen.getByRole('tab', { name: 'Understand' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Translate' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Check' })).toBeTruthy();
  });

  it('the picker offers the two tools and Community Checking, and NO Align entry (D74: absent, not disabled)', () => {
    state = obsState as never;
    render(<App />);
    expect(screen.getByTestId('preflight-translationWords')).toBeTruthy();
    expect(screen.getByTestId('preflight-translationNotes')).toBeTruthy();
    expect(screen.getByTestId('community-checking-card').textContent).toContain('Story 1');
    expect(screen.queryByTestId('align-card')).toBeNull();
    expect(screen.queryByTestId('open-align')).toBeNull();
  });

  it('Community Checking renders the story with its pictures, and the Pictures toggle removes them', () => {
    state = { ...obsState, view: 'publish' } as never;
    render(<App />);
    const page = screen.getByTestId('cc-story');
    expect(page.textContent).toContain('La Creación');
    expect(page.textContent).toContain('Así fue como Dios hizo todo.');
    expect(page.textContent).toContain('[ frame not yet drafted ]');
    expect(screen.getByTestId('cc-reference').textContent).toContain('Génesis 1-2');
    expect(screen.getByTestId('cc-picture-1').getAttribute('src')).toBe('local://obs-en-01-01.jpg');
    expect(page.getAttribute('data-pictures')).toBe('1');
    fireEvent.click(screen.getByLabelText('Pictures'));
    expect(screen.queryByTestId('cc-picture-1')).toBeNull();
    expect(screen.getByTestId('cc-story').getAttribute('data-pictures')).toBe('0');
    // the Bible page-setup controls are not offered for a story
    expect(screen.queryByText('Spacing')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Single' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Double' })).toBeNull();
    expect(screen.queryByText('Verse numbers')).toBeNull();
    expect(screen.queryByText('Export USFM')).toBeNull();
  });
});

// ---- #381 (D80 point 5): the page setup reaches every export. The dev-only
// fake producer (src/data/export/producers.ts) enters the table only when its
// flag is set as the module loads, so these cases load a fresh module graph
// with the flag on. The export action routes to the real kernel over a store
// that reads the book from a git repository on disk, so assertProjectUnchanged
// has a real project to guard.
describe('#381 — the page setup reaches every export', () => {
  let dir: string;
  let AppWithFake: typeof App;
  let fakeProducer: ExportProducer;
  const spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(async () => {
    cleanup();
    go.mockClear();
    unexpectedAction.mockClear();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tc4-page-setup-'));
    const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args]);
    git('init', '-q');
    fs.writeFileSync(path.join(dir, 'TIT.usfm'), sampleBook);
    git('add', '.');
    git('commit', '-qm', 'baseline');

    localStorage.setItem('tc4.e2e.fakeExport', '1');
    vi.resetModules();
    ({ default: AppWithFake } = await import('../src/App.jsx'));
    fakeProducer = (await import('../src/data/export/producers')).PRODUCERS.find((p) => (p.id as string) === 'e2e-fake')!;
    const { runExport } = await import('../src/data/export/kernel');
    const store = {
      commitPending: async () => {},
      readBook: async (code: string) => ({ usfm: fs.readFileSync(path.join(dir, `${code}.usfm`), 'utf8') }),
    };
    // The same input the exportFile action in src/state.jsx builds.
    exportFile = vi.fn((producer: ExportProducer, pageSetup: unknown) =>
      runExport(producer, { store: store as never, project: state.project as never, book: state.book ?? undefined, pageSetup: pageSetup as never }));
    // jsdom has no Blob URLs and does not navigate on an anchor click.
    URL.createObjectURL = vi.fn(() => 'blob:fake');
    URL.revokeObjectURL = vi.fn();
    spies.push(vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {}));
  });
  afterEach(() => {
    localStorage.removeItem('tc4.e2e.fakeExport');
    exportFile = null;
    spies.splice(0).forEach((spy) => spy.mockRestore());
  });

  const bibleState = () => ({ ...baseState, view: 'publish', project: { ...baseState.project, flavor: 'textTranslation' } });
  const runFakeExport = async (produce: { mock: { calls: unknown[][] } }) => {
    fireEvent.click(screen.getByTestId('export-menu-trigger'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Fake export (e2e)' }));
    await waitFor(() => expect(produce.mock.calls).toHaveLength(1));
    return (produce.mock.calls[0][0] as { pageSetup: unknown }).pageSetup;
  };

  it('the Bible card has a Paper size row after Spacing, and Double spacing and Letter reach the fake producer exactly', async () => {
    state = bibleState() as never;
    const produce = vi.spyOn(fakeProducer, 'produce');
    spies.push(produce);
    render(<AppWithFake />);

    const spacing = screen.getByRole('group', { name: 'Spacing' });
    const paper = screen.getByRole('group', { name: 'Paper size' });
    expect(spacing.compareDocumentPosition(paper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const a4 = screen.getByRole('button', { name: 'A4' });
    const letter = screen.getByRole('button', { name: 'Letter' });
    expect(paper.contains(a4) && paper.contains(letter)).toBe(true);
    expect(a4.getAttribute('aria-pressed')).toBe('true');
    expect(letter.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: 'Double' }));
    fireEvent.click(letter);
    expect(a4.getAttribute('aria-pressed')).toBe('false');
    expect(letter.getAttribute('aria-pressed')).toBe('true');

    const received = await runFakeExport(produce);
    expect(received).toEqual({ ...DEFAULT_PAGE_SETUP, spacing: 'double', paper: 'letter' });
    expect(exportFile).toHaveBeenCalledWith(fakeProducer, received);
    const report = await (exportFile as unknown as { mock: { results: Array<{ value: Promise<{ ok: boolean }> }> } }).mock.results[0].value;
    expect(report.ok).toBe(true);
    expect(unexpectedAction).not.toHaveBeenCalled();
  });

  it('pictures: false reaches the producer for an OBS project', async () => {
    state = { ...obsState, view: 'publish' } as never;
    // The fake applies to a Bible book and reads one; here it stands in for an OBS producer.
    spies.push(vi.spyOn(fakeProducer, 'appliesTo').mockReturnValue(true));
    const produce = vi.spyOn(fakeProducer, 'produce').mockResolvedValue({ bytes: new Uint8Array([1]), filename: 'story.txt', mime: 'text/plain' });
    spies.push(produce);
    render(<AppWithFake />);

    fireEvent.click(screen.getByLabelText('Pictures'));
    expect(screen.getByTestId('cc-story').getAttribute('data-pictures')).toBe('0');
    expect(await runFakeExport(produce)).toEqual({ ...DEFAULT_PAGE_SETUP, pictures: false });
  });

  it('assertProjectUnchanged holds around a change of every page-setup choice, then an export', async () => {
    state = bibleState() as never;
    const produce = vi.spyOn(fakeProducer, 'produce');
    spies.push(produce);
    render(<AppWithFake />);
    const before = JSON.stringify(state);
    expect(await assertProjectUnchanged(dir, async () => {
      fireEvent.click(screen.getByRole('button', { name: '2' }));
      fireEvent.click(screen.getByRole('button', { name: 'Double' }));
      fireEvent.click(screen.getByRole('button', { name: 'Letter' }));
      fireEvent.click(screen.getByLabelText('Drop-cap chapters'));
      fireEvent.click(screen.getByLabelText('Verse numbers'));
      expect(await runFakeExport(produce)).toEqual({ ...DEFAULT_PAGE_SETUP, columns: 2, spacing: 'double', paper: 'letter', dropCapChapters: false, verseNumbers: false });
    })).toBe(0);
    expect(JSON.stringify(state)).toBe(before);
    cleanup();

    state = { ...obsState, view: 'publish' } as never;
    spies.push(vi.spyOn(fakeProducer, 'appliesTo').mockReturnValue(true));
    render(<AppWithFake />);
    expect(await assertProjectUnchanged(dir, async () => {
      fireEvent.click(screen.getByLabelText('Pictures'));
    })).toBe(0);
    expect(unexpectedAction).not.toHaveBeenCalled();
  });
});
