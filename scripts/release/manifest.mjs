// Writes and checks BUILD-MANIFEST.json, the one record of what a release holds (card G3): the
// commit and version, the platform, Electronite's tag and archive sha256, and the sha256 and size
// of every shipped file.
//
//   node manifest.mjs --root <staged app> [--into <dir>] --platform <p> --electronite <tag>
//     --electronite-sha256 <hex> [--unrecorded <path>]...
//   node manifest.mjs --check <BUILD-MANIFEST.json> --root <installed app> [--extra <path>]...
//
// The manifest is written into --into (default: --root); the commit is TC4_BUILD_COMMIT, as tc4
// and the UI were built with. On macOS the manifest sits inside the sealed bundle, so the files
// that hold the bundle's own signature are written after it and cannot be recorded in it: they
// are named under `unrecorded` (seal-macos.sh; docs/RELEASE.md). --check reads the files under
// --root and refuses a manifest that is not their record (#969): a recorded file that is missing
// or differs, an unrecorded file that is missing, or a file the manifest does not name, other
// than the --extra ones an installer adds beside the app's (Inno Setup's uninstaller).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const MANIFEST = 'BUILD-MANIFEST.json';

/** Every file under `root` but the manifest itself, as the manifest records it, in path order. */
export function recorded(root) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name !== MANIFEST) {
        const bytes = fs.readFileSync(full);
        files.push({
          path: path.relative(root, full).split(path.sep).join('/'),
          size: bytes.length,
          sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
        });
      }
    }
  };
  walk(root);
  return files;
}

/** The manifest of `root`, with the `unrecorded` paths left out of `files`. */
export function manifest(root, { commit, version, platform, electronite, electroniteSha256, unrecorded = [] }) {
  const left = new Set(unrecorded);
  for (const file of unrecorded) {
    if (!fs.existsSync(path.join(root, file))) throw new Error(`--unrecorded ${file} is not under ${root}`);
  }
  return {
    commit,
    version,
    platform,
    electronite: { tag: electronite, sha256: electroniteSha256 },
    unrecorded: [...unrecorded],
    files: recorded(root).filter((file) => !left.has(file.path)),
  };
}

/**
 * Why `manifest` is not the record of the files under `root`, one line each; empty when it is.
 * `extra` names files an installer puts beside the app's, which the manifest never records.
 */
export function mismatches(manifest, root, extra = []) {
  const found = new Map(recorded(root).map((file) => [file.path, file]));
  const faults = [];
  for (const want of manifest.files) {
    const got = found.get(want.path);
    if (!got) faults.push(`${want.path}: recorded, missing`);
    else if (got.size !== want.size || got.sha256 !== want.sha256) {
      faults.push(`${want.path}: recorded ${want.size} bytes ${want.sha256}, found ${got.size} bytes ${got.sha256}`);
    }
  }
  for (const file of manifest.unrecorded ?? []) {
    if (!found.has(file)) faults.push(`${file}: unrecorded, missing`);
  }
  const named = new Set([...manifest.files.map((file) => file.path), ...(manifest.unrecorded ?? []), ...extra]);
  for (const file of found.keys()) {
    if (!named.has(file)) faults.push(`${file}: not in the manifest`);
  }
  return faults;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      root: { type: 'string' },
      into: { type: 'string' },
      platform: { type: 'string' },
      electronite: { type: 'string' },
      'electronite-sha256': { type: 'string' },
      unrecorded: { type: 'string', multiple: true, default: [] },
      check: { type: 'string' },
      extra: { type: 'string', multiple: true, default: [] },
    },
  });
  if (!values.root) throw new Error('--root is needed');
  if (values.check) {
    const given = JSON.parse(fs.readFileSync(values.check, 'utf8'));
    const faults = mismatches(given, values.root, values.extra);
    if (faults.length) {
      console.error(`${values.check} is not the record of ${values.root}:\n  ${faults.join('\n  ')}`);
      process.exit(1);
    }
    console.log(`${MANIFEST}: ${given.files.length} files match, ${given.unrecorded?.length ?? 0} unrecorded`);
  } else {
    for (const name of ['platform', 'electronite', 'electronite-sha256']) {
      if (!values[name]) throw new Error(`--${name} is needed`);
    }
    const commit = process.env.TC4_BUILD_COMMIT;
    if (!/^[0-9a-f]{40}$/.test(commit ?? '')) throw new Error('TC4_BUILD_COMMIT must be the 40-hex commit the build used');
    const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const cargo = fs.readFileSync(path.join(repo, 'Cargo.toml'), 'utf8');
    const version = cargo.match(/\[workspace\.package\][^[]*?\nversion\s*=\s*"([^"]+)"/)?.[1];
    if (!version) throw new Error('no [workspace.package] version in Cargo.toml');
    const made = manifest(values.root, {
      commit,
      version,
      platform: values.platform,
      electronite: values.electronite,
      electroniteSha256: values['electronite-sha256'],
      unrecorded: values.unrecorded,
    });
    fs.writeFileSync(path.join(values.into ?? values.root, MANIFEST), `${JSON.stringify(made, null, 2)}\n`);
    console.log(`${MANIFEST}: ${made.files.length} files, ${commit.slice(0, 12)}, ${version}, ${values.platform}`);
  }
}
