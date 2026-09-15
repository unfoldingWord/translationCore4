// Story files — BURRITO-SPEC §10 reference implementation (spec 1.14, D74).
//
// An OBS story file is one title line `# N. Title`, then per frame one image line and
// exactly ONE paragraph, then an optional reference line `_…_`, separated by single blank
// lines. THE IMAGE LINE SPLITS FRAMES (R-10.3.1). This module is the one place that reads
// and writes that shape: the fold projects a story through it at checkpoint (§8.7), the
// conformance harness proves it, and the app's store port reuses it (#286).
//
// Writes are LINE SPLICES, never re-serializations: a frame write replaces the lines of
// that frame's paragraph region and nothing else, so every other byte of the file —
// the title, every image line, every other frame, the reference line — is identical
// afterwards (R-10.3.4, the D8 analogue). Like every other journal module this file may
// load in a browser bundle: no Node builtin.

const TITLE_RE = /^# (\d+)\.( (.*))?$/;
const IMAGE_RE = /^!\[[^\]]*\]\([^)]*\)$/;
const REF_RE = /^_[^\n]*_$/;

export const STORY_COUNT = 50;
const isStr = (v) => typeof v === 'string';
const isInt = (v) => Number.isInteger(v);

// §10: story numbers are 1..50; a frame number is 0 (the title) or a positive integer,
// bounded by the story's own frame count at write time (the base file decides).
export const storyNumberError = (v) =>
  !isInt(v) ? 'is not an integer'
  : v < 1 || v > STORY_COUNT ? `${v} is not a §10 story number (1..${STORY_COUNT})`
  : null;
export const frameNumberError = (v) =>
  !isInt(v) ? 'is not an integer'
  : v < 0 ? `${v} is not a §10 frame number (0 = the title, then 1..)`
  : null;
// The ingredient path rule: `content/NN.md`, two-digit story numbers (R-10.2.2).
export const storyIpath = (story) => `content/${String(story).padStart(2, '0')}.md`;

// Journaled frame text is ONE paragraph: no blank line, no leading/trailing newline, no
// carriage return, and no line that would re-partition the file when read back — an
// image line (it would start a frame) or a reference-line form (it would end the story).
// The app removes blank lines before it seals (D74 §5); the schema refuses what is left.
export const frameTextError = (v) => {
  if (!isStr(v)) return 'is not a string';
  if (v.includes('\r')) return 'contains a carriage return';
  if (v.startsWith('\n') || v.endsWith('\n')) return 'starts or ends with a newline';
  if (/\n[ \t]*\n/.test(v)) return 'contains a blank line — a frame is exactly ONE paragraph (§10)';
  for (const line of v.split('\n')) {
    if (IMAGE_RE.test(line)) return 'contains an image line — the image line splits frames (§10)';
    if (REF_RE.test(line)) return 'contains a line in the reference-line form `_…_` (§10)';
    if (TITLE_RE.test(line)) return 'contains a line in the title form `# N.` (§10)';
  }
  return null;
};
// A title is one line without the `# N. ` prefix; a reference line is its text without
// the underscores. Both are single-line and trimmed.
export const titleTextError = (v) =>
  !isStr(v) ? 'is not a string'
  : /[\r\n]/.test(v) ? 'is not a single line'
  : v !== v.trim() ? 'has leading or trailing whitespace'
  : null;
export const refTextError = (v) =>
  !isStr(v) ? 'is not a string'
  : v === '' ? 'is empty — the reference line is removed by no operation (§10)'
  : /[\r\n]/.test(v) ? 'is not a single line'
  : v !== v.trim() ? 'has leading or trailing whitespace'
  : null;

// parseStory(bytes) → { number, title, frames: [{image, text}], ref }, or throws.
// Frames are 1-based in the result's `frames` (frames[0] is frame 1); the title is frame 0.
// Internal line indices are kept for the writers below.
const splitStory = (bytes) => {
  if (!isStr(bytes)) throw new Error('story is not a string');
  if (bytes.includes('\r')) throw new Error('story contains a carriage return (§10: LF line ends)');
  const lines = bytes.split('\n');
  const m = TITLE_RE.exec(lines[0] ?? '');
  if (!m) throw new Error(`story line 1 "${(lines[0] ?? '').slice(0, 40)}" is not the title form \`# N.\` or \`# N. Title\` (§10)`);
  const number = Number(m[1]);
  const title = m[3] ?? '';
  // the reference line: the LAST non-blank line, when it has the `_…_` form and is not
  // an image line (R-10.3.3)
  let last = lines.length - 1;
  while (last > 0 && lines[last].trim() === '') last--;
  let refIdx = -1;
  if (last > 0 && REF_RE.test(lines[last]) && !IMAGE_RE.test(lines[last])) refIdx = last;
  const end = refIdx >= 0 ? refIdx : lines.length; // exclusive bound of the frame area
  const frames = [];
  let cur = null;
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (IMAGE_RE.test(line)) { cur = { image: line, imageIdx: i, textLines: [], firstText: -1, lastText: -1 }; frames.push(cur); continue; }
    if (line.trim() === '') continue;
    if (!cur) throw new Error(`story line ${i + 1} carries text before the first image line (§10: the title line is followed by frames)`);
    // exactly one paragraph: a text line after a blank line that already closed the
    // paragraph is a SECOND paragraph
    if (cur.lastText >= 0 && cur.lastText !== i - 1)
      throw new Error(`story ${number} frame ${frames.length} carries more than one paragraph (line ${i + 1}) — exactly one paragraph per frame (§10)`);
    if (cur.firstText < 0) cur.firstText = i;
    cur.lastText = i;
    cur.textLines.push(line);
  }
  if (frames.length === 0 && refIdx >= 0)
    throw new Error(`story ${number} carries a reference line but no frame (§10)`);
  return { number, title, frames, refIdx, lines };
};
export const parseStory = (bytes) => {
  const { number, title, frames, refIdx, lines } = splitStory(bytes);
  return {
    number, title,
    frames: frames.map((f) => ({ image: f.image, text: f.textLines.join('\n') })),
    ref: refIdx >= 0 ? lines[refIdx].slice(1, -1) : null,
  };
};

// The three writers. Each returns the new bytes; each touches ONLY its own region.
// The region of frame F (F ≥ 1) is every line after its image line up to the next image
// line, the reference line, or the end of the file. The region of the title is line 1.
// The region of the reference line is the line itself when present, else the trailing
// blank lines after the last frame's paragraph.
const EMPTY_FRAME_MID = ['', '', ''];          // the template's exact form between frames
const EMPTY_FRAME_LAST = ['', '', '', '', '', '']; // the template's exact form at end of file
const frameRegion = (s, f) => {
  const start = s.frames[f - 1].imageIdx + 1;
  const end = f < s.frames.length ? s.frames[f].imageIdx : (s.refIdx >= 0 ? s.refIdx : s.lines.length);
  return { start, end };
};
export const writeFrame = (bytes, frame, text) => {
  const fe = frameNumberError(frame);
  if (fe) throw new Error(`frame ${fe}`);
  if (frame === 0) return writeTitle(bytes, text);
  const te = frameTextError(text);
  if (te) throw new Error(`frame text ${te}`);
  const s = splitStory(bytes);
  if (frame > s.frames.length)
    throw new Error(`story ${s.number} has ${s.frames.length} frames — frame ${frame} does not exist (§10: the frame set is fixed by the source)`);
  const { start, end } = frameRegion(s, frame);
  const followed = end < s.lines.length; // another image line or the reference line follows
  const replacement = text === ''
    ? (followed ? EMPTY_FRAME_MID : EMPTY_FRAME_LAST)
    : ['', ...text.split('\n'), ''];
  return [...s.lines.slice(0, start), ...replacement, ...s.lines.slice(end)].join('\n');
};
export const writeTitle = (bytes, text) => {
  const te = titleTextError(text);
  if (te) throw new Error(`title text ${te}`);
  const s = splitStory(bytes);
  const lines = [...s.lines];
  lines[0] = text === '' ? `# ${s.number}.` : `# ${s.number}. ${text}`;
  return lines.join('\n');
};
export const writeRef = (bytes, text) => {
  const re = refTextError(text);
  if (re) throw new Error(`reference text ${re}`);
  const s = splitStory(bytes);
  const refLine = `_${text}_`;
  if (s.refIdx >= 0) { const lines = [...s.lines]; lines[s.refIdx] = refLine; return lines.join('\n'); }
  if (s.frames.length === 0) throw new Error(`story ${s.number} has no frame — a reference line follows the last frame (§10)`);
  // no reference line yet: the region is the trailing blank lines after the last content
  const lastFrame = s.frames[s.frames.length - 1];
  const start = (lastFrame.lastText >= 0 ? lastFrame.lastText : lastFrame.imageIdx) + 1;
  return [...s.lines.slice(0, start), '', refLine, ''].join('\n');
};

// The seed form of a template story (R-10.2.4): the title reduced to `# N.` with no text,
// every frame the image line plus an empty paragraph exactly as the template has it, no
// reference line. A new project is the template's fifty files in this form.
export const seedStory = (templateBytes) => writeTitle(templateBytes, '');

// Apply a folded story state — {frames: {F: text}, ref} with frame 0 the title — onto a
// base file, ascending frame order then the reference line. The checkpoint's story
// projection (§8.7); the app applies one write at a time through the same three writers.
export const applyStoryState = (baseBytes, state) => {
  let out = baseBytes;
  const frames = state.frames || {};
  for (const f of Object.keys(frames).map(Number).sort((a, b) => a - b)) out = writeFrame(out, f, frames[f]);
  if (state.ref !== undefined && state.ref !== null) out = writeRef(out, state.ref);
  return out;
};
