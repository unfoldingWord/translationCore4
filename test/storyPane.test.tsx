// @vitest-environment jsdom
// #311 — component test for the gateway story pane (`StoryPane` in
// `src/views/Check.jsx`) and its phrase highlight, rendered through the Check
// screen with the application state mocked (the `test/storyDraft.test.tsx`
// style: jsdom, `@testing-library/react`).
//
// Every story number, frame number, quote string and title below is read from
// the system's own fixtures — the vendored en_obs-tn v13 export
// (`test/fixtures/resources/en_obs-tn@v13/OBS.tsv`), the vendored en_tn v86
// export for the Bible case, the vendored `text_stories` template
// (`conformance/fixtures/text_stories/ingredients/content/NN.md`), the
// en_ult TIT USFM for the original-language pane, and the `storyDraft`
// catalog string through `t()` — none is written by hand. The gateway frame
// prose is a TSV cell (a Note or Quote column), never an invented sentence:
// the template ships the seed form only (titles + image lines, empty frames).
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { t } from '../src/i18n/index.js';
import { usfmjs } from '../src/data/vendor';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const root = (p: string): string => path.resolve(process.cwd(), p);
const tsvRows = (p: string): string[][] =>
  fs
    .readFileSync(root(p), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .slice(1)
    .map((line) => line.split('\t'));
const cell = (rows: string[][], reference: string, id: string, col: number): string => {
  const row = rows.find((r) => r[0] === reference && r[1] === id);
  if (!row) throw new Error(`fixture row missing: ${reference} ${id}`);
  return row[col];
};

const OBS = tsvRows('test/fixtures/resources/en_obs-tn@v13/OBS.tsv');
// Column 4 is Quote, column 6 is Note, column 0 is Reference (story:frame).
const obsQuote = (reference: string, id: string): string => cell(OBS, reference, id, 4);
const obsNote = (reference: string, id: string): string => cell(OBS, reference, id, 6);

// The story title as the template carries it (`# N. Title`), the source the
// frame-0 pane must read.
const templateTitle = (story: number): string =>
  fs
    .readFileSync(root(`conformance/fixtures/text_stories/ingredients/content/${String(story).padStart(2, '0')}.md`), 'utf8')
    .split('\n')[0]
    .replace(/^#\s*\d+\.\s*/, '')
    .trim();

// Story 1 frame 1: the gateway text is the Note of the very row whose Quote
// the pane must highlight — file-read on both sides.
const FRAME1_TEXT = obsNote('1:1', 'lm48');
const FRAME1_QUOTE = obsQuote('1:1', 'lm48'); // 'the beginning'
// Story 1 frame 2: the gateway text is the Quote of 1:2 zzmo, a full sentence
// holding the 1:2 n2rx quote — the frame>=2 indexing proof.
const FRAME2_TEXT = obsQuote('1:2', 'zzmo');
const FRAME2_QUOTE = obsQuote('1:2', 'n2rx'); // 'God said'
// The negative control shares a word with the frame text (`God`) but never
// the full phrase: a quote from frame 1:2 held against the frame 1:1 text.
const MISS_QUOTE = FRAME2_QUOTE;
const TITLE1 = templateTitle(1);
const TITLE7 = templateTitle(7);
// Story 7 frame 1: the two-span quote over the sentence that holds both spans.
const AMP_QUOTE = obsQuote('7:1', 'vf5f');
const AMP_TEXT = obsQuote('7:1', 'a5s7');

// The Bible item for the session-kind case: reference and identity from the
// vendored en_tn v86 export; the original-language verse from en_ult TIT.
const TIT = tsvRows('test/fixtures/resources/en_tn@v86/TIT.tsv');
const TIT_REF = '1:1';
const TIT_ID = 'rtc9';
const TIT_QUOTE = cell(TIT, TIT_REF, TIT_ID, 4);
const ULT_TIT = fs.readFileSync(root('test/fixtures/en_ult/TIT.usfm'), 'utf8');
const ULT_1_1 = (usfmjs.toJSON(ULT_TIT) as { chapters: Record<string, Record<string, unknown>> }).chapters['1']['1'];

const actions = {
  runPreflight: vi.fn(),
  loadPickerProgress: vi.fn(),
  setCheckIndex: vi.fn(),
  recordDecision: vi.fn(),
  closeCheckTool: vi.fn(),
  openSources: vi.fn(),
  go: vi.fn(),
};

interface MockRef {
  story?: number;
  frame?: number;
  bookId?: string;
  chapter?: number;
  verse?: number;
}
interface MockItem {
  contextId: {
    reference: MockRef;
    checkId: string;
    quoteString: string;
    quote: Array<{ word: string; occurrence: number }>;
    tool: string;
    groupId: string;
    occurrence: number;
  };
  category: string;
}

const storyItem = (story: number, frame: number, checkId: string, quoteString: string): MockItem => ({
  contextId: {
    reference: { story, frame },
    checkId,
    quoteString,
    quote: [],
    tool: 'translationNotes',
    groupId: '',
    occurrence: 1,
  },
  category: 'other',
});

interface MockStory {
  number: number;
  title: string;
  ref: string;
  frames: Array<{ image: string; text: string }>;
}

const storyWith = (number: number, title: string, frameTexts: Record<number, string>): MockStory => {
  const top = Math.max(0, ...Object.keys(frameTexts).map(Number));
  const frames = Array.from({ length: Math.max(top, 1) }, (_, i) => ({
    image: '',
    text: frameTexts[i + 1] ?? '',
  }));
  return { number, title, ref: '', frames };
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let state: any;
const setStoryState = (item: MockItem, sourceStory: MockStory | null) => {
  state = {
    project: { flavor: 'textStories', scriptDirection: 'ltr' },
    story: { number: (item.contextId.reference as { story: number }).story },
    storyNumber: (item.contextId.reference as { story: number }).story,
    sourceStory,
    sources: {},
    sourcePanes: [],
    understand: null,
    preflight: null,
    checkTool: 'translationNotes',
    aligning: false,
    book: null,
    bookRaw: null,
    checkSession: {
      tool: 'translationNotes',
      book: 'OBS',
      items: [item],
      activeIndex: 0,
      verses: {},
      progress: { decided: 0, total: 1 },
      dropped: null,
      resource: null,
    },
  };
};

vi.mock('../src/state.jsx', () => ({ useApp: () => ({ s: state, actions }) }));

import Check from '../src/views/Check.jsx';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StoryPane through the Check screen (#311)', () => {
  it('negative control first: a quote that shares a word but not the phrase marks nothing', () => {
    // FRAME1_TEXT ends with "except God." — MISS_QUOTE ('God said', 1:2 n2rx)
    // shares `God`, so any partial highlight would light up here.
    expect(FRAME1_TEXT).toContain('God');
    setStoryState(storyItem(1, 1, 'lm48', MISS_QUOTE), storyWith(1, TITLE1, { 1: FRAME1_TEXT }));
    render(<Check />);
    expect(screen.getByTestId('story-pane')).toBeTruthy();
    expect(screen.getByTestId('story-pane-text').textContent).toContain('the beginning');
    expect(screen.queryAllByTestId('story-hl')).toHaveLength(0);
  });

  it('frame 2 reads frames[1] and frame 0 reads the story title', () => {
    // The template title and the title-note quote agree — the cross-check
    // that both fixtures name the same story.
    expect(TITLE1).toBe(obsQuote('1:0', 'i6lj'));
    setStoryState(
      storyItem(1, 2, 'n2rx', FRAME2_QUOTE),
      storyWith(1, TITLE1, { 1: FRAME1_TEXT, 2: FRAME2_TEXT }),
    );
    render(<Check />);
    // frames[frame - 1]: the frame-2 item shows the second frame, not the first.
    expect(screen.getByTestId('story-pane-text').textContent).toContain('Let there be light');
    expect(screen.getByTestId('story-pane-text').textContent).not.toContain('all things');
    cleanup();
    setStoryState(
      storyItem(1, 0, 'i6lj', obsQuote('1:0', 'i6lj')),
      storyWith(1, TITLE1, { 1: FRAME1_TEXT, 2: FRAME2_TEXT }),
    );
    render(<Check />);
    expect(screen.getByTestId('story-pane-text').textContent).toContain(TITLE1);
    expect(screen.getByTestId('story-pane-text').textContent).not.toContain('all things');
  });

  it('marks exactly the quote words and keeps the remainder unmarked', () => {
    setStoryState(storyItem(1, 1, 'lm48', FRAME1_QUOTE), storyWith(1, TITLE1, { 1: FRAME1_TEXT }));
    render(<Check />);
    // Hard-coded expectation, not the matcher oracling itself: the quote is
    // two words, and the frame's other clause stays dark.
    const marks = screen.getAllByTestId('story-hl');
    expect(marks).toHaveLength(2);
    expect(marks.map((m) => m.textContent)).toEqual(['the', 'beginning']);
    const text = screen.getByTestId('story-pane-text').textContent ?? '';
    expect(text).toContain('all things');
    expect(text.replace('the beginning', '')).not.toContain('the beginning');
  });

  it('states the sourceMissing string and shows no highlight with no gateway story', () => {
    setStoryState(storyItem(1, 1, 'lm48', FRAME1_QUOTE), null);
    render(<Check />);
    expect(screen.getByTestId('story-pane').textContent).toContain(t('storyDraft.sourceMissing'));
    expect(screen.queryAllByTestId('story-hl')).toHaveLength(0);
  });

  it('an &-separated quote marks both spans and nothing between them', () => {
    expect(TITLE7).toBe(obsQuote('7:0', 'mhz1'));
    setStoryState(storyItem(7, 1, 'vf5f', AMP_QUOTE), storyWith(7, TITLE7, { 1: AMP_TEXT }));
    render(<Check />);
    const marks = screen.getAllByTestId('story-hl');
    expect(marks.map((m) => m.textContent).join(' ')).toBe('loved to stay at home loved to hunt');
    expect(screen.getByTestId('story-pane-text').textContent).toContain('but Esau');
    expect(marks.some((m) => (m.textContent ?? '').includes('Esau'))).toBe(false);
  });

  it('the pane does not appear for a Bible session; the orig and gateway verse panes do', () => {
    state = {
      project: { flavor: 'textTranslation', scriptDirection: 'ltr' },
      book: 'TIT',
      bookRaw: {},
      story: null,
      storyNumber: null,
      sourceStory: null,
      sources: {},
      sourcePanes: [],
      understand: null,
      preflight: null,
      checkTool: 'translationNotes',
      aligning: false,
      checkSession: {
        tool: 'translationNotes',
        book: 'TIT',
        items: [
          {
            contextId: {
              reference: { bookId: 'TIT', chapter: 1, verse: 1 },
              checkId: TIT_ID,
              quoteString: TIT_QUOTE,
              quote: [],
              tool: 'translationNotes',
              groupId: '',
              occurrence: 1,
            },
            category: 'other',
          },
        ],
        activeIndex: 0,
        verses: {},
        progress: { decided: 0, total: 1 },
        dropped: null,
        resource: null,
        orig: { testament: 'nt', state: 'ready', chapters: { 1: { 1: ULT_1_1 } } },
      },
    };
    render(<Check />);
    expect(screen.queryByTestId('story-pane')).toBeNull();
    expect(screen.getByTestId('orig-pane')).toBeTruthy();
    // The verse behind the quote renders — the pane shows content, not only chrome.
    expect((screen.getByTestId('orig-pane').textContent ?? '').length).toBeGreaterThan(20);
    expect(screen.getByTestId('ult-pane')).toBeTruthy();
  });
});
