// Book rail — the project's books with nested chapter grid, shared by the
// Understand and Translate screens (epic #104; extracted from Draft.jsx).
// Design updates (owner, 2026-07-31): the chapter grid nests under the ACTIVE
// book row, and the active book and its grid share ONE tinted group.
import React from 'react';
import { useApp } from '../state.jsx';
import { bookName } from '../data/bookNames';
import { t } from '../i18n';
import { BookTile } from '../ds/index.js';
import { RailGroup, RailNumberButton, RailNumbers, RailShell } from './railChrome.jsx';

export default function BookRail() {
  const { s, book, actions } = useApp();
  if (!book) return null;
  return (
    <RailShell title={`${t('draft.books')} · ${(s.project?.bookCodes || []).length}`}>
      {(s.project?.bookCodes || []).map((code) => {
        const active = code === book.code;
        // Every row shows its draft bar: the active book live, the rest
        // from the Home progress cache when it has been loaded.
        const pct = active ? book.draftPct : s.progressByProject[s.project.id]?.[code];
        return (
          <RailGroup key={code} active={active}>
            <BookTile layout="row" active={active} name={bookName(code)}
              percent={pct ?? 0} meta={pct != null ? `${pct}%` : ''}
              onClick={() => actions.openBook(code)} />
            {active && (
              <RailNumbers>
                {book.chapterNums.map((c) => (
                  <RailNumberButton key={c} selected={c === s.chapter} onClick={() => actions.setChapter(c)}>{c}</RailNumberButton>
                ))}
              </RailNumbers>
            )}
          </RailGroup>
        );
      })}
    </RailShell>
  );
}
