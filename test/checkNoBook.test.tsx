// @vitest-environment jsdom
// #583: the tabs show while a project opens, before openBook sets s.book. A
// click on Check in that gap rendered Check with no book, and bookName(null)
// threw ("Cannot read properties of null (reading 'toUpperCase')").
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';

const runPreflight = vi.fn();
const state = { project: { flavor: 'textTranslation' }, book: null, bookRaw: null, preflight: null, checkTool: null, aligning: false };
vi.mock('../src/state.jsx', () => ({ useApp: () => ({ s: state, actions: { runPreflight, loadPickerProgress: vi.fn() } }) }));

const { default: Check } = await import('../src/views/Check.jsx');

afterEach(cleanup);

describe('Check before the book loads (#583)', () => {
  it('renders nothing and does not throw', () => {
    const { container } = render(<Check />);
    expect(container.innerHTML).toBe('');
    expect(runPreflight).toHaveBeenCalled();
  });
});
