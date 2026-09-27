// @vitest-environment jsdom
// #382 (D80): the export menu says "Saved" only after the desktop app reports a
// completed download. A cancelled save shows no message; an interrupted one
// shows a warning; a browser (no desktop report) shows only "Export ready".
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const FILE = 'TIT-2026-09-26.usfm';
const actions = { exportFile: vi.fn(async () => ({ ok: true, facts: { producer: 'usfm-plain', filename: FILE, bytes: 10 } })) };
const state = { project: { id: '_local_/_local_/titus', flavor: 'textTranslation' } };
vi.mock('../src/state.jsx', () => ({ useApp: () => ({ s: state, actions }) }));
vi.mock('../src/data/export/producers', () => ({ PRODUCERS: [{ id: 'usfm-plain', label: 'USFM, plain', appliesTo: () => true }] }));

import ExportMenu from '../src/views/ExportMenu.jsx';

type Result = { filename: string; state: 'completed' | 'cancelled' | 'interrupted' };
const w = window as unknown as { tc4Desktop?: { onDownloadDone: (listener: (result: Result) => void) => () => void } };

/** A fake of the preload channel: the test plays the main process's report. */
function fakeChannel() {
  const listeners = new Set<(result: Result) => void>();
  w.tc4Desktop = {
    onDownloadDone: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { listeners, report: (result: Result) => act(() => listeners.forEach((listener) => listener(result))) };
}

async function exportOnce() {
  fireEvent.click(screen.getByTestId('export-menu-trigger'));
  await act(async () => fireEvent.click(screen.getByRole('menuitem', { name: 'USFM, plain' })));
  expect(actions.exportFile).toHaveBeenCalledTimes(1);
}

const toast = () => screen.queryByTestId('export-toast')?.textContent ?? null;

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  delete w.tc4Desktop;
});

describe('#382 — the export menu reports the download result', () => {
  it('desktop: says nothing until the report, then "Saved <filename>" after completed', async () => {
    const channel = fakeChannel();
    render(<ExportMenu pageSetup={{}} />);
    await exportOnce();
    expect(toast()).toBeNull(); // the save dialog is still open: no claim yet
    channel.report({ filename: FILE, state: 'completed' });
    expect(toast()).toContain(`Saved ${FILE}`);
  });

  it('desktop: a cancelled save shows no success message', async () => {
    const channel = fakeChannel();
    render(<ExportMenu pageSetup={{}} />);
    await exportOnce();
    channel.report({ filename: FILE, state: 'cancelled' });
    expect(toast()).toBeNull();
    expect(document.body.textContent).not.toContain('Saved');
  });

  it('desktop: an interrupted download shows a warning with the file name', async () => {
    const channel = fakeChannel();
    render(<ExportMenu pageSetup={{}} />);
    await exportOnce();
    channel.report({ filename: FILE, state: 'interrupted' });
    expect(toast()).toContain(FILE);
    expect(toast()).not.toContain('Saved');
    expect(screen.getByTestId('export-toast').querySelector('[role="status"]')).not.toBeNull();
  });

  it('desktop: the menu removes its listener when it closes', () => {
    const channel = fakeChannel();
    const { unmount } = render(<ExportMenu pageSetup={{}} />);
    expect(channel.listeners.size).toBe(1);
    unmount();
    expect(channel.listeners.size).toBe(0);
  });

  it('browser: no desktop report, so "Export ready: <filename>" and never "Saved"', async () => {
    render(<ExportMenu pageSetup={{}} />);
    await exportOnce();
    expect(toast()).toContain(`Export ready: ${FILE}`);
    expect(document.body.textContent).not.toContain('Saved');
  });
});
