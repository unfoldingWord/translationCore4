import React from 'react';
import { useApp } from '../state.jsx';
import { Button, Callout, Overline } from '../ds/index.js';
import { t } from '../i18n';
import StoryRail from './StoryRail.jsx';

const fieldStyle = {
  width: '100%',
  boxSizing: 'border-box',
  border: 'var(--stroke-hair) solid var(--border-input)',
  borderRadius: 'var(--radius-sm)',
  padding: '10px 12px',
  color: 'var(--text-scripture)',
  background: 'var(--surface-card)',
  fontFamily: 'var(--font-scripture)',
  fontSize: 'var(--fs-verse-lg)',
  lineHeight: 'var(--lh-verse-lg)',
};

/** One clause per picture pack consulted: where it was read and what it held. */
function describePack(report) {
  const pin = `${report.pin.repoPath}@${report.pin.sha.slice(0, 12)}`;
  if (!report.localPath) return t('storyDraft.packNotInstalled', { pin });
  if (report.via === null) return t('storyDraft.packUnreadable', { pin, path: report.localPath, error: report.error });
  return t('storyDraft.packFiles', { pin, path: report.localPath, n: report.files, via: report.via });
}

function EditableUnit({ unit, value, label, multiline = false, dir }) {
  const { actions } = useApp();
  const props = {
    'aria-label': label,
    dir,
    value,
    onChange: (event) => actions.stageStoryUnit(unit, event.target.value),
    onBlur: () => { void actions.blurStoryUnit(unit); },
    style: fieldStyle,
  };
  return multiline ? <textarea {...props} rows={4} /> : <input {...props} />;
}

/** The gateway text of a unit, read-only, or the unavailable notice. */
function GatewayText({ text, dir }) {
  return (
    <p dir={dir} style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-secondary)', fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-lg)', lineHeight: 'var(--lh-verse-lg)' }}>
      {text || t('storyDraft.sourceMissing')}
    </p>
  );
}

/** The title or the reference line: the gateway text above the target field.
 * Neither has a frame locator, so neither shows a frame number or a picture. */
function LineUnit({ testId, unit, label, gateway, value, dir }) {
  return (
    <div data-testid={testId} style={{ marginBottom: 20 }}>
      <Overline tone="muted" style={{ marginBottom: 6 }}>{label}</Overline>
      <div style={{ marginBottom: 8 }}><GatewayText text={gateway} dir={dir} /></div>
      <EditableUnit unit={unit} value={value} label={label} dir={dir} />
    </div>
  );
}

function FrameEditor({ frame, sourceFrame, image, story, index, dir }) {
  const unit = { kind: 'frame', story: story.number, frame: index + 1 };
  return (
    <article data-testid={`story-frame-${index + 1}`} style={{ borderTop: 'var(--stroke-hair) solid var(--border-hair)', padding: '24px 0 30px' }}>
      <Overline tone="muted" style={{ marginBottom: 12 }}>{t('storyDraft.frameLabel', { n: index + 1 })}</Overline>
      <div style={{ display: 'grid', gridTemplateColumns: image?.uri ? 'minmax(160px, 30%) 1fr' : '1fr', gap: 22, alignItems: 'start' }}>
        {image?.uri && <img src={image.uri} alt={t('storyDraft.imageAlt', { n: index + 1 })} style={{ width: '100%', maxHeight: 210, objectFit: 'cover', borderRadius: 'var(--radius-md)', background: 'var(--surface-sunken)' }} />}
        <div>
          <div style={{ marginBottom: 12 }}>
            <Overline tone="muted" style={{ marginBottom: 6 }}>{t('storyDraft.source')}</Overline>
            <GatewayText text={sourceFrame?.text} dir={dir} />
          </div>
          <Overline tone="accent" style={{ marginBottom: 6 }}>{t('storyDraft.translation')}</Overline>
          <EditableUnit unit={unit} value={frame.text} label={t('storyDraft.frameLabel', { n: index + 1 })} multiline dir={dir} />
        </div>
      </div>
    </article>
  );
}

export default function StoryDraft() {
  const { s, actions } = useApp();
  const story = s.story;
  const dir = s.project?.scriptDirection === 'rtl' ? 'rtl' : 'ltr';
  if (s.storyLoading) return <main data-testid="story-draft-loading" style={{ flex: 1, padding: 40 }}>{t('storyDraft.loading')}</main>;
  if (s.storyError) return <main data-testid="story-draft-error" style={{ flex: 1, padding: 40 }}><Callout tone="warn">{s.storyError}</Callout></main>;
  if (!story) return <main data-testid="story-draft-empty" style={{ flex: 1, padding: 40 }}>{t('storyDraft.noStory')}</main>;
  const sourceStory = s.sourceStory;
  const number = story.number;
  return (
    <main data-testid="story-draft" style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden', background: 'var(--surface-app)' }}>
      {s.rail && <StoryRail numbers={s.storyNumbers} active={s.storyNumber} story={story} onSelect={actions.openStory} />}
      <section style={{ flex: 1, minWidth: 0, overflowY: 'auto', padding: '30px 40px 70px' }}>
        <div style={{ maxWidth: 'var(--measure-reading)', margin: '0 auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            <Overline tone="accent">{t('storyDraft.storyNumber', { n: number })}</Overline>
            <Button variant="ghost" onClick={actions.toggleRail} data-testid="toggle-story-rail">{s.rail ? t('storyDraft.hideStories') : t('storyDraft.showStories')}</Button>
          </div>
          <LineUnit testId="story-title" unit={{ kind: 'title', story: number }} label={t('storyDraft.title')} gateway={sourceStory ? sourceStory.title : null} value={story.title} dir={dir} />
          {s.storySourceError && (
            <Callout tone="warn" data-testid="story-source-error" style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
              <span style={{ flex: 1, overflowWrap: 'anywhere' }}>{s.storySourceError}</span>
              {s.storySourceMissing && (
                <Button size="sm" variant="secondary" onClick={actions.openSources} data-testid="story-source-install">
                  {t('storyDraft.getSource')}
                </Button>
              )}
            </Callout>
          )}
          {s.storyImageNote && (
            <Callout tone="info" data-testid="story-image-note" style={{ marginBottom: 18, overflowWrap: 'anywhere' }}>
              {t('storyDraft.noPictures', { n: s.storyImageNote.wanted })} {s.storyImageNote.packs.map(describePack).join('; ')}
            </Callout>
          )}
          {story.frames.map((frame, index) => (
            <FrameEditor key={index + 1} frame={frame} sourceFrame={sourceStory?.frames?.[index]} image={s.storyImages?.[String(index + 1)]} story={story} index={index} dir={dir} />
          ))}
          <LineUnit testId="story-ref" unit={{ kind: 'ref', story: number }} label={t('storyDraft.reference')} gateway={sourceStory ? (sourceStory.ref || '') : null} value={story.ref || ''} dir={dir} />
        </div>
      </section>
    </main>
  );
}
