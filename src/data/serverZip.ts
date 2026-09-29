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

/** A server zip → normalized entry name → bytes. `keep` tests the normalized
 * name, so a `/` filter finds a `\` entry too. */
export function unzipServerZip(zip: Uint8Array, keep: (name: string) => boolean = () => true): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  for (const [name, bytes] of Object.entries(unzipSync(zip, { filter: (entry) => keep(normalized(entry.name)) }))) out[normalized(name)] = bytes;
  return out;
}
