// @vitest-environment jsdom
// PR #150 (epic #104 fidelity): check-item titles show the GATEWAY rendering of
// the quote [decided 2026-08-31], through the helps panel's own resolver — so
// the rail, the heading and the picker's next-line can never disagree with the
// helps panel. Codex review round 1 of #150: cross-frame mapped rows, loading
// (no frame verdict), bridge keys, and the empty-quote-array shape.
import { describe, expect, it } from 'vitest';
import { gatewayTitleFor } from '../src/views/Check.jsx';

// The real usfm-js aligned shape (as in helpsHighlight.test.tsx): zaln
// milestones carrying gateway words; Θεοῦ appears twice to prove occurrence.
const zw = (text: string) => ({ text, tag: 'w', type: 'word', occurrence: '1', occurrences: '1' });
const zg = (content: string, occurrence: string, children: unknown[]) => ({
  tag: 'zaln', type: 'milestone', content, occurrence, occurrences: '2', children,
});
const sp = { type: 'text', text: ' ' };
const alignedV1 = {
  verseObjects: [
    zg('δοῦλος', '1', [zw('servant')]), sp,
    zg('Θεοῦ', '1', [zw('of'), sp, zw('God')]), sp,
    zg('ἐκλεκτῶν', '1', [zw('chosen')]), sp,
    zg('Θεοῦ', '2', [zw('of'), sp, zw('God')]), { type: 'text', text: '.' },
  ],
};
const item = (chapter: number, verse: number | string, over: Record<string, unknown> = {}) => ({
  contextId: {
    checkId: `n${chapter}:${verse}`, groupId: 'figs-metaphor',
    reference: { bookId: 'tit', chapter, verse },
    quote: [{ word: 'ἐκλεκτῶν', occurrence: 1 }, { word: 'Θεοῦ', occurrence: 1 }],
    quoteString: 'ἐκλεκτῶν Θεοῦ', occurrence: 1,
    ...over,
  },
});
const sources = (chapters: Record<string, Record<string, unknown>>) => ({ ult: { raw: '', chapters } });
const ready = (sourceRefs: unknown = null) => ({ loading: false, sourceRefs });

describe('gatewayTitleFor — the Check tool titles items in the gateway text', () => {
  it('same frame: the ULT words the quote aligns to, in gateway order', () => {
    const titleOf = gatewayTitleFor(sources({ '1': { '1': alignedV1 } }), ['ult'], ready());
    expect(titleOf(item(1, 1))).toBe('chosen of God');
  });

  it('occurrence discriminates: Θεοῦ#2 alone resolves to the SECOND "of God"', () => {
    const titleOf = gatewayTitleFor(sources({ '1': { '1': alignedV1 } }), ['ult'], ready());
    expect(titleOf(item(1, 1, { quote: [{ word: 'Θεοῦ', occurrence: 2 }], quoteString: 'Θεοῦ', occurrence: 2 }))).toBe('of God');
  });

  it('cross frame: a project 2:2 item resolves through the mapped row to source 1:1 (Codex round 1, High)', () => {
    const refs = { '2': [{ c: 1, v: '1', pc: 2, pv: '1' }, { c: 1, v: '1', pc: 2, pv: '2' }] };
    const titleOf = gatewayTitleFor(sources({ '1': { '1': alignedV1 } }), ['ult'], ready(refs));
    expect(titleOf(item(2, 2))).toBe('chosen of God');
    // A chapter the mapping does not cover keeps the original — never a same-frame guess.
    expect(titleOf(item(3, 1))).toBe('ἐκλεκτῶν Θεοῦ');
  });

  it('while the helps load there is no frame verdict: every title is the original (Codex round 1, Medium)', () => {
    const titleOf = gatewayTitleFor(sources({ '1': { '1': alignedV1 } }), ['ult'], { loading: true });
    expect(titleOf(item(1, 1))).toBe('ἐκλεκτῶν Θεοῦ');
    expect(gatewayTitleFor(sources({ '1': { '1': alignedV1 } }), ['ult'], null)(item(1, 1))).toBe('ἐκλεκτῶν Θεοῦ');
  });

  it('a bridge key ("9-10") carries an item at verse 9 (Codex round 1, Medium)', () => {
    const titleOf = gatewayTitleFor(sources({ '1': { '9-10': alignedV1 } }), ['ult'], ready());
    expect(titleOf(item(1, 9))).toBe('chosen of God');
  });

  it('an empty quote array falls back to quoteString for the match, and to quoteString (not groupId) when nothing resolves', () => {
    const empty = item(1, 1, { quote: [], quoteString: 'Θεοῦ', occurrence: 1 });
    expect(gatewayTitleFor(sources({ '1': { '1': alignedV1 } }), ['ult'], ready())(empty)).toBe('of God');
    expect(gatewayTitleFor(sources({}), ['ult'], ready())(empty)).toBe('Θεοῦ');
  });

  it('no pane, a missing pane, or an unaligned verse: the original quote, then the group id', () => {
    expect(gatewayTitleFor({}, [], ready())(item(1, 1))).toBe('ἐκλεκτῶν Θεοῦ');
    expect(gatewayTitleFor({ ult: 'missing' }, ['ult'], ready())(item(1, 1))).toBe('ἐκλεκτῶν Θεοῦ');
    const bare = item(1, 1, { quote: [], quoteString: undefined });
    expect(gatewayTitleFor(sources({}), ['ult'], ready())(bare)).toBe('figs-metaphor');
  });

  it('titles are cached per item: the same resolver answers the same item without re-tokenizing', () => {
    const titleOf = gatewayTitleFor(sources({ '1': { '1': alignedV1 } }), ['ult'], ready());
    const a = titleOf(item(1, 1));
    expect(titleOf(item(1, 1))).toBe(a);
  });
});
