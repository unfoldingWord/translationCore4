// Translate for an Open Bible Stories project (#289; #307 parity with Bible
// Translate). The chrome is Bible Translate's, so the process trains for Bible
// work (D74; the owner's parity checklist on #307): the rail with the same icon
// toggle, the header row (rail, "Story N", helps), the two-column grid with the
// source on the left and the target on the right per unit, one gateway source
// chip where the Bible source tabs sit, the project name where the Bible page
// names it, the dashed "Draft frame N" pill that opens an editing card, and the
// helps panel on the right scoped to the unit in focus. What differs is listed
// there too: the picture inside the source cell, story and frame labels, no
// unit switch, no original-language tab.
//
// The units are the story file's, in file order: the title (unit 0), every
// numbered frame, then the reference line. One save per unit, byte-strict
// outside it (§10, R-10.3.4): the editor stages through the story scheduler and
// blur flushes, exactly as before the parity pass.
import React, { useEffect, useRef, useState } from 'react';
import { useApp } from '../state.jsx';
import { Badge, Button, Callout, IconButton, Overline } from '../ds/index.js';
import { t } from '../i18n';
import { resolveObsSetSlot } from '../data/resolve';
import { RailIcon, HelpsIcon } from './PanelIcons.jsx';
import StoryRail, { isFrameDrafted } from './StoryRail.jsx';
import { HelpsPanel } from './HelpsPanel.jsx';
import { CELL, DraftPill, EditingCard, hair } from './draftChrome.jsx';

/** A rail frame button brings its unit into view, as a chapter button brings its chapter. */
const scrollUnitIntoView = (testId) => {
  if (typeof document === 'undefined') return;
  document.querySelector(`[data-testid="${testId}"]`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
};
const READ = { fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-lg)', lineHeight: 'var(--lh-verse-lg)', margin: 0, whiteSpace: 'pre-wrap', textAlign: 'start' };

const shortPin = (pin) => `${pin.repoPath}@${pin.sha.slice(0, 12)}`;

/** One clause per picture pack consulted: where it was read and what it held. */
function describePack(report) {
  const pin = shortPin(report.pin);
  if (!report.localPath) return t('storyDraft.packNotInstalled', { pin });
  if (report.via === null) return t('storyDraft.packUnreadable', { pin, path: report.localPath, error: report.error });
  return t(report.files === 1 ? 'storyDraft.packFilesOne' : 'storyDraft.packFiles', { pin, path: report.localPath, n: report.files, via: report.via });
}

/** Why the gateway story is absent (obsStory.ts ObsSourceState). */
function describeSource(source) {
  if (source.kind === 'no-pin') return t('storyDraft.sourceNoPin');
  if (source.kind === 'not-installed') return t('storyDraft.sourceNotInstalled', { pin: shortPin(source.pin) });
  if (source.kind === 'mismatch') return t('storyDraft.sourceMismatch', { message: source.message });
  return t('storyDraft.sourceError', { message: source.message });
}

/** The story's units in file order: the title (frame 0), every frame, the
 * reference line. `key` is the unit's identity on this screen; `unit` is what
 * the scheduler writes. */
const storyUnits = (story, sourceStory) => [
  {
    key: 'title', testId: 'story-title', frame: 0, unit: { kind: 'title', story: story.number },
    label: t('storyDraft.title'), pill: t('storyDraft.draftTitle'), fieldLabel: t('storyDraft.title'),
    gateway: sourceStory ? sourceStory.title : null, draft: story.title, image: null, multiline: false,
  },
  ...story.frames.map((frame, i) => ({
    key: `f${i + 1}`, testId: `story-frame-${i + 1}`, frame: i + 1, unit: { kind: 'frame', story: story.number, frame: i + 1 },
    label: t('storyDraft.frameLabel', { n: i + 1 }), pill: t('storyDraft.draftFrame', { n: i + 1 }), fieldLabel: t('storyDraft.frameLabel', { n: i + 1 }),
    gateway: sourceStory?.frames?.[i]?.text ?? null, draft: frame.text, image: frame.image, multiline: true,
  })),
  {
    key: 'ref', testId: 'story-ref', frame: null, unit: { kind: 'ref', story: story.number },
    label: t('storyDraft.reference'), pill: t('storyDraft.draftReference'), fieldLabel: t('storyDraft.reference'),
    gateway: sourceStory ? (sourceStory.ref || '') : null, draft: story.ref || '', image: null, multiline: false,
  },
];

/** The editing card (Bible Translate's VerseEditor, for one story unit). Blur
 * saves and closes, as the journeys blur to save; Save and Cancel carry
 * onMouseDown preventDefault so the field's blur does not close the card
 * before the click lands. Cancel stages the text the card opened with — the
 * scheduler compares it clean, so nothing is written. */
function UnitEditor({ u, dir, onClose }) {
  const { actions } = useApp();
  const ref = useRef(null);
  const before = useRef(u.draft);
  useEffect(() => { ref.current?.focus(); }, []);
  const save = async () => { await actions.blurStoryUnit(u.unit); onClose(); };
  const cancel = () => { actions.stageStoryUnit(u.unit, before.current); void actions.blurStoryUnit(u.unit); onClose(); };
  const field = {
    ref,
    'aria-label': u.fieldLabel,
    dir,
    value: u.draft,
    placeholder: t('storyDraft.placeholder'),
    onChange: (event) => actions.stageStoryUnit(u.unit, event.target.value),
    onBlur: () => { void save(); },
    style: { width: '100%', boxSizing: 'border-box', border: 0, outline: 'none', resize: 'vertical', ...READ, color: 'var(--text-scripture)', background: 'transparent' },
  };
  return (
    <EditingCard data-testid="story-unit-editor"
      header={<Overline tone="accent">{t('draft.drafting')} {u.label}</Overline>}
      footer={<>
        <Button size="sm" onMouseDown={(e) => e.preventDefault()} onClick={() => { void save(); }}>{t('storyDraft.save')}</Button>
        <Button variant="ghost" onMouseDown={(e) => e.preventDefault()} onClick={cancel}
          style={{ color: 'var(--text-tertiary)', fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)' }}>
          {t('draft.cancelVerse')}
        </Button>
      </>}>
      {u.multiline ? <textarea {...field} rows={4} /> : <input {...field} />}
    </EditingCard>
  );
}

/** The source cell: the unit's label, its picture (a frame only) and the
 * gateway text or the unavailable notice. */
function SourceCell({ u, image, dir }) {
  return (
    <div style={{ ...CELL, borderInlineEnd: hair }}>
      <Overline tone="muted" style={{ marginBottom: 6 }}>{u.label}</Overline>
      {image?.uri && (
        <img src={image.uri} alt={t('storyDraft.imageAlt', { n: u.frame })}
          style={{ display: 'block', width: '100%', maxHeight: 210, objectFit: 'cover', borderRadius: 'var(--radius-md)', background: 'var(--surface-sunken)', marginBottom: 10 }} />
      )}
      <p dir={dir} style={{ ...READ, color: u.gateway ? 'var(--text-scripture)' : 'var(--uw-haze)', fontStyle: u.gateway ? 'normal' : 'italic', fontSize: u.gateway ? READ.fontSize : 'var(--fs-ui-sm)' }}>
        {u.gateway || t('storyDraft.sourceMissing')}
      </p>
    </div>
  );
}

/** The target cell: the drafted text (click or Enter to revise), the dashed
 * pill for an undrafted unit, or the editing card while this unit is open.
 * Drafted is the rail marker's predicate (isFrameDrafted), so the cell and the
 * marker never disagree. The drafted text is reachable from the keyboard too:
 * before the parity pass every unit was a textbox in the tab order. */
function TargetCell({ u, dir, editing, onEdit, onClose }) {
  const onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onEdit(); } };
  return (
    <div style={{ ...CELL, position: 'relative' }}>
      <div style={{ minHeight: 14, marginBottom: 6 }} />
      {editing ? (
        <UnitEditor u={u} dir={dir} onClose={onClose} />
      ) : isFrameDrafted(u.draft) ? (
        <p dir={dir} title={t('storyDraft.editUnit')} onClick={onEdit} onKeyDown={onKey} role="button" tabIndex={0}
          data-testid="story-unit-text"
          style={{ ...READ, color: 'var(--text-scripture)', cursor: 'text' }}>
          {u.draft}
        </p>
      ) : (
        <DraftPill onClick={onEdit}>{u.pill}</DraftPill>
      )}
    </div>
  );
}

/** The source column header: the OBS mark where the Bible source tabs sit (the
 * same Badge Home's project card carries — one gateway, so a label, not a tab
 * that does nothing), and the pinned version under it. */
function SourceHeader({ pins }) {
  const pin = pins ? resolveObsSetSlot(pins, 'obs').pin : null;
  return (
    <div style={{ position: 'sticky', top: 0, background: 'var(--surface-app)', zIndex: 2, padding: '13px 26px 8px', borderInlineEnd: hair }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <Badge size="sm" tone="accent" data-testid="source-tab-obs">{t('home.obsMarker')}</Badge>
      </div>
      <span data-testid="source-name" style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)' }}>
        {t('storyDraft.source')}
        {pin?.version ? ` · ${t('draft.pinned', { version: pin.version })}` : ''}
      </span>
    </div>
  );
}

/** The two notices above the grid: why the gateway story is absent, and why no
 * frame has a picture. */
function StoryNotices({ source, imageNote, onInstall }) {
  return (
    <>
      {source && (
        <Callout tone="warn" data-testid="story-source-notice" style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '14px 26px 0' }}>
          <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{describeSource(source)}</span>
          {source.kind === 'not-installed' && (
            <Button size="sm" variant="secondary" onClick={onInstall} data-testid="story-source-install">
              {t('storyDraft.getSource')}
            </Button>
          )}
        </Callout>
      )}
      {imageNote && (
        <Callout tone="info" data-testid="story-image-note" style={{ margin: '14px 26px 0', overflowWrap: 'anywhere' }}>
          {t(imageNote.wanted === 1 ? 'storyDraft.noPicturesOne' : 'storyDraft.noPictures', { n: imageNote.wanted })} {imageNote.packs.map(describePack).join('; ')}
        </Callout>
      )}
    </>
  );
}

export default function StoryDraft() {
  const { s, actions } = useApp();
  const story = s.story;
  const dir = s.project?.scriptDirection === 'rtl' ? 'rtl' : 'ltr';
  // The unit in focus (its helps show) and the unit whose card is open.
  const [focusKey, setFocusKey] = useState('f1');
  const [editingKey, setEditingKey] = useState(null);
  // The frame in focus is app state (#329): a story load sets it to 1 and a Home
  // tile's restore sets the remembered frame; a click here reports it back.
  useEffect(() => { setEditingKey(null); }, [s.storyNumber]);
  useEffect(() => {
    if (s.storyFrame == null) return;
    setFocusKey(s.storyFrame === 0 ? 'title' : `f${s.storyFrame}`);
  }, [s.storyNumber, s.storyFrame]);
  const focusUnit = (key) => {
    setFocusKey(key);
    if (key === 'title') actions.setStoryFrame?.(0);
    else if (key.startsWith('f')) actions.setStoryFrame?.(Number(key.slice(1)));
  };
  // The helps of the open story, as Understand loads them (#290): reload when
  // the story, the pins or the network change.
  useEffect(() => {
    actions.loadUnderstand?.();
  }, [s.storyNumber, s.projectPins, s.projectPinsLoaded, s.netEnabled, s.installEpoch]);

  if (s.storyLoading) return <main data-testid="story-draft-loading" style={{ flex: 1, padding: 40 }}>{t('storyDraft.loading')}</main>;
  if (s.storyError) return <main data-testid="story-draft-error" style={{ flex: 1, padding: 40 }}><Callout tone="warn">{s.storyError}</Callout></main>;
  if (!story) return <main data-testid="story-draft-empty" style={{ flex: 1, padding: 40 }}>{t('storyDraft.noStory')}</main>;

  const units = storyUnits(story, s.sourceStory);
  const focused = units.find((u) => u.key === focusKey) ?? units[1] ?? units[0];

  return (
    <div style={{ flex: 1, display: 'flex', minHeight: 0 }} data-testid="story-draft">
      {s.rail && (
        <StoryRail numbers={s.storyNumbers} active={s.storyNumber} story={story} onSelect={actions.openStory}
          currentFrame={focused.frame} onSelectFrame={(n) => { focusUnit(`f${n}`); scrollUnitIntoView(`story-frame-${n}`); }} />
      )}
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 22px', borderBottom: hair, background: 'var(--surface-card)', flex: 'none' }}>
          <IconButton title={t('storyDraft.toggleRail')} data-testid="toggle-story-rail" onClick={actions.toggleRail}><RailIcon /></IconButton>
          <h2 style={{ fontSize: 'var(--fs-title)', letterSpacing: 'var(--track-17)', margin: 0 }}>{t('storyDraft.storyNumber', { n: story.number })}</h2>
          <div style={{ flex: 1 }} />
          <IconButton title={t('draft.toggleHelps')} data-testid="toggle-story-helps" onClick={actions.toggleHelps}><HelpsIcon /></IconButton>
        </div>
        <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
          <StoryNotices source={s.storySource} imageNote={s.storyImageNote} onInstall={actions.openSources} />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', maxWidth: 1100, margin: '0 auto' }}>
            <SourceHeader pins={s.projectPins} />
            <div style={{ position: 'sticky', top: 0, background: 'var(--surface-app)', zIndex: 2, padding: '13px 26px 8px', display: 'flex', alignItems: 'center' }}>
              <Overline tone="accent">{s.project?.name} · {s.project?.languageTag}</Overline>
              <div style={{ flex: 1 }} />
              {/* The Bible unit switch (Section | Verse) sits here; a frame is one unit (#307). */}
            </div>
            {units.map((x) => (
              <div key={x.key} data-testid={x.testId} data-focused={x.key === focused.key ? 'true' : undefined}
                style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '1fr 1fr' }}
                onClick={() => focusUnit(x.key)}>
                <SourceCell u={x} image={x.frame ? s.storyImages?.[String(x.frame)] : null} dir={dir} />
                <TargetCell u={x} dir={dir} editing={editingKey === x.key}
                  onEdit={() => { focusUnit(x.key); setEditingKey(x.key); }}
                  onClose={() => setEditingKey((k) => (k === x.key ? null : k))} />
              </div>
            ))}
          </div>
        </div>
      </main>
      {s.helps && <HelpsPanel chapter={story.number} comments story focusFrame={focused.frame} />}
    </div>
  );
}
