// The one reader of the server's zips (issues #425 and #423). On Windows the
// server names every zip entry with `\` — both the whole-repository route
// (`GET /burrito/zipped`, pankosmia-web 0.18.5 `src/utils/zip.rs:25-32`) and
// the ingredient-directory route (`GET /burrito/ingredient/zipped`) share the
// one zipper (docs/PLATFORM-NOTES.md note 41). The zip format itself specifies
// `/` in entry names, so a `\` can only come from that server behavior. This
// helper gives every entry name with `/` on every platform, the bytes
// untouched. Every reader of a server zip unzips through it and never matches
// raw entry names (test/serverZip.test.ts guards this).
import { unzipSync } from 'fflate';

const normalized = (name: string): string => name.replaceAll('\\', '/');

/** True for a normalized name that cannot sit inside the repository tree:
 * normalization must never LAUNDER a hostile stored filename (`\` is a legal
 * byte in a POSIX filename) into a traversal or an absolute path (PR #469
 * review). */
const escapes = (name: string): boolean =>
  name.startsWith('/') || /^[A-Za-z]:\//.test(name) || name.split('/').includes('..');

/** A server zip → normalized entry name → bytes. `keep` tests the normalized
 * name, so a `/` filter finds a `\` entry too. Refuses (throws) a name that
 * escapes the tree, two entries that normalize to one name (a silent last-
 * write-wins would lose a file without even an `invalid` record), and a
 * `__proto__` entry (fflate keys its result on a prototype-bearing object, so
 * such an entry POISONS the prototype instead of landing as an own key). The
 * journal reader falls back to per-file reads on a throw; an export surfaces
 * it. */
export function unzipServerZip(zip: Uint8Array, keep: (name: string) => boolean = () => true): Record<string, Uint8Array> {
  const entries = unzipSync(zip, { filter: (entry) => keep(normalized(entry.name)) });
  if (Object.getPrototypeOf(entries) !== Object.prototype) throw new Error('server zip holds a __proto__ entry');
  const out: Record<string, Uint8Array> = Object.create(null);
  for (const [name, bytes] of Object.entries(entries)) {
    const slash = normalized(name);
    // Judged HERE, on what survives the filter — never only inside it.
    if (escapes(slash)) throw new Error(`server zip entry is not a relative path: ${name}`);
    if (slash in out) throw new Error(`server zip entries collide at ${slash}`); // null proto: `in` sees own keys only
    out[slash] = bytes;
  }
  return out;
}
