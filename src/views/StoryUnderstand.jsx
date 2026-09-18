// Understand for an Open Bible Stories project (#290, J25 — D74 §8, §10;
// amended #332: source only, like the Bible Understand):
// the open story's frames in order with picture and gateway text,
// a user comment per frame, and the helps pane scoped to the selected
// frame — OBS Translation Notes by `story:frame` (the title notes on frame 0)
// and OBS Translation Words Links resolved to the shared Translation Words
// articles. The ONLY write is the comment box (the journal's note.add with a
// {story, frame} target), the same scheduler and writer as the Bible screen.
import React from 'react';
import { useApp } from '../state.jsx';
import { t } from '../i18n';
import StoryRail from './StoryRail.jsx';
import { ComprehensionBox } from './Understand.jsx';
import { ArticleView, ExpandableNote, SlotState } from './HelpsPanel.jsx';
import { Button, Callout, IconButton, Overline, StatusDot, Switcher } from '../ds/index.js';
import { RailIcon } from './PanelIcons.jsx';

const STORY_BOOK = 'OBS';
const READ_TEXT = { margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-lg)', lineHeight: 'var(--lh-verse-lg)' };
const UNIT_FOCUSED = { background: 'var(--surface-card)', border: 'var(--stroke) solid var(--accent-ring)', boxShadow: '0 2px 10px rgba(1,66,99,.07)' };
const UNIT_REST = { background: 'transparent', border: 'var(--stroke) solid transparent', boxShadow: 'none' };

/** The story's units: frame 0 is the title, then every frame. */
const storyUnits = (story, sourceStory) => [
  { frame: 0, label: t('storyDraft.title'), gateway: sourceStory?.title ?? null, image: null },
  ...story.frames.map((frame, i) => ({
    frame: i + 1,
    label: t('storyDraft.frameLabel', { n: i + 1 }),
    gateway: sourceStory?.frames?.[i]?.text ?? null,
    image: frame.image,
  })),
];

/** The helps of one frame from a slot: the items whose frame is this one. */
const itemsForFrame = (slot, frame) =>
  (slot?.state === 'ready' ? slot.items.filter((it) => it.contextId.reference.frame === frame) : []);

function StoryUnit({ unit, story, image, dir, focused, onFocus, hasNote }) {
  return (
    <div data-testid={`story-understand-unit-${unit.frame}`} data-focused={focused ? 'true' : undefined} onClick={onFocus}
      tabIndex={0} aria-current={focused ? 'true' : undefined}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onFocus(); } }}
      style={{ marginBottom: 18, borderRadius: 'var(--radius-xl)', padding: '12px 16px 14px', cursor: 'pointer', ...(focused ? UNIT_FOCUSED : UNIT_REST) }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, paddingBottom: 8, borderBottom: 'var(--stroke-hair) solid var(--border)' }}>
        <Overline>{unit.label}</Overline><div style={{ flex: 1 }} />
        {hasNote ? <StatusDot status="valid" size={7} /> : null}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: image?.uri ? 'minmax(160px, 30%) 1fr' : '1fr', gap: 22, alignItems: 'start', marginTop: 10 }}>
        {image?.uri && <img src={image.uri} alt={t('storyDraft.imageAlt', { n: unit.frame })} style={{ width: '100%', maxHeight: 210, objectFit: 'cover', borderRadius: 'var(--radius-md)', background: 'var(--surface-sunken)' }} />}
        <div>
          <Overline tone="muted" style={{ marginBottom: 6 }}>{t('storyDraft.source')}</Overline>
          <p dir={dir} data-testid="story-understand-gateway" style={{ ...READ_TEXT, color: 'var(--text-secondary)', marginBottom: 0 }}>
            {unit.gateway || t('storyDraft.sourceMissing')}
          </p>
        </div>
      </div>
      {/* The comment box keys its note under {story, frame}: `unit.project`
        * is the exact durable identity, written unmapped (projectFrame). */}
      <ComprehensionBox book={STORY_BOOK} chapter={story.number} mode="frame"
        unit={{ key: `f${unit.frame}`, project: { chapter: story.number, verse: unit.frame }, verses: [] }} />
    </div>
  );
}

/** One note or word-link card of the selected frame. */
function StoryHelpCard({ kind, item, rung, onArticle }) {
  const c = item.contextId;
  const slug = c.groupId;
  return (
    <div data-testid={`story-help-${kind}`} style={{ border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '10px 12px', marginBottom: 8, background: 'var(--surface-card)' }}>
      <p style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-ui-md)', fontWeight: 'var(--fw-bold)', color: 'var(--text-heading)', margin: '0 0 4px' }}>“{c.quoteString}”</p>
      {kind === 'note' && c.occurrenceNote && (
        <div style={{ fontSize: 'var(--fs-ui-sm)', color: 'var(--text-body)', lineHeight: 'var(--lh-body)' }}>
          <ExpandableNote text={c.occurrenceNote} />
        </div>
      )}
      {slug && (
        <Button variant="ghost" size="sm" style={{ padding: 0, marginTop: 4 }}
          onClick={(e) => { e.stopPropagation(); onArticle({ kind: kind === 'note' ? 'ta' : 'tw', category: item.category, slug, rung }); }}>
          {t(kind === 'note' ? 'understand.academyLink' : 'understand.wordLink')}
        </Button>
      )}
    </div>
  );
}

/** The list the helps pane shows for one slot: loading, the slot's stated
 * non-ready state, nothing for this frame, or the cards. */
function StoryHelpsList({ u, slot, kind, frame, onArticle }) {
  if (u?.loading) return <p data-testid="helps-loading" style={{ fontSize: 'var(--fs-ui-sm)', color: 'var(--text-tertiary)', margin: 0 }}>{t('understand.loading')}</p>;
  if (!slot) return null;
  if (slot.state !== 'ready') return <SlotState slot={slot} />;
  const items = itemsForFrame(slot, frame);
  if (items.length === 0) {
    return <p style={{ fontSize: 'var(--fs-caption-lg)', color: 'var(--text-tertiary)', fontStyle: 'italic', margin: 0 }}>{t('understand.noneInFocus')}</p>;
  }
  return items.map((item, i) => (
    <StoryHelpCard key={`${item.contextId.checkId}-${i}`} kind={kind} item={item} rung={slot.rung} onArticle={onArticle} />
  ));
}

/** The helps pane: Notes | Words for the selected frame, and the article a
 * card opened. */
export function StoryHelps({ u, unit, actions }) {
  const [tab, setTab] = React.useState('notes');
  const slot = tab === 'notes' ? u?.notes : u?.words;
  return (
    <aside data-testid="story-helps" style={{ width: 'var(--rail-width-wide)', flex: 'none', background: 'var(--surface-card)', borderInlineStart: 'var(--stroke-hair) solid var(--border)', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ padding: '14px 16px 10px', borderBottom: 'var(--stroke-hair) solid var(--border-hair)' }}>
        <Overline tone="muted" style={{ marginBottom: 8 }}>{unit ? t('understand.frameHelps', { unit: unit.label }) : t('understand.selectFrame')}</Overline>
        <Switcher indicator="pill" size="sm" tone="ocean" value={tab} onChange={setTab}
          options={[{ value: 'notes', label: t('helps.notes') }, { value: 'words', label: t('helps.words') }]} />
      </div>
      <div style={{ flex: 1, overflow: 'auto', padding: 14, minHeight: 0 }}>
        {u?.error && <Callout tone="warn" role="alert" data-testid="understand-error" style={{ overflowWrap: 'anywhere', marginBottom: 10 }}>{u.error}</Callout>}
        <StoryHelpsList u={u} slot={slot} kind={tab === 'notes' ? 'note' : 'word'} frame={unit?.frame} onArticle={actions.loadHelpArticle} />
      </div>
      <ArticleView article={u?.article} onClose={actions.closeHelpArticle}
        onRetry={() => u?.article?.request && actions.loadHelpArticle(u.article.request)} />
    </aside>
  );
}

export default function StoryUnderstand() {
  const { s, actions } = useApp();
  const story = s.story;
  const dir = s.project?.scriptDirection === 'rtl' ? 'rtl' : 'ltr';
  // The frame in focus is app state (#329): a story load sets it, a Home tile's
  // restore sets the remembered frame, a click here reports it back. Absent, the title.
  const [activeFrame, setActiveFrame] = React.useState(s.storyFrame ?? 0);
  React.useEffect(() => { setActiveFrame(s.storyFrame ?? 0); }, [s.storyNumber, s.storyFrame]);
  const focusFrame = (n) => { setActiveFrame(n); actions.setStoryFrame?.(n); };
  // The helps of the open story: reload when the story, the pins or the
  // network change (the book screen's useLoadHelps, on the story's inputs).
  React.useEffect(() => {
    actions.loadUnderstand();
  }, [s.storyNumber, s.projectPins, s.projectPinsLoaded, s.netEnabled, s.installEpoch]);

  if (s.storyLoading) return <main data-testid="story-understand-loading" style={{ flex: 1, padding: 40 }}>{t('storyDraft.loading')}</main>;
  if (s.storyError) return <main data-testid="story-understand-error" style={{ flex: 1, padding: 40 }}><Callout tone="warn">{s.storyError}</Callout></main>;
  if (!story) return <main data-testid="story-understand-empty" style={{ flex: 1, padding: 40 }}>{t('storyDraft.noStory')}</main>;

  // The understand slot is the open story's only when it names it (#290:
  // a story switch reloads; a stale slot of another story shows nothing).
  const u = s.understand?.book === STORY_BOOK && s.understand.story === story.number ? s.understand : null;
  const units = storyUnits(story, s.sourceStory);
  const unit = units.find((x) => x.frame === activeFrame) ?? units[0];
  const hasNote = (frame) => !!u?.comprehension?.[`${story.number}:${frame}`];

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }} data-testid="story-understand">
      {s.rail && (
        <StoryRail numbers={s.storyNumbers} active={s.storyNumber} story={story} onSelect={actions.openStory}
          currentFrame={unit.frame} onSelectFrame={(n) => { focusFrame(n); document.querySelector(`[data-testid="story-understand-unit-${n}"]`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }); }} />
      )}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '10px 26px', borderBottom: 'var(--stroke-hair) solid var(--border-hair)', background: 'var(--surface-card)', flex: 'none', minWidth: 0, overflow: 'hidden' }}>
          <IconButton title={t('draft.toggleRail')} onClick={actions.toggleRail}><RailIcon /></IconButton>
          <h2 style={{ fontSize: 'var(--fs-title)', letterSpacing: 'var(--track-17)', margin: 0, flex: 'none' }}>{t('storyDraft.storyNumber', { n: story.number })}</h2>
          <span style={{ fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-tertiary)', flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('understand.storyNote')}</span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0, background: 'var(--surface-app)' }}>
          <div style={{ maxWidth: 'var(--measure-read)', margin: '0 auto', padding: '22px 26px 60px' }}>
            {s.understand?.saveError && (
              <Callout tone="warn" role="alert" data-testid="understand-save-error" style={{ marginBottom: 10, overflowWrap: 'anywhere' }}>
                <strong>{t('understand.saveFailed')}</strong> {s.understand.saveError}
              </Callout>
            )}
            {units.map((x) => (
              <StoryUnit key={x.frame} unit={x} story={story} image={x.frame ? s.storyImages?.[String(x.frame)] : null} dir={dir}
                focused={x.frame === unit.frame} onFocus={() => focusFrame(x.frame)} hasNote={hasNote(x.frame)} />
            ))}
          </div>
        </div>
      </main>
      <StoryHelps u={u} unit={unit} actions={actions} />
    </div>
  );
}
