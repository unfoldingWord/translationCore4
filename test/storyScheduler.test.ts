import { describe, expect, it } from 'vitest';
import { StoryScheduler } from '../src/data/storyScheduler';

describe('StoryScheduler', () => {
  it('normalizes frame paragraphs and single-line fields at the write boundary', async () => {
    const writes: Array<{ kind: string; text: string }> = [];
    const scheduler = new StoryScheduler({
      debounceMs: 0,
      write: async (unit, text) => { writes.push({ kind: unit.kind, text }); },
    });
    const frame = { kind: 'frame' as const, story: 1, frame: 1 };
    const title = { kind: 'title' as const, story: 1 };
    scheduler.seed(frame, 'original');
    scheduler.seed(title, 'Original title');
    scheduler.markDirty(frame, '\nuno\n\n dos\r\n');
    scheduler.markDirty(title, '  Título\n');
    await scheduler.drain();
    expect(writes).toEqual([
      { kind: 'frame', text: 'uno\n dos' },
      { kind: 'title', text: 'Título' },
    ]);
  });

  it('keeps a failed unit dirty until the shared retry succeeds', async () => {
    let fail = true;
    const scheduler = new StoryScheduler({
      debounceMs: 0,
      write: async () => { if (fail) throw new Error('offline'); },
    });
    const unit = { kind: 'frame' as const, story: 1, frame: 1 };
    scheduler.seed(unit, '');
    scheduler.markDirty(unit, 'draft');
    await scheduler.drain();
    expect(scheduler.getState()).toBe('error');
    fail = false;
    await scheduler.retry();
    expect(scheduler.getState()).toBe('saved');
    expect(scheduler.value(unit)).toBe('draft');
  });
});
