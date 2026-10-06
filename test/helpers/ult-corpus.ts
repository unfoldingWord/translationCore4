// Shared corpus loader for the suggestion-engine benches (#1, #516): aligned
// verses of unfoldingWord en_ult read from the rig's cached export, treated as
// a project's own confirmed alignments (every `\zaln` link).
import { unzipSync, strFromU8 } from 'fflate';
import { usfmjs } from '../../src/data/vendor';
import { wordTokens } from '../../src/data/align/tokenize';
import type { TokenSeed, TrainingVerse } from '../../src/data/align/suggest';

const fs = process.getBuiltinModule('node:fs');

export type VO = { type?: string; tag?: string; text?: string; content?: string; strong?: string; lemma?: string; morph?: string; occurrence?: string | number; occurrences?: string | number; children?: VO[] };

/** One aligned verse from en_ult's `\zaln` markup: source words from the
 * milestones (x-content/strong/lemma/morph/occurrence), target words from the
 * `\w` children, links from containment. Target positions come from the
 * #255 tokenizer over the verse's plain text, so they match the app's view. */
export function verseFromObjects(ref: string, objects: VO[]): TrainingVerse | null {
  const source: TokenSeed[] = [];
  const links: Array<{ source: number[]; targetWords: Array<{ text: string; occurrence: number }> }> = [];
  let plain = '';
  const walk = (list: VO[], openSources: number[]) => {
    for (const o of list) {
      if (o.tag === 'zaln' || (o.type === 'milestone' && o.content)) {
        const idx = source.length;
        source.push({ text: o.content ?? '', position: idx, occurrence: Number(o.occurrence ?? 1), occurrences: Number(o.occurrences ?? 1), strong: o.strong, lemma: o.lemma, morph: o.morph });
        walk(o.children ?? [], [...openSources, idx]);
        continue;
      }
      if (o.type === 'word') {
        plain += o.text ?? '';
        if (openSources.length) links.push({ source: openSources, targetWords: [{ text: o.text ?? '', occurrence: Number(o.occurrence ?? 1) }] });
        continue;
      }
      if (o.text) plain += o.text;
      if (o.children) walk(o.children, openSources);
    }
  };
  walk(objects, []);
  if (!source.length || !links.length) return null;
  const target = wordTokens(plain).map((t, i) => ({ text: t.text, position: i, occurrence: t.occurrence, occurrences: t.occurrences }));
  const pos = new Map(target.map((t) => [`${t.text} ${t.occurrence}`, t.position]));
  const positional = links
    .map((l) => ({ source: l.source, target: l.targetWords.map((w) => pos.get(`${w.text} ${w.occurrence}`)).filter((p): p is number => p !== undefined) }))
    .filter((l) => l.target.length);
  return positional.length ? { ref, source, target, links: positional } : null;
}

export function versesOfBook(code: string, usfm: string): TrainingVerse[] {
  const json = usfmjs.toJSON(usfm) as { chapters: Record<string, Record<string, { verseObjects?: VO[] }>> };
  const out: TrainingVerse[] = [];
  for (const [c, verses] of Object.entries(json.chapters ?? {})) {
    for (const [v, d] of Object.entries(verses)) {
      if (!/^\d/.test(v)) continue;
      const tv = verseFromObjects(`${code} ${c}:${v}`, d.verseObjects ?? []);
      if (tv) out.push(tv);
    }
  }
  return out;
}

/** The books of `codes`, read from the unwrapped en_ult zip at `zipPath`, in
 * the order given (canonical when the caller passes canonical order). */
export function loadUltBooks(zipPath: string, codes: string[]): TrainingVerse[] {
  const zip = unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
  return codes.flatMap((code) => versesOfBook(code, strFromU8(zip[`ingredients/${code}.usfm`])));
}

/** Deterministic RNG (mulberry32) for seeded hold-out draws. */
export const mulberry32 = (seed: number) => {
  let a = seed;
  return () => {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
