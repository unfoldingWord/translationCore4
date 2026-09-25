// @vitest-environment jsdom
// Issue #95 — the open indicator keeps keyboard focus on its dialog.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OpenProgressView } from '../src/views/OpenProgress.jsx';

const opening = (patch: Partial<{ stage: string; done: number; total: number; startedAt: number }> = {}) => ({
  repoPath: '_local_/_local_/lento',
  stage: 'journal',
  done: 0,
  total: 0,
  startedAt: 1_000_000,
  ...patch,
});

describe('#95: OpenProgressView', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps keyboard focus on the dialog: it is focused, and a Tab there is swallowed', () => {
    const late = () => 5_000_000;
    render(<OpenProgressView opening={opening({ done: 10, total: 100, startedAt: 1 })} now={late} />);
    const dialog = screen.getByRole('dialog');
    expect(document.activeElement).toBe(dialog);
    const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    dialog.dispatchEvent(tab);
    expect(tab.defaultPrevented).toBe(true);
  });
});
