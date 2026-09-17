// #310 — one model for a check reference. The type gate: `npm run typecheck`
// covers test/, and each `@ts-expect-error` below FAILS the gate if its error
// ever disappears — a reference that carries both forms, and a story item
// passed where the Bible form is required. The runtime cases: the two key
// grammars differ while the displayed locator does not.
import { describe, expect, it } from 'vitest';
import {
  deriveTwlItems,
  locatorOf,
  textKeyOf,
  type BibleReference,
  type CheckItem,
  type CheckReference,
  type StoryReference,
} from '../src/data/derive';

// @ts-expect-error — one object cannot carry both forms (R-10.5.1: the two forms never mix)
const mixed: CheckReference = { bookId: 'tit', chapter: 1, verse: 2, story: 1, frame: 2 };

const verse: BibleReference = { bookId: 'tit', chapter: 1, verse: 2 };
const frame: StoryReference = { story: 1, frame: 2 };

const storyItem: CheckItem<StoryReference> = {
  contextId: { checkId: 'lm48', reference: frame, tool: 'translationNotes', groupId: '', quote: 'x', quoteString: 'x', occurrence: 1 },
  selections: false,
  comments: false,
  reminders: false,
  nothingToSelect: false,
  verseEdits: false,
  invalidated: false,
};
const bibleOnly = (item: CheckItem<BibleReference>): string => item.contextId.reference.bookId;
// @ts-expect-error — a story item where the Bible form is required (deriveForProject's input)
const rejected = (): string => bibleOnly(storyItem);

describe('one model for a check reference (#310)', () => {
  it('the Bible derivers return the Bible form by type; a story item cannot stand in for one', () => {
    const items = deriveTwlItems('Reference\tID\tTags\tOrigWords\tOccurrence\tTWLink\n1:2\taaaa\tkeyterm\tGod\t1\trc://*/tw/dict/bible/kt/god\n', 'tit');
    expect(bibleOnly(items[0])).toBe('tit');
    expect(typeof rejected).toBe('function');
    expect(mixed.bookId).toBe('tit');
  });

  it('a verse and a frame with the same two numbers share the displayed locator and never the text key', () => {
    expect(locatorOf(verse)).toBe('1:2');
    expect(locatorOf(frame)).toBe('1:2');
    expect(textKeyOf(verse)).toBe('1:2');
    expect(textKeyOf(frame)).toBe('story|1:2');
    expect(textKeyOf(verse)).not.toBe(textKeyOf(frame));
  });
});
