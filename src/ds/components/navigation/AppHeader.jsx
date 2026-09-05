/* SHIM. This component's name and props are unchanged, but nothing is drawn
   here any more: it composes the primitives. Kept so an application built on
   the old system keeps working while its call sites migrate one at a time.
   The composition it delegates to is written out in AUDIT.md; MIGRATION.md has
   the swap. Delete this file once your last call site is gone. */

import React from 'react';
import { Surface } from '../primitives/Surface.jsx';
import { Stack } from '../primitives/Stack.jsx';
import { Text } from '../primitives/Text.jsx';
import { Rule } from '../primitives/Rule.jsx';
import { StatusDot } from '../core/StatusDot.jsx';

/** The 56px application title bar: brand, project chip, mode switch, save state.
 * tC4 local: `switchTitle` localizes the project chip's tooltip. */
export function AppHeader({ tone = 'ocean', logoSrc, projectInitials, projectName, projectMeta, switchTitle = 'Switch project', center, right, onBrandClick, onProjectClick }) {
  const dark = tone === 'ocean';
  /* Everything that used to be a `dark ? … : …` ternary is now the surface
     context doing its job: the Surface paints Ocean, sets data-on="dark", and
     every Text and Rule inside reads --fg, --fg-muted and --line from
     tokens/context.css. Twelve conditionals became one `fill`. */
  return (
    <Surface as="header" tone={dark ? 'ocean' : undefined} fill={dark ? 'solid' : 'card'}
      border={dark ? 'none' : 'hair'} radius="none" pad="0 16px"
      style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 'none',
               height: 'var(--header-height)', zIndex: 'var(--z-header)' }}>
      <Stack direction="row" gap={9} align="center" onClick={onBrandClick}
        style={{ cursor: onBrandClick ? 'pointer' : undefined }}>
        {logoSrc ? <img src={logoSrc} alt="translationCore" style={{ height: 28, width: 'auto', display: 'block' }} /> : null}
        <Text role="strong" style={{ fontSize: 'var(--fs-wordmark)', letterSpacing: 'var(--track-15-5)' }}>
          translationCore
          <Text as="span" role="labelMicro" tone="muted"
            style={{ verticalAlign: 'super', marginInlineStart: 1, letterSpacing: 'var(--track-9)' }}>®</Text>
        </Text>
      </Stack>
      <Rule orientation="vertical" />
      {projectName ? (
        <Surface as="button" fill="quiet" border="line" radius="md" interactive="quiet"
          onClick={onProjectClick} title={switchTitle}
          style={{ padding: '5px 10px 5px 8px', cursor: 'pointer', font: 'inherit' }}>
          <Stack direction="row" gap={9} align="center">
            <Surface as="span" tone={dark ? 'accent' : 'ocean'} fill="solid" radius="xs"
              style={{ width: 26, height: 26, flex: 'none', display: 'inline-flex',
                       alignItems: 'center', justifyContent: 'center' }}>
              <Text role="captionStrong" style={{ color: 'var(--tone-on-fill)' }}>{projectInitials}</Text>
            </Surface>
            <Stack direction="column" gap={1} style={{ textAlign: 'start' }}>
              <Text role="ui" tone="strong">{projectName}</Text>
              <Text role="overline" tone="muted" style={{ textTransform: 'none', letterSpacing: 'var(--track-11)' }}>{projectMeta}</Text>
            </Stack>
          </Stack>
        </Surface>
      ) : null}
      <span style={{ flex: 1 }} />
      {center}
      <span style={{ flex: 1 }} />
      {right != null ? right : <StatusDot status="valid" size={8} label="Saved" />}
    </Surface>
  );
}
