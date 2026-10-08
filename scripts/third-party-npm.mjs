// #554: the npm packages that the client build puts into the app, with each license text.
// vite.config.js gives the ids of the modules that have code in an output chunk (main and
// worker); the packager adds the result to THIRD-PARTY-NOTICES.md. Nobody edits the list.
//
// A package that ships no license file needs an override text for its exact version,
// scripts/license-overrides/<name>@<version>.txt ("/" in a scoped name becomes "+").
// When neither exists, the build fails: a version bump makes someone read the new version.
// The builtins come through process.getBuiltinModule: Vitest aliases `node:fs` (CONTRIBUTING.md).
const fs = process.getBuiltinModule('node:fs');
const path = process.getBuiltinModule('node:path');

const LICENSE_FILE = /^(licen[cs]e|copying)/i;
const NOTICE_FILE = /^notice/i;
const SEP = '/node_modules/';

function packageDir(id) {
  const file = id.replace(/^\0/, '').split('?')[0].replaceAll('\\', '/');
  const at = file.lastIndexOf(SEP);
  if (at < 0) return null;
  const parts = file.slice(at + SEP.length).split('/');
  const name = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
  return file.slice(0, at + SEP.length) + name;
}

function licenseName(json) {
  const field = json.license ?? json.licenses;
  if (typeof field === 'string') return field;
  if (Array.isArray(field)) return field.map((l) => l.type ?? l).join(' OR ');
  if (field && typeof field === 'object' && field.type) return field.type;
  return '(not stated)';
}

function readFiles(dir, pattern) {
  return fs
    .readdirSync(dir)
    .filter((f) => pattern.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .sort()
    .map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
}

export function collectNpmNotices(moduleIds, overridesDir) {
  const dirs = new Set();
  for (const id of moduleIds) {
    const dir = packageDir(id);
    if (dir) dirs.add(dir);
  }
  const entries = new Map();
  const missing = [];
  for (const dir of dirs) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const key = `${json.name}@${json.version}`;
    if (entries.has(key)) continue;
    const texts = readFiles(dir, LICENSE_FILE);
    if (texts.length === 0) {
      const override = path.join(overridesDir, `${json.name.replace('/', '+')}@${json.version}.txt`);
      if (fs.existsSync(override)) texts.push(fs.readFileSync(override, 'utf8'));
      else {
        missing.push(key);
        continue;
      }
    }
    texts.push(...readFiles(dir, NOTICE_FILE));
    entries.set(key, { name: json.name, version: json.version, license: licenseName(json), text: texts.join('\n\n') });
  }
  if (missing.length) {
    throw new Error(
      `#554: these bundled npm packages ship no license file and have no override in ${overridesDir}:\n` +
        missing.sort().map((m) => `  ${m}`).join('\n') +
        '\nRead the license of that exact version, then add <name>@<version>.txt (see scripts/license-overrides/README.md).',
    );
  }
  return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name, 'en') || a.version.localeCompare(b.version, 'en', { numeric: true }));
}

export function renderNpmNotices(entries) {
  const blocks = entries.map((e) => {
    const longest = Math.max(2, ...(e.text.match(/`+/g) ?? []).map((run) => run.length));
    const fence = '`'.repeat(longest + 1);
    return `### ${e.name} ${e.version} — ${e.license}\n\n${fence}\n${e.text.trimEnd()}\n${fence}\n`;
  });
  return (
    '## npm packages in the client\n\n' +
    `The client build generated this list from the code in the app: ${entries.length} packages.\n\n` +
    blocks.join('\n')
  );
}
