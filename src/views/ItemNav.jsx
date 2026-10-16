// #726: the Previous / Next item buttons of the Check and Align marking rows.
// Labelled quiet pills, so they read as "move", apart from the marking buttons
// that record a decision. Each sits 4 px further from the marking buttons than
// the row gap, and its arrow follows the interface direction.
import React from 'react';
import { LOCALES, t, useLocale } from '../i18n';
import { Button } from '../ds/index.js';

export function ItemNavButton({ which, enabled, onClick, testId }) {
  const locale = useLocale();
  const rtl = LOCALES.find((l) => l.id === locale)?.dir === 'rtl';
  const prev = which === 'prev';
  const arrow = prev === rtl ? '→' : '←';
  const label = t(prev ? 'check.prevLabel' : 'check.nextLabel');
  return (
    <Button variant="secondary" size="sm" data-testid={testId} title={t(prev ? 'check.prevItem' : 'check.nextItem')}
      disabled={!enabled} onClick={() => enabled && onClick()}
      style={{ [prev ? 'marginInlineEnd' : 'marginInlineStart']: 4, ...(enabled ? { color: 'var(--accent)' } : null) }}>
      {prev ? `${arrow} ${label}` : `${label} ${arrow}`}
    </Button>
  );
}
