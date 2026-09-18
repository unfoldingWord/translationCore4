// #329 — the place record: where the user last worked in one book or one story.
import { describe, expect, it } from 'vitest';
import { modeOf, placeKey, recordPlace } from '../src/data/place';

describe('#329 — place records', () => {
  it('keys a book by its code and a story as story:N; a currentScope book code never reads as a story', () => {
    expect(placeKey({ book: 'TIT' })).toBe('TIT');
    expect(placeKey({ story: 3 })).toBe('story:3');
    expect(placeKey({ book: 'GEN', story: null })).toBe('GEN');
    expect(placeKey({ story: 0 })).toBeNull();
    expect(placeKey({})).toBeNull();
  });

  it('records the three modes and maps Community Checking to Check; Home is not a place', () => {
    expect(modeOf('read')).toBe('read');
    expect(modeOf('draft')).toBe('draft');
    expect(modeOf('check')).toBe('check');
    expect(modeOf('publish')).toBe('check');
    expect(modeOf('home')).toBeNull();
    expect(modeOf(undefined)).toBeNull();
  });

  it('an observation keeps what it does not name: a mode switch keeps the verse, a frame click keeps the mode, a chapter click clears the verse', () => {
    let places = recordPlace(undefined, 'repo/p', 'TIT', { mode: 'draft', chapter: 2, verse: '5', at: 1 });
    expect(places['repo/p'].TIT).toEqual({ mode: 'draft', chapter: 2, verse: '5', at: 1 });
    places = recordPlace(places, 'repo/p', 'TIT', { mode: 'read', at: 2 });
    expect(places['repo/p'].TIT).toEqual({ mode: 'read', chapter: 2, verse: '5', at: 2 });
    places = recordPlace(places, 'repo/p', 'story:3', { verse: 4, at: 3 });
    expect(places['repo/p']['story:3']).toEqual({ mode: 'draft', chapter: 1, verse: 4, at: 3 });
    places = recordPlace(places, 'repo/p', 'TIT', { chapter: 3, verse: null, at: 4 });
    expect(places['repo/p'].TIT).toEqual({ mode: 'read', chapter: 3, verse: null, at: 4 });
  });

  it('the Check tool is kept with mode check and dropped when the mode leaves Check', () => {
    let places = recordPlace(undefined, 'repo/p', 'TIT', { mode: 'check', chapter: 1, tool: 'translationNotes', at: 1 });
    expect(places['repo/p'].TIT.tool).toBe('translationNotes');
    places = recordPlace(places, 'repo/p', 'TIT', { mode: 'check', at: 2 });
    expect(places['repo/p'].TIT.tool).toBe('translationNotes');
    places = recordPlace(places, 'repo/p', 'TIT', { mode: 'draft', at: 3 });
    expect(places['repo/p'].TIT.tool).toBeUndefined();
  });

  it('records for two units of one project and for two projects stay apart', () => {
    let places = recordPlace(undefined, 'repo/a', 'TIT', { mode: 'draft', chapter: 2, at: 1 });
    places = recordPlace(places, 'repo/a', 'JON', { mode: 'check', chapter: 4, tool: 'translationWords', at: 2 });
    places = recordPlace(places, 'repo/b', 'story:1', { mode: 'read', chapter: 1, verse: 2, at: 3 });
    expect(Object.keys(places['repo/a'])).toEqual(['TIT', 'JON']);
    expect(places['repo/b']['story:1'].verse).toBe(2);
    expect(places['repo/a'].TIT.mode).toBe('draft');
  });
});
