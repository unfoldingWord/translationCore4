// Issue #95: the conditional progress indicator for a slow project open.
//
// The open pipeline reports its progress into `s.opening` (state.jsx
// performProjectOpen). This view shows NOTHING for the first SHOW_THRESHOLD_MS
// of an open — a small or medium project opens in well under that, and a bar
// that flashes for a sub-second open is noise — then a determinate bar driven
// by real segment counts while the journal is read, and an indeterminate one
// for the two short stages after it. A failed or superseded open clears
// `s.opening`, so the indicator can never be left standing (the issue's third
// criterion).
import React from 'react';
import { useApp } from '../state.jsx';
import { t } from '../i18n';
import { Layer, Surface, Stack, Text, Progress } from '../ds/index.js';

/** How long an open may run before the indicator appears. The owner's ruling
 * (2026-08-25): open cost is acceptable, a frozen screen is not; the issue
 * names 300 ms as the threshold. */
export const SHOW_THRESHOLD_MS = 300;

const STAGE_LABEL = {
  journal: 'open.readingJournal',
  state: 'open.checkingState',
  prepare: 'open.preparing',
};

/** The pure view: given the open record and a clock, decide whether to show
 * and what. `now` is injectable so the threshold is unit-testable. */
export function OpenProgressView({ opening, now = () => Date.now() }) {
  const startedAt = opening ? opening.startedAt : null;
  const [shown, setShown] = React.useState(() => startedAt != null && now() - startedAt >= SHOW_THRESHOLD_MS);
  React.useEffect(() => {
    if (startedAt == null) {
      setShown(false);
      return undefined;
    }
    const wait = SHOW_THRESHOLD_MS - (now() - startedAt);
    if (wait <= 0) {
      setShown(true);
      return undefined;
    }
    setShown(false);
    const timer = setTimeout(() => setShown(true), wait);
    return () => clearTimeout(timer);
  }, [startedAt, now]);
  if (!opening || !shown) return null;

  const determinate = opening.stage === 'journal' && opening.total > 0;
  // floor, never round: 100 means every segment is read, not "nearly".
  const pct = determinate ? Math.floor((100 * opening.done) / opening.total) : null;
  return (
    <Layer open level="overlay" scrim="modal" placement="center" role="dialog"
      label={t('open.title')} dismiss="" animate={false} trapFocus
      scrimProps={{ 'data-testid': 'open-progress', 'data-stage': opening.stage }}>
      {/* Nothing here is focusable, so Layer's trap focuses the panel itself; a Tab
          from there would leave for the covered page — keep it here (Codex, round 1). */}
      <Surface fill="card" radius="2xl" elevation="modal" pad="lg" style={{ width: 420, maxWidth: '100%' }}
        onKeyDown={(e) => { if (e.key === 'Tab') e.preventDefault(); }}>
        <Stack direction="column" gap={12}>
          <Text role="h3">{t('open.title')}</Text>
          <Text role="caption" aria-live="polite" data-testid="open-progress-stage">
            {t(STAGE_LABEL[opening.stage] || STAGE_LABEL.journal)}
            {determinate ? ` · ${t('open.segments', { done: opening.done, total: opening.total })}` : ''}
          </Text>
          <Progress value={pct} label={undefined} height={6}
            aria-label={t(STAGE_LABEL[opening.stage] || STAGE_LABEL.journal)} />
        </Stack>
      </Surface>
    </Layer>
  );
}

export default function OpenProgress() {
  const { s } = useApp();
  return <OpenProgressView opening={s.opening} />;
}
