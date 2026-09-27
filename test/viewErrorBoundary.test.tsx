// @vitest-environment jsdom
// #435: a render error in a project view must not leave a blank window. React
// unmounts the whole tree on an uncaught render error, so the person sees only
// the menu bar. The ways this can fail, each one a case below:
//   1. A view throws while it renders: nothing is shown (the blank window).
//   2. The message shows, but it gives no way out of the broken view.
//   3. The way out does not leave the project (it must be backToProjects,
//      which refuses while unsaved work stands, FR-32).
//   4. The error covers the top bar too: the save indicator and its Retry
//      are lost while the view is broken.
//   5. After the person goes Home, the error stays and Home does not render.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const backToProjects = vi.fn();
let state: Record<string, unknown> = {};

vi.mock('../src/state.jsx', () => ({
  useApp: () => ({ s: state, actions: { backToProjects, go: vi.fn() } }),
}));
// The project view that breaks: it throws while it renders.
vi.mock('../src/views/Draft.jsx', () => ({
  default: () => {
    throw new Error('Cannot read properties of undefined (reading \'chapters\')');
  },
}));
vi.mock('../src/views/Home.jsx', () => ({ default: () => <div data-testid="home-view" /> }));
const { none } = vi.hoisted(() => ({ none: () => ({ default: () => null }) }));
vi.mock('../src/views/StoryDraft.jsx', none);
vi.mock('../src/views/StoryUnderstand.jsx', none);
vi.mock('../src/views/Check.jsx', none);
vi.mock('../src/views/CommunityChecking.jsx', none);
vi.mock('../src/views/Understand.jsx', none);
vi.mock('../src/views/OpenProgress.jsx', none);
vi.mock('../src/views/dev/Inspector.jsx', none);
vi.mock('../src/views/modals/NewBible.jsx', none);
vi.mock('../src/views/modals/NewObs.jsx', none);
vi.mock('../src/views/modals/AddBook.jsx', none);
vi.mock('../src/views/modals/Import.jsx', none);
vi.mock('../src/views/modals/ProjectSettings.jsx', none);
vi.mock('../src/views/modals/SourceTexts.jsx', none);
vi.mock('../src/views/modals/GatewayChange.jsx', none);
vi.mock('../src/views/modals/UpgradeSet.jsx', none);
vi.mock('../src/views/modals/GuidedFix.jsx', none);

const { default: App } = await import('../src/App.jsx');

const project = { id: '_local_/_local_/cfm_fbt', repoPath: '_local_/_local_/cfm_fbt', name: 'cfm fbt', languageTag: 'cfm', scriptDirection: 'ltr' };

afterEach(() => {
  cleanup();
  backToProjects.mockClear();
  vi.restoreAllMocks();
});

describe('#435: a render error in the project view', () => {
  it('shows a message and a Home button, not a blank window; the top bar and its save indicator stay', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}); // React reports the caught error
    state = { view: 'draft', project, saveState: 'saved' };
    render(<App />);
    const alert = screen.getByTestId('view-error');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('This screen could not be shown.');
    expect(alert.textContent).toContain('reading \'chapters\'');
    expect(screen.getByRole('button', { name: 'Back to Home' })).toBeTruthy();
    expect(screen.getByTestId('save-indicator')).toBeTruthy();
  });

  it('the Home button leaves the project through backToProjects, and Home then renders', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    state = { view: 'draft', project, saveState: 'saved' };
    const { rerender } = render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to Home' }));
    expect(backToProjects).toHaveBeenCalledTimes(1);
    // backToProjects sets the view to Home (state.jsx); the error must not stay.
    state = { view: 'home', project: null, saveState: 'saved' };
    rerender(<App />);
    expect(screen.getByTestId('home-view')).toBeTruthy();
    expect(screen.queryByTestId('view-error')).toBeNull();
  });
});
