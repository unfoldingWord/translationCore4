// A small bundled store for notices.mjs, shared by its unit test and the About journey (#606).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TN = { repoPath: 'git.door43.org/unfoldingWord/en_tn', version: 'v91', sha: 'e'.repeat(40) };
export const UGL = { repoPath: 'git.door43.org/uW/en_ugl', sha: 'd'.repeat(40) };

/** A bundled store of one burrito export and one lexicon, laid out as bundle_store does. */
export function smallBundle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notices-'));
  const metadata = (title) => ({
    identification: { name: { en: title } },
    copyright: { shortStatements: [{ statement: '© unfoldingWord 2026, CC BY-SA 4.0' }] },
  });
  const install = (folder, pin, packaging, file, body) => {
    const at = path.join(dir, 'dcs', ...folder, pin.sha);
    fs.mkdirSync(path.join(at, 'content'), { recursive: true });
    fs.writeFileSync(path.join(at, 'receipt.json'), JSON.stringify({ pin, packaging }));
    fs.writeFileSync(path.join(at, 'content', file), JSON.stringify(body));
  };
  install(['unfoldingword', 'en_tn'], TN, 'burritoExport', 'metadata.json', metadata('Translation Notes'));
  install(['uw', 'en_ugl'], UGL, 'lexicon', 'lexicon.json', { metadata: metadata('Greek Lexicon') });
  fs.writeFileSync(path.join(dir, 'BUNDLE-MANIFEST.json'), JSON.stringify({ manifestVersion: 1, installs: [TN, UGL] }));
  const electronite = path.join(dir, 'ELECTRONITE-LICENSE');
  fs.writeFileSync(electronite, 'Copyright (c) Electron contributors');
  return { bundle: dir, electroniteLicense: electronite };
}
