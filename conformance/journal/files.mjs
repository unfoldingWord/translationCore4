// Journal stream I/O — BURRITO-SPEC §8.1 reference implementation.
// Append-only NDJSON, 5-digit <seq> rotation >1MB, torn-tail rule.
import fs from 'fs';
import path from 'path';

const ROTATE_BYTES = 1024 * 1024;
const seqName = (stream, n) => `${stream}.${String(n).padStart(5, '0')}.jsonl`;

export const appendEvent = (actorDir, stream, event) => {
  fs.mkdirSync(actorDir, { recursive: true });
  let n = 1;
  while (fs.existsSync(path.join(actorDir, seqName(stream, n + 1)))) n++;
  let file = path.join(actorDir, seqName(stream, n));
  if (fs.existsSync(file) && fs.statSync(file).size > ROTATE_BYTES)
    file = path.join(actorDir, seqName(stream, ++n)); // rotate BEFORE appending (§8.1)
  fs.appendFileSync(file, JSON.stringify(event) + '\n');
};

// Read one actor's stream across all <seq> files, applying the torn-tail rule.
export const readStream = (actorDir, stream) => {
  const files = fs.existsSync(actorDir)
    ? fs.readdirSync(actorDir).filter((f) => f.startsWith(`${stream}.`) && f.endsWith('.jsonl')).sort()
    : [];
  const events = [];
  files.forEach((f, fi) => {
    const raw = fs.readFileSync(path.join(actorDir, f), 'utf8');
    const lines = raw.split('\n');
    const lastIdx = lines.length - 1;
    lines.forEach((line, li) => {
      if (line === '') return; // trailing LF / blank
      try {
        events.push(JSON.parse(line));
      } catch (e) {
        const isFinalLine = fi === files.length - 1 && li === lastIdx - (lines[lastIdx] === '' ? 1 : 0);
        const isTornTail = isFinalLine && !raw.endsWith('\n');
        if (isTornTail) return; // §8.1: ignore torn tail
        throw new Error(`corrupt journal line in ${f}:${li + 1} — refuse to fold`);
      }
    });
  });
  return events;
};

// Union across every actor under journal/ (all streams).
export const readUnion = (journalDir) => {
  if (!fs.existsSync(journalDir)) return [];
  const events = [];
  for (const actor of fs.readdirSync(journalDir)) {
    const dir = path.join(journalDir, actor);
    if (!fs.statSync(dir).isDirectory()) continue;
    const streams = new Set(
      fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => f.replace(/\.\d{5}\.jsonl$/, ''))
    );
    for (const s of streams) events.push(...readStream(dir, s));
  }
  return events;
};
