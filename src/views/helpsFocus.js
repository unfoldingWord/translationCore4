// Pure helpers for helps panel focus filtering (#239).
import { keyCarries } from './SourceVerse.jsx';

/**
 * Does this help reference fall within the focused verses?
 * When focusVerses is null, every reference is in focus.
 * The introduction card (verse === 'intro') is in focus when verse 1 is in focus.
 */
export function inFocus(reference, focusVerses) {
  if (focusVerses == null) return true;
  if (!reference || reference.verse == null) return false;
  if (reference.verse === 'intro') {
    return focusVerses.some((k) => keyCarries(k, 1));
  }
  return focusVerses.some((k) => keyCarries(k, reference.verse));
}

/**
 * The focused verse keys for the Translate view.
 * When editing is open for the current chapter, returns section keys or [verse].
 * Returns null when no editor is open or the editor belongs to another chapter.
 */
export function editingFocus(editing, chapter) {
  if (!editing?.key) return null;
  const [c, ...rest] = String(editing.key).split(':');
  if (Number(c) !== Number(chapter)) return null;
  if (editing.keys) return editing.keys;
  const verse = rest.join(':');
  return verse ? [verse] : null;
}
