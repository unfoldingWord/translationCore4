// @vitest-environment jsdom
// #446: the design-system Select is a select-only combobox (a button opening a
// listbox in a Layer popover), replacing the native <select>.
//
// Ways this component can fail, written before the code under test ran here
// (AGENTS.md "How to test" rule 3):
// 1. The button is not a combobox named by its visible label.
// 2. The search field appears under 10 options, or is missing at 10.
// 3. The filter misses a name-contains or code-prefix match, or matches too much.
// 4. Arrow/Home/End moves skip rows or fall off the ends.
// 5. Enter chooses a disabled option, or a click does.
// 6. Enter/Esc leave the list open, or focus does not return to the field.
// 7. onChange delivers something other than { target: { value } }.
// 8. Group headers miss, or their counts do not follow the filter.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Select as DsSelect } from '../src/ds/components/forms/Select.jsx';

/* The .jsx component's `options = []` default infers as never[] under tsc;
   the test types the surface it actually uses. */
type Option = { value: string; label: string; code?: string; group?: string; disabled?: boolean; badge?: string };
type SelectProps = {
  label: string; options: (Option | string)[]; value: string;
  onChange: (e: { target: { value: string } }) => void;
  searchPlaceholder?: string; noMatchesLabel?: string;
};
const Select = DsSelect as unknown as React.FC<SelectProps>;

const FONTS = ['Noto Sans (default)', 'Charis SIL', 'Scheherazade New', 'Awami Nastaliq', 'Padauk'];

/** Ten options with codes and groups — the smallest list that shows search. */
const TEN = [
  { value: 'GEN', label: 'Genesis', code: 'GEN', group: 'Old Testament' },
  { value: 'EXO', label: 'Exodus', code: 'EXO', group: 'Old Testament' },
  { value: 'JOS', label: 'Joshua', code: 'JOS', group: 'Old Testament' },
  { value: 'JOB', label: 'Job', code: 'JOB', group: 'Old Testament' },
  { value: 'JON', label: 'Jonah', code: 'JON', group: 'Old Testament', disabled: true, badge: 'In this Bible' },
  { value: 'MAT', label: 'Matthew', code: 'MAT', group: 'New Testament' },
  { value: 'JHN', label: 'John', code: 'JHN', group: 'New Testament' },
  { value: 'TIT', label: 'Titus', code: 'TIT', group: 'New Testament' },
  { value: '1JN', label: '1 John', code: '1JN', group: 'New Testament' },
  { value: 'REV', label: 'Revelation', code: 'REV', group: 'New Testament' },
];

const box = (name = 'Book') => screen.getByRole('combobox', { name });
const open = (name = 'Book') => { fireEvent.click(box(name)); return screen.getByRole('listbox'); };
const optionNames = () => screen.getAllByRole('option').map((o) => o.textContent);

afterEach(cleanup);

describe('#446 — the design-system dropdown', () => {
  it('is a combobox named by its label, and opens a listbox with the options', () => {
    const onChange = vi.fn();
    render(<Select label="Book" options={TEN} value="GEN" onChange={onChange} />);
    expect(box().getAttribute('aria-expanded')).toBe('false');
    open();
    expect(box().getAttribute('aria-expanded')).toBe('true');
    expect(box().getAttribute('aria-controls')).toBeTruthy();
    expect(screen.getAllByRole('option')).toHaveLength(10);
    expect(screen.getByRole('option', { name: /Genesis/ }).getAttribute('aria-selected')).toBe('true');
  });

  it('shows the search field at 10 options and not at 9', async () => {
    const { unmount } = render(<Select label="Book" options={TEN} value="GEN" onChange={() => {}} searchPlaceholder="Find a book" />);
    open();
    await waitFor(() => expect(screen.getByPlaceholderText('Find a book')).toBeTruthy());
    unmount();
    cleanup();
    render(<Select label="Book" options={TEN.slice(0, 9)} value="GEN" onChange={() => {}} searchPlaceholder="Find a book" />);
    open();
    expect(screen.queryByPlaceholderText('Find a book')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(9);
  });

  it('filters by name-contains or code-prefix, counts follow, and no match says so', () => {
    render(<Select label="Book" options={TEN} value="GEN" onChange={() => {}}
      searchPlaceholder="Find a book" noMatchesLabel="Nothing matches this filter." />);
    open();
    const input = screen.getByPlaceholderText('Find a book');
    fireEvent.change(input, { target: { value: 'jo' } });
    expect(optionNames()).toEqual(['JoshuaJOS', 'JobJOB', 'JonahIn this BibleJON', 'JohnJHN', '1 John1JN']);
    const groups = screen.getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual(['Old Testament', 'New Testament']);
    expect(groups[0].textContent).toContain('Old Testament3');
    expect(groups[1].textContent).toContain('New Testament2');
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText('Nothing matches this filter.')).toBeTruthy();
  });

  it('moves with arrows, Home and End without skipping or overrunning, and Enter chooses', () => {
    const onChange = vi.fn();
    render(<Select label="Script font" options={FONTS} value={FONTS[0]} onChange={onChange} />);
    const b = box('Script font');
    fireEvent.keyDown(b, { key: 'ArrowDown' }); // opens on the selected option
    screen.getByRole('listbox');
    fireEvent.keyDown(b, { key: 'ArrowDown' }); // → Charis SIL
    fireEvent.keyDown(b, { key: 'ArrowUp' });   // → back to Noto
    fireEvent.keyDown(b, { key: 'ArrowUp' });   // top: stays
    fireEvent.keyDown(b, { key: 'End' });       // → Padauk
    fireEvent.keyDown(b, { key: 'ArrowDown' }); // end: stays
    fireEvent.keyDown(b, { key: 'Home' });      // → Noto
    fireEvent.keyDown(b, { key: 'ArrowDown' }); // → Charis SIL
    fireEvent.keyDown(b, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({ target: { value: 'Charis SIL' } });
  });

  it('jumps by typed letter in a list without search', () => {
    const onChange = vi.fn();
    render(<Select label="Script font" options={FONTS} value={FONTS[0]} onChange={onChange} />);
    const b = box('Script font');
    fireEvent.keyDown(b, { key: 'Enter' }); // opens
    fireEvent.keyDown(b, { key: 'p' });     // → Padauk
    fireEvent.keyDown(b, { key: 'Enter' });
    expect(onChange.mock.calls[0][0]).toEqual({ target: { value: 'Padauk' } });
  });

  it('never chooses a disabled option, by click or by Enter, and the list stays open', () => {
    const onChange = vi.fn();
    render(<Select label="Book" options={TEN} value="GEN" onChange={onChange}
      searchPlaceholder="Find a book" />);
    open();
    const jonah = screen.getByRole('option', { name: /Jonah/ });
    expect(jonah.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(jonah);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
    const input = screen.getByPlaceholderText('Find a book');
    fireEvent.change(input, { target: { value: 'jonah' } });
    fireEvent.keyDown(input, { key: 'Enter' }); // highlighted row is disabled Jonah
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('closes on Escape without changing the value, and focus returns to the field', async () => {
    const onChange = vi.fn();
    render(<Select label="Script font" options={FONTS} value={FONTS[0]} onChange={onChange} />);
    const b = box('Script font');
    b.focus();
    fireEvent.keyDown(b, { key: 'Enter' });
    screen.getByRole('listbox');
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(onChange).not.toHaveBeenCalled();
    await waitFor(() => expect(document.activeElement).toBe(box('Script font')));
  });

  it('choosing by click closes the list and focus returns to the field', async () => {
    const onChange = vi.fn();
    render(<Select label="Script font" options={FONTS} value={FONTS[0]} onChange={onChange} />);
    const b = box('Script font');
    b.focus();
    fireEvent.click(b);
    fireEvent.click(screen.getByRole('option', { name: 'Charis SIL' }));
    expect(onChange.mock.calls[0][0]).toEqual({ target: { value: 'Charis SIL' } });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(box('Script font')));
  });
});
