// @vitest-environment jsdom
// #680 (layer 4 of epic #24, D98): the sign-in step of Share and Sync says that
// the Door43 username goes into the project and stays (R-8.5.25, R-8.5.26).
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { t } from '../src/i18n/index.js';

const actions = { closeModal: vi.fn(), submitSignIn: vi.fn(), patchSi: vi.fn() };
const state: Record<string, unknown> = {
  modal: 'signIn',
  si: { server: 'qa.door43.org', login: '', password: '', stay: false, busy: false, error: null, renew: false },
};
vi.mock('../src/state.jsx', () => ({ useApp: () => ({ s: state, actions }) }));

import ShareSignIn from '../src/views/modals/ShareSignIn.jsx';

afterEach(() => cleanup());

describe('#680 the sign-in step', () => {
  it('sign-in step names the permanent username', () => {
    render(<ShareSignIn />);
    const notice = screen.getByTestId('signin-name-notice');
    expect(screen.getByTestId('share-signin').contains(notice)).toBe(true);
    expect(notice.textContent).toBe(t('signIn.nameNotice'));
    // the English sentence names the username, the project, that it stays, and the export
    for (const word of ['Door43 username', 'project', 'stays', 'Scripture Burrito export'])
      expect(t('signIn.nameNotice'), word).toContain(word);
  });
});
