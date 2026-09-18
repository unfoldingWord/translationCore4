// @vitest-environment jsdom
// #290 (J25): the story Understand screen. The open story's frames render in
// order with picture, gateway text and draft; the helps pane is scoped to the
// selected frame (the title notes on frame 0); the comment box is the ONLY
// write and stages under the {story, frame} target (projectFrame: the exact
// durable identity, never mapped). Inputs are the shapes the state produces:
// the story parser's story, the shared derivation's story-keyed items.
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

const READ_SIDE = new Set(['loadUnderstand', 'toggleRail', 'openStory', 'go', 'loadHelpArticle', 'closeHelpArticle', 'stagedNote', 'setStoryFrame' /* #329: the frame in focus is view state, not a write */]);
const calls: Array<{ name: string; args: unknown[] }> = [];
const noteCurrent = new Map<string, string>();
const notePersisted = new Map<string, string>();
const keyOf = (t: { chapter: unknown; verse: unknown }) => `${t.chapter}:${t.verse}`;
const actionsProxy = new Proxy({}, {
  get: (_, name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
    if (name === 'stageNote') {
      const [target, text] = args as [{ chapter: unknown; verse: unknown; stored?: string }, string];
      if (!noteCurrent.has(keyOf(target))) notePersisted.set(keyOf(target), target.stored ?? '');
      noteCurrent.set(keyOf(target), text);
    }
    if (name === 'stagedNote') return noteCurrent.get(keyOf(args[0] as never)) ?? null;
    return undefined;
  },
});

const storyItem = (frame: number, checkId: string, quote: string, note: string, tool: string, groupId = '') => ({
  contextId: { checkId, occurrenceNote: note, reference: { story: 1, frame }, tool, groupId, quote, quoteString: quote, occurrence: 1 },
  category: 'other', selections: false, comments: false, reminders: false, nothingToSelect: false, verseEdits: false, invalidated: false,
});

const STORY = {
  number: 1,
  title: 'La Creación',
  frames: [
    { image: '![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-01.jpg)', text: 'Así fue como Dios hizo todo en el principio.' },
    { image: '![OBS Image](https://cdn.door43.org/obs/jpg/360px/obs-en-01-02.jpg)', text: '' },
  ],
  ref: null,
};
const SOURCE = { number: 1, title: 'The Creation', frames: [{ image: '', text: 'This is how God made everything in the beginning.' }, { image: '', text: 'Then God said, “Let there be light!”' }], ref: 'A Bible story from: Genesis 1-2' };

const state: Record<string, unknown> = {
  view: 'read',
  project: { id: 'p2', repoPath: '_local_/_local_/historias', name: 'Historias', languageTag: 'es', scriptDirection: 'ltr', flavor: 'textStories', bookCodes: [] },
  book: null,
  rail: false,
  storyNumbers: [1, 2],
  storyNumber: 1,
  story: STORY,
  sourceStory: SOURCE,
  storyImages: { '1': { uri: 'local://obs-en-01-01.jpg' } },
  storyLoading: false,
  storyError: null,
  understand: {
    loading: false,
    book: 'OBS',
    story: 1,
    notes: { state: 'ready', rung: 'primary', items: [
      storyItem(0, 'i6lj', 'The Creation', 'This title can also be translated as “About how God made the world”.', 'translationNotes'),
      storyItem(1, 'lm48', 'the beginning', 'This could mean ‘the beginning of all things’.', 'translationNotes'),
      storyItem(2, 'zzmo', 'Let there be light!', 'This is direct quotation.', 'translationNotes', 'figs-quotations'),
    ] },
    words: { state: 'ready', rung: 'primary', items: [storyItem(1, 'aoaa', 'God', '', 'translationWords', 'god')] },
    comprehension: { '1:2': { text: 'Nota guardada', ts: 't1' } },
  },
};

vi.mock('../src/state.jsx', () => ({
  useApp: () => ({ s: state, book: null, sourceModel: null, actions: actionsProxy }),
  AppProvider: ({ children }: { children: unknown }) => children,
  SCRIPT_FONTS: [],
  SUITE_VERSION: 'v89',
}));

import StoryUnderstand from '../src/views/StoryUnderstand.jsx';

beforeEach(() => { cleanup(); calls.length = 0; noteCurrent.clear(); notePersisted.clear(); });
const writes = () => calls.filter((c) => !READ_SIDE.has(c.name));

describe('#290 — the story Understand screen', () => {
  it('renders the title and every frame in order with picture, gateway text and draft', () => {
    render(<StoryUnderstand />);
    expect(screen.getByTestId('story-understand')).toBeTruthy();
    const title = screen.getByTestId('story-understand-unit-0');
    expect(within(title).getByTestId('story-understand-gateway').textContent).toBe('The Creation');
    expect(within(title).getByTestId('story-understand-draft').textContent).toBe('La Creación');
    const one = screen.getByTestId('story-understand-unit-1');
    expect(within(one).getByRole('img').getAttribute('src')).toBe('local://obs-en-01-01.jpg');
    expect(within(one).getByTestId('story-understand-gateway').textContent).toContain('in the beginning');
    expect(within(one).getByTestId('story-understand-draft').getAttribute('data-drafted')).toBe('1');
    const two = screen.getByTestId('story-understand-unit-2');
    expect(within(two).getByTestId('story-understand-draft').getAttribute('data-drafted')).toBe('0');
    expect(within(two).queryByRole('img')).toBeNull(); // no picture resolved for frame 2
    expect(within(two).getByRole('textbox').getAttribute('value') ?? (within(two).getByRole('textbox') as HTMLTextAreaElement).value).toBe('Nota guardada');
    expect(calls.map((c) => c.name)).toContain('loadUnderstand');
  });

  it('the helps pane follows the selected frame: the title notes on frame 0, then frame 1 with its word link', () => {
    render(<StoryUnderstand />);
    const helps = () => within(screen.getByTestId('story-helps'));
    // the title unit is selected first: its note, and nothing of frame 1
    expect(helps().getAllByTestId('story-help-note').map((n) => n.textContent)).toEqual([expect.stringContaining('The Creation')]);
    fireEvent.click(screen.getByTestId('story-understand-unit-1'));
    expect(helps().getAllByTestId('story-help-note').map((n) => n.textContent)).toEqual([expect.stringContaining('the beginning')]);
    fireEvent.click(helps().getByRole('tab', { name: 'Words' }));
    expect(helps().getAllByTestId('story-help-word')).toHaveLength(1);
    expect(helps().getByTestId('story-help-word').textContent).toContain('God');
    fireEvent.click(helps().getByRole('button', { name: 'Read the article →' }));
    expect(calls.find((c) => c.name === 'loadHelpArticle')?.args[0]).toMatchObject({ kind: 'tw', slug: 'god', rung: 'primary' });
    fireEvent.click(screen.getByTestId('story-understand-unit-2'));
    fireEvent.click(helps().getByRole('tab', { name: 'Notes' }));
    expect(helps().getByTestId('story-help-note').textContent).toContain('Let there be light');
    expect(writes()).toEqual([]);
  });

  it('typing a comment on a frame stages it under the {story, frame} target, unmapped; no other control writes', () => {
    render(<StoryUnderstand />);
    const box = within(screen.getByTestId('story-understand-unit-1')).getByRole('textbox');
    fireEvent.change(box, { target: { value: 'Preguntar al equipo.' } });
    const staged = calls.find((c) => c.name === 'stageNote');
    expect(staged?.args[0]).toMatchObject({ chapter: 1, verse: 1, projectFrame: true, stored: '' });
    expect(staged?.args[1]).toBe('Preguntar al equipo.');
    fireEvent.blur(box);
    expect(calls.some((c) => c.name === 'flushNotes')).toBe(true);
    expect(writes().map((c) => c.name)).toEqual(['stageNote', 'flushNotes']);
  });
});
