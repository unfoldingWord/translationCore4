// The USFM parser (issue #195, J9c): one or several .usfm, .sfm or .txt files
// are one bundle; the book code comes from `\id`; the license finding says CC
// BY-SA 4.0 will be applied; a file with no `\id`, two files for one book, or
// bytes that are not UTF-8 are a damaged finding; the stored book is the file
// byte for byte, CRLF line ends included; a byte-order mark stays in the text.
import { describe, expect, it } from 'vitest';
import { USFM_PARSER } from '../../src/data/import/usfm';
import { runImport } from '../../src/data/import/shell';
import type { ImportFile } from '../../src/data/import/types';
import { ServerApi } from '../../src/data/serverApi';
import { JournalingStore, forgetProjectQueues } from '../../src/data/journal/journalingStore';
import { forgetSharedClocks } from '../../src/data/journal/journalStore';
import { journalingRig, memKv, tickingNow } from '../helpers/journalingRig';
import { fixtureFile } from '../helpers/import';

const encoder = new TextEncoder();
const file = (name: string, text: string): ImportFile => ({ name, bytes: encoder.encode(text) });
const LICENSE = { kind: 'license', text: 'No license was found. CC BY-SA 4.0 will be applied.', warn: true };
const damagedOf = (findings: Array<{ kind: string }>) => findings.filter((f) => f.kind === 'damaged');

describe('#195 the USFM parser', () => {
  it('accepts one or several .usfm, .sfm or .txt files, and nothing else', () => {
    expect(USFM_PARSER.accepts([file('TIT.usfm', '')])).toBe(true);
    expect(USFM_PARSER.accepts([file('a.USFM', ''), file('b.sfm', ''), file('c.txt', '')])).toBe(true);
    expect(USFM_PARSER.accepts([file('TIT.usfm', ''), file('export.zip', '')])).toBe(false);
    expect(USFM_PARSER.accepts([])).toBe(false);
  });

  it('one file: the book from \\id, the name from \\h, no language, the license finding, the text as it is', async () => {
    const tit = fixtureFile('usfm/57-TIT.usfm');
    const bundle = await USFM_PARSER.parse([tit]);
    expect(bundle.kind).toBe('bible');
    expect(bundle.facts).toEqual({ language: '', name: 'Tito' });
    expect(bundle.findings).toEqual([LICENSE]);
    expect(bundle.books.map((b) => b.code)).toEqual(['TIT']);
    expect(encoder.encode(bundle.books[0].usfm)).toEqual(tit.bytes);
  });

  it('three files are one bundle with three books; the name is left to the review page', async () => {
    const bundle = await USFM_PARSER.parse(['usfm/57-TIT.usfm', 'usfm/32-JON.usfm', 'usfm/58-PHM.txt'].map((rel) => fixtureFile(rel)));
    expect(bundle.findings).toEqual([LICENSE]);
    expect(bundle.books.map((b) => b.code)).toEqual(['JON', 'PHM', 'TIT']);
    expect(bundle.facts.name).toBe('');
  });

  it('refuse: a file with no \\id line is import.damaged.usfm-parse', async () => {
    const bundle = await USFM_PARSER.parse([fixtureFile('usfm/57-TIT.usfm'), fixtureFile('usfm/no-id.sfm')]);
    expect(damagedOf(bundle.findings)).toEqual([expect.objectContaining({ code: 'import.damaged.usfm-parse', text: expect.stringContaining('no-id.sfm') })]);
  });

  it('refuse: two files for one book, or bytes that are not UTF-8, are import.damaged.usfm-parse', async () => {
    const twice = await USFM_PARSER.parse([file('a.usfm', '\\id TIT\n\\c 1\n'), file('b.usfm', '\\id TIT\n\\c 1\n')]);
    expect(damagedOf(twice.findings)).toEqual([expect.objectContaining({ code: 'import.damaged.usfm-parse', text: expect.stringMatching(/a\.usfm.*b\.usfm.*TIT/) })]);
    const latin1 = await USFM_PARSER.parse([{ name: 'TIT.usfm', bytes: new Uint8Array([...encoder.encode('\\id TIT\n\\h Tit'), 0xf3, 0x0a]) }]);
    expect(damagedOf(latin1.findings)).toEqual([expect.objectContaining({ code: 'import.damaged.usfm-parse' })]);
  });

  it('a byte-order mark: the book is found and the text keeps the mark', async () => {
    const text = '\uFEFF\\id TIT\n\\h Tito\n\\c 1\n';
    const bundle = await USFM_PARSER.parse([file('TIT.usfm', text)]);
    expect(bundle.books).toEqual([{ code: 'TIT', usfm: text }]);
  });

  it('CRLF line ends: the new project stores the file byte for byte', async () => {
    forgetSharedClocks();
    forgetProjectQueues();
    const rig = journalingRig();
    const clock = tickingNow('2026-09-23T12:00:00.000Z');
    const api = new ServerApi({ baseUrl: 'http://rig.test/api', fetchFn: rig.fetchFn });
    const store = new JournalingStore({ api, kv: memKv(), now: () => clock.advance(13) });
    const text = '\\id TIT\r\n\\usfm 3.0\r\n\\h Tito\r\n\\c 1\r\n\\p\r\n\\v 1 Uno.\r\n\\v 2 Dos.\r\n';
    const report = await runImport(USFM_PARSER, [file('TIT.usfm', text)], { language: 'es-419' }, { api, store });
    expect(report).toMatchObject({ ok: true, facts: { repoPath: '_local_/_local_/tito', books: ['TIT'], seedSource: 'sidecar-migration' } });
    expect(rig.repos.get('_local_/_local_/tito')!.files.get('TIT.usfm')).toBe(text);
  });
});
