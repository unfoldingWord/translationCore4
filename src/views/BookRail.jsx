// Book rail — the project's books with nested chapter grid, shared by the
// Understand and Translate screens (epic #104; extracted from Draft.jsx).
// Design updates (owner, 2026-07-31): the chapter grid nests under the ACTIVE
// book row, and the active book and its grid share ONE tinted group.
import React from 'react';
import { useApp } from '../state.jsx';
import { bookName } from '../data/bookNames';
import { t } from '../i18n';
import { BookTile, Overline } from '../ds/index.js';

export default function BookRail() {
  const { s, book, actions } = useApp();
  if (!book) return null;
  return (
    <aside style={{ width: 'var(--rail-width)', flex: 'none', background: 'var(--surface-panel)', borderInlineEnd: 'var(--stroke-hair) solid var(--border-hair)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '16px 16px 10px' }}>
        <Overline>{t('draft.books')} · {(s.project?.bookCodes || []).length}</Overline>
      </div>
      <div style={{ padding: '0 10px 14px', display: 'flex', flexDirection: 'column', gap: 4, overflow: 'auto', flex: 1, minHeight: 0 }}>
        {(s.project?.bookCodes || []).map((code) => {
          const active = code === book.code;
          // Every row shows its draft bar: the active book live, the rest
          // from the Home progress cache when it has been loaded.
          const pct = active ? book.draftPct : s.progressByProject[s.project.id]?.[code];
          return (
            <div key={code} style={{ borderRadius: 'var(--radius-md)', background: active ? 'var(--surface-accent-soft)' : 'transparent' }}>
              <BookTile layout="row" active={active} name={bookName(code)}
                percent={pct ?? 0} meta={pct != null ? `${pct}%` : ''}
                onClick={() => actions.openBook(code)} />
              {active && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6, padding: '2px 12px 12px' }}>
                  {book.chapterNums.map((c) => {
                    const sel = c === s.chapter;
                    return (
                      <button key={c} onClick={() => actions.setChapter(c)} type="button" data-tc={sel ? undefined : 'surface'}
                        style={{ cursor: 'pointer', fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', height: 32, borderRadius: 'var(--radius-sm)', borderWidth: 'var(--stroke)', borderStyle: 'solid',
                          ...(sel ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' }
                            : { background: '#fff', color: 'var(--text-tertiary)', borderColor: 'var(--border)' }) }}>{c}</button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
