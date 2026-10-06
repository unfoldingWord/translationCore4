// Packaged startup support. The resource binding runs under the singleton lock,
// before the server initializes its own working directory (#243, #70, #348).
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');

function withTrailingSeparator(value) {
  return value.endsWith(path.sep) ? value : `${value}${path.sep}`;
}

function appResourcesDir(resourcesDir) {
  return withTrailingSeparator(path.resolve(resourcesDir, 'lib'));
}

function productShortName(resourcesDir) {
  const productFile = path.join(resourcesDir, 'lib', 'product', 'product.json');
  let product;
  try {
    product = JSON.parse(fs.readFileSync(productFile, 'utf8'));
  } catch (error) {
    throw new Error(`could not read packaged product identity at ${productFile}: ${error.message}`);
  }
  if (!product || typeof product.short_name !== 'string' || !/^[a-z0-9-]+$/i.test(product.short_name)) {
    throw new Error(`packaged product identity has no valid short_name at ${productFile}`);
  }
  return product.short_name;
}

function profileDirectory({ resourcesDir, home, profileLeaf }) {
  const leaf = profileLeaf || path.join('pankosmia', productShortName(resourcesDir));
  return path.join(home, leaf);
}

// An explicit external-server launch owns its selector/profile. Packaged
// binding is only for the server this entry point starts itself.
function shouldBindPackagedResources(startServer = process.env.START_SERVER) {
  return startServer !== 'false';
}

// #284: the MSVC-built bin\server.exe needs VCRUNTIME140.dll, and a clean
// Windows install has none (exit 0xC0000135, STATUS_DLL_NOT_FOUND, on
// alpha.6 — docs/evidence/offline-run-2026-09-14.md). The packaging recipe
// ships the CRT app-local in bin\; a copy that lost it, on a machine without
// the system-wide redistributable, must stop with this prerequisite instead
// of the template's opaque "The backend could not be started."
const WINDOWS_SERVER_RUNTIME_DLL = 'vcruntime140.dll';
const VC_REDIST_DOWNLOAD = 'https://aka.ms/vs/17/release/vc_redist.x64.exe';
function missingWindowsServerRuntime({ resourcesDir, platform = process.platform, systemRoot = process.env.SystemRoot }) {
  if (platform !== 'win32') return null;
  if (fs.existsSync(path.join(resourcesDir, 'bin', WINDOWS_SERVER_RUNTIME_DLL))) return null;
  if (systemRoot && fs.existsSync(path.join(systemRoot, 'System32', WINDOWS_SERVER_RUNTIME_DLL))) return null;
  return 'The backend server (bin\\server.exe) needs VCRUNTIME140.dll, and this computer does not have it.\n\n'
    + `This copy of translationCore4 is missing bin\\${WINDOWS_SERVER_RUNTIME_DLL}. `
    + 'Re-extract the complete zip, or install the Microsoft Visual C++ Redistributable (x64) from\n\n'
    + `${VC_REDIST_DOWNLOAD}\n\nThen start translationCore4 again.`;
}

function writeJsonAtomically(file, value) {
  const temporary = `${file}.tc4-writing-${process.pid}-${Date.now()}`;
  const contents = `${JSON.stringify(value, null, 2)}\n`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, contents, 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, file);
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

/**
 * Bind the bundled server to this installation's resources and repair the
 * saved selector for an existing tC4 profile. This must run before
 * electronStartup.js captures process.env.APP_RESOURCES_DIR.
 */
function bindPackagedResources({ resourcesDir, home, profileLeaf }) {
  const selected = appResourcesDir(resourcesDir);
  process.env.APP_RESOURCES_DIR = selected;

  const settingsFile = path.join(profileDirectory({ resourcesDir, home, profileLeaf }), 'user_settings.json');
  if (!fs.existsSync(settingsFile)) return { appResourcesDir: selected, settingsFile, repaired: false };

  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch (error) {
    throw new Error(`tC4 profile settings are malformed at ${settingsFile}: ${error.message}`);
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error(`tC4 profile settings are not an object at ${settingsFile}`);
  }
  if (settings.app_resources_dir === selected) {
    return { appResourcesDir: selected, settingsFile, repaired: false };
  }
  settings.app_resources_dir = selected;
  writeJsonAtomically(settingsFile, settings);
  return { appResourcesDir: selected, settingsFile, repaired: true };
}

function copyIfMissing(source, destination, prepare = () => {}) {
  if (fs.existsSync(destination)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  // A failed/interrupted copy must not masquerade as an installed resource on
  // the next launch. Publish only the completed directory.
  const staging = `${destination}.tc4-installing`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    fs.cpSync(source, staging, { recursive: true, errorOnExist: true, force: false });
    prepare(staging);
    fs.renameSync(staging, destination);
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function readObject(file) {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Expected JSON object at ${file}`);
  return value;
}

const ARCHIVE_RECEIPT = '.tc4-bundled-identity.json';

function archiveProof(directory, pin) {
  if (!pin.archive_receipt_sha256) return null;
  const file = path.join(directory, ARCHIVE_RECEIPT);
  const bytes = fs.readFileSync(file);
  if (pin.version || createHash('sha256').update(bytes).digest('hex') !== pin.archive_receipt_sha256) throw new Error(`Archive receipt does not match manifest: ${directory}`);
  const receipt = readObject(file);
  if (receipt.repoPath !== pin.repoPath || receipt.sha !== pin.sha || !receipt.files?.['metadata.json']) throw new Error(`Archive receipt identity does not match manifest: ${directory}`);
  return receipt;
}

function resourceMetadata(directory, pin, archive = null, recorded = null) {
  const meta = readObject(path.join(directory, 'metadata.json'));
  const entries = Object.entries(meta.identification?.primary?.dcs ?? {});
  if (!entries.some(([repo, value]) => `git.door43.org/${repo}`.toLowerCase() === pin.repoPath.toLowerCase() && value.revision === pin.sha)) {
    // Tagged exports must declare their DCS SHA. For commit archives the
    // signed package's receipt preserves the fetcher's archive-comment proof.
    let proven = false;
    if (!entries.length && archive) {
      if (fs.existsSync(path.join(directory, ARCHIVE_RECEIPT))) proven = !!archiveProof(directory, pin);
      else if (recorded) proven = recorded.repoPath?.toLowerCase() === pin.repoPath.toLowerCase() && recorded.sha === pin.sha;
      else {
        const segment = pin.repoPath.replace('git.door43.org/', '').replace('/', '--').toLowerCase();
        const name = path.basename(directory).toLowerCase();
        proven = name === `${segment}--${pin.sha}` || name === `${segment}--${pin.sha.slice(0, 12)}`;
      }
    }
    if (!proven) throw new Error(`Resource revision does not match manifest: ${directory}`);
  }
  const ft = meta.type?.flavorType;
  if (!ft?.name || !ft?.flavor?.name) throw new Error(`Resource has no factual flavor: ${directory}`);
  if (!meta.ingredients || !Object.keys(meta.ingredients).length) throw new Error(`Resource has no ingredients: ${directory}`);
  return { meta, flavor: `${ft.name}/${ft.flavor.name}` };
}

function validateTree(directory, ingredients) {
  for (const [relative, record] of Object.entries(ingredients)) {
    if (relative.includes('\\') || path.posix.isAbsolute(relative) || relative.split('/').some((part) => part === '..')) throw new Error(`Invalid ingredient path: ${relative}`);
    const file = path.join(directory, ...relative.split('/'));
    if (!fs.statSync(file).isFile()) throw new Error(`Incomplete resource: ${file}`);
    const bytes = fs.readFileSync(file);
    if (typeof record.size === 'number' && bytes.length !== record.size) throw new Error(`Resource size mismatch: ${file}`);
    for (const [algorithm, checksum] of Object.entries(record.checksum ?? {})) {
      if (!['md5', 'sha256', 'sha512'].includes(algorithm)) throw new Error(`Unsupported resource checksum: ${algorithm}`);
      if (createHash(algorithm).update(bytes).digest('hex') !== checksum) throw new Error(`Resource checksum mismatch: ${file}`);
    }
  }
}

// Pankosmia (0.18.5 to 0.18.15, lib.rs:129) initializes only when its working directory is absent.
// Publish a COMPLETE fresh profile from its own shipped templates, otherwise
// recording installs first would make the server skip initialization and panic.
function prepareProfile(resourcesDir, home, profile, staging) {
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true });
  const setup = readObject(path.join(resourcesDir, 'lib/setup/local_setup.json'));
  const replacements = {
    '%%WORKINGDIR%%': profile,
    '%%APPRESOURCESDIR%%': appResourcesDir(resourcesDir),
    '%%PANKOSMIADIR%%': setup.local_pankosmia_path,
    '%%HOMEDIR%%': home,
  };
  const substitute = (value) => {
    if (typeof value === 'string') return Object.entries(replacements).reduce((text, [token, replacement]) => text.replaceAll(token, replacement), value);
    if (Array.isArray(value)) return value.map(substitute);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, substitute(child)]));
    return value;
  };
  for (const name of ['user_settings.json', 'app_state.json']) {
    writeJsonAtomically(path.join(staging, name), substitute(readObject(path.join(resourcesDir, 'lib/templates', name))));
  }
  fs.mkdirSync(path.join(staging, 'blobs'));
  fs.mkdirSync(path.join(staging, 'temp'));
}

function ensureBundledResources({ resourcesDir, home, storeLeaf, profileLeaf }) {
  const store = path.join(home, storeLeaf);
  const bundled = path.join(resourcesDir, 'resources');
  const sources = fs.readdirSync(bundled, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  const manifest = readObject(path.join(resourcesDir, 'BUILD-MANIFEST.json'));
  if (!Array.isArray(manifest.bundled_resources) || !manifest.bundled_resources.length) throw new Error('Manifest has no bundled resources');
  const local = path.join(store, '_local_', '_sideloaded_');
  const stagingRoot = path.join(store, '.tc4-resource-installing');
  fs.mkdirSync(local, { recursive: true });
  // Startup holds the singleton lock; abandoned staging is never a resource.
  fs.rmSync(stagingRoot, { recursive: true, force: true });
  const profile = profileDirectory({ resourcesDir, home, profileLeaf });
  const freshProfile = !fs.existsSync(profile);
  const profileStaging = `${profile}.tc4-installing`;
  const settingsFile = path.join(freshProfile ? profileStaging : profile, 'client_settings', 'uw-tc4.json');
  const settings = !freshProfile && fs.existsSync(settingsFile) ? readObject(settingsFile) : {};
  const installed = settings.installedResources ?? {};
  if (!installed || typeof installed !== 'object' || Array.isArray(installed)) throw new Error('Invalid installedResources settings');
  const next = { ...installed };
  try {
    for (const pin of manifest.bundled_resources) {
      if (!/^git\.door43\.org\/[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(pin.repoPath) || !/^[0-9a-f]{40}$/.test(pin.sha)) throw new Error('Invalid bundled resource identity in manifest');
      const parts = pin.repoPath.split('/');
      const segment = `${parts[1]}--${parts[2]}`.toLowerCase();
      const sourceEntry = sources.find((entry) => entry.name.toLowerCase() === segment || entry.name.toLowerCase() === `${segment}--${pin.sha.slice(0, 12)}`);
      if (!sourceEntry) throw new Error(`Bundled resource missing: ${pin.repoPath}`);
      const source = path.join(bundled, sourceEntry.name);
      const archive = archiveProof(source, pin);
      const { meta, flavor } = resourceMetadata(source, pin, archive);
      // Authored archives can have stale ingredient sizes/checksums and omit
      // payloads. Their verified complete-tree receipt is authoritative; DCS
      // exports continue to use the export's own ingredient inventory.
      const tree = archive ? archive.files : meta.ingredients;
      validateTree(source, tree);
      let destination = path.join(local, `${segment}--${pin.sha}`);
      const candidates = fs.readdirSync(local, { withFileTypes: true }).filter((entry) => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of candidates) {
        const candidate = path.join(local, entry.name);
        // Metadata, not a possibly stale record, determines a reusable copy.
        let identity;
        const recorded = installed[`_local_/_sideloaded_/${entry.name}`];
        try { identity = resourceMetadata(candidate, pin, archive, recorded); }
        catch (error) { if (candidate === destination) throw error; continue; }
        if (identity.flavor !== flavor) throw new Error(`Resource flavor mismatch: ${candidate}`);
        validateTree(candidate, tree);
        destination = candidate;
        break;
      }
      if (!fs.existsSync(destination)) {
        const staging = path.join(stagingRoot, `${segment}--${pin.sha}`);
        fs.mkdirSync(stagingRoot, { recursive: true });
        fs.cpSync(source, staging, { recursive: true, errorOnExist: true, force: false });
        resourceMetadata(staging, pin, archive);
        validateTree(staging, tree);
        fs.renameSync(staging, destination);
      }
      const key = `_local_/_sideloaded_/${path.basename(destination)}`;
      next[key] = { repoPath: pin.repoPath, sha: pin.sha, ...(pin.version ? { version: pin.version } : {}), flavor };
    }
    if (freshProfile) prepareProfile(resourcesDir, home, profile, profileStaging);
    if (freshProfile || JSON.stringify(next) !== JSON.stringify(installed)) {
      fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
      writeJsonAtomically(settingsFile, { ...settings, installedResources: next });
    }
    if (freshProfile) fs.renameSync(profileStaging, profile);
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
    fs.rmSync(profileStaging, { recursive: true, force: true });
  }
}

function bootstrap(options) {
  const { resourcesDir, home, storeLeaf, variant } = options;
  ensureBundledResources(options);
  const store = path.join(home, storeLeaf);
  if (variant === 'debug') {
    const destination = path.join(store, '_local_', '_local_', 'sample_burrito');
    copyIfMissing(path.join(resourcesDir, 'debug-seeds', 'sample_burrito'), destination, (cwd) => {
      // Same initial commit as the existing debug launcher (#70).
      const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe' });
      git('init', '-q', '-b', 'main', '.');
      git('add', '-A');
      git('-c', 'user.email=debug@tc4.local', '-c', 'user.name=tc4-debug', 'commit', '-qm', 'seed');
    });
  }
}

module.exports = { appResourcesDir, bindPackagedResources, bootstrap, ensureBundledResources, missingWindowsServerRuntime, profileDirectory, shouldBindPackagedResources };
