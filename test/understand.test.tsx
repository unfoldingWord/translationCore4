// @vitest-environment jsdom
// #106 (epic #104, D63): the Understand screen's WRITE BOUNDARY. The
// comprehension-notes box is the ONLY control that writes to the project
// (owner ruling 2026-08-27); every other control is read-only. Plus the
// persistence shape: the §8.5 note.add event addNote() emits seals and
// projects through the conformance reference.
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

// Actions the Understand screen may call WITHOUT writing to the project.
// stageNote/flushNotes are the write surface (D65: staging buffers into the
// note SaveScheduler; flush/debounce journals) — everything else is read-only.
const READ_SIDE = new Set([
  'loadUnderstand', 'setHelpsTab', 'setSourceTab', 'toggleRail', 'setChapter',
  'loadHelpArticle', 'closeHelpArticle', 'openBook', 'go',
  'stagedNote', // reads the scheduler buffer — never a project write
]);
const calls: Array<{ name: string; args: unknown[] }> = [];
// A faithful fake of the note scheduler's per-key latest-value buffer (D65):
// stageNote seeds `persisted` with the displayed stored text on first touch
// and overwrites `current`; stagedNote reads the buffer; dirty is derived by
// comparison, exactly like src/data/saveScheduler.ts.
const noteCurrent = new Map<string, string>();
const notePersisted = new Map<string, string>();
const noteKeyOf = (t: { chapter: unknown; verse: unknown }) => `${t.chapter}:${t.verse}`;
const bufferDirty = () =>
  [...noteCurrent].filter(([k, v]) => notePersisted.get(k) !== v).map(([k]) => k);
const actionsProxy = new Proxy({}, {
  get: (_, name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
    if (name === 'stageNote') {
      const [target, text] = args as [{ chapter: unknown; verse: unknown; stored?: string }, string];
      const k = noteKeyOf(target);
      if (!noteCurrent.has(k)) notePersisted.set(k, target.stored ?? '');
      noteCurrent.set(k, text);
      return undefined;
    }
    if (name === 'stagedNote') return noteCurrent.get(noteKeyOf(args[0] as never)) ?? null;
    if (name === 'revertNote') {
      // Round 32: the version-aware clear — revert to the buffer's persisted
      // value, never a render-time snapshot.
      const k = noteKeyOf(args[0] as never);
      if (noteCurrent.has(k)) noteCurrent.set(k, notePersisted.get(k) ?? '');
      return undefined;
    }
    return undefined;
  },
});

const RAW_ULT = '\\id TIT\n\\c 1\n\\ts\\*\n\\p\n\\v 1 one\n\\v 2 two\n\\ts\\*\n\\p\n\\v 3 three\n\\v 4-5 bridge\n';
const srcChapters = {
  '1': {
    '1': { verseObjects: [{ text: 'In the beginning was the Word.' }] },
    '2': { verseObjects: [{ text: 'He was with God.' }] },
    '3': { verseObjects: [{ text: 'All things were made through him.' }] },
    // A real USFM verse bridge — a span KEY, not two numeric keys (indexer.ts).
    '4-5': { verseObjects: [{ text: 'In him was life, the light of men.' }] },
  },
};

const noteItem = (verse: number, quote: string, note: string, groupId = 'figs-metaphor') => ({
  contextId: {
    checkId: `n${verse}`, occurrenceNote: note,
    reference: { bookId: 'tit', chapter: 1, verse },
    tool: 'translationNotes', groupId, quote: [], quoteString: quote, occurrence: 1,
  },
  category: 'figures', selections: false, comments: false, reminders: false,
  nothingToSelect: false, verseEdits: false, invalidated: false,
});

const state = {
  view: 'read',
  project: { id: 'p1', name: 'Equipo', languageTag: 'es-419', scriptDirection: 'ltr', bookCodes: ['TIT'] },
  book: 'TIT',
  chapter: 1,
  rail: false,
  helpsTab: 'notes',
  sourceTab: 'ult',
  sourcePanes: ['ult', 'ust'], // round 37: chips render from the project's pane ids
  sources: { ult: { raw: RAW_ULT, chapters: srcChapters }, ust: { raw: RAW_ULT, chapters: srcChapters } },
  understand: {
    loading: false,
    book: 'TIT',
    notes: { state: 'ready', rung: 'primary', items: [noteItem(1, 'the Word', 'A title for Jesus.')], dropped: null },
    words: { state: 'none' },
    questions: {
      state: 'ready', rung: 'fallback', dropped: null,
      items: [{ ...noteItem(1, 'Word', 'The Word was with God.'), question: 'Who was with God?', response: 'The Word.', category: 'questions' }],
    },
    comprehension: {},
  },
  progressByProject: {},
  bookError: null,
};

const bookModel = { code: 'TIT', chapterNums: [1], draftPct: 0, byChapter: { '1': [] } };

vi.mock('../src/state.jsx', () => ({
  useApp: () => ({ s: state, book: bookModel, sourceModel: null, actions: actionsProxy }),
  AppProvider: ({ children }: { children: unknown }) => children,
  SCRIPT_FONTS: [],
  SUITE_VERSION: 'v89',
}));

import Understand from '../src/views/Understand.jsx';

// The fake buffer stands in for the note scheduler (module state in the app,
// but per-test here): clear it after cleanup() so tests never inherit drafts.
beforeEach(() => { cleanup(); noteCurrent.clear(); notePersisted.clear(); });

const writes = () => calls.filter((c) => !READ_SIDE.has(c.name));

describe('#106 — the Understand write boundary', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('renders the passage, helps and questions read-only — no write fires from any control', () => {
    render(<Understand />);
    expect(screen.getByTestId('understand')).toBeTruthy();
    // exercise every read-only control
    // The source pill and the helps tab are both labelled by the pinned
    // simplified text ("UST"), so each is addressed inside its own region.
    fireEvent.click(screen.getByTestId('source-tab-ust'));
    fireEvent.click(screen.getByRole('button', { name: 'Verse' }));
    fireEvent.click(screen.getByRole('button', { name: 'Questions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Academy' }));
    fireEvent.click(within(screen.getByTestId('helps-panel')).getByRole('button', { name: 'UST' }));
    expect(writes()).toEqual([]);
  });

  it('the tQ questions render with their answers (read-only)', () => {
    state.helpsTab = 'questions'; // the tab lives in app state; the mock is static
    try {
      render(<Understand />);
      expect(screen.getByText('Who was with God?')).toBeTruthy();
      expect(screen.getByText(/The Word\./)).toBeTruthy();
      expect(writes()).toEqual([]);
    } finally {
      state.helpsTab = 'notes';
    }
  });

  it('verse-bridge keys ("4-5") render in the reading pane instead of being dropped (2026-08-27 review)', () => {
    render(<Understand />);
    expect(screen.getByText(/In him was life/)).toBeTruthy();
  });

  it('EXACT identity wins in a section holding several notes; the rest are announced, never timestamp-picked (M2)', () => {
    const saved = state.understand.comprehension;
    state.understand.comprehension = {
      '1:1': { text: 'note targeting verse 1', ts: '2026-08-26T00:00:00.000Z|0000|a' },
      '1:2': { text: 'newer note targeting verse 2', ts: '2026-08-27T00:00:00.000Z|0000|a' },
    };
    try {
      render(<Understand />);
      const boxes = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?');
      // section 1–2: the HEAD's exact note shows (not the newer one), and the
      // other target is announced
      expect((boxes[0] as HTMLTextAreaElement).value).toBe('note targeting verse 1');
      expect(screen.getByTestId('understand-notes-in-section').textContent).toContain('1');
    } finally {
      state.understand.comprehension = saved;
    }
  });

  it("a single in-range note still surfaces under the other chunking, and EDITING it continues ITS OWN target (M2)", () => {
    const saved = state.understand.comprehension;
    // Only a verse-2 note exists; the section head is verse 1.
    state.understand.comprehension = {
      '1:2': { text: 'the verse-2 note', ts: '2026-08-27T00:00:00.000Z|0000|a' },
    };
    try {
      render(<Understand />);
      const box = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0] as HTMLTextAreaElement;
      expect(box.value).toBe('the verse-2 note');
      fireEvent.change(box, { target: { value: 'the verse-2 note, edited' } });
      fireEvent.blur(box);
      const staged = calls.filter((c) => c.name === 'stageNote');
      expect((staged[staged.length - 1].args[0] as { verse: string }).verse).toBe('2'); // the note's OWN target, not the head '1'
      expect(calls.filter((c) => c.name === 'flushNotes').length).toBe(1);
    } finally {
      state.understand.comprehension = saved;
    }
  });

  it('the comprehension box is the ONLY write: typing stages into the buffer, blur flushes — nothing else writes', () => {
    render(<Understand />);
    const boxes = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?');
    fireEvent.change(boxes[0], { target: { value: 'God made everything through the Word.' } });
    // Typing stages (buffered, debounce-owned) but never flushes by itself.
    expect(calls.filter((c) => c.name === 'flushNotes')).toEqual([]);
    const staged = calls.filter((c) => c.name === 'stageNote');
    expect(staged[staged.length - 1].args[1]).toBe('God made everything through the Word.');
    fireEvent.blur(boxes[0]);
    expect(calls.filter((c) => c.name === 'flushNotes').length).toBe(1);
    // and the whole write surface is exactly those two actions
    expect(writes().every((c) => c.name === 'stageNote' || c.name === 'flushNotes')).toBe(true);
  });
});

describe('2026-08-27 Codex review regressions', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('deriveTnItems keeps plain rows (no SupportReference) only when asked — the Understand notes surface needs them, checking never sees them', async () => {
    const { deriveTnItems, TN_HEADER } = await import('../src/data/derive');
    const tsv = [
      TN_HEADER,
      '1:1\taaaa\t\trc://*/ta/man/translate/figs-metaphor\tquote\t1\tA checking note.',
      '1:2\tbbbb\t\t\t\t0\tA plain note with no module.',
    ].join('\n');
    expect(deriveTnItems(tsv, 'tit').length).toBe(1); // checking default unchanged
    const all = deriveTnItems(tsv, 'tit', { keepPlain: true });
    expect(all.length).toBe(2);
    expect(all[1].contextId.groupId).toBe(''); // plain row links nowhere
  });

  it("a note journaled under a bridge key ('4-5') surfaces in the unit that spans it, and vice versa", () => {
    const saved = state.understand.comprehension;
    state.understand.comprehension = { '1:4-5': { text: 'bridge note', ts: '2026-08-27T01:00:00.000Z|0000|a' } };
    try {
      render(<Understand />);
      // section mode: the second section (verses 3 + 4-5) shows the note
      const boxes = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?');
      expect((boxes[1] as HTMLTextAreaElement).value).toBe('bridge note');
    } finally {
      state.understand.comprehension = saved;
    }
  });

  it('saving from a bridge unit targets the EXACT span key, never its leading number', () => {
    render(<Understand />);
    fireEvent.click(screen.getByRole('button', { name: 'Verse' }));
    const boxes = screen.getAllByPlaceholderText('What does this verse mean, and what will be hard to render?');
    const bridgeBox = boxes[boxes.length - 1]; // last verse unit is 4-5
    fireEvent.change(bridgeBox, { target: { value: 'note on the bridge' } });
    fireEvent.blur(bridgeBox);
    const staged = calls.filter((c) => c.name === 'stageNote');
    expect((staged[staged.length - 1].args[0] as { verse: string }).verse).toBe('4-5'); // §8.4 identity preserved
    expect(calls.filter((c) => c.name === 'flushNotes').length).toBe(1);
  });

  it('an unchanged focus/blur appends NO duplicate grow-only note', () => {
    const saved = state.understand.comprehension;
    state.understand.comprehension = { '1:1': { text: 'existing note', ts: '2026-08-27T01:00:00.000Z|0000|a' } };
    try {
      render(<Understand />);
      const box = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0];
      expect((box as HTMLTextAreaElement).value).toBe('existing note');
      fireEvent.focus(box);
      fireEvent.blur(box);
      expect(writes()).toEqual([]);
    } finally {
      state.understand.comprehension = saved;
    }
  });
});

describe('2026-08-27 adversarial-review regressions', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('comprehension boxes are DISABLED while the persisted notes are unread (comprehension: null) — no writable empties over a grow-only store', () => {
    const saved = state.understand;
    state.understand = { loading: false, error: 'resolution blew up', comprehension: null } as never;
    try {
      render(<Understand />);
      for (const box of screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')) {
        expect((box as HTMLTextAreaElement).disabled).toBe(true);
      }
      expect(writes()).toEqual([]);
    } finally {
      state.understand = saved;
    }
  });

  it("a malformed optional resource is ITS slot's error — stated in the tab, other tabs and notes untouched", () => {
    const saved = state.understand;
    state.understand = {
      ...saved,
      questions: { state: 'error', error: 'unversioned/unknown tQ TSV header' },
    } as never;
    state.helpsTab = 'questions';
    try {
      render(<Understand />);
      expect(screen.getByTestId('helps-state-error').textContent).toContain('unversioned/unknown tQ TSV header');
      // the passage boxes stay enabled — comprehension was read
      const box = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0];
      expect((box as HTMLTextAreaElement).disabled).toBe(false);
    } finally {
      state.understand = saved;
      state.helpsTab = 'notes';
    }
  });

  it('typing makes the note buffer dirty (the unload guard reads it); an unchanged edit returns it to clean', () => {
    render(<Understand />);
    const box = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0];
    fireEvent.change(box, { target: { value: 'unsaved text' } });
    // Dirty is DERIVED per target: current ≠ persisted for exactly this key (C2/F2).
    expect(bufferDirty()).toEqual(['1:1']);
    fireEvent.change(box, { target: { value: '' } }); // back to the stored (empty) value
    expect(bufferDirty()).toEqual([]);
  });
});

describe('2026-08-27 adversarial round 2 regressions', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('blur does NOT clear the buffer — only a successful persist may (B1: the scheduler sets persisted on write success)', () => {
    render(<Understand />);
    const box = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0];
    fireEvent.change(box, { target: { value: 'about to fail' } });
    fireEvent.blur(box);
    // The flush was REQUESTED; the buffer stays dirty until the write lands
    // (the real scheduler clears it only in writeDirty's success path).
    expect(calls.filter((c) => c.name === 'flushNotes').length).toBe(1);
    expect(bufferDirty()).toEqual(['1:1']);
  });
});

describe('2026-08-27 adversarial round 5 regression', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it("a stored update landing while the user has TYPED newer text does not clobber the draft (E1)", () => {
    const saved = state.understand.comprehension;
    try {
      const { rerender } = render(<Understand />);
      const box = () => screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0] as HTMLTextAreaElement;
      // user blurs A (save starts), refocuses and types B while A is pending
      fireEvent.change(box(), { target: { value: 'text B, typed while A saves' } });
      // A's completion publishes its snapshot into comprehension...
      state.understand.comprehension = { '1:1': { text: 'text A', ts: '2026-08-27T02:00:00.000Z|0000|a' } };
      rerender(<Understand />);
      // ...and the box KEEPS the newer draft instead of resetting to A
      expect(box().value).toBe('text B, typed while A saves');
      // and the buffer still holds the draft for the unload guard
      expect(bufferDirty()).toEqual(['1:1']);
    } finally {
      state.understand.comprehension = saved;
    }
  });

  it('an undiverged box still follows a stored update (the normal sync path)', () => {
    const saved = state.understand.comprehension;
    try {
      const { rerender } = render(<Understand />);
      const box = () => screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0] as HTMLTextAreaElement;
      expect(box().value).toBe('');
      state.understand.comprehension = { '1:1': { text: 'saved elsewhere', ts: '2026-08-27T02:00:00.000Z|0000|a' } };
      rerender(<Understand />);
      expect(box().value).toBe('saved elsewhere');
    } finally {
      state.understand.comprehension = saved;
    }
  });
});

describe('2026-08-27 adversarial round 7 regression', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('clearing a saved note is REFUSED: the text restores, the reason shows, the dirty mark reconciles, nothing writes (G1)', () => {
    const saved = state.understand.comprehension;
    state.understand.comprehension = { '1:1': { text: 'a permanent note', ts: '2026-08-27T03:00:00.000Z|0000|a' } };
    try {
      render(<Understand />);
      const box = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0] as HTMLTextAreaElement;
      expect(box.value).toBe('a permanent note');
      fireEvent.change(box, { target: { value: '' } });
      fireEvent.blur(box);
      expect(box.value).toBe('a permanent note'); // restored
      expect(screen.getByTestId('understand-clear-refused')).toBeTruthy();
      // The emptiness never entered the buffer: it reconciled to the stored
      // text (clean by comparison), and nothing flushed — the grow-only
      // store is untouched and no dirty state can strand (round 22).
      expect(bufferDirty()).toEqual([]);
      expect(calls.filter((c) => c.name === 'flushNotes')).toEqual([]);
    } finally {
      state.understand.comprehension = saved;
    }
  });
});

describe('2026-08-27 adversarial round 8 regressions', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('a cross-frame project renders the passage at the MAPPED source refs, states the unmappable, and saves under the SOURCE chapter (H1)', () => {
    const savedU = state.understand;
    const savedCh = state.chapter;
    try {
      // Project chapter 2 maps to source 1:1 (plus one unmappable verse).
      state.chapter = 2 as never;
      state.understand = {
        ...savedU,
        // Fan-out shape (I1): TWO project verses read the SAME source ref.
        sourceRefs: { '2': [{ c: 1, v: '1', pc: 2, pv: '1' }, { c: 1, v: '1', pc: 2, pv: '2' }, { unmapped: '2:99' }] },
      } as never;
      render(<Understand />);
      // both fan-out units render, each showing the SOURCE ref and text
      expect(screen.getAllByText('Titus 1:1').length).toBe(2);
      expect(screen.getAllByText(/In the beginning was the Word/).length).toBe(2);
      // the unmappable project verse is stated, not guessed
      expect(screen.getByTestId('understand-unit-u2:99').textContent).toContain('2:99');
      // and a save from the SECOND unit writes ITS exact project ref
      // verbatim (never a reverse-mapped span), with the source ref only
      // naming the display echo bucket
      const box = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[1];
      fireEvent.change(box, { target: { value: 'note on project 2:2' } });
      fireEvent.blur(box);
      const staged = calls.filter((c) => c.name === 'stageNote');
      const target = staged[staged.length - 1].args[0] as { chapter: number; verse: string; projectFrame: boolean };
      expect(target.chapter).toBe(2); // the PROJECT chapter…
      expect(target.verse).toBe('2'); // …and the PROJECT verse, verbatim
      expect(target.projectFrame).toBe(true);
      expect(calls.filter((c) => c.name === 'flushNotes').length).toBe(1);
    } finally {
      state.understand = savedU;
      state.chapter = savedCh;
    }
  });
});

describe('2026-08-27 adversarial round 10 regression', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('fan-out units keep their DISTINCT notes: each box reads its exact project reference (J2)', () => {
    const savedU = state.understand;
    const savedCh = state.chapter;
    try {
      state.chapter = 2 as never;
      state.understand = {
        ...savedU,
        sourceRefs: { '2': [{ c: 1, v: '1', pc: 2, pv: '1' }, { c: 1, v: '1', pc: 2, pv: '2' }] },
        comprehension: {
          '2:1': { text: 'note for project 2:1', ts: '2026-08-27T04:00:00.000Z|0000|a' },
          '2:2': { text: 'note for project 2:2', ts: '2026-08-27T04:00:01.000Z|0000|a' },
        },
      } as never;
      render(<Understand />);
      const boxes = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?');
      expect((boxes[0] as HTMLTextAreaElement).value).toBe('note for project 2:1');
      expect((boxes[1] as HTMLTextAreaElement).value).toBe('note for project 2:2');
    } finally {
      state.understand = savedU;
      state.chapter = savedCh;
    }
  });
});

describe('2026-08-27 adversarial round 14 regression', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it("a draft never survives a change of the box's DURABLE TARGET: the identity flip resets it (N2)", () => {
    const saved = state.understand.comprehension;
    // Only a verse-2 note: the section box displays it (target 2).
    state.understand.comprehension = { '1:2': { text: 'the verse-2 note', ts: '2026-08-27T06:00:00.000Z|0000|a' } };
    try {
      const { rerender } = render(<Understand />);
      const box = () => screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0] as HTMLTextAreaElement;
      fireEvent.change(box(), { target: { value: 'draft typed against target 2' } });
      // An exact verse-1 note lands: the displayed target flips 2 -> 1.
      state.understand.comprehension = {
        '1:1': { text: 'exact head note', ts: '2026-08-27T06:00:02.000Z|0000|a' },
        '1:2': { text: 'the verse-2 note', ts: '2026-08-27T06:00:00.000Z|0000|a' },
      };
      rerender(<Understand />);
      // The box follows its NEW target — the draft is never carried onto it…
      expect(box().value).toBe('exact head note');
      // …and never DISCARDED either (O1, round 15): the parked draft is
      // restored by the box that shows its own durable target (Verse view).
      fireEvent.click(screen.getByRole('button', { name: 'Verse' }));
      const boxes = screen.getAllByPlaceholderText('What does this verse mean, and what will be hard to render?');
      expect((boxes[1] as HTMLTextAreaElement).value).toBe('draft typed against target 2');
    } finally {
      state.understand.comprehension = saved;
    }
  });
});

describe('2026-08-27 adversarial round 11 regressions', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('reverting a draft to the stored text abandons it: the buffer returns to clean and nothing flushes (K1)', () => {
    const saved = state.understand.comprehension;
    state.understand.comprehension = { '1:1': { text: 'the stored note', ts: '2026-08-27T05:00:00.000Z|0000|a' } };
    try {
      render(<Understand />);
      const box = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0];
      fireEvent.change(box, { target: { value: 'a failing edit' } });
      expect(bufferDirty()).toEqual(['1:1']);
      fireEvent.change(box, { target: { value: 'the stored note' } }); // revert by typing
      expect(bufferDirty()).toEqual([]); // clean by comparison — the failed draft is abandoned
      fireEvent.blur(box); // and the equal-text blur writes nothing
      expect(calls.filter((c) => c.name === 'flushNotes')).toEqual([]);
    } finally {
      state.understand.comprehension = saved;
    }
  });

  it('the merge of downloaded optional pins never replaces an existing pin and targets only the matching rung (K2)', async () => {
    const { mergeOptionalPins } = await import('../src/data/installed');
    const pin = (repo: string) => ({ repoPath: `git.door43.org/es-419_gl/${repo}`, sha: 'f'.repeat(40), flavor: 'x' });
    const resources = {
      languageSets: {
        primary: { gatewayLanguage: { languageId: 'es-419', owner: 'es-419_gl' }, translationNotes: pin('es-419_tn') },
        fallback: { gatewayLanguage: { languageId: 'en', owner: 'unfoldingWord' }, translationNotes: pin('en_tn') },
      },
    };
    const installed = { a: pin('es-419_tn'), b: pin('es-419_tw'), c: pin('es-419_ta'), d: pin('es-419_tq'), e: pin('es-419_gst') };
    const merged = mergeOptionalPins(resources as unknown as Parameters<typeof mergeOptionalPins>[0], { id: 'es-419', org: 'es-419_gl' }, installed as never);
    expect(merged?.languageSets?.primary.translationQuestions?.repoPath).toContain('es-419_tq');
    expect(merged?.languageSets?.primary.simplifiedText?.repoPath).toContain('es-419_gst');
    expect(merged?.languageSets?.fallback.translationQuestions).toBeUndefined(); // non-matching rung untouched
    // idempotent: nothing new to add -> null (no write)
    expect(mergeOptionalPins(merged as never, { id: 'es-419', org: 'es-419_gl' }, installed as never)).toBeNull();
  });

  it('optional pins adopt WITHOUT the required suite being local: a tq-only download reaches the matching rung (adversarial round 12, L2)', async () => {
    const { mergeOptionalPins } = await import('../src/data/installed');
    const pin = (repo: string) => ({ repoPath: `git.door43.org/es-419_gl/${repo}`, sha: 'f'.repeat(40), flavor: 'x' });
    const resources = {
      languageSets: {
        primary: { gatewayLanguage: { languageId: 'es-419', owner: 'es-419_gl' }, translationNotes: pin('es-419_tn') },
      },
    };
    // ONLY the optional repo is installed — no tn/tw/ta on this machine.
    const installed = { d: pin('es-419_tq') };
    const merged = mergeOptionalPins(resources as unknown as Parameters<typeof mergeOptionalPins>[0], { id: 'es-419', org: 'es-419_gl' }, installed as never);
    expect(merged?.languageSets?.primary.translationQuestions?.repoPath).toContain('es-419_tq');
  });
});

describe('2026-08-27 adversarial round 19 regressions', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('two concurrent successful saves both survive: the reducer merges noteSaved by key from ITS OWN state (S1)', async () => {
    // The real module (not the mock): vi.mock only intercepts this file's
    // static import of ../src/state.jsx, so pull the reducer via the actual
    // path the mock resolves — importActual bypasses it.
    const { __reducerForTests: reducer } = await vi.importActual<typeof import('../src/state.jsx')>('../src/state.jsx');
    const base = {
      book: 'TIT',
      project: { repoPath: 'p1' },
      understand: { book: 'TIT', comprehension: {} },
    };
    // Two completions dispatched back-to-back — the second must NOT drop the
    // first's entry (the old snapshot-spread did exactly that).
    const afterA = reducer(base, { type: 'noteSaved', repoPath: 'p1', book: 'TIT', key: '1:1', text: 'note A', ts: 't1' });
    const afterB = reducer(afterA, { type: 'noteSaved', repoPath: 'p1', book: 'TIT', key: '1:2', text: 'note B', ts: 't2' });
    expect(afterB.understand.comprehension['1:1'].text).toBe('note A');
    expect(afterB.understand.comprehension['1:2'].text).toBe('note B');
    // and a completion for a project/book the UI has left never touches the
    // visible understand state (D65: no error-mirror side channel remains)
    const foreign = reducer(afterB, { type: 'noteSaved', repoPath: 'p2', book: 'TIT', key: '1:3', text: 'foreign', ts: 't3' });
    expect(foreign.understand.comprehension['1:3']).toBeUndefined();
    expect(foreign).toBe(afterB); // untouched, not merely similar
  });

  it("the noteSaveState mirror folds the scheduler's failure message into the Understand callout, from the reducer's own state", async () => {
    const { __reducerForTests: reducer } = await vi.importActual<typeof import('../src/state.jsx')>('../src/state.jsx');
    const base = { noteSaveState: 'saved', understand: { book: 'TIT', comprehension: {} } };
    const failed = reducer(base, { type: 'noteSaveState', state: 'error', saveError: 'disk full' });
    expect(failed.noteSaveState).toBe('error');
    expect(failed.understand.saveError).toBe('disk full');
    const recovered = reducer(failed, { type: 'noteSaveState', state: 'saved', saveError: null });
    expect(recovered.noteSaveState).toBe('saved');
    expect(recovered.understand.saveError).toBeNull();
    // with no understand loaded, only the mirror moves
    const bare = reducer({ noteSaveState: 'saved', understand: null }, { type: 'noteSaveState', state: 'dirty', saveError: null });
    expect(bare.noteSaveState).toBe('dirty');
    expect(bare.understand).toBeNull();
  });

  it('cross-frame mode with ZERO refs suppresses the passage and states why — never a same-frame guess (S3)', () => {
    const savedU = state.understand;
    try {
      // A known-non-eng frame whose mapping is unavailable: sourceRefs {} and
      // comprehension null (boxes would be disabled if any rendered).
      state.understand = { ...savedU, sourceRefs: {}, comprehension: null } as never;
      render(<Understand />);
      expect(screen.queryAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?').length).toBe(0);
      expect(screen.getByTestId('understand-frame-unavailable')).toBeTruthy();
      // and no same-frame passage leaked through
      expect(screen.queryByText(/In the beginning was the Word/)).toBeNull();
    } finally {
      state.understand = savedU;
    }
  });
});

describe('#106 — the persistence shape: §8.5 note.add seals and projects', () => {
  it('the exact event addNote() emits validates through the reference and folds into notes output', async () => {
    const { sealAction } = await import('../src/data/journal/seal');
    const nodeRequire = process.getBuiltinModule('node:module').createRequire(`${process.cwd()}/`);
    const refFold = nodeRequire('./conformance/journal/fold.mjs') as { fold(events: unknown[]): { notes: Array<Record<string, unknown>> } };
    const refSkeleton = nodeRequire('./conformance/journal/skeleton.mjs') as { decompose(usfm: string): { skeleton: string; verses: Record<string, string> } };
    const { skeleton, verses } = refSkeleton.decompose('\\id TIT\n\\c 1\n\\p\n\\v 1 one\n');
    const addTs = '2026-08-27T00:00:00.000Z|0000|actor-a';
    const events = [
      { v: 1, op: 'book.add', actor: 'actor-a', ts: addTs, base: null, book: 'TIT', scope: [], skeleton, initialVerses: verses },
      { v: 1, op: 'note.add', actor: 'actor-a', ts: '2026-08-27T00:00:01.000Z|0000|actor-a',
        target: { book: 'TIT', chapter: '1', verse: '1' }, text: 'My comprehension note.', generation: addTs },
    ];
    await expect(sealAction([events[1]] as never)).resolves.toBeDefined();
    const out = refFold.fold(JSON.parse(JSON.stringify(events)));
    expect(out.notes.length).toBe(1);
    expect(out.notes[0].text).toBe('My comprehension note.');
    expect((out.notes[0].target as Record<string, unknown>).verse).toBe('1');
  });
});

describe('2026-08-28 adversarial round 20 regression (F2)', () => {
  beforeEach(() => { calls.length = 0; });

  it('a bumped installEpoch re-runs loadUnderstand — an install that leaves resources.json byte-identical still refreshes readiness', () => {
    const loads = () => calls.filter((c) => c.name === 'loadUnderstand').length;
    const { rerender } = render(<Understand />);
    const initial = loads();
    expect(initial).toBeGreaterThan(0);

    // Same deps → no re-run (the effect is keyed, not per-render).
    rerender(<Understand />);
    expect(loads()).toBe(initial);

    // A successful download bumps the epoch even when projectPins did not
    // change (the pin already existed; only the machine's holdings changed).
    (state as { installEpoch?: number }).installEpoch = 1;
    rerender(<Understand />);
    expect(loads()).toBe(initial + 1);
    delete (state as { installEpoch?: number }).installEpoch;
  });
});

describe('2026-08-28 adversarial round 22 regression (D65: the class, not the symptom)', () => {
  beforeEach(() => { cleanup(); calls.length = 0; noteCurrent.clear(); notePersisted.clear(); });

  it('an emptied saved note whose box unmounts BEFORE blur leaves nothing dirty and nothing stranded', () => {
    const saved = state.understand.comprehension;
    state.understand.comprehension = { '1:1': { text: 'a saved note', ts: '2026-08-28T00:00:00.000Z|0000|a' } };
    try {
      render(<Understand />);
      const box = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0] as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: '' } }); // clear, no blur
      cleanup(); // a background refresh unmounts the box
      // Round 22's stranded dirty guard is structurally impossible: the
      // emptiness reconciled the buffer at CHANGE time, so nothing is dirty,
      // nothing flushes, and navigation is free.
      expect(bufferDirty()).toEqual([]);
      expect(calls.filter((c) => c.name === 'flushNotes')).toEqual([]);
      // and a remount shows the stored note again — nothing was lost
      render(<Understand />);
      const again = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0] as HTMLTextAreaElement;
      expect(again.value).toBe('a saved note');
    } finally {
      state.understand.comprehension = saved;
    }
  });

  it('a DIVERGED draft whose box unmounts before blur survives in the buffer and restores on remount (P1/O1 structurally)', () => {
    render(<Understand />);
    const box = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0] as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'an unblurred draft' } });
    cleanup(); // unmount with unblurred text
    expect(bufferDirty()).toEqual(['1:1']); // the draft is project work the drain will flush
    render(<Understand />);
    const again = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0] as HTMLTextAreaElement;
    expect(again.value).toBe('an unblurred draft');
  });
});

describe('2026-08-28 adversarial round 32 regressions', () => {
  beforeEach(() => { cleanup(); calls.length = 0; noteCurrent.clear(); notePersisted.clear(); });

  it('an EMPTIED box reverts the target instead of staging the render-time stored snapshot (F1)', () => {
    const saved = state.understand.comprehension;
    state.understand.comprehension = { '1:1': { text: 'note A', ts: '2026-08-28T00:00:00.000Z|0000|a' } };
    try {
      render(<Understand />);
      const box = screen.getAllByPlaceholderText('What is this section saying? Who is speaking, to whom, and what will be hard to render?')[0];
      fireEvent.change(box, { target: { value: 'note B' } }); // staged
      fireEvent.change(box, { target: { value: '' } }); // cleared mid-edit
      const reverts = calls.filter((c) => c.name === 'revertNote');
      expect(reverts.length).toBe(1); // the clear is a REVERT op…
      const staged = calls.filter((c) => c.name === 'stageNote');
      expect(staged[staged.length - 1].args[1]).toBe('note B'); // …never a stage of the stale stored text
      expect(bufferDirty()).toEqual([]);
    } finally {
      state.understand.comprehension = saved;
    }
  });

  it('cross-frame projects state "Verse view" instead of offering a Section control that does nothing (F2, D30)', () => {
    const savedU = state.understand;
    try {
      state.understand = {
        ...savedU,
        sourceRefs: { '1': [{ c: 1, v: '1', pc: 1, pv: '1' }] },
      } as never;
      render(<Understand />);
      expect(screen.queryByRole('button', { name: 'Verse' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Section' })).toBeNull();
      expect(screen.getByTestId('understand-verse-only')).toBeTruthy();
    } finally {
      state.understand = savedU;
    }
  });

  it('same-frame projects keep the Section/Verse control', () => {
    render(<Understand />);
    expect(screen.getByRole('button', { name: 'Verse' })).toBeTruthy();
    expect(screen.queryByTestId('understand-verse-only')).toBeNull();
  });
});

describe('2026-08-28 adversarial round 33 regression (F3)', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('a long translation note is never silently truncated: the full text is reachable through Show more', () => {
    const savedItems = state.understand.notes.items;
    const longNote = `${'Guidance that matters. '.repeat(25)}THE QUALIFICATION AT THE END.`; // > 400 chars
    expect(longNote.length).toBeGreaterThan(400);
    state.understand.notes = { ...state.understand.notes, items: [noteItem(1, 'the Word', longNote)] };
    try {
      render(<Understand />);
      // Collapsed: a visible preview plus an accessible expansion control.
      const toggle = screen.getByTestId('note-expand');
      expect(toggle.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByText(/THE QUALIFICATION AT THE END/)).toBeNull();
      fireEvent.click(toggle);
      expect(toggle.getAttribute('aria-expanded')).toBe('true');
      expect(screen.getByText(/THE QUALIFICATION AT THE END/)).toBeTruthy();
      // Short notes render whole, with no control.
      expect(writes()).toEqual([]); // expansion is read-only
    } finally {
      state.understand.notes = { ...state.understand.notes, items: savedItems };
    }
  });
});

describe('#106 — note bodies are markdown, and are rendered as such', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  // The REAL chapter-introduction note, read from the vendored en_tn@v86 TSV —
  // not a hand-written literal. It is the note that exposed both defects: no
  // quoted phrase, escaped line breaks, `#`/`##` headings, `**` emphasis, and
  // a 400-character cut that lands inside a `[1 Timothy 3](…)` link.
  const fsMod = process.getBuiltinModule('node:fs');
  const pathMod = process.getBuiltinModule('node:path');
  const HERE = pathMod.dirname(new URL(import.meta.url).pathname);
  const TSV = fsMod.readFileSync(
    pathMod.join(HERE, 'fixtures', 'resources', 'en_tn@v86', 'TIT.tsv'),
    'utf8',
  );
  const INTRO = (() => {
    const header = TSV.split('\n')[0].split('\t');
    const noteCol = header.indexOf('Note');
    const row = TSV.split('\n').find((l) => l.startsWith('1:intro\t'));
    if (!row) throw new Error('the vendored en_tn TIT.tsv has no 1:intro row');
    return row.split('\t')[noteCol];
  })();

  it('renders the markdown instead of printing it — no ##, no **, no literal escapes', () => {
    const savedItems = state.understand.notes.items;
    state.understand.notes = { ...state.understand.notes, items: [noteItem(1, '', INTRO)] };
    try {
      render(<Understand />);
      const card = screen.getByTestId('note-expand').closest('[data-tc="outline"]');
      expect(card).toBeTruthy();
      const shown = card!.textContent ?? '';
      // The heading text survives; the syntax does not.
      expect(shown).toContain('Titus 1 Chapter Introduction');
      expect(shown).toContain('Structure and Formatting');
      expect(shown).not.toContain('#');
      expect(shown).not.toContain('**');
      expect(shown).not.toContain('\\n');
      expect(shown).not.toContain('[[');
      // The COLLAPSED preview must not end mid-token: cutting the markdown
      // source at 400 characters left a dangling "[1 " from "[1 Timothy 3](…)".
      expect(shown).not.toMatch(/\[[^\]]*…/);
      expect(writes()).toEqual([]); // still read-only
    } finally {
      state.understand.notes = { ...state.understand.notes, items: savedItems };
    }
  });

  it('a preview never ends on a word fragment, even when the budget runs out mid-block', () => {
    // en_tn@v86 JON 4:intro: earlier blocks consume ~397 characters, leaving a
    // budget too small for the next block's first word — which used to print
    // "Prophecy delayed Acc…".
    const jon = fsMod.readFileSync(
      pathMod.join(HERE, 'fixtures', 'resources', 'en_tn@v86', 'JON.tsv'),
      'utf8',
    );
    const header = jon.split('\n')[0].split('\t');
    const row = jon.split('\n').find((l) => l.startsWith('4:intro\t'));
    if (!row) throw new Error('the vendored en_tn JON.tsv has no 4:intro row');
    const note = row.split('\t')[header.indexOf('Note')];
    const savedItems = state.understand.notes.items;
    state.understand.notes = { ...state.understand.notes, items: [noteItem(1, '', note, '')] };
    try {
      render(<Understand />);
      const card = screen.getByTestId('note-expand').closest('[data-tc="outline"]');
      const shown = card!.textContent ?? '';
      // The word before the ellipsis must be a WHOLE word of the source, not a
      // fragment: "Acc…" is a fragment of "According", and `\bAcc\b` does not
      // appear in the note, while the correct last word does.
      const tail = shown.match(/(\S+)…/);
      expect(tail, 'the collapsed preview must end with an ellipsis').toBeTruthy();
      const lastWord = tail![1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      expect(
        new RegExp(`\\b${lastWord}\\b`).test(note),
        `"${tail![1]}" is not a whole word of the note`,
      ).toBe(true);
    } finally {
      state.understand.notes = { ...state.understand.notes, items: savedItems };
    }
  });

  it('a note with no quoted phrase renders no empty quotation marks', () => {
    const savedItems = state.understand.notes.items;
    // A chapter introduction has NEITHER a quoted phrase nor a groupId to fall
    // back to — the title is genuinely empty, which is what printed “”.
    state.understand.notes = { ...state.understand.notes, items: [noteItem(1, '', INTRO, '')] };
    try {
      render(<Understand />);
      expect(screen.queryByText('“”')).toBeNull();
    } finally {
      state.understand.notes = { ...state.understand.notes, items: savedItems };
    }
  });
});

describe('2026-08-28 adversarial round 34 regression (F1 view)', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('a rejected pins read shows a stated error with a retry that re-runs the pins load — never a false absence', () => {
    (state as { projectPinsError?: string }).projectPinsError = 'sidecar corrupt';
    try {
      render(<Understand />);
      expect(screen.getByTestId('pins-error').textContent).toContain('sidecar corrupt');
      fireEvent.click(screen.getByTestId('pins-retry'));
      expect(calls.some((c) => c.name === 'retryProjectPins')).toBe(true);
    } finally {
      delete (state as { projectPinsError?: string }).projectPinsError;
    }
  });
});

describe('2026-08-28 adversarial round 35 regression (F2 view)', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('a failed article read shows a stated error with an in-place retry — never "article missing"', () => {
    const savedU = state.understand;
    try {
      state.understand = {
        ...savedU,
        article: { key: 'ta::figs-metaphor', loading: false, found: null, error: 'socket hang up', request: { kind: 'ta', slug: 'figs-metaphor', rung: 'primary' } },
      } as never;
      render(<Understand />);
      expect(screen.getByTestId('understand-article-error').textContent).toContain('socket hang up');
      expect(screen.queryByTestId('understand-article-missing')).toBeNull(); // no false absence
      fireEvent.click(screen.getByTestId('article-retry'));
      const retries = calls.filter((c) => c.name === 'loadHelpArticle');
      expect(retries.length).toBe(1);
      expect(retries[0].args[0]).toMatchObject({ kind: 'ta', slug: 'figs-metaphor' });
    } finally {
      state.understand = savedU;
    }
  });
});

describe('2026-08-28 adversarial round 37 regressions', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('a chapter mapping entirely into ANOTHER book states that in the helps — never "nothing for this chapter" (F2)', () => {
    const savedU = state.understand;
    const savedCh = state.chapter;
    try {
      state.chapter = 11 as never;
      state.helpsTab = 'questions';
      state.understand = {
        ...savedU,
        sourceRefs: { '11': [{ crossBook: '11:1', to: 'NEH 1:1' }] },
      } as never;
      render(<Understand />);
      expect(screen.getByTestId('helps-cross-book').textContent).toContain('NEH 1:1');
      // and the simplified text never interpolates undefined refs
      state.helpsTab = 'simplified';
      state.understand = {
        ...state.understand,
        simplified: { state: 'ready', rung: 'primary', chapters: { '1': { '1': { verseObjects: [{ text: 'texto' }] } } } },
      } as never;
      cleanup();
      render(<Understand />);
      expect(screen.queryByText(/undefined:undefined/)).toBeNull();
    } finally {
      state.understand = savedU;
      state.chapter = savedCh;
      state.helpsTab = 'notes';
    }
  });

  it('a project that pins NO source panes states it, with no chips and no defaults (F1, §5.3)', () => {
    const savedPanes = (state as { sourcePanes?: string[] }).sourcePanes;
    const savedSources = state.sources;
    try {
      (state as { sourcePanes?: string[] }).sourcePanes = [];
      state.sources = {} as never;
      render(<Understand />);
      expect(screen.getByTestId('no-source-panes')).toBeTruthy();
      expect(screen.queryByTestId('source-tab-ult')).toBeNull();
      expect(screen.queryByTestId('source-tab-ust')).toBeNull();
      // No pane, no source name (Codex review of #140).
      expect(screen.queryByTestId('understand-source-name')).toBeNull();
      // No panes means nothing is pending: the loading line must not render
      // beside (and contradict) the no-source-panes callout (issue #123).
      expect(screen.queryByText(/Loading the passage/)).toBeNull();
    } finally {
      (state as { sourcePanes?: string[] }).sourcePanes = savedPanes;
      state.sources = savedSources;
    }
  });

  it('a failed pane read is a stated, retryable error — never "not available for this book" (A3)', () => {
    const savedSources = state.sources;
    try {
      state.sources = { ...savedSources, ult: { error: 'socket hang up' } } as never;
      render(<Understand />);
      expect(screen.getByTestId('source-pane-error').textContent).toContain('socket hang up');
      fireEvent.click(screen.getByTestId('source-retry'));
      expect(calls.some((c) => c.name === 'reloadSourcePanes')).toBe(true);
    } finally {
      state.sources = savedSources;
    }
  });

  it('the Academy article renders EVERY block — the fixture-sized 42-block module keeps its final example (F3)', () => {
    const savedU = state.understand;
    try {
      const body = Array.from({ length: 41 }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n') + '\n\nTHE FINAL APPLIED EXAMPLE.';
      state.understand = {
        ...savedU,
        article: { key: 'ta::abstractnouns', loading: false, found: { title: 'Abstract Nouns', body } },
      } as never;
      render(<Understand />);
      expect(screen.getByText(/THE FINAL APPLIED EXAMPLE/)).toBeTruthy();
    } finally {
      state.understand = savedU;
    }
  });
});

describe('#104 fidelity — the focused-unit model (Codex review of #140)', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('the first unit is focused by default; clicking another moves the focus and nothing writes', () => {
    render(<Understand />);
    const units = screen.getAllByTestId(/^understand-unit-/);
    expect(units[0].getAttribute('data-focused')).toBe('true');
    expect(units[1].getAttribute('data-focused')).toBeNull();
    fireEvent.click(units[1]);
    expect(units[1].getAttribute('data-focused')).toBe('true');
    expect(units[0].getAttribute('data-focused')).toBeNull();
    expect(writes()).toEqual([]);
  });

  it('a unit is keyboard-operable: Tab stop, Enter and Space focus it', () => {
    render(<Understand />);
    const units = screen.getAllByTestId(/^understand-unit-/);
    expect(units[1].getAttribute('tabindex')).toBe('0');
    fireEvent.keyDown(units[1], { key: 'Enter' });
    expect(units[1].getAttribute('data-focused')).toBe('true');
    fireEvent.keyDown(units[0], { key: ' ' });
    expect(units[0].getAttribute('data-focused')).toBe('true');
    expect(units[0].getAttribute('aria-current')).toBe('true');
  });

  it('focusing a unit selects the first help card in its range; a unit without one clears the selection', () => {
    render(<Understand />);
    const units = screen.getAllByTestId(/^understand-unit-/);
    fireEvent.click(units[0]); // verses 1–2 carry the fixture's verse-1 note
    const focused = calls.filter((c) => c.name === 'focusHelp');
    expect(focused.length).toBe(1);
    expect((focused[0].args[0] as { id: string }).id).toBe('n1');
    // With a card active, a unit that has no help clears it (focusHelp(null)).
    (state as unknown as { helpsActive: { id: string } | null }).helpsActive = { id: 'n1' };
    try {
      fireEvent.click(units[1]); // verses 3–5: no notes, no words
      const after = calls.filter((c) => c.name === 'focusHelp');
      expect(after.length).toBe(2);
      expect(after[1].args[0]).toBeNull();
    } finally {
      (state as unknown as { helpsActive: unknown }).helpsActive = undefined;
    }
  });

  it('a paragraph marker inside a verse opens a new <p>; the unit renders one paragraph otherwise', () => {
    const saved = srcChapters['1']['2'];
    (srcChapters['1'] as Record<string, unknown>)['2'] = { verseObjects: [{ tag: 'p', type: 'paragraph' }, { text: 'He was with God.' }] };
    try {
      render(<Understand />);
      const units = screen.getAllByTestId(/^understand-unit-/);
      expect(units[0].querySelectorAll('p').length).toBe(2);
      expect(units[1].querySelectorAll('p').length).toBe(1);
    } finally {
      (srcChapters['1'] as Record<string, unknown>)['2'] = saved;
    }
  });
});
