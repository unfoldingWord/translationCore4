// @vitest-environment jsdom
// The Translate exits are off while an editing card is open (see
// sectionDraftExits.test.tsx). backToProjects is also reached from the
// view's error screen ("Back to Home", #435). It must clear `editing`: a stale
// value would hold the mode tabs and the project button off in the next
// project, and an OBS project never opens a book, so nothing else clears it.
// This test uses the real AppProvider and its real actions.
import React from 'react';
import { expect, it } from 'vitest';
import { act, render } from '@testing-library/react';
import { AppProvider, useApp } from '../src/state.jsx';

it('backToProjects closes the editing card, so no exit stays off after it', async () => {
  type Api = { s: { view: string; editing: unknown }; actions: { startSection: (c: number, k: string[]) => void; backToProjects: () => Promise<void> } };
  const box: { api?: Api } = {};
  function Grab() { box.api = useApp() as unknown as Api; return null; }
  render(<AppProvider><Grab /></AppProvider>);
  await act(async () => { box.api!.actions.startSection(1, ['1', '2']); });
  expect(box.api!.s.editing).toEqual({ key: '1:s1', keys: ['1', '2'] });
  await act(async () => { await box.api!.actions.backToProjects(); });
  expect(box.api!.s.view).toBe('home');
  expect(box.api!.s.editing).toBeNull();
});
