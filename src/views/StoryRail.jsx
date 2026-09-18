import React from 'react';
import { useApp } from '../state.jsx';
import { BookTile } from '../ds/index.js';
import { t } from '../i18n';
import { RailGroup, RailNumberButton, RailNumbers, RailShell } from './railChrome.jsx';

/** A frame is drafted exactly when its paragraph is non-empty (#289) — the one
 * predicate the rail marker and the target cell share (#307 review). */
export const isFrameDrafted = (text) => String(text ?? '').trim() !== '';

/** Story navigation for OBS, in the book rail's chrome (#330): one row per
 * story with its title and drafted percent (the Home progress cache, #328),
 * the active story's row and its frame grid in one tinted group, the frames as
 * number buttons with the frame in view filled and a drafted frame tinted.
 * The list is always the project's story catalogue; the frame grid describes
 * the open story only. */
export default function StoryRail({ numbers = [], active, story, onSelect, currentFrame = null, onSelectFrame = undefined }) {
  const { s } = useApp();
  const progress = s.progressByProject?.[s.project?.id]?.stories ?? [];
  const byNumber = new Map(progress.map((entry) => [entry.number, entry]));
  const rowName = (number) => {
    // The open story's own title first (live); else the Home cache's (the
    // drafted title, else the gateway's); else the number alone.
    const title = (story && Number(story.number) === Number(number) ? story.title : '') || byNumber.get(number)?.title || '';
    return title ? `${number} · ${title}` : t('storyDraft.storyNumber', { n: number });
  };
  return (
    <RailShell data-testid="story-rail" title={`${t('storyDraft.stories')} · ${numbers.length}`}>
      {numbers.map((number) => {
        const selected = Number(active) === Number(number);
        const pct = byNumber.get(number)?.pct;
        return (
          <RailGroup key={number} active={selected}>
            <BookTile layout="row" active={selected} data-testid={`story-${number}`} aria-current={selected ? 'page' : undefined}
              name={rowName(number)} percent={typeof pct === 'number' ? pct : 0} meta={typeof pct === 'number' ? `${pct}%` : ''}
              onClick={() => onSelect(number)} />
            {selected && story && (
              <RailNumbers data-testid="story-frame-markers">
                {story.frames.map((frame, index) => {
                  const n = index + 1;
                  const drafted = isFrameDrafted(frame.text);
                  return (
                    <RailNumberButton key={n} data-testid={`frame-marker-${n}`} data-drafted={drafted ? 'true' : 'false'}
                      selected={Number(currentFrame) === n} drafted={drafted}
                      title={t(drafted ? 'storyDraft.frameDrafted' : 'storyDraft.frameEmpty', { n })}
                      onClick={() => onSelectFrame?.(n)}>
                      {n}
                    </RailNumberButton>
                  );
                })}
              </RailNumbers>
            )}
          </RailGroup>
        );
      })}
    </RailShell>
  );
}
