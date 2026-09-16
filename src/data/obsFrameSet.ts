import type { Story } from './burritoStore';

export interface ObsFrameSetEntry {
  number: number;
  frames: number;
}

/** The structural identity that §10.7.5 permits a source replacement to keep.
 * Text, references and image URLs may differ; story numbers and frame counts
 * may not, because existing target frames have nowhere else to attach. */
export const obsFrameSet = (stories: Iterable<Story>): ObsFrameSetEntry[] =>
  [...stories]
    .map((story) => ({ number: story.number, frames: story.frames.length }))
    .sort((a, b) => a.number - b.number);

export const obsFrameSetMismatch = (
  current: Iterable<Story>,
  incoming: Iterable<Story>,
): string | null => {
  const before = obsFrameSet(current);
  const after = obsFrameSet(incoming);
  if (before.length !== after.length)
    return `source has ${after.length} stories; project has ${before.length}`;
  for (let i = 0; i < before.length; i += 1) {
    if (before[i].number !== after[i].number)
      return `source story ${after[i].number} does not match project story ${before[i].number}`;
    if (before[i].frames !== after[i].frames)
      return `story ${before[i].number} has ${after[i].frames} source frames; project has ${before[i].frames}`;
  }
  return null;
};
