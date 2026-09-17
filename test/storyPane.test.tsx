// @vitest-environment jsdom
// #311 — component test for the gateway story pane (`StoryPane` in
// `src/views/Check.jsx`) and its phrase highlight. Every story number, frame
// number and quote string comes from the system's own fixtures: the vendored
// en_obs-tn v13 export (`test/fixtures/resources/en_obs-tn@v13/OBS.tsv`) and
// the vendored `text_stories` template
// (`conformance/fixtures/text_stories/ingredients/content/01.md`). Nothing is
// written by hand, except the gateway frame prose quoted verbatim below —
// the template ships the seed form only (title + image lines, empty frames),
// so the frame text is the en_obs v9 export at the bundled pin (d39a1dc7,
// `src/data/installedSuite.js`), the same provenance
// `test/sourceHighlight.test.ts` records.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { matchPlainQuote, tokenizePlain } from '../src/data/sourceHighlight';

const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const TSV = fs.readFileSync(
  path.resolve(process.cwd(), 'test/fixtures/resources/en_obs-tn@v13/OBS.tsv'),
  'utf8',
);
const rows = TSV.split('\n')
  .filter((line) => line.trim() !== '')
  .slice(1)
  .map((line) => line.split('\t'));
const cell = (reference: string, id: string, col: number): string => {
  const row = rows.find((r) => r[0] === reference && r[1] === id);
  if (!row) throw new Error(`fixture row missing: ${reference} ${id}`);
  return row[col];
};
// Column 4 is Quote, column 0 is Reference (story:frame), column 1 is ID.
const quoteOf = (reference: string, id: string): string => cell(reference, id, 4);

// The template title line (`# 1. The Creation`) carries the story title the
// frame-0 pane must read.
const templateTitle = fs
  .readFileSync(
    path.resolve(process.cwd(), 'conformance/fixtures/text_stories/ingredients/content/01.md'),
    'utf8',
  )
  .split('\n')[0]
  .replace(/^#\s*\d+\.\s*/, '')
  .trim();

// Frame text below is en_obs v9 story 1 frame 1 at the bundled pin d39a1dc7,
// quoted verbatim (cf. `test/sourceHighlight.test.ts` OBS_1_1).
const OBS_1_1 =
  'This is how God made everything in the beginning. He created the universe and everything in it in six days. ' +
  'After God created the earth it was dark and empty because he had not yet formed anything in it. But God’s Spirit was there over the water.';

const TITLE_QUOTE = quoteOf('1:0', 'i6lj'); // 'The Creation'
const FRAME_QUOTE = quoteOf('1:1', 'lm48'); // 'the beginning'
const AMP_QUOTE = quoteOf('7:1', 'vf5f'); // 'loved to stay at home & loved to hunt'
const AMP_TEXT = quoteOf('7:1', 'a5s7'); // full sentence holding both spans
const MISS_QUOTE = 'the beginning of nothing'; // real negative (sourceHighlight.test.ts)

const actions = {
  runPreflight: vi.fn(),
  loadPickerProgress: vi.fn(),
  setCheckIndex: vi.fn(),
  recordDecision: vi.fn(),
  closeCheckTool: vi.fn(),
  openSources: vi.fn(),
  go: vi.fn(),
};

interface MockItem {
  contextId: {
    reference: { story: number; frame: number };
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
    story: { number: item.contextId.reference.story },
    storyNumber: item.contextId.reference.story,
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
  it('negative control first: a quote that does not match in full marks nothing', () => {
    setStoryState(
      storyItem(1, 1, 'lm48', MISS_QUOTE),
      storyWith(1, templateTitle, { 1: OBS_1_1 }),
    );
    render(<Check />);
    expect(screen.getByTestId('story-pane')).toBeTruthy();
    expect(screen.queryAllByTestId('story-hl')).toHaveLength(0);
    expect(screen.getByTestId('story-pane-text').textContent).toContain('the beginning');
  });

  it('covers the story pane through the Check screen', () => {
    setStoryState(
      storyItem(1, 1, 'lm48', FRAME_QUOTE),
      storyWith(1, templateTitle, { 1: OBS_1_1 }),
    );
    render(<Check />);
    expect(screen.getByTestId('story-pane')).toBeTruthy();
    expect(screen.getByTestId('story-pane-text')).toBeTruthy();
  });

  it('a numbered frame reads frames[frame - 1]; frame 0 reads the story title', () => {
    expect(templateTitle).toBe(TITLE_QUOTE);
    setStoryState(
      storyItem(1, 1, 'lm48', FRAME_QUOTE),
      storyWith(1, templateTitle, { 1: OBS_1_1 }),
    );
    render(<Check />);
    expect(screen.getByTestId('story-pane-text').textContent).toContain(OBS_1_1.slice(0, 40));
    cleanup();
    setStoryState(
      storyItem(1, 0, 'i6lj', TITLE_QUOTE),
      storyWith(1, templateTitle, { 1: OBS_1_1 }),
    );
    render(<Check />);
    expect(screen.getByTestId('story-pane-text').textContent).toContain(templateTitle);
    expect(screen.getByTestId('story-pane-text').textContent).not.toContain(OBS_1_1.slice(0, 40));
  });

  it('marks exactly the tokens matchPlainQuote returns and no other token', () => {
    setStoryState(
      storyItem(1, 1, 'lm48', FRAME_QUOTE),
      storyWith(1, templateTitle, { 1: OBS_1_1 }),
    );
    render(<Check />);
    const tokens = tokenizePlain(OBS_1_1);
    const hits = matchPlainQuote(tokens, FRAME_QUOTE);
    const marks = screen.getAllByTestId('story-hl');
    expect(marks).toHaveLength(hits.size);
    expect(marks.map((m) => m.textContent).join(' ')).toBe(FRAME_QUOTE);
  });

  it('states sourceMissing and shows no highlight with no gateway story', () => {
    setStoryState(storyItem(1, 1, 'lm48', FRAME_QUOTE), null);
    render(<Check />);
    expect(screen.getByTestId('story-pane').textContent).toContain('Gateway text is unavailable.');
    expect(screen.queryAllByTestId('story-hl')).toHaveLength(0);
  });

  it('an &-separated quote marks both spans and nothing between them', () => {
    setStoryState(
      storyItem(7, 1, 'vf5f', AMP_QUOTE),
      storyWith(7, 'Jacob and Esau', { 1: AMP_TEXT }),
    );
    render(<Check />);
    const marks = screen.getAllByTestId('story-hl');
    expect(marks.map((m) => m.textContent).join(' ')).toBe(
      'loved to stay at home loved to hunt',
    );
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
              checkId: 'tq84',
              quoteString: 'faith',
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
        orig: { testament: 'nt', state: 'ready', chapters: {} },
      },
    };
    render(<Check />);
    expect(screen.queryByTestId('story-pane')).toBeNull();
    expect(screen.getByTestId('orig-pane')).toBeTruthy();
    expect(screen.getByTestId('ult-pane')).toBeTruthy();
  });
});
