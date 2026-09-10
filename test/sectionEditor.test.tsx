// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';

vi.mock('../src/state.jsx', () => ({
  useApp: () => ({
    actions: {
      saveSection: vi.fn(),
      blurVerse: vi.fn(),
    },
  }),
}));

import { SectionEditor } from '../src/views/SectionEditor.jsx';

beforeEach(() => {
  cleanup();
});

describe('#54 — SectionEditor Type mode Tab indent', () => {
  it('proves Tab adds a tab and keeps focus, a second gives two, a third nothing, Shift+Tab removes one', () => {
    render(
      <SectionEditor
        chapter={2}
        keys={['9', '10']}
        verses={[
          { n: '9', drafted: true, body: 'a' },
          { n: '10', drafted: true, body: 'b' },
        ]}
        span="9–10"
        dir="ltr"
        editType={{}}
      />,
    );

    const textarea = screen.getByRole('textbox', { name: /Section 9–10/i }) as HTMLTextAreaElement;
    expect(textarea).toBeDefined();
    expect(textarea.value).toBe('9 a\n10 b');

    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    // Position caret at the start of verse 10's line (index 4)
    textarea.setSelectionRange(4, 4);

    // 1. Tab adds one tab and keeps focus (default prevented)
    expect(fireEvent.keyDown(textarea, { key: 'Tab' })).toBe(false);
    expect(textarea.value).toBe('9 a\n\t10 b');

    // 2. A second Tab gives two tabs
    expect(fireEvent.keyDown(textarea, { key: 'Tab' })).toBe(false);
    expect(textarea.value).toBe('9 a\n\t\t10 b');

    // 3. A third Tab does nothing (max two tabs)
    expect(fireEvent.keyDown(textarea, { key: 'Tab' })).toBe(false);
    expect(textarea.value).toBe('9 a\n\t\t10 b');

    // 4. Shift+Tab removes one tab
    expect(fireEvent.keyDown(textarea, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(textarea.value).toBe('9 a\n\t10 b');
  });
});

describe('#241 — A held verse marker no longer selects the text it passes over', () => {
  it('prevents default on pointer down and disables user selection while a marker is held', () => {
    render(
      <SectionEditor
        chapter={2}
        keys={['9', '10']}
        verses={[
          { n: '9', drafted: true, body: 'a' },
          { n: '10', drafted: true, body: 'b' },
        ]}
        span="9–10"
        dir="ltr"
        editType={{}}
      />,
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Place verse numbers' }));

    expect(fireEvent.pointerDown(screen.getByTestId('pin-10'))).toBe(false);
    expect(screen.getByTestId('place-words').style.userSelect).toBe('none');

    fireEvent.keyDown(screen.getByText('a'), { key: 'Escape' });
    expect(screen.getByTestId('place-words').style.userSelect).toBe('');
  });
});
