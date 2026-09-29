// The print model of an OBS project (#454): what the Community Checking
// preview and the OBS PDF (src/data/export/pdf.ts) show, by one rule, as
// printedItems (src/data/bookModel.js) is for a Bible book. Both surfaces read
// the project through readPrintedStories, so they state the same stories the
// same way.
import type { BurritoStore, Story } from './burritoStore';

/** A drafted frame (`n` counts from 1), or one run of undrafted frames `from`–`to`. */
export type PrintedFrame = { n: number; text: string } | { gap: [number, number] };

/** A drafted story with its frames, or one run of undrafted stories `from`–`to`. */
export type PrintedStory = { story: Story; frames: PrintedFrame[] } | { gap: [number, number] };

/** Each printed story's picture sources, by story number, then frame number ("1" is the first frame). */
export type StoryPictures = Record<number, Record<string, string>>;

/** A story is drafted when its title, a frame or its reference has text. The
 * seed form of each is empty (BURRITO-SPEC R-10.2.4): a title or frame `''`,
 * no reference line (`null`). */
export const storyDrafted = (story: Story): boolean =>
  story.title !== '' || Boolean(story.ref) || story.frames.some((frame) => frame.text !== '');

/** A drafted story's frames: each drafted frame, and one line for each run of
 * undrafted frames, at the start and the end of the story too. */
export function printedFrames(story: Story): PrintedFrame[] {
  const out: PrintedFrame[] = [];
  story.frames.forEach((frame, i) => {
    const n = i + 1;
    const last = out[out.length - 1];
    if (frame.text !== '') out.push({ n, text: frame.text });
    else if (last && 'gap' in last) last.gap[1] = n;
    else out.push({ gap: [n, n] });
  });
  return out;
}

/** What the preview and the PDF show, in story order (#454): `{ story, frames }`
 * for each drafted story, and one `{ gap: [from, to] }` for each run of
 * undrafted stories between two drafted ones. Undrafted stories before the
 * first drafted story or after the last are left out. A run follows the order
 * of `stories` and names its first and last story number. Empty when no story
 * is drafted. */
export function printedStories(stories: Story[]): PrintedStory[] {
  const drafted = stories.map(storyDrafted);
  const first = drafted.indexOf(true);
  const last = drafted.lastIndexOf(true);
  const items: PrintedStory[] = [];
  for (let i = first; first !== -1 && i <= last; i++) {
    const item = items[items.length - 1];
    if (drafted[i]) items.push({ story: stories[i], frames: printedFrames(stories[i]) });
    else if (item && 'gap' in item) item.gap[1] = stories[i].number;
    else items.push({ gap: [stories[i].number, stories[i].number] });
  }
  return items;
}

/**
 * Every story of the project as the store holds it, in number order, as
 * printed items; and, with `storyPictures` (one story's picture sources by
 * frame number, given the story as read here), the sources of the drafted
 * frames of each printed story. A
 * story that does not print, and an undrafted frame, resolve no picture.
 * `undrafted` is true when any frame of the project has no text.
 */
export async function readPrintedStories(
  store: Pick<BurritoStore, 'listStories' | 'readStory'>,
  storyPictures?: (number: number, story: Story) => Promise<Record<string, string>>,
): Promise<{ items: PrintedStory[]; pictures: StoryPictures; undrafted: boolean }> {
  const stories: Story[] = [];
  for (const number of [...(await store.listStories())].sort((a, b) => a - b)) stories.push((await store.readStory(number)).story);
  const items = printedStories(stories);
  const undrafted = stories.some((story) => story.frames.some((frame) => frame.text === ''));
  const pictures: StoryPictures = {};
  if (!storyPictures) return { items, pictures, undrafted };
  for (const item of items) {
    if ('gap' in item) continue;
    const drafted = item.frames.flatMap((frame) => ('gap' in frame ? [] : [String(frame.n)]));
    if (drafted.length === 0) continue;
    const sources = await storyPictures(item.story.number, item.story);
    pictures[item.story.number] = Object.fromEntries(drafted.filter((n) => sources[n]).map((n) => [n, sources[n]]));
  }
  return { items, pictures, undrafted };
}
