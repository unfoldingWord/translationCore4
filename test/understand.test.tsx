// @vitest-environment jsdom
// #106 (epic #104, D63): the Understand screen's WRITE BOUNDARY. The
// comprehension-notes box is the ONLY control that writes to the project
// (owner ruling 2026-08-27); every other control is read-only. Plus the
// persistence shape: the §8.5 note.add event addNote() emits seals and
// projects through the conformance reference.
import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Actions the Understand screen may call WITHOUT writing to the project.
const READ_SIDE = new Set([
  'loadUnderstand', 'setHelpsTab', 'setSourceTab', 'toggleRail', 'setChapter',
  'loadHelpArticle', 'closeHelpArticle', 'openBook', 'go',
  'setNoteDirty', // an unload-guard flag on a ref — never a project write
  'dismissNoteError', // removes a UI failure-ledger entry — never a project write
]);
const calls: Array<{ name: string; args: unknown[] }> = [];
const actionsProxy = new Proxy({}, {
  get: (_, name: string) => (...args: unknown[]) => { calls.push({ name, args }); },
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

const writes = () => calls.filter((c) => !READ_SIDE.has(c.name));

describe('#106 — the Understand write boundary', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('renders the passage, helps and questions read-only — no write fires from any control', () => {
    render(<Understand />);
    expect(screen.getByTestId('understand')).toBeTruthy();
    // exercise every read-only control
    fireEvent.click(screen.getByRole('button', { name: 'UST' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verse' }));
    fireEvent.click(screen.getByRole('button', { name: 'Questions' }));
    fireEvent.click(screen.getByRole('button', { name: 'Notes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Academy' }));
    fireEvent.click(screen.getByRole('button', { name: 'Simplified' }));
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

  it('a note saved under a DIFFERENT chunking still surfaces: retrieval is by unit membership, latest ts wins (2026-08-27 review)', () => {
    const saved = state.understand.comprehension;
    // Two notes inside the first section (verses 1–2): the newer one shows.
    state.understand.comprehension = {
      '1:1': { text: 'older note', ts: '2026-08-26T00:00:00.000Z|0000|a' },
      '1:2': { text: 'newer note under the other chunking', ts: '2026-08-27T00:00:00.000Z|0000|a' },
    };
    try {
      render(<Understand />);
      const boxes = screen.getAllByPlaceholderText('What does this section mean in your own words?');
      expect((boxes[0] as HTMLTextAreaElement).value).toBe('newer note under the other chunking');
    } finally {
      state.understand.comprehension = saved;
    }
  });

  it('the comprehension box is the ONLY write: blur with new text calls saveComprehension, and nothing else writes', () => {
    render(<Understand />);
    const boxes = screen.getAllByPlaceholderText('What does this section mean in your own words?');
    fireEvent.change(boxes[0], { target: { value: 'God made everything through the Word.' } });
    expect(writes()).toEqual([]); // typing alone writes nothing
    fireEvent.blur(boxes[0]);
    const w = writes();
    expect(w.length).toBe(1);
    expect(w[0].name).toBe('saveComprehension');
    expect(w[0].args[2]).toBe('God made everything through the Word.');
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
      const boxes = screen.getAllByPlaceholderText('What does this section mean in your own words?');
      expect((boxes[1] as HTMLTextAreaElement).value).toBe('bridge note');
    } finally {
      state.understand.comprehension = saved;
    }
  });

  it('saving from a bridge unit targets the EXACT span key, never its leading number', () => {
    render(<Understand />);
    fireEvent.click(screen.getByRole('button', { name: 'Verse' }));
    const boxes = screen.getAllByPlaceholderText('What does this section mean in your own words?');
    const bridgeBox = boxes[boxes.length - 1]; // last verse unit is 4-5
    fireEvent.change(bridgeBox, { target: { value: 'note on the bridge' } });
    fireEvent.blur(bridgeBox);
    const w = writes();
    expect(w.length).toBe(1);
    expect(w[0].args[1]).toBe('4-5'); // §8.4 identity preserved
  });

  it('an unchanged focus/blur appends NO duplicate grow-only note', () => {
    const saved = state.understand.comprehension;
    state.understand.comprehension = { '1:1': { text: 'existing note', ts: '2026-08-27T01:00:00.000Z|0000|a' } };
    try {
      render(<Understand />);
      const box = screen.getAllByPlaceholderText('What does this section mean in your own words?')[0];
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
      for (const box of screen.getAllByPlaceholderText('What does this section mean in your own words?')) {
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
      const box = screen.getAllByPlaceholderText('What does this section mean in your own words?')[0];
      expect((box as HTMLTextAreaElement).disabled).toBe(false);
    } finally {
      state.understand = saved;
      state.helpsTab = 'notes';
    }
  });

  it('typing marks the note dirty for the unload guard; an unchanged edit clears it', () => {
    render(<Understand />);
    const box = screen.getAllByPlaceholderText('What does this section mean in your own words?')[0];
    fireEvent.change(box, { target: { value: 'unsaved text' } });
    const dirtyCalls = calls.filter((c) => c.name === 'setNoteDirty');
    expect(dirtyCalls[dirtyCalls.length - 1].args[1]).toBe(true);
    expect(String(dirtyCalls[dirtyCalls.length - 1].args[0])).toContain(':'); // per-target key (C2)
    fireEvent.change(box, { target: { value: '' } }); // back to the stored (empty) value
    const after = calls.filter((c) => c.name === 'setNoteDirty');
    expect(after[after.length - 1].args[1]).toBe(false);
  });
});

describe('2026-08-27 adversarial round 2 regressions', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('blur does NOT clear the dirty flag — only a successful persist may (B1)', () => {
    render(<Understand />);
    const box = screen.getAllByPlaceholderText('What does this section mean in your own words?')[0];
    fireEvent.change(box, { target: { value: 'about to fail' } });
    fireEvent.blur(box);
    // setNoteDirty(true) from the change; NO setNoteDirty(false) from the blur
    const dirtyCalls = calls.filter((c) => c.name === 'setNoteDirty').map((c) => c.args[1]);
    expect(dirtyCalls).toEqual([true]);
    expect(calls.filter((c) => c.name === 'saveComprehension').length).toBe(1);
  });
});

describe('2026-08-27 adversarial round 5 regression', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it("a stored update landing while the user has TYPED newer text does not clobber the draft (E1)", () => {
    const saved = state.understand.comprehension;
    try {
      const { rerender } = render(<Understand />);
      const box = () => screen.getAllByPlaceholderText('What does this section mean in your own words?')[0] as HTMLTextAreaElement;
      // user blurs A (save starts), refocuses and types B while A is pending
      fireEvent.change(box(), { target: { value: 'text B, typed while A saves' } });
      // A's completion publishes its snapshot into comprehension...
      state.understand.comprehension = { '1:1': { text: 'text A', ts: '2026-08-27T02:00:00.000Z|0000|a' } };
      rerender(<Understand />);
      // ...and the box KEEPS the newer draft instead of resetting to A
      expect(box().value).toBe('text B, typed while A saves');
      // and the dirty mark is re-asserted for the unload guard
      const dirty = calls.filter((c) => c.name === 'setNoteDirty');
      expect(dirty[dirty.length - 1].args[1]).toBe(true);
    } finally {
      state.understand.comprehension = saved;
    }
  });

  it('an undiverged box still follows a stored update (the normal sync path)', () => {
    const saved = state.understand.comprehension;
    try {
      const { rerender } = render(<Understand />);
      const box = () => screen.getAllByPlaceholderText('What does this section mean in your own words?')[0] as HTMLTextAreaElement;
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
      const box = screen.getAllByPlaceholderText('What does this section mean in your own words?')[0] as HTMLTextAreaElement;
      expect(box.value).toBe('a permanent note');
      fireEvent.change(box, { target: { value: '' } });
      fireEvent.blur(box);
      expect(box.value).toBe('a permanent note'); // restored
      expect(screen.getByTestId('understand-clear-refused')).toBeTruthy();
      const dirty = calls.filter((c) => c.name === 'setNoteDirty');
      expect(dirty[dirty.length - 1].args[1]).toBe(false); // reconciled
      expect(writes()).toEqual([]); // grow-only store untouched
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
      const box = screen.getAllByPlaceholderText('What does this section mean in your own words?')[1];
      fireEvent.change(box, { target: { value: 'note on project 2:2' } });
      fireEvent.blur(box);
      const w = writes();
      expect(w.length).toBe(1);
      expect(w[0].args[0]).toBe(2); // the PROJECT chapter…
      expect(w[0].args[1]).toBe('2'); // …and the PROJECT verse, verbatim
      expect((w[0].args[3] as { projectFrame: boolean }).projectFrame).toBe(true);
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
      const boxes = screen.getAllByPlaceholderText('What does this section mean in your own words?');
      expect((boxes[0] as HTMLTextAreaElement).value).toBe('note for project 2:1');
      expect((boxes[1] as HTMLTextAreaElement).value).toBe('note for project 2:2');
    } finally {
      state.understand = savedU;
      state.chapter = savedCh;
    }
  });
});

describe('2026-08-27 adversarial round 11 regressions', () => {
  beforeEach(() => { cleanup(); calls.length = 0; });

  it('reverting a draft to the stored text dismisses the failed write for that exact target (K1)', () => {
    const saved = state.understand.comprehension;
    state.understand.comprehension = { '1:1': { text: 'the stored note', ts: '2026-08-27T05:00:00.000Z|0000|a' } };
    try {
      render(<Understand />);
      const box = screen.getAllByPlaceholderText('What does this section mean in your own words?')[0];
      fireEvent.change(box, { target: { value: 'a failing edit' } });
      fireEvent.change(box, { target: { value: 'the stored note' } }); // revert by typing
      const dismissals = calls.filter((c) => c.name === 'dismissNoteError');
      expect(dismissals.length).toBe(1);
      expect(dismissals[0].args).toEqual([1, '1']);
      fireEvent.blur(box); // and the equal-text blur dismisses too, writes nothing
      expect(writes()).toEqual([]);
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
