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

// #769: the fold headings keep the rail ONE Tab stop and take nothing from the
// rows' keys (review S2): on a row, Up/Down/Home/End select item to item as
// before; Left (Right in a right-to-left rail) moves focus to the row's group
// heading, the tree pattern. On a heading, Up/Down go to the stop before or
// after it in screen order.
describe('railKeyDown — group headings beside the rows (#769)', () => {
  const list = (dir = 'ltr') => {
    const root = document.createElement('div');
    root.dir = dir;
    root.innerHTML = [
      '<div><button data-rail-stop data-testid="rail-group" data-group="a"></button>',
      '<div data-testid="rail-group-rows" data-group="a"><button data-rail-stop data-rail-index="0"></button></div></div>',
      '<div><button data-rail-stop data-testid="rail-group" data-group="b"></button>',
      '<div data-testid="rail-group-rows" data-group="b"><button data-rail-stop data-rail-index="2"></button></div></div>',
    ].join('');
    document.body.append(root);
    return root;
  };
  const press = (root: HTMLElement, k: string, current = 0) => {
    const onSelect = vi.fn();
    railKeyDown([0, 2], current, onSelect, { current: root })({ key: k, preventDefault() {} });
    return onSelect;
  };
  const focus = (root: HTMLElement, sel: string) => (root.querySelector(sel) as HTMLElement).focus();

  it('on a row, Down and Home select item to item, as without headings', () => {
    const root = list();
    focus(root, '[data-rail-index="0"]');
    expect(press(root, 'ArrowDown')).toHaveBeenCalledWith(2);
    expect(document.activeElement?.getAttribute('data-rail-index')).toBe('2');
    expect(press(root, 'Home', 2)).toHaveBeenCalledWith(0);
    root.remove();
  });
  it("Left on a row focuses its group's heading and selects nothing; Right in a right-to-left rail", () => {
    const root = list();
    focus(root, '[data-rail-index="2"]');
    expect(press(root, 'ArrowLeft', 2)).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute('data-group')).toBe('b');
    root.remove();
    const rtl = list('rtl');
    focus(rtl, '[data-rail-index="2"]');
    press(rtl, 'ArrowRight', 2);
    expect(document.activeElement?.getAttribute('data-group')).toBe('b');
    rtl.remove();
  });
  it('on a heading, Down selects the row after it and Up goes to the stop before it', () => {
    const root = list();
    focus(root, '[data-testid="rail-group"][data-group="b"]');
    expect(press(root, 'ArrowDown')).toHaveBeenCalledWith(2);
    focus(root, '[data-testid="rail-group"][data-group="b"]');
    expect(press(root, 'ArrowUp')).toHaveBeenCalledWith(0);
    root.remove();
  });
});
