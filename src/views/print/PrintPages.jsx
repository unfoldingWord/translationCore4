// The Community Checking preview as pages (#20, owner 2026-09-24): sheets of
// the chosen paper with the PDF's margins and page numbers, and the book set on
// them with the PDF's own DOM and stylesheet (PrintBook.jsx, print.css). Two
// columns are one flow per page: column 1, then column 2, then column 1 of the
// next sheet. A screen has no pages, so this component measures: a hidden
// sheet takes verses until the next one would overflow, and a verse that does
// not fit is split between words. Chromium's print makes the PDF's own breaks,
// so the two agree where the fonts agree (the PDF loads no web font).
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import '../../ds/tokens/print.css';
import { PAGE_MARGIN_MM, PAPER_MM, PrintParts, printVariables } from './PrintBook.jsx';

const px = (mm) => (mm * 96) / 25.4;
const PAGE_NUMBER = { position: 'absolute', left: 0, right: 0, bottom: px(PAGE_MARGIN_MM.bottom) / 2 - 7, textAlign: 'center', fontFamily: '"Charis SIL", "PT Serif", Georgia, "Times New Roman", serif', fontSize: 11, color: '#626F78' };
const FLOW = { flex: 1, minHeight: 0, columnFill: 'auto', overflow: 'hidden' };

/** The units a page takes, in reading order: a gap line, or one verse of a chapter
 * (`head` on the chapter's first verse, which carries its drop cap or heading). */
const atomsOf = (items) =>
  items.flatMap((item) => (item.gap ? [{ gap: item.gap }] : item.verses.map((v, i) => ({ c: item.c, head: i === 0, v }))));

/** A page's atoms as print parts: consecutive verses of one chapter share a part. */
export function partsOf(atoms) {
  const parts = [];
  for (const atom of atoms) {
    const last = parts[parts.length - 1];
    if (atom.gap) parts.push({ gap: atom.gap });
    else if (last && !last.gap && last.c === atom.c && !atom.head) last.verses.push(atom.v);
    else parts.push({ c: atom.c, head: atom.head, verses: [atom.v] });
  }
  return parts;
}

const wordsOf = (atom) => (atom.v.rest ?? atom.v.text).split(' ');
/** The first words of a verse atom; it keeps its number unless it is already a continuation. */
const pieceOf = (atom, words) =>
  ({ ...atom, v: atom.v.rest === undefined ? { ...atom.v, text: words.join(' ') } : { ...atom.v, rest: words.join(' ') } });
/** The rest of a verse after a page break: no head, no number. */
const restOf = (atom, words) => ({ c: atom.c, head: false, v: { ...atom.v, rest: words.join(' ') } });

/** The largest n in [0, max] with `ok(n)` true, for an `ok` true up to some n and false after. */
function largest(max, ok) {
  let lo = 0;
  let hi = 1;
  while (hi <= max && ok(hi)) {
    lo = hi;
    hi *= 2;
  }
  hi = Math.min(hi - 1, max);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ok(mid)) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Fill pages in order. `fits(page, atoms)` says whether those atoms fit on that page. */
export function paginate(atoms, fits) {
  const pages = [];
  let queue = atoms;
  while (queue.length > 0) {
    const p = pages.length;
    const n = largest(queue.length, (k) => fits(p, queue.slice(0, k)));
    let page = queue.slice(0, n);
    let rest = queue.slice(n);
    const next = rest[0];
    if (next && !next.gap && next.v.drafted && next.v.text) {
      const words = wordsOf(next);
      const k = largest(words.length - 1, (m) => fits(p, [...page, pieceOf(next, words.slice(0, m))]));
      if (k > 0) {
        page = [...page, pieceOf(next, words.slice(0, k))];
        rest = [restOf(next, words.slice(k)), ...rest.slice(1)];
      }
    }
    if (page.length === 0) {
      // Nothing fits an empty page (one word taller than the page): give it the page.
      page = [queue[0]];
      rest = queue.slice(1);
    }
    pages.push(page);
    queue = rest;
  }
  return pages;
}

/** One sheet: the title on the first, the flow, the page number. */
function Sheet({ pageSetup, dir, title, number, children, sheetRef, hidden = false }) {
  const [w, h] = PAPER_MM[pageSetup.paper];
  const { top, side, bottom } = PAGE_MARGIN_MM;
  const style = {
    ...printVariables(pageSetup),
    width: px(w),
    height: px(h),
    padding: `${px(top)}px ${px(side)}px ${px(bottom)}px`,
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    position: hidden ? 'absolute' : 'relative',
    background: '#fff',
    ...(hidden
      ? { visibility: 'hidden', pointerEvents: 'none', left: 0, top: 0 }
      : { boxShadow: 'var(--shadow-page)', borderRadius: 4, margin: '0 auto 24px' }),
  };
  return (
    <div ref={sheetRef} className="print-book" style={style} aria-hidden={hidden || undefined} data-testid={hidden ? undefined : 'cc-page'}>
      {title !== null && <h1 className="print-title" dir={dir}>{title}</h1>}
      <div className="print-flow" dir={dir} style={FLOW} data-testid={hidden ? undefined : 'cc-flow'}>{children}</div>
      {!hidden && <div style={PAGE_NUMBER}>{number}</div>}
    </div>
  );
}

export default function PrintPages({ title, items, pageSetup, dir, empty }) {
  const measureRef = React.useRef(null);
  const [pages, setPages] = React.useState(null);
  const [fontsEpoch, setFontsEpoch] = React.useState(0);
  const atoms = React.useMemo(() => atomsOf(items), [items]);

  // A web font that arrives after the measurement changes every line: measure again.
  React.useEffect(() => {
    const fonts = globalThis.document?.fonts;
    if (!fonts?.addEventListener) return undefined;
    const again = () => setFontsEpoch((n) => n + 1);
    fonts.ready.then(again);
    fonts.addEventListener('loadingdone', again);
    return () => fonts.removeEventListener('loadingdone', again);
  }, []);

  React.useLayoutEffect(() => {
    const sheet = measureRef.current;
    const heading = sheet.querySelector('.print-title');
    const flow = sheet.querySelector('.print-flow');
    const fits = (page, list) => {
      heading.style.display = page === 0 ? '' : 'none';
      flow.innerHTML = renderToStaticMarkup(<PrintParts parts={partsOf(list)} pageSetup={pageSetup} dir={dir} />);
      return flow.scrollWidth <= flow.clientWidth + 1 && flow.scrollHeight <= flow.clientHeight + 1;
    };
    setPages(paginate(atoms, fits));
    flow.innerHTML = '';
  }, [atoms, pageSetup, dir, fontsEpoch]);

  return (
    <div style={{ position: 'relative' }}>
      <Sheet sheetRef={measureRef} pageSetup={pageSetup} dir={dir} title={title} hidden />
      {atoms.length === 0 ? (
        <Sheet pageSetup={pageSetup} dir={dir} title={title} number={1}>{empty}</Sheet>
      ) : (
        (pages ?? []).map((page, i) => (
          <Sheet key={i} pageSetup={pageSetup} dir={dir} title={i === 0 ? title : null} number={i + 1}>
            <PrintParts parts={partsOf(page)} pageSetup={pageSetup} dir={dir} testIds />
          </Sheet>
        ))
      )}
    </div>
  );
}
