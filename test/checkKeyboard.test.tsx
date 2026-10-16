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

// #737 review round 1: a drag starts on a word; the keyboard then acts on that
// word, as it does after a click — not on where the caret was before.
describe('TargetWords — the keyboard after a mouse drag (#737)', () => {
  const drag = (from: number, to: number) => {
    fireEvent.mouseDown(screen.getByTestId(`tw-${from}`), { button: 0 });
    screen.getByTestId(`tw-${from}`).focus();
    for (let i = from + 1; i <= to; i++) fireEvent.mouseEnter(screen.getByTestId(`tw-${i}`));
    fireEvent.mouseUp(document);
  };

  it('a drag selects the words it passed over, whole', () => {
    render(<Words />);
    drag(1, 3);
    expect(pressed()).toEqual([1, 2, 3]);
  });

  it('Space right after a drag toggles the word the drag started on', () => {
    render(<Words />);
    drag(1, 3);
    key(' ');
    expect(pressed()).toEqual([2, 3]);
  });

  it('Shift+Right right after a drag extends from the word the drag started on', () => {
    render(<Words />);
    drag(1, 2);
    key('Escape'); // ends nothing special; the caret stays before word 1
    key('ArrowRight', true);
    expect(pressed()).toEqual([1, 2]);
    expect(document.activeElement).toBe(screen.getByTestId('tw-2'));
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

// #769: with folding group headings, the rail stays ONE Tab stop. Up and Down
// walk the headings and the shown rows in screen order; a heading only takes
// focus, a row is selected as before.
describe('railKeyDown — group headings are roving stops (#769)', () => {
  const list = () => {
    const root = document.createElement('div');
    root.innerHTML = [
      '<button data-rail-stop data-testid="rail-group" data-group="a"></button>',
      '<button data-rail-stop data-rail-index="0"></button>',
      '<button data-rail-stop data-testid="rail-group" data-group="b"></button>',
      '<button data-rail-stop data-rail-index="2"></button>',
    ].join('');
    document.body.append(root);
    return root;
  };
  const press = (root: HTMLElement, k: string, onSelect = vi.fn()) => {
    railKeyDown([0, 2], 0, onSelect, { current: root })({ key: k, preventDefault() {} });
    return onSelect;
  };
  it('Down from a row reaches the next heading (focus only), then the row after it (selected)', () => {
    const root = list();
    (root.querySelector('[data-rail-index="0"]') as HTMLElement).focus();
    expect(press(root, 'ArrowDown')).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute('data-group')).toBe('b');
    const onSelect = press(root, 'ArrowDown');
    expect(onSelect).toHaveBeenCalledWith(2);
    expect(document.activeElement?.getAttribute('data-rail-index')).toBe('2');
    root.remove();
  });
  it('Home and End go to the first and the last stop', () => {
    const root = list();
    (root.querySelector('[data-rail-index="2"]') as HTMLElement).focus();
    press(root, 'Home');
    expect(document.activeElement?.getAttribute('data-group')).toBe('a');
    expect(press(root, 'End')).toHaveBeenCalledWith(2);
    root.remove();
  });
});
