// @vitest-environment jsdom
// #42 review round 1 (PR #571): the keyboard handlers of the Check view.
// Frank P2: Tab ends a Shift+arrow run, and the words selected before stay
// selected (owner decision point 2). George #1: with the active item hidden by
// a filter, Up or Down selects the focused first row (criterion 3, Switcher).
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TargetWords, railKeyDown } from '../src/views/Check.jsx';

afterEach(cleanup);

function Words() {
  const [sel, setSel] = React.useState<Set<number>>(new Set());
  const toggle = (i: number) =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  return (
    <>
      <TargetWords
        words={['a', 'b', 'c', 'd']}
        sel={sel}
        setSelection={setSel}
        toggleWord={toggle}
        direction="ltr"
      />
      <button type="button">elsewhere</button>
    </>
  );
}
const pressed = () =>
  [0, 1, 2, 3].filter((i) => screen.getByTestId(`tw-${i}`).getAttribute('aria-pressed') === 'true');
const key = (k: string, shiftKey = false) =>
  fireEvent.keyDown(document.activeElement as Element, { key: k, shiftKey });

describe('TargetWords — a Shift+arrow run ends on any other key or on blur', () => {
  it('Tab away and back: Shift+Left starts a new run and keeps both words', () => {
    render(<Words />);
    screen.getByTestId('tw-0').focus();
    key('ArrowRight', true);
    key('ArrowRight', true);
    expect(pressed()).toEqual([0, 1]);
    key('Tab'); // the keydown alone ends the run (focus is not moved here)
    key('Shift', true); // a bare modifier does not
    key('ArrowLeft', true);
    expect(pressed()).toEqual([0, 1]);
  });

  it('a blur that leaves the line ends the run too', () => {
    render(<Words />);
    screen.getByTestId('tw-0').focus();
    key('ArrowRight', true);
    key('ArrowRight', true);
    screen.getByText('elsewhere').focus();
    screen.getByTestId('tw-2').focus();
    key('ArrowLeft', true);
    expect(pressed()).toEqual([0, 1]);
  });

  it('one unbroken run still shrinks (control)', () => {
    render(<Words />);
    screen.getByTestId('tw-0').focus();
    key('ArrowRight', true);
    key('ArrowRight', true);
    key('ArrowLeft', true);
    expect(pressed()).toEqual([0]);
  });
});

describe('railKeyDown — the Switcher roving pattern', () => {
  const run = (k: string, current: number, order = [3, 5, 7]) => {
    const onSelect = vi.fn();
    railKeyDown(order, current, onSelect, { current: null })({ key: k, preventDefault() {} });
    return onSelect.mock.calls[0]?.[0];
  };
  it('the active item hidden by a filter: Down and Up select the focused first row', () => {
    expect(run('ArrowDown', 9)).toBe(3);
    expect(run('ArrowUp', 9)).toBe(3);
  });
  it('the active item shown: Down and Up step and wrap; Home and End jump', () => {
    expect(run('ArrowDown', 5)).toBe(7);
    expect(run('ArrowDown', 7)).toBe(3);
    expect(run('ArrowUp', 3)).toBe(7);
    expect(run('Home', 9)).toBe(3);
    expect(run('End', 9)).toBe(7);
  });
});
