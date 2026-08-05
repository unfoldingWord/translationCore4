// C2.5 — the help article behind a check item, read from the INSTALLED burrito.
import { describe, expect, it } from 'vitest';
import { readTaArticle, readTwArticle, renderArticleBlocks, TA_SECTIONS } from '../src/data/articles';

const fakeApi = (files: Record<string, string>) => ({
  readIngredient: async (repo: string, ipath: string) => {
    const key = `${repo}::${ipath}`;
    if (!(key in files)) throw new Error('not found');
    return files[key];
  },
});

const TA = '_local_/_sideloaded_/en_ta';
const TW = '_local_/_sideloaded_/en_tw';

describe('tA modules — the tN groupId is a module slug (PLATFORM-NOTES #12)', () => {
  const api = fakeApi({
    [`${TA}::translate/figs-metaphor/01.md`]: '### Description\n\nA metaphor is…',
    [`${TA}::translate/figs-metaphor/title.md`]: 'Metaphor\n',
    [`${TA}::checking/acceptable/01.md`]: 'Acceptable style…',
    [`${TA}::checking/acceptable/title.md`]: 'Acceptable Style',
  });

  it('reads the module body and its authoritative title.md', async () => {
    const a = await readTaArticle(api as never, TA, 'figs-metaphor');
    expect(a?.title).toBe('Metaphor'); // trimmed, from title.md not the toc
    expect(a?.body).toContain('A metaphor is');
    expect(a?.ipath).toBe('translate/figs-metaphor/01.md');
  });

  it('probes the other sections — a module is not always under translate/', async () => {
    const a = await readTaArticle(api as never, TA, 'acceptable');
    expect(a?.ipath).toBe('checking/acceptable/01.md');
    expect(a?.title).toBe('Acceptable Style');
  });

  it('reports ABSENCE for a module the pinned release does not carry', async () => {
    expect(await readTaArticle(api as never, TA, 'figs-yousingular')).toBeNull();
  });

  it('falls back to the slug when title.md is missing but the body is not', async () => {
    const partial = fakeApi({ [`${TA}::translate/x-mod/01.md`]: 'body' });
    expect((await readTaArticle(partial as never, TA, 'x-mod'))?.title).toBe('x-mod');
  });

  it('probes translate first — the overwhelmingly common section', () => {
    expect(TA_SECTIONS[0]).toBe('translate');
  });
});

describe('tW articles — same repo the links came from (D34)', () => {
  const api = fakeApi({
    [`${TW}::payload/names/paul.md`]: '# Paul, Saul\n\n## Definition:\n\nPaul was…',
    [`${TW}::payload/kt/god.md`]: '# God\n\n## Definition:',
  });

  it('reads payload/<category>/<slug>.md using the category from the TWLink', async () => {
    const a = await readTwArticle(api as never, TW, 'names', 'paul');
    expect(a?.title).toBe('Paul, Saul'); // the H1, not the slug
    expect(a?.ipath).toBe('payload/names/paul.md');
  });

  it('reports absence rather than guessing another category', async () => {
    expect(await readTwArticle(api as never, TW, 'kt', 'paul')).toBeNull();
  });

  it('needs both a category and a slug', async () => {
    expect(await readTwArticle(api as never, TW, '', 'paul')).toBeNull();
    expect(await readTwArticle(api as never, TW, 'kt', '')).toBeNull();
  });
});

describe('a platform error envelope counts as absence, not as content', () => {
  it('does not render {"is_good":false,...} as an article body', async () => {
    const api = fakeApi({
      [`${TA}::translate/x/01.md`]: '{"is_good":false,"reason":"could not read ingredient content"}',
    });
    expect(await readTaArticle(api as never, TA, 'x')).toBeNull();
  });
});

describe('renderArticleBlocks — small, predictable markdown handling', () => {
  it('splits headings, paragraphs and list items', () => {
    const blocks = renderArticleBlocks('### Description\n\nSome text.\n\n- one\n- two');
    expect(blocks.map((b) => b.kind)).toEqual(['h', 'p', 'li', 'li']);
    expect(blocks[0]).toMatchObject({ level: 3, text: 'Description' });
    expect(blocks[2].text).toBe('one');
  });

  it('strips bold, italics, links and wiki-links to their text', () => {
    const [b] = renderArticleBlocks('The words **faith** and *truth* — see [[rc://x/ta/man/y]] and [here](http://a).');
    expect(b.text).toContain('faith');
    expect(b.text).not.toContain('**');
    expect(b.text).toContain('rc://x/ta/man/y');
    expect(b.text).toContain('here');
    expect(b.text).not.toContain('http://a');
  });

  it('turns the TSV escaped newline into a space, so notes read as prose', () => {
    const [b] = renderArticleBlocks('First line.\\n\\nSecond line.');
    expect(b.text).toBe('First line. Second line.');
  });

  it('drops blank lines and keeps unknown syntax literal', () => {
    const blocks = renderArticleBlocks('\n\n| a | b |\n\n');
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('| a | b |');
  });
});
