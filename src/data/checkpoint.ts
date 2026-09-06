// Checkpoint commits (issue #183, decision D9): a git commit at the moments a
// translator reaches every day — leaving the project, switching mode — and
// never on a save. Every save is already durable as a journal segment (D50);
// the commit is the checkpoint a person or a teammate can point at.
//
// Two facts from the platform shape this module [VERIFIED live — pankosmia-web
// 0.18.5 (99fd9be), 2026-09-05, PLATFORM-NOTES #9]:
//   - `add-and-commit` sweeps the whole repository, and on a CLEAN tree it still
//     succeeds and records an EMPTY commit. So the caller must look first.
//   - `GET /git/status/<repo>` lists the pending changes as {path, change_type}.
//     An empty list means nothing to commit.
//
// The message is derived from the pending paths, so it names what the
// checkpoint actually carries, never what the caller assumed it would.

export interface GitChange {
  path: string;
  change_type: string;
}

/** The kind of work a pending path represents, by its place in the burrito. */
const kindOf = (path: string): { book: string | null; kind: string } => {
  const m = /^ingredients\/(?:checking\/(alignments|translationWords|translationNotes|notes)\/)?([A-Z0-9]{3})\.(?:usfm|json)$/.exec(path);
  if (m) {
    const kind = m[1] === 'alignments' ? 'alignment' : m[1] === 'notes' ? 'notes' : m[1] ? 'checks' : 'text';
    return { book: m[2], kind };
  }
  if (path.startsWith('ingredients/checking/journal/')) return { book: null, kind: 'journal' };
  if (path.startsWith('ingredients/audio/')) return { book: null, kind: 'audio' }; // tolerated class, BURRITO-SPEC R-8.7.1
  if (path === 'ingredients/checking/resources.json') return { book: null, kind: 'sources' };
  if (path === 'ingredients/checking/settings.json') return { book: null, kind: 'settings' };
  if (path === 'metadata.json') return { book: null, kind: 'metadata' };
  return { book: null, kind: 'other' };
};

/** The commit message for a checkpoint that carries `changes`, or null when
 * there is nothing to commit. `reason` names the checkpoint (D9): the mode the
 * translator is leaving, or "leaving the project". Example:
 * "Checkpoint, leaving Translate: TIT text, TIT checks (tC4)". */
export function checkpointMessage(reason: string, changes: GitChange[]): string | null {
  if (changes.length === 0) return null;
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const change of changes) {
    const k = kindOf(change.path);
    // The journal and the metadata ride with every checkpoint; they are not
    // what the translator did, so they are named only when nothing else is.
    if (k.kind === 'journal' || k.kind === 'metadata') continue;
    const label = k.book ? `${k.book} ${k.kind}` : k.kind;
    if (!seen.has(label)) {
      seen.add(label);
      parts.push(label);
    }
  }
  const what = parts.length ? parts.join(', ') : 'journal';
  return `Checkpoint, ${reason}: ${what} (tC4)`;
}
