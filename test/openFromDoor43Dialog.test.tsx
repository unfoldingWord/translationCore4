// @vitest-environment jsdom
// #677 (layer 4 of epic #24): the screens of "Open a project from Door43" — the
// fourth card of "Add a project", the dialog with its inline name error, the
// refusal callout with its code, and the D95 question. The operation and its
// refusals are proven in test/sync/openFromDoor43.test.ts. Assertions read test
// ids, codes and catalog keys.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { t } from '../src/i18n/index.js';

const actions = {
  openNewProject: vi.fn(), openNewObs: vi.fn(), openImport: vi.fn(), openDoor43Dialog: vi.fn(),
  closeModal: vi.fn(), patchOd: vi.fn(), openDoor43Run: vi.fn(), askForHelp: vi.fn(),
  turnOnInternet: vi.fn(), cancelInternet: vi.fn(), closeNetFailed: vi.fn(),
};
let state: Record<string, unknown> = {};
const od = (over: Record<string, unknown> = {}) => ({ repo: 'anna_k/titus-team-draft', name: 'titus-team-draft', named: false, busy: false, error: null, ...over });
vi.mock('../src/state.jsx', () => ({ useApp: () => ({ s: state, actions }), door43: { server: 'https://git.door43.org' } }));

import AddProject from '../src/views/modals/AddProject.jsx';
import OpenFromDoor43 from '../src/views/modals/OpenFromDoor43.jsx';
import { InternetDialog } from '../src/views/AccountMenu.jsx';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state = { modal: 'openDoor43', od: od(), projects: [{ id: '_local_/_local_/jonah' }], netAsk: null, netFailed: false };
});

describe('#677 — open a project from Door43, the screens', () => {
  it('"Add a project" has a fourth card that opens the dialog', () => {
    state.modal = 'addProject';
    render(<AddProject />);
    const card = screen.getByTestId('add-project-door43');
    expect(card.textContent).toContain(t('addProject.door43Title'));
    fireEvent.click(card);
    expect(actions.openDoor43Dialog).toHaveBeenCalledTimes(1);
  });

  it('the name follows the repository name until the user types one', () => {
    state.od = od({ repo: '', name: '' });
    render(<OpenFromDoor43 />);
    fireEvent.change(screen.getByTestId('open-door43-repo'), { target: { value: 'https://git.door43.org/anna_k/titus-team-draft' } });
    expect(actions.patchOd).toHaveBeenLastCalledWith({ repo: 'https://git.door43.org/anna_k/titus-team-draft', name: 'titus-team-draft', error: null });
    cleanup();
    state.od = od({ named: true, name: 'mine' });
    render(<OpenFromDoor43 />);
    fireEvent.change(screen.getByTestId('open-door43-repo'), { target: { value: 'anna_k/other' } });
    expect(actions.patchOd).toHaveBeenLastCalledWith({ repo: 'anna_k/other', error: null });
  });

  it('Open project runs the open; a repository on another server cannot be opened', () => {
    render(<OpenFromDoor43 />);
    const submit = screen.getByTestId('open-door43-submit') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    fireEvent.click(submit);
    expect(actions.openDoor43Run).toHaveBeenCalledTimes(1);
    cleanup();
    state.od = od({ repo: 'https://example.org/anna_k/titus-team-draft' });
    render(<OpenFromDoor43 />);
    expect((screen.getByTestId('open-door43-submit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a name in use is an inline error under the project name, and Open project is off', () => {
    state.od = od({ name: 'jonah' });
    render(<OpenFromDoor43 />);
    expect(screen.getByTestId('open-door43-name-field').textContent).toContain(t('openDoor43.nameInUse', { name: 'jonah' }));
    expect((screen.getByTestId('open-door43-submit') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('open-door43-refused')).toBeNull();
    // the same, when the operation refused with the name code
    cleanup();
    state.od = od({ error: { code: 'open-door43.name-exists', reason: null } });
    render(<OpenFromDoor43 />);
    expect(screen.getByTestId('open-door43-name-field').textContent).toContain(t('openDoor43.nameInUse', { name: 'titus-team-draft' }));
    expect(screen.queryByTestId('open-door43-refused')).toBeNull();
  });

  it('[G2] a refusal shows its code, "Nothing was written", and Ask for help', () => {
    state.od = od({ error: { code: 'sync.incoming-invalid', reason: '1 journal file(s) on Door43 fail the validator' } });
    render(<OpenFromDoor43 />);
    const callout = screen.getByTestId('open-door43-refused');
    expect(callout.getAttribute('data-code')).toBe('sync.incoming-invalid');
    expect(callout.textContent).toContain(t('openDoor43.refused.invalid'));
    expect(callout.textContent).toContain(t('openDoor43.nothingWritten'));
    fireEvent.click(screen.getByTestId('open-door43-help'));
    expect(actions.askForHelp).toHaveBeenCalledWith(expect.objectContaining({ code: 'sync.incoming-invalid' }));
  });

  it('open asks for the internet: the question names the open', () => {
    state = { netAsk: { kind: 'open' }, netFailed: false };
    render(<InternetDialog />);
    expect(screen.getByTestId('net-ask').getAttribute('data-kind')).toBe('open');
    expect(screen.getByTestId('net-ask-reason').textContent).toBe(t('net.ask.step', { what: t('net.ask.open') }));
    fireEvent.click(screen.getByTestId('net-cancel'));
    expect(actions.cancelInternet).toHaveBeenCalledTimes(1);
  });
});
