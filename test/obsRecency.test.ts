// #328 — the per-client list of the stories edited most recently in one OBS
// project: the collapsed Home card's tiles.
import { describe, expect, it } from 'vitest';
import { RECENT_STORIES, recordRecentStory } from '../src/data/obsRecency';

describe('#328 — recent stories', () => {
  it('an edit puts its story first; a second edit of the same story moves it to the front without a duplicate', () => {
    let list = recordRecentStory(undefined, 3, 1000);
    list = recordRecentStory(list, 7, 2000);
    expect(list.map((e) => e.story)).toEqual([7, 3]);
    list = recordRecentStory(list, 3, 3000);
    expect(list.map((e) => e.story)).toEqual([3, 7]);
    expect(list).toHaveLength(2);
  });

  it('an edit in story 12 moves it to the front; a fourth distinct story pushes the oldest out', () => {
    let list = [{ story: 1, at: 100 }, { story: 2, at: 200 }, { story: 3, at: 300 }];
    list = recordRecentStory(list, 12, 400);
    expect(list.map((e) => e.story)).toEqual([12, 3, 2]);
    expect(list).toHaveLength(RECENT_STORIES);
    expect(RECENT_STORIES).toBe(3);
  });

  it('the list is ordered by time even when an older timestamp arrives late, and a bad story number changes nothing', () => {
    let list = recordRecentStory([{ story: 5, at: 500 }], 4, 400);
    expect(list.map((e) => e.story)).toEqual([5, 4]);
    expect(recordRecentStory(list, 0, 900)).toEqual(list);
    expect(recordRecentStory(list, 2.5, 900)).toEqual(list);
    expect(recordRecentStory(list, NaN, 900)).toEqual(list);
  });
});
