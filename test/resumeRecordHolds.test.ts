// #290 (J25) — the gate that decides whether Home offers a Resume card.
//
// This is the line that broke on the first rig drive of this journey: the gate
// asked whether the record's `book` was one of the project's book codes, and a
// story project carries no book codes at all, so the card never appeared. The
// fix added the story branch. Nothing held it after that but a manual run, so
// this file holds it.
//
// The predicate is pure — a record and a project summary in, a boolean out —
// so every case below is the real product function, not a copy of its rules.
import { describe, expect, it } from 'vitest';
import { resumeRecordHolds } from '../src/state.jsx';

const bibleProject = { id: '_local_/_local_/tit', flavor: 'textTranslation', bookCodes: ['TIT', 'JON'] };
const storyProject = { id: '_local_/_local_/historias', flavor: 'textStories', bookCodes: [] };

const bibleRecord = { repoPath: bibleProject.id, book: 'TIT', chapter: 1, verse: '1', mode: 'draft' };
const storyRecord = { repoPath: storyProject.id, book: 'OBS', chapter: 1, verse: 1, mode: 'read' };

describe('the Resume gate (#290): which records a project can resume', () => {
  it('a story project resumes its OBS record — the case the first rig drive failed', () => {
    expect(resumeRecordHolds(storyRecord, storyProject)).toBe(true);
  });

  it('a Bible project resumes a record naming a book it carries, and refuses one it does not', () => {
    expect(resumeRecordHolds(bibleRecord, bibleProject)).toBe(true);
    expect(resumeRecordHolds({ ...bibleRecord, book: 'MRK' }, bibleProject)).toBe(false);
  });

  it('the two forms never cross', () => {
    // A story record against a Bible project: `OBS` is not one of its books.
    expect(resumeRecordHolds(storyRecord, bibleProject)).toBe(false);
    // A Bible record against a story project: only the OBS position resumes it.
    expect(resumeRecordHolds(bibleRecord, storyProject)).toBe(false);
  });

  it('a story project refuses a record that names no position at all', () => {
    expect(resumeRecordHolds({ ...storyRecord, book: undefined }, storyProject)).toBe(false);
    expect(resumeRecordHolds({ ...storyRecord, book: '' }, storyProject)).toBe(false);
  });

  it('a Bible project with no bookCodes key refuses every record', () => {
    // The array is optional on a summary; the gate must not throw on its absence.
    const bare = { id: bibleProject.id, flavor: 'textTranslation' };
    expect(resumeRecordHolds(bibleRecord, bare)).toBe(false);
    expect(resumeRecordHolds(storyRecord, bare)).toBe(false);
  });
});
