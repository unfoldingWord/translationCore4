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
// 9. A dismiss with no click after it (a right-click) eats the next keyboard click.
// 10. The list stays open when the focus leaves it, or the close pulls the focus back.
// 11. Home/End in the search field move the highlight, not the text cursor.
// 12. A closing list can still take the focus while it animates out.
// 13. The search input copies the field button's id.
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Select as DsSelect } from '../src/ds/components/forms/Select.jsx';
import { SCRIPT_FONTS } from '../src/state.jsx';

/* The .jsx component's `options = []` default infers as never[] under tsc;
   the test types the surface it actually uses. */
type Option = { value: string; label: string; code?: string; group?: string; disabled?: boolean; badge?: string };
type SelectProps = {
  label: string; options: (Option | string)[]; value: string;
  onChange: (e: { target: { value: string } }) => void;
  searchPlaceholder?: string; noMatchesLabel?: string;
};
const Select = DsSelect as unknown as React.FC<SelectProps>;

/* The app's own font catalogue (AGENTS.md: inputs come from the system). */
const FONTS: string[] = SCRIPT_FONTS;

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
    // a code that is in no name: only the code-prefix rule finds John
    fireEvent.change(input, { target: { value: 'jhn' } });
    expect(optionNames()).toEqual(['JohnJHN']);
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
    expect(onChange.mock.calls[0][0]).toEqual({ target: { value: 'Padauk — Myanmar' } });
  });

  it('never chooses a disabled option, by click or by Enter, and the list stays open', () => {
    const onChange = vi.fn();
    render(<Select label="Book" options={TEN} value="GEN" onChange={onChange}
      searchPlaceholder="Find a book" />);
    open();
    const jonah = screen.getByRole('option', { name: /Jonah/ });
    expect(jonah.getAttribute('aria-disabled')).toBe('true');
    // a press on a row keeps the focus where it is, so the list does not close
    expect(fireEvent.mouseDown(jonah)).toBe(false);
    fireEvent.click(jonah);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
    const input = screen.getByPlaceholderText('Find a book');
    fireEvent.change(input, { target: { value: 'jonah' } });
    fireEvent.keyDown(input, { key: 'Enter' }); // highlighted row is disabled Jonah
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('Enter on the search Clear button activates Clear, not the highlighted option', () => {
    const onChange = vi.fn();
    render(<Select label="Book" options={TEN} value="GEN" onChange={onChange}
      searchPlaceholder="Find a book" />);
    open();
    const input = screen.getByPlaceholderText('Find a book') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'tit' } }); // highlight: enabled Titus
    const clear = screen.getByRole('button', { name: 'Clear' });
    // the key is left to the button's own activation (keydown not cancelled) …
    expect(fireEvent.keyDown(clear, { key: 'Enter' })).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('listbox')).toBeTruthy();
    // … which, as a click, empties the filter and leaves the list open
    fireEvent.click(clear);
    expect(input.value).toBe('');
    expect(screen.getAllByRole('option')).toHaveLength(10);
    expect(onChange).not.toHaveBeenCalled();
    // Enter in the search input still chooses
    fireEvent.change(input, { target: { value: 'tit' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange.mock.calls[0][0]).toEqual({ target: { value: 'TIT' } });
  });

  it('clearing the search puts the focus back in the search field, so the keyboard keeps working', () => {
    const onChange = vi.fn();
    render(<Select label="Book" options={TEN} value="GEN" onChange={onChange}
      searchPlaceholder="Find a book" />);
    open();
    const input = screen.getByPlaceholderText('Find a book') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'tit' } });
    const clear = screen.getByRole('button', { name: 'Clear' });
    clear.focus(); // Tab from the search field
    fireEvent.click(clear);
    // Clear leaves with the empty filter; the focus must not fall to <body>
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(document.activeElement).toBe(input);
    // arrows and Enter act from where the focus is: Genesis → Exodus
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onChange.mock.calls[0][0]).toEqual({ target: { value: 'EXO' } });
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

  it('the outside click that closes the list is consumed, like the native popup ate it', async () => {
    const onChange = vi.fn();
    const outside = vi.fn();
    render(
      <div>
        <button onClick={outside}>Cancel</button>
        <Select label="Script font" options={FONTS} value={FONTS[0]} onChange={onChange} />
      </div>,
    );
    fireEvent.click(box('Script font'));
    screen.getByRole('listbox');
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    // the press that dismisses the list must not also activate what it landed on
    fireEvent.mouseDown(cancel);
    fireEvent.click(cancel);
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(outside).not.toHaveBeenCalled();
    // the next press is an ordinary click again
    fireEvent.mouseDown(cancel);
    fireEvent.click(cancel);
    expect(outside).toHaveBeenCalledTimes(1);
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
  it('a dismiss with no click after it does not eat the next keyboard click', async () => {
    const outside = vi.fn();
    render(
      <div>
        <button onClick={outside}>Create book</button>
        <Select label="Script font" options={FONTS} value={FONTS[0]} onChange={() => {}} />
      </div>,
    );
    fireEvent.click(box('Script font'));
    screen.getByRole('listbox');
    const create = screen.getByRole('button', { name: 'Create book' });
    // a held modifier repeats its keydown; that must not clear the mark of a real press
    fireEvent.mouseDown(create);
    fireEvent.keyDown(create, { key: 'Shift' });
    fireEvent.click(create);
    expect(outside).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    fireEvent.click(box('Script font'));
    screen.getByRole('listbox');
    // a right-click closes the list and sends contextmenu, not click
    fireEvent.mouseDown(create, { button: 2 });
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    // Enter on a button: keydown, then the click the browser makes from it
    fireEvent.keyDown(create, { key: 'Enter' });
    fireEvent.click(create);
    expect(outside).toHaveBeenCalledTimes(1);
  });

  it('closes when the focus leaves the field, and leaves the focus where it went', async () => {
    render(
      <div>
        <Select label="Script font" options={FONTS} value={FONTS[0]} onChange={() => {}} />
        <input aria-label="Next" />
      </div>,
    );
    const b = box('Script font');
    b.focus();
    fireEvent.keyDown(b, { key: 'Enter' });
    screen.getByRole('listbox');
    const next = screen.getByRole('textbox', { name: 'Next' });
    next.focus(); // Tab
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(next);
  });

  it('closes when the focus leaves the search field, and leaves the focus where it went', async () => {
    render(
      <div>
        <Select label="Book" options={TEN} value="GEN" onChange={() => {}} searchPlaceholder="Find a book" />
        <input aria-label="Next" />
      </div>,
    );
    open();
    const input = screen.getByPlaceholderText('Find a book');
    input.focus();
    const next = screen.getByRole('textbox', { name: 'Next' });
    next.focus(); // Tab out of the panel
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    expect(document.activeElement).toBe(next);
  });

  it('Home and End in the search field are left to the text cursor', () => {
    const onChange = vi.fn();
    render(<Select label="Book" options={TEN} value="GEN" onChange={onChange} searchPlaceholder="Find a book" />);
    open();
    const input = screen.getByPlaceholderText('Find a book');
    fireEvent.change(input, { target: { value: 'jo' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlight: Job
    // not cancelled: the browser moves the cursor
    expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'End' })).toBe(true);
    // and the highlight did not move: Enter still chooses Job
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange.mock.calls[0][0]).toEqual({ target: { value: 'JOB' } });
  });
  it('a closing list is inert while it animates out, so Tab cannot land in it', async () => {
    render(<Select label="Book" options={TEN} value="GEN" onChange={() => {}} searchPlaceholder="Find a book" />);
    open();
    const input = screen.getByPlaceholderText('Find a book');
    expect(input.closest('[inert]')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    // still drawn for the exit animation, but out of the focus order
    expect(screen.getByPlaceholderText('Find a book').closest('[inert]')).not.toBeNull();
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  });

  it('a press on the closing popover does not take the focus (double-click on a row)', () => {
    const onChange = vi.fn();
    render(<Select label="Script font" options={FONTS} value={FONTS[0]} onChange={onChange} />);
    const b = box('Script font');
    b.focus();
    fireEvent.click(b);
    const row = screen.getByRole('option', { name: 'Charis SIL' });
    // the Layer's own panel, the focusable box (tabIndex -1) around our panel
    const layerPanel = row.closest('[tabindex="-1"]') as HTMLElement;
    expect(layerPanel).not.toBeNull();
    fireEvent.mouseDown(row);
    fireEvent.click(row); // first click: chooses and closes
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(b);
    // second press, during the exit animation: our panel is inert, so the
    // press lands on the Layer's panel, which must not take the focus
    expect(fireEvent.mouseDown(layerPanel)).toBe(false);
  });

  it('the search input has its own name and does not copy the field id', () => {
    render(<Select label="Book" options={TEN} value="GEN" onChange={() => {}} searchPlaceholder="Find a book" />);
    open();
    const id = box().id;
    expect(id).toBeTruthy();
    expect(document.querySelectorAll('[id="' + id + '"]')).toHaveLength(1);
    expect(screen.getByRole('textbox', { name: 'Find a book' }).id).not.toBe(id);
  });
});
