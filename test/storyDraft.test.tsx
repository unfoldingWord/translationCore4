// @vitest-environment jsdom
// The OBS Translate surface (#289) in Bible Translate's chrome (#307, the
// owner's parity checklist): the header row with the rail and helps icons,
// the two-column grid (gateway left, target right) per unit in file order, one
// gateway chip where the Bible source tabs sit, the dashed "Draft frame N" pill
// that opens an editing card, and the helps pane scoped to the unit in focus.
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const actions = {
  stageStoryUnit: vi.fn(),
  blurStoryUnit: vi.fn(async () => {}),
  openStory: vi.fn(),
  openSources: vi.fn(),
  toggleRail: vi.fn(),
  toggleHelps: vi.fn(),
  loadUnderstand: vi.fn(),
  loadHelpArticle: vi.fn(),
  closeHelpArticle: vi.fn(),
  setStoryFrame: vi.fn(),
  setHelpsTab: vi.fn((tab: string) => { state.helpsTab = tab; }),
  hoverHelp: vi.fn(),
  focusHelp: vi.fn(),
};
const SOURCE_STORY = { number: 1, title: 'Creation', ref: 'Genesis 1', frames: [{ image: '![x](obs-01.jpg)', text: 'In the beginning.' }, { image: '![x](obs-02.jpg)', text: 'Then God said.' }] };
const state = {
  rail: true,
  helps: true,
  storyNumbers: [1, 2],
  storyNumber: 1,
  storyLoading: false,
  storyError: null,
  storySource: null as null | { kind: 'no-pin' } | { kind: 'not-installed'; pin: { repoPath: string; sha: string } } | { kind: 'mismatch'; message: string } | { kind: 'error'; message: string },
  storyImageNote: null as null | { wanted: number; packs: Array<Record<string, unknown>> },
  story: { number: 1, title: 'La creación', ref: 'Génesis 1', frames: [{ image: '![x](obs-01.jpg)', text: 'Al principio.' }, { image: '![x](obs-02.jpg)', text: '' }] },
  sourceStory: SOURCE_STORY as typeof SOURCE_STORY | null,
  storyImages: { '1': { source: 'default', uri: 'local://obs-01.jpg' } } as Record<string, { source: string; uri: string }>,
  project: { flavor: 'textStories', scriptDirection: 'ltr', name: 'Historias', languageTag: 'es' } as Record<string, unknown>,
  progressByProject: {} as Record<string, unknown>,
  projectPins: { schemaVersion: 2, languageSets: { primary: { obs: { repoPath: 'git.door43.org/unfoldingWord/en_obs', version: 'v9', sha: 'd39a1dc7a7557ac54e4a8fecc3462147fe7eec3b', flavor: 'gloss/textStories' } }, fallback: {} } } as unknown,
  understand: null as null | Record<string, unknown>,
  storyFrame: null as number | null,
  helpsTab: 'notes',
  helpsActive: null,
  sources: {},
  sourceTab: 'ult',
};

vi.mock('../src/state.jsx', () => ({ useApp: () => ({ s: state, actions }) }));

import StoryDraft from '../src/views/StoryDraft.jsx';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.story = { number: 1, title: 'La creación', ref: 'Génesis 1', frames: [{ image: '![x](obs-01.jpg)', text: 'Al principio.' }, { image: '![x](obs-02.jpg)', text: '' }] };
  state.sourceStory = SOURCE_STORY;
  state.storySource = null;
  state.storyImageNote = null;
  state.helps = true;
  state.project = { flavor: 'textStories', scriptDirection: 'ltr', name: 'Historias', languageTag: 'es' };
});

describe('OBS story draft surface', () => {
  it('renders the gateway frame and its picture in the source cell, the drafted text in the target cell, and the pill for an undrafted frame', () => {
    render(<StoryDraft />);
    expect(screen.getByTestId('story-draft')).toBeTruthy();
    const frame1 = screen.getByTestId('story-frame-1');
    expect(within(frame1).getByText('In the beginning.')).toBeTruthy();
    expect(within(frame1).getByRole('img', { name: 'Story frame 1' })).toBeTruthy();
    expect(within(frame1).getByText('Al principio.')).toBeTruthy();
    expect(within(frame1).queryByRole('textbox')).toBeNull();
    const frame2 = screen.getByTestId('story-frame-2');
    expect(within(frame2).getByRole('button', { name: 'Draft frame 2' })).toBeTruthy();
    expect(within(frame2).queryByRole('img')).toBeNull();
  });

  it('the pill opens the editing card; typing stages the unit; blur flushes it and closes the card', async () => {
    render(<StoryDraft />);
    fireEvent.click(screen.getByRole('button', { name: 'Draft frame 2' }));
    const box = screen.getByRole('textbox', { name: 'Frame 2' });
    expect(screen.getByTestId('story-unit-editor')).toBeTruthy();
    fireEvent.change(box, { target: { value: 'Una nueva frase.' } });
    expect(actions.stageStoryUnit).toHaveBeenCalledWith({ kind: 'frame', story: 1, frame: 2 }, 'Una nueva frase.');
    fireEvent.blur(box);
    expect(actions.blurStoryUnit).toHaveBeenCalledWith({ kind: 'frame', story: 1, frame: 2 });
    await waitFor(() => expect(screen.queryByTestId('story-unit-editor')).toBeNull());
  });

  it('a drafted unit opens its editor on click; Cancel stages the text the card opened with, so the scheduler compares clean', () => {
    render(<StoryDraft />);
    fireEvent.click(within(screen.getByTestId('story-frame-1')).getByText('Al principio.'));
    const box = screen.getByRole('textbox', { name: 'Frame 1' }) as HTMLTextAreaElement;
    expect(box.value).toBe('Al principio.');
    fireEvent.change(box, { target: { value: 'Otra cosa.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(actions.stageStoryUnit).toHaveBeenLastCalledWith({ kind: 'frame', story: 1, frame: 1 }, 'Al principio.');
    expect(actions.blurStoryUnit).toHaveBeenCalledWith({ kind: 'frame', story: 1, frame: 1 });
    expect(screen.queryByTestId('story-unit-editor')).toBeNull();
  });

  it('a drafted unit is reachable from the keyboard: Enter on its text opens the editor', () => {
    render(<StoryDraft />);
    const text = within(screen.getByTestId('story-frame-1')).getByTestId('story-unit-text');
    expect(text.getAttribute('tabindex')).toBe('0');
    expect(text.getAttribute('role')).toBe('button');
    expect(screen.getByRole('button', { name: 'Al principio.' })).toBe(text); // the draft itself is the accessible name
    fireEvent.keyDown(text, { key: 'Enter' });
    expect(screen.getByRole('textbox', { name: 'Frame 1' })).toBeTruthy();
  });

  it('a whitespace-only paragraph is undrafted for the cell as for the rail marker: the pill shows', () => {
    state.story = { ...state.story, frames: [state.story.frames[0], { image: '![x](obs-02.jpg)', text: '   ' }] };
    render(<StoryDraft />);
    expect(within(screen.getByTestId('story-frame-2')).getByRole('button', { name: 'Draft frame 2' })).toBeTruthy();
    expect(screen.getByTestId('frame-marker-2').getAttribute('data-drafted')).toBe('false');
  });

  it('the header row carries the rail and helps icon toggles and the story title; the source chip and the project name sit where Bible Translate puts them', () => {
    render(<StoryDraft />);
    fireEvent.click(screen.getByTestId('toggle-story-rail'));
    expect(actions.toggleRail).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId('toggle-story-helps'));
    expect(actions.toggleHelps).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Story 1');
    expect(screen.getByTestId('source-tab-obs').textContent).toBe('OBS');
    expect(screen.queryByRole('button', { name: 'OBS' })).toBeNull(); // a mark, not a tab that does nothing
    expect(screen.getByTestId('source-name').textContent).toBe('Gateway story · v9 · pinned');
    expect(screen.getByText('Historias · es')).toBeTruthy();
  });

  it('the helps pane is the Bible panel with Notes | Words | Questions | Comments; the frame in focus is marked; hidden with the helps toggle (#331)', () => {
    const item = (frame: number, id: string, quote: string) => ({ contextId: { checkId: id, occurrenceNote: 'n', reference: { story: 1, frame }, tool: 'translationNotes', groupId: '', quote, quoteString: quote, occurrence: 1 }, category: 'other' });
    state.understand = {
      book: 'OBS', story: 1, loading: false,
      notes: { state: 'ready', rung: 'primary', items: [item(1, 'a1', 'beginning'), item(2, 'b2', 'light')] },
      words: { state: 'ready', rung: 'primary', items: [] },
      questions: { state: 'ready', rung: 'primary', items: [] },
      comprehension: { '1:2': { text: 'Comentario en el marco dos', ts: 't1' } },
    };
    state.helpsTab = 'notes';
    const { rerender } = render(<StoryDraft />);
    const panel = () => screen.getByTestId('helps-panel');
    expect(within(panel()).getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['Notes', 'Words', 'Questions', 'Comments']);
    const cards = () => Array.from(panel().querySelectorAll('[data-frame]'));
    expect(cards().map((c) => c.getAttribute('data-focused'))).toEqual(['true', null]); // frame 1 in focus first
    fireEvent.click(screen.getByTestId('story-frame-2'));
    expect(screen.getByTestId('story-frame-2').getAttribute('data-focused')).toBe('true');
    expect(cards().map((c) => c.getAttribute('data-focused'))).toEqual([null, 'true']);
    fireEvent.click(within(panel()).getByRole('tab', { name: 'Comments' }));
    rerender(<StoryDraft />);
    const comment = screen.getByTestId('helps-comment');
    expect(comment.textContent).toContain('Frame 2');
    expect(comment.textContent).toContain('Comentario en el marco dos');
    expect(actions.loadUnderstand).toHaveBeenCalled();
    cleanup();
    state.helps = false;
    render(<StoryDraft />);
    expect(screen.queryByTestId('helps-panel')).toBeNull();
    state.understand = null;
    state.helpsTab = 'notes';
  });

  it('states once, not per frame, why a story has no pictures', () => {
    state.storyImages = {};
    state.storyImageNote = { wanted: 2, packs: [{ pin: { repoPath: 'git.door43.org/uW/obs_images_360', sha: '7146d5b504f6b63b9e11f7dc0b18c594d0ae179d' }, localPath: '_local_/_sideloaded_/uw--obs_images_360--7146d5b504f6', via: 'paths', files: 0, error: null }] };
    render(<StoryDraft />);
    const note = screen.getByTestId('story-image-note').textContent;
    expect(note).toContain('No picture on this machine matched the 2 image lines');
    expect(note).toContain('lists 0 image files (paths)');
    expect(screen.getAllByTestId('story-image-note')).toHaveLength(1);
    expect(screen.getByTestId('story-frame-1').textContent).not.toContain('image');
    state.storyImages = { '1': { source: 'default', uri: 'local://obs-01.jpg' } };
  });

  it('renders the units in file order: the title, every numbered frame, then the reference line, each beside its gateway text', () => {
    render(<StoryDraft />);
    const main = screen.getByTestId('story-draft');
    const ids = Array.from(main.querySelectorAll('[data-testid^="story-"]')).map((node) => node.getAttribute('data-testid'))
      .filter((id) => id === 'story-title' || id === 'story-ref' || /^story-frame-\d+$/.test(id ?? ''));
    expect(ids).toEqual(['story-title', 'story-frame-1', 'story-frame-2', 'story-ref']);
    const title = screen.getByTestId('story-title');
    expect(title.textContent).toContain('Creation');
    expect(title.textContent).toContain('La creación');
    const ref = screen.getByTestId('story-ref');
    expect(ref.textContent).toContain('Genesis 1');
    expect(ref.textContent).toContain('Génesis 1');
    expect(screen.getByTestId('story-frame-2').textContent).toContain('Then God said.');
    expect(screen.getByTestId('story-frame-2').querySelector('img')).toBeNull();
  });

  it('states that gateway text is unavailable on every unit when there is no source story, and keeps the target text', () => {
    state.sourceStory = null;
    state.storySource = { kind: 'no-pin' };
    render(<StoryDraft />);
    expect(screen.getByTestId('story-source-notice').textContent).toContain('No gateway story is pinned');
    expect(screen.getAllByText('Gateway text is unavailable.')).toHaveLength(4);
    expect(within(screen.getByTestId('story-frame-1')).getByText('Al principio.')).toBeTruthy();
    expect(within(screen.getByTestId('story-title')).getByText('La creación')).toBeTruthy();
  });

  it('marks a frame drafted exactly when its paragraph is non-empty', () => {
    render(<StoryDraft />);
    expect(screen.getByTestId('frame-marker-1').getAttribute('data-drafted')).toBe('true');
    expect(screen.getByTestId('frame-marker-1').getAttribute('title')).toBe('Frame 1, drafted');
    expect(screen.getByTestId('frame-marker-2').getAttribute('data-drafted')).toBe('false');
    expect(screen.getByTestId('frame-marker-2').getAttribute('title')).toBe('Frame 2, not drafted');
    cleanup();
    state.story = { ...state.story, frames: [state.story.frames[0], { image: '![x](obs-02.jpg)', text: '   ' }] };
    render(<StoryDraft />);
    expect(screen.getByTestId('frame-marker-2').getAttribute('data-drafted')).toBe('false');
  });

  it('lists every story from the catalogue as a keyboard-operable button and names the current one', () => {
    render(<StoryDraft />);
    const rail = screen.getByTestId('story-rail');
    expect(rail.textContent).toContain('Stories · 2');
    // #330: the book rail's rows — the open story with its title and its percent; a story without a title by number.
    expect(within(rail).getByTestId('story-1').textContent).toBe('1 · La creación');
    expect(within(rail).getByTestId('story-2').textContent).toBe('Story 2');
    expect(screen.getByTestId('story-1').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('story-2').getAttribute('aria-current')).toBeNull();
    screen.getByTestId('story-2').focus();
    expect(document.activeElement).toBe(screen.getByTestId('story-2'));
    fireEvent.click(screen.getByTestId('story-2'));
    expect(actions.openStory).toHaveBeenCalledWith(2);
  });

  it('the frame in focus is reported to the app state, and a remembered frame restores the focus (#329)', () => {
    render(<StoryDraft />);
    fireEvent.click(screen.getByTestId('story-frame-2'));
    expect(actions.setStoryFrame).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByTestId('story-title'));
    expect(actions.setStoryFrame).toHaveBeenCalledWith(0);
    cleanup();
    state.storyFrame = 2;
    render(<StoryDraft />);
    expect(screen.getByTestId('story-frame-2').getAttribute('data-focused')).toBe('true');
    state.storyFrame = null;
  });

  it('the rail shows the frames of the open story as number buttons: the frame in view filled, a drafted frame tinted; a frame button focuses its unit', () => {
    render(<StoryDraft />);
    const one = screen.getByTestId('frame-marker-1');
    const two = screen.getByTestId('frame-marker-2');
    expect(one.tagName).toBe('BUTTON');
    expect(one.getAttribute('data-i')).toBeNull(); // frame 1 is in view: filled
    expect(two.getAttribute('data-i')).toBe('choice');
    expect(one.getAttribute('data-drafted')).toBe('true');
    expect(two.getAttribute('data-drafted')).toBe('false');
    fireEvent.click(two);
    expect(screen.getByTestId('story-frame-2').getAttribute('data-focused')).toBe('true');
    expect(screen.getByTestId('frame-marker-2').getAttribute('data-i')).toBeNull();
    expect(screen.getByTestId('frame-marker-1').getAttribute('data-i')).toBe('choice');
  });

  it('a row shows the percent and title the Home cache holds for a story that is not open', () => {
    (state as Record<string, unknown>).progressByProject = { hist: { OBS: 5, stories: [{ number: 1, title: 'x', pct: 40 }, { number: 2, title: 'El pecado', pct: 0 }] } };
    (state.project as Record<string, unknown>).id = 'hist';
    render(<StoryDraft />);
    expect(screen.getByTestId('story-2').textContent).toBe('2 · El pecado0%');
    expect(screen.getByTestId('story-1').textContent).toBe('1 · La creación40%'); // the open story's own title, the cache's percent
    (state as Record<string, unknown>).progressByProject = {};
    delete (state.project as Record<string, unknown>).id;
  });

  it('gives every gateway line, every drafted line and the open field the project script direction', () => {
    state.project = { ...state.project, scriptDirection: 'rtl' };
    render(<StoryDraft />);
    const rows = ['story-title', 'story-frame-1', 'story-frame-2', 'story-ref'].map((id) => screen.getByTestId(id));
    const lines = rows.flatMap((row) => Array.from(row.querySelectorAll('p')));
    expect(lines.length).toBeGreaterThanOrEqual(7); // four gateway lines, three drafted lines
    for (const line of lines) expect(line.getAttribute('dir')).toBe('rtl');
    fireEvent.click(screen.getByRole('button', { name: 'Draft frame 2' }));
    expect(screen.getByRole('textbox', { name: 'Frame 2' }).getAttribute('dir')).toBe('rtl');
  });

  it('passes an emptied reference to the state as an empty string, so the field can be cleared and retyped', () => {
    render(<StoryDraft />);
    fireEvent.click(within(screen.getByTestId('story-ref')).getByText('Génesis 1'));
    const box = screen.getByRole('textbox', { name: 'Reference' });
    fireEvent.change(box, { target: { value: '' } });
    expect(actions.stageStoryUnit).toHaveBeenCalledWith({ kind: 'ref', story: 1 }, '');
    fireEvent.blur(box);
    expect(actions.blurStoryUnit).toHaveBeenCalledWith({ kind: 'ref', story: 1 });
  });

  it('offers the Sources modal when the pinned gateway story is not installed', () => {
    state.storySource = { kind: 'not-installed', pin: { repoPath: 'git.door43.org/unfoldingWord/en_obs', sha: '0123456789abcdef0123456789abcdef01234567' } };
    render(<StoryDraft />);
    expect(screen.getByTestId('story-source-notice').textContent).toContain('en_obs@0123456789ab is not on this machine');
    fireEvent.click(screen.getByTestId('story-source-install'));
    expect(actions.openSources).toHaveBeenCalledTimes(1);
  });

  it('states a frame-set mismatch as a mismatch without a Get source button, and keeps the gateway text', () => {
    state.storySource = { kind: 'mismatch', message: 'story 1 has 16 source frames; project has 15' };
    render(<StoryDraft />);
    const notice = screen.getByTestId('story-source-notice').textContent ?? '';
    expect(notice).toContain('does not match this project: story 1 has 16 source frames');
    expect(notice).not.toContain('could not be read');
    expect(screen.queryByTestId('story-source-install')).toBeNull();
    expect(screen.getByText('In the beginning.')).toBeTruthy();
    expect(screen.getByText('Then God said.')).toBeTruthy();
  });

  it('still states a true read failure as could-not-be-read without a Get source button', () => {
    state.sourceStory = null;
    state.storySource = { kind: 'error', message: 'could not read ingredient content: No such file or directory (os error 2)' };
    render(<StoryDraft />);
    expect(screen.getByTestId('story-source-notice').textContent).toContain('could not be read: could not read ingredient content');
    expect(screen.queryByTestId('story-source-install')).toBeNull();
  });
});
