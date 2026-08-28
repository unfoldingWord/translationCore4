// Plain display text for one source verse (verseObjects from usfm-js —
// aligned USFM collapses to its text/word content; display only, never
// re-serialized). ONE flattener for every view (2026-08-27 review).
export const verseText = (vObj) => {
  const walk = (vos) =>
    (vos || [])
      .map((vo) => {
        if (vo.type === 'footnote' || vo.tag === 'f') return '';
        if (vo.text != null && vo.type !== 'section') return vo.text;
        if (vo.children) return walk(vo.children);
        return '';
      })
      .join('');
  return walk(vObj?.verseObjects).replace(/\s+/g, ' ').trim();
};
