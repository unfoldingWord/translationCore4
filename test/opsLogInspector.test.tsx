// @vitest-environment jsdom
// The dev Inspector (issue #374): the last Report and the ops log; hidden in a
// packaged build unless VITE_TC4_INSPECTOR is set.
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { InspectorPanel, inspectorEnabled } from '../src/views/dev/Inspector.jsx';
import { failedReport, okReport, Refusal } from '../src/data/journal/runtime';

const at = (s: number) => new Date(Date.UTC(2026, 8, 27, 9, 0, s)).toISOString();
const imported = failedReport('import', at(0), at(3), new Refusal('import.write-failed', 'x; the partly written project was removed'), { parser: 'usfm', repoPath: '_local_/_local_/kanuri', rolledBack: true });
const opened = okReport('open', at(4), at(5), { classification: 'converged' });

describe('#374 the dev Inspector', () => {
  afterEach(() => cleanup());

  it('shows in a dev build, and in a packaged build only with the flag', () => {
    expect(inspectorEnabled({ DEV: true })).toBe(true);
    expect(inspectorEnabled({ DEV: false })).toBe(false);
    expect(inspectorEnabled({ DEV: false, VITE_TC4_INSPECTOR: '1' })).toBe(true);
  });

  it('renders the last Report and the ops log, newest first, with an open record and a rollback', () => {
    const ops = {
      entries: [
        { id: 'a', op: 'import', startedAt: at(0), facts: { parser: 'usfm', repoPath: '_local_/_local_/kanuri' }, report: imported },
        { id: 'b', op: 'open', startedAt: at(4), facts: { repoPath: '_local_/_local_/prueba' }, report: opened },
        { id: 'c', op: 'checkpoint', startedAt: at(6), facts: { repoPath: '_local_/_local_/prueba' } },
      ],
      errors: [{ id: 'c', op: 'checkpoint', error: 'client-settings write refused' }],
    };
    render(<InspectorPanel ops={ops} />);
    expect(JSON.parse(screen.getByTestId('dev-inspector-report').textContent ?? '')).toEqual(opened);
    const rows = within(screen.getByTestId('dev-inspector-log')).getAllByRole('row');
    expect(rows.map((r) => [r.getAttribute('data-op'), r.getAttribute('data-state')])).toEqual([['checkpoint', 'open'], ['open', 'ok'], ['import', 'failed']]);
    expect(rows[2].textContent).toContain('import.write-failed');
    expect(rows[2].textContent).toContain('rolled back');
    expect(screen.getByTestId('dev-inspector-errors').textContent).toContain('The checkpoint record was not saved: client-settings write refused');
  });
});
