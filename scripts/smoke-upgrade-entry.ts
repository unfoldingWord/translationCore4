// #528: an installed-app upgrade witness. The shell drivers run this only in
// their separate, disposable upgrade HOME. No system Git or checkout is needed.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { ServerApi } from '../src/data/serverApi';
import { JournalingStore } from '../src/data/journal/journalingStore';
import { INSTALLED_SUITE } from '../src/data/installedSuite';
import { installedPathFor, languageSetFromInstalled, gatewayBiblesFromInstalled, readInstalled, pinsPreferringInstalled } from '../src/data/installed';
import type { ResourcePin } from '../src/data/burritoStore';

const kv = () => {
  const values = new Map<string, string>();
  return {
    get: async (key: string) => values.get(key),
    set: async (key: string, value: string) => { values.set(key, value); },
    setIfAbsent: async (key: string, value: string) => { if (!values.has(key)) values.set(key, value); return values.get(key)!; },
    keys: async (prefix: string) => [...values.keys()].filter((key) => key.startsWith(prefix)),
    delete: async (key: string) => { values.delete(key); },
  };
};
const options = (api: ServerApi) => ({ api, kv: kv() });
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const legacyPath = (name: string) => `_local_/_sideloaded_/unfoldingword--${name}`;
const fixturePin = (root: string, name: string, version: string): ResourcePin => {
  const meta = read(path.join(root, `${name}@${version}/metadata.json`));
  const identity = Object.entries(meta.identification.primary.dcs)[0] as [string, { revision: string }];
  return { repoPath: `git.door43.org/${identity[0]}`, sha: identity[1].revision, version, flavor: `${meta.type.flavorType.name}/${meta.type.flavorType.flavor.name}` };
};
const digestTree = (directory: string): Record<string, string> => Object.fromEntries(
  fs.readdirSync(directory, { recursive: true }).map(String).filter((file) => !file.split(path.sep).includes('.git') && fs.statSync(path.join(directory, file)).isFile()).sort()
    .map((file) => [file, createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex')]),
);
const witnessFile = (store: string) => path.join(store, '.tc4-upgrade-witness.json');

export async function createOldProject(api: ServerApi, store: string, fixtures: string): Promise<void> {
  assert.equal(fs.existsSync(witnessFile(store)), false, 'negative control: upgrade witness already exists');
  const oldBible = fixturePin(fixtures, 'en_ult', 'v89');
  const oldNotes = fixturePin(fixtures, 'en_tn', 'v86');
  const project = new JournalingStore(options(api));
  try {
    const { repoPath } = await project.createProject({ content_name: 'Bundled upgrade old project', content_abbr: 'bundled_upgrade_old', content_language_code: 'fr', add_book: true, book_code: 'TIT', book_title: 'Titus', book_abbr: 'Titus', add_cv: true, versification: 'eng' });
    const pins = structuredClone(INSTALLED_SUITE);
    // ULT is pinned by the old project; TN is deliberately unpinned anywhere.
    pins.extraScripture[0] = { ...oldBible, version: 'v89', id: 'ult' };
    await project.writeResources(pins, null);
    await project.writeSettings({ schemaVersion: 1, checkingLanguage: 'en', textDirection: 'ltr', textFont: null, languageName: 'Français' }, null);
    await project.commit('Old project before bundled-resource upgrade');
    fs.writeFileSync(witnessFile(store), JSON.stringify({ store, repoPath, oldBible, oldNotes, oldProjectPins: await project.readResources(), project: digestTree(path.join(store, repoPath)) }));
  } finally { project.dispose(); }
}

export function prepareUpgrade(store: string, settingsFile: string, fixtures: string): void {
  const witness = read(witnessFile(store));
  assert.equal(witness.store, store);
  const settings = read(settingsFile);
  // Only the disposable witness store is modified, with its server STOPPED.
  // Remove its current ULT/TN installs so the next real launch must add them.
  for (const [local, pin] of Object.entries(settings.installedResources) as [string, ResourcePin][]) {
    if (![witness.oldBible.repoPath, witness.oldNotes.repoPath].includes(pin.repoPath)) continue;
    assert.ok(local.startsWith('_local_/_sideloaded_/') && !local.includes('..'));
    fs.rmSync(path.join(store, local), { recursive: true, force: true });
    delete settings.installedResources[local];
  }
  const legacy: Record<string, Record<string, string>> = {};
  for (const [name, version, ingredient] of [['en_ult', 'v89', 'TIT.usfm'], ['en_tn', 'v86', 'TIT.tsv']]) {
    const key = legacyPath(name);
    const destination = path.join(store, key);
    const source = path.join(fixtures, `${name}@${version}`);
    const metadata = read(path.join(source, 'metadata.json'));
    metadata.ingredients = { [`ingredients/${ingredient}`]: metadata.ingredients[`ingredients/${ingredient}`] };
    metadata.type.flavorType.currentScope = { TIT: [] };
    fs.mkdirSync(path.join(destination, 'ingredients'), { recursive: true });
    fs.writeFileSync(path.join(destination, 'metadata.json'), JSON.stringify(metadata));
    fs.copyFileSync(path.join(source, ingredient), path.join(destination, 'ingredients', ingredient));
    settings.installedResources[key] = fixturePin(fixtures, name, version);
    legacy[key] = digestTree(destination);
  }
  settings.upgradeWitnessPreference = 'preserve';
  fs.writeFileSync(settingsFile, JSON.stringify(settings));
  fs.writeFileSync(witnessFile(store), JSON.stringify({ ...witness, legacy }));
}

export async function verifyUpgrade(api: ServerApi, store: string, evidenceFile?: string): Promise<void> {
  const witness = read(witnessFile(store));
  assert.equal(await api.getNetEnabled(), false, 'upgrade verification must be offline');
  assert.deepEqual(digestTree(path.join(store, witness.repoPath)), witness.project, 'launcher changed the old project');
  for (const [local, expected] of Object.entries(witness.legacy)) assert.deepEqual(digestTree(path.join(store, local)), expected, `launcher changed ${local}`);
  const installed = await readInstalled(api, 'uw-tc4');
  assert.equal((await api.getClientSettings('uw-tc4')).upgradeWitnessPreference, 'preserve');
  assert.equal(installedPathFor(installed, witness.oldBible), legacyPath('en_ult'));
  assert.equal(installedPathFor(installed, witness.oldNotes), legacyPath('en_tn'));
  const gateway = { id: 'en', org: 'unfoldingWord' };
  assert.equal(languageSetFromInstalled(installed, gateway)?.translationNotes.sha, INSTALLED_SUITE.languageSets.fallback.translationNotes.sha);
  assert.equal(gatewayBiblesFromInstalled(installed, gateway).literal?.sha, INSTALLED_SUITE.extraScripture[0].sha);
  for (const pin of [INSTALLED_SUITE.languageSets.fallback.translationNotes, INSTALLED_SUITE.extraScripture[0]]) {
    const local = installedPathFor(installed, pin);
    assert.ok(local?.endsWith(`--${pin.sha}`), 'new bundled revision must use a full-SHA folder');
    const metadata = await api.getMetadataRaw(local!);
    assert.ok(JSON.stringify(metadata).includes(pin.sha));
    const ingredient = pin.flavor === 'scripture/textTranslation' ? 'TIT.usfm' : 'TIT.tsv';
    assert.ok((await api.readIngredient(local!, ingredient)).length > 0);
  }
  const old = new JournalingStore(options(api));
  try {
    await old.open(witness.repoPath);
    assert.equal((await old.readResources())?.extraScripture?.[0].sha, witness.oldBible.sha, 'opening old project must retain its pin');
    assert.equal(await api.readIngredient(legacyPath('en_ult'), 'TIT.usfm'), fs.readFileSync(path.join(store, legacyPath('en_ult'), 'ingredients/TIT.usfm'), 'utf8'));
  } finally { old.dispose(); }
  const current = new JournalingStore(options(api));
  let newRepo: string | undefined;
  let newProjectPins;
  try {
    const created = await current.createProject({ content_name: 'Bundled upgrade new project', content_abbr: 'bundled_upgrade_new', content_language_code: 'fr', add_book: true, book_code: 'TIT', book_title: 'Titus', book_abbr: 'Titus', add_cv: true, versification: 'eng' });
    newRepo = created.repoPath;
    await current.writeResources(pinsPreferringInstalled(INSTALLED_SUITE, installed), null);
    await current.commit('New project after bundled-resource upgrade');
    newProjectPins = await current.readResources();
    assert.equal(newProjectPins?.languageSets?.primary.translationNotes.sha, INSTALLED_SUITE.languageSets.primary.translationNotes.sha);
    assert.equal(newProjectPins?.extraScripture?.[0].sha, INSTALLED_SUITE.extraScripture[0].sha);
  } finally {
    current.dispose();
    if (newRepo) await api.deleteRepo(newRepo);
  }
  if (evidenceFile) fs.writeFileSync(evidenceFile, JSON.stringify({ ...witness, netEnabled: false, installedResources: installed, newProjectPins,
    resolvedPaths: { oldBible: installedPathFor(installed, witness.oldBible), oldNotes: installedPathFor(installed, witness.oldNotes),
      newBible: installedPathFor(installed, INSTALLED_SUITE.extraScripture[0]), newNotes: installedPathFor(installed, INSTALLED_SUITE.languageSets.fallback.translationNotes) },
  }, null, 2));
  await api.deleteRepo(witness.repoPath);
  fs.rmSync(witnessFile(store));
  console.log('ok bundled upgrade: old pinned ULT and unpinned TN bytes preserved; old project reopened with old pin; current bundled ULT/TN readable and selected by exact SHA; preference retained');
}

if (typeof require !== 'undefined' && require.main === module) {
  const [mode, base, store, settingsFile, evidenceDirectory] = process.argv.slice(2);
  const fixtures = path.join(__dirname, 'upgrade-fixtures');
  const api = new ServerApi({ baseUrl: base });
  Promise.resolve().then(async () => {
    if (mode === 'project') await createOldProject(api, store, fixtures);
    else if (mode === 'prepare') prepareUpgrade(store, settingsFile, fixtures);
    else if (mode === 'verify') await verifyUpgrade(api, store, path.join(evidenceDirectory, 'bundled-upgrade-witness.json'));
    else throw new Error('usage: smoke-upgrade <project|prepare|verify> <api> <store> <settingsFile>');
  }).catch((error: unknown) => { console.error(error); process.exitCode = 1; });
}
