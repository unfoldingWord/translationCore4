import React from 'react';
import { Button, Overline } from '../ds/index.js';
import { t } from '../i18n';

/** A frame is drafted exactly when its paragraph is non-empty (#289) — the one
 * predicate the rail marker and the target cell share (#307 review). */
export const isFrameDrafted = (text) => String(text ?? '').trim() !== '';

/** Story navigation for OBS. The list is always sourced from the project's
 * story catalogue; frame markers only describe the currently open story. A
 * marker is drafted exactly when the frame's paragraph is non-empty (#289). */
export default function StoryRail({ numbers = [], active, story, onSelect }) {
  return (
    <aside data-testid="story-rail" style={{ width: 236, flex: 'none', overflowY: 'auto', borderInlineEnd: 'var(--stroke-hair) solid var(--border-hair)', background: 'var(--surface-card)', padding: '20px 14px' }}>
      <Overline tone="muted" style={{ margin: '0 8px 10px' }}>{t('storyDraft.stories')}</Overline>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {numbers.map((number) => {
          const selected = Number(active) === Number(number);
          return (
            <React.Fragment key={number}>
              <Button variant={selected ? 'secondary' : 'ghost'} data-testid={`story-${number}`} aria-current={selected ? 'page' : undefined}
                onClick={() => onSelect(number)} style={{ justifyContent: 'flex-start', width: '100%', textAlign: 'start', fontWeight: selected ? 'var(--fw-black)' : 'var(--fw-medium)' }}>
                {t('storyDraft.storyNumber', { n: number })}
              </Button>
              {selected && story && (
                <div data-testid="story-frame-markers" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '2px 8px 8px' }}>
                  {story.frames.map((frame, index) => {
                    const drafted = isFrameDrafted(frame.text);
                    return (
                      <span key={index + 1} data-testid={`frame-marker-${index + 1}`} data-drafted={drafted ? 'true' : 'false'}
                        title={t(drafted ? 'storyDraft.frameDrafted' : 'storyDraft.frameEmpty', { n: index + 1 })}
                        style={{ width: 22, height: 22, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 'var(--radius-xs)', fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-bold)',
                          ...(drafted
                            ? { background: 'var(--surface-accent-soft)', color: 'var(--text-accent)' }
                            : { background: 'transparent', color: 'var(--text-tertiary)', boxShadow: 'inset 0 0 0 1px var(--border)' }) }}>
                        {index + 1}
                      </span>
                    );
                  })}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </aside>
  );
}
