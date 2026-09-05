// @vitest-environment jsdom
// Issue #95 — the conditional open indicator: nothing before the show
// threshold, a determinate bar on real counts after it, gone when the open
// record clears.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { OpenProgressView, SHOW_THRESHOLD_MS } from '../src/views/OpenProgress.jsx';

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
    vi.useRealTimers();
  });

  it('renders nothing while the open is younger than the threshold, then the bar', () => {
    vi.useFakeTimers();
    let now = 1_000_000;
    const clock = () => now;
    const { rerender } = render(<OpenProgressView opening={opening()} now={clock} />);
    expect(screen.queryByTestId('open-progress')).toBeNull();
    act(() => {
      now += SHOW_THRESHOLD_MS - 1;
      vi.advanceTimersByTime(SHOW_THRESHOLD_MS - 1);
    });
    expect(screen.queryByTestId('open-progress')).toBeNull();
    act(() => {
      now += 1;
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByTestId('open-progress')).toBeTruthy();
    // Determinate on real counts once the total is known.
    rerender(<OpenProgressView opening={opening({ done: 25, total: 100 })} now={clock} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(screen.getByTestId('open-progress-stage').textContent).toContain('25 of 100');
  });

  it('a fast open never mounts the indicator: the record clears before the threshold', () => {
    vi.useFakeTimers();
    let now = 2_000_000;
    const { rerender } = render(<OpenProgressView opening={opening({ startedAt: now })} now={() => now} />);
    act(() => {
      now += 120;
      vi.advanceTimersByTime(120);
    });
    rerender(<OpenProgressView opening={null} now={() => now} />);
    act(() => {
      now += 1000;
      vi.advanceTimersByTime(1000);
    });
    expect(screen.queryByTestId('open-progress')).toBeNull();
  });

  it('the two short stages show an indeterminate bar, and clearing the record removes it', () => {
    const late = () => 5_000_000;
    const { rerender } = render(<OpenProgressView opening={opening({ stage: 'state', startedAt: 1 })} now={late} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(bar.getAttribute('aria-busy')).toBe('true');
    rerender(<OpenProgressView opening={opening({ stage: 'prepare', startedAt: 1 })} now={late} />);
    expect(screen.getByTestId('open-progress').getAttribute('data-stage')).toBe('prepare');
    rerender(<OpenProgressView opening={null} now={late} />);
    expect(screen.queryByTestId('open-progress')).toBeNull();
  });
});
