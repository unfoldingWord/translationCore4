// The dev Inspector (issue #374; TEAM-SYNC-PLAN 1.7): the last Report and the
// ops log, for the person who builds or tests the app. It shows in a dev build
// only, or in a packaged build made with VITE_TC4_INSPECTOR=1. Alt+Shift+I
// opens and closes it. It never writes.
import React, { useEffect, useState } from 'react';
import { useApp } from '../../state.jsx';
import { t } from '../../i18n';

/** Whether this build shows the Inspector.
 * @param {{ DEV?: boolean, VITE_TC4_INSPECTOR?: string }} env */
export const inspectorEnabled = (env = import.meta.env) => env.DEV === true || env.VITE_TC4_INSPECTOR === '1';

const cell = { padding: '2px 8px', textAlign: 'start', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-caption)' };

export function InspectorPanel({ ops }) {
  const closed = ops.entries.filter((e) => e.report);
  const last = closed[closed.length - 1]?.report ?? null;
  return (
    <aside data-testid="dev-inspector" aria-label={t('inspector.title')}
      style={{ position: 'fixed', insetInlineEnd: 12, bottom: 12, width: 520, maxHeight: '70vh', overflow: 'auto', zIndex: 1000, background: 'var(--surface-card)', border: 'var(--stroke) solid var(--border)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <strong style={{ color: 'var(--uw-ocean)' }}>{t('inspector.title')}</strong>
      {ops.errors.length > 0 && (
        <ul data-testid="dev-inspector-errors" style={{ margin: 0, paddingInlineStart: 18, color: 'var(--tc-warn-text)', fontSize: 'var(--fs-caption-lg)' }}>
          {ops.errors.map((e, i) => <li key={`${e.id}:${i}`}>{t('inspector.writeFailed', { op: e.op, error: e.error })}</li>)}
        </ul>
      )}
      <span style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-ui-sm)' }}>{t('inspector.lastReport')}</span>
      <pre data-testid="dev-inspector-report" style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 'var(--fs-caption)' }}>
        {last ? JSON.stringify(last, null, 2) : t('inspector.none')}
      </pre>
      <span style={{ fontWeight: 'var(--fw-bold)', fontSize: 'var(--fs-ui-sm)' }}>{t('inspector.log')}</span>
      <table data-testid="dev-inspector-log" style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {[...ops.entries].reverse().map((e) => (
            <tr key={e.id} data-op={e.op} data-state={e.report ? (e.report.ok ? 'ok' : 'failed') : 'open'}>
              <td style={cell}>{e.startedAt}</td>
              <td style={cell}>{e.op}</td>
              <td style={cell}>{e.report ? (e.report.ok ? 'ok' : (e.report.code ?? 'failed')) : t('inspector.open')}</td>
              <td style={cell}>{e.facts.repoPath ?? ''}{e.report?.facts?.rolledBack ? ` · ${t('inspector.rolledBack')}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}

export default function Inspector() {
  const { s } = useApp();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey && e.shiftKey && e.code === 'KeyI') setOpen((v) => !v);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (!inspectorEnabled() || !open) return null;
  return <InspectorPanel ops={s.ops} />;
}
