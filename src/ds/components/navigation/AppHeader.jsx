import React from 'react';
import { StatusDot } from '../core/StatusDot.jsx';
import { Divider } from '../core/Divider.jsx';

/** The 56px application title bar: brand, project chip, mode switch, save state.
 * `switchTitle` localizes the project chip's tooltip. */
export function AppHeader({ tone = 'ocean', logoSrc, projectInitials, projectName, projectMeta, switchTitle = 'Switch project', center, right, onBrandClick, onProjectClick }) {
  const dark = tone === 'ocean';
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 14, height: 'var(--header-height)', flex: 'none',
      padding: '0 16px', zIndex: 30,
      background: dark ? 'var(--uw-ocean)' : '#fff',
      borderBottom: dark ? 'none' : 'var(--stroke-hair) solid var(--border)' }}>
      <div onClick={onBrandClick} style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
        {logoSrc ? <img src={logoSrc} alt="translationCore" style={{ height: 28, width: 'auto', display: 'block' }} /> : null}
        <span style={{ fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-wordmark)', letterSpacing: 'var(--track-15-5)', color: dark ? '#fff' : 'var(--uw-ocean)' }}>
          translationCore<span style={{ fontSize: 'var(--fs-micro)', letterSpacing: 'var(--track-9)', fontWeight: 'var(--fw-bold)', verticalAlign: 'super', marginInlineStart: 1, color: dark ? 'rgba(255,255,255,.6)' : 'var(--text-tertiary)' }}>®</span>
        </span>
      </div>
      <Divider orientation="vertical" inverse={dark} />
      {projectName ? (
        <button type="button" onClick={onProjectClick} title={switchTitle} style={{ cursor: 'pointer', borderRadius: 'var(--radius-md)',
          padding: '5px 10px 5px 8px', display: 'flex', alignItems: 'center', gap: 9, fontFamily: 'inherit',
          border: 'var(--stroke) solid ' + (dark ? 'var(--border-inverse)' : 'var(--border)'),
          background: dark ? 'rgba(255,255,255,.08)' : 'var(--surface-app)' }}>
          <span style={{ width: 26, height: 26, borderRadius: 'var(--radius-xs)', color: '#fff', background: dark ? 'var(--accent)' : 'var(--uw-ocean)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', flex: 'none' }}>{projectInitials}</span>
          <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, textAlign: 'start' }}>
            <span style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', fontWeight: 'var(--fw-heavy)', color: dark ? '#fff' : 'var(--uw-ocean)' }}>{projectName}</span>
            <span style={{ fontSize: 'var(--fs-label)', letterSpacing: 'var(--track-11)', color: dark ? 'rgba(255,255,255,.6)' : 'var(--text-tertiary)' }}>{projectMeta}</span>
          </span>
        </button>
      ) : null}
      <div style={{ flex: 1 }} />
      {center}
      <div style={{ flex: 1 }} />
      {right != null ? right : (
        <span style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', fontWeight: 'var(--fw-bold)', display: 'flex', alignItems: 'center', gap: 6,
          color: dark ? 'rgba(255,255,255,.6)' : 'var(--text-tertiary)' }}><StatusDot status="valid" size={8} />Saved</span>
      )}
    </header>
  );
}
