import fs from 'node:fs';
import path from 'node:path';
import { applyBundle, bundleInfo, canonical, loadProject, replayBundles, sha256 } from './model.mjs';

const safeActor = (actor) => {
  if (!/^[a-z0-9-]{4,32}$/.test(actor)) throw new Error('unsafe actor path');
  return actor;
};

const fsyncDir = (dir) => {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};

const writeImmutable = (file, bytes) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fsyncDir(path.dirname(file));
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (fs.readFileSync(file, 'utf8') !== bytes) throw new Error(`immutable file differs: ${path.basename(file)}`);
  }
};

export const initializeStore = (root, rootBundle, actors) => {
  fs.mkdirSync(root, { recursive: true });
  writeImmutable(path.join(root, 'root.bundle.json'), rootBundle);
  const actorsDir = path.join(root, 'actors');
  fs.mkdirSync(actorsDir, { recursive: true });
  for (const [actorId, manifest] of actors) {
    safeActor(actorId);
    writeImmutable(path.join(actorsDir, `${actorId}.json`), canonical(manifest));
  }
};

const bundlePath = (root, folder, actorId, hash) =>
  path.join(root, folder, safeActor(actorId), `${hash}.bundle.json`);

export const acceptDurably = (root, accepted, raw, actors, { crashAfter = null } = {}) => {
  const info = bundleInfo(raw, actors);
  const hash = sha256(raw);
  const pending = bundlePath(root, 'outbox', info.actorId, hash);
  writeImmutable(pending, raw);
  if (crashAfter === 'stage') throw new Error('simulated crash after durable staging');

  const result = applyBundle(accepted, raw, actors);
  if (result.status === 'rejected' || result.status === 'pending') return { ...result, pending };
  const canonicalPath = bundlePath(root, 'segments', info.actorId, hash);
  writeImmutable(canonicalPath, raw);
  if (crashAfter === 'canonical') throw new Error('simulated crash after canonical write');
  fs.unlinkSync(pending);
  fsyncDir(path.dirname(pending));
  return { ...result, path: canonicalPath };
};

const filesUnder = (root) => {
  if (!fs.existsSync(root)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`symlink refused: ${full}`);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.bundle.json')) out.push(full);
      else throw new Error(`non-whitelisted store path: ${full}`);
    }
  };
  walk(root);
  return out.sort();
};

export const recoverStore = (root, actors) => {
  const rootBundle = fs.readFileSync(path.join(root, 'root.bundle.json'), 'utf8');
  const canonicalFiles = filesUnder(path.join(root, 'segments'));
  const pendingFiles = filesUnder(path.join(root, 'outbox'));
  const canonicalBundles = canonicalFiles.map((file) => fs.readFileSync(file, 'utf8'));
  const base = replayBundles(rootBundle, canonicalBundles, actors);
  if (base.rejected.length || base.pending.length) throw new Error(`canonical store does not replay: ${[...base.rejected, ...base.pending.map(() => 'pending')].join(', ')}`);
  let doc = base.doc;
  const recovered = [];
  const quarantined = [];
  for (const file of pendingFiles) {
    const raw = fs.readFileSync(file, 'utf8');
    const result = acceptDurably(root, doc, raw, actors);
    if (result.status === 'accepted' || result.status === 'duplicate') {
      doc = result.accepted;
      if (fs.existsSync(file)) fs.unlinkSync(file);
      recovered.push(file);
    } else quarantined.push({ file, status: result.status, reason: result.reason });
  }
  loadProject(rootBundle); // independently recheck the immutable root before returning
  return { doc, recovered, quarantined };
};
