import React from 'react';
import { useApp } from './state.jsx';
import Home from './views/Home.jsx';
import Draft from './views/Draft.jsx';
import Check from './views/Check.jsx';
import NewBible from './views/modals/NewBible.jsx';
import AddBook from './views/modals/AddBook.jsx';
import ProjectSettings from './views/modals/ProjectSettings.jsx';
import SourceTexts from './views/modals/SourceTexts.jsx';
import GatewayChange from './views/modals/GatewayChange.jsx';
import { t } from './i18n';

// Ocean header (owner's design update, 2026-07-31): the title bar is dark
// (#014263) with light-on-dark text everywhere.
const HDR = {
  dim: 'rgba(255,255,255,.66)',
  rule: 'rgba(255,255,255,.22)',
  chipBorder: '1px solid rgba(255,255,255,.22)',
  chipBg: 'rgba(255,255,255,.08)',
  track: 'rgba(255,255,255,.10)',
};

// FR-32: the indicator binds to the ACTUAL write promise via the SaveScheduler
// state machine — never optimistic.
function SaveIndicator() {
  const { s, actions } = useApp();
  if (!s.project) return null;
  const map = {
    saved: { dot: '#58C17A', label: t('app.saved') },
    saving: { dot: '#E59D33', label: t('app.saving') },
    dirty: { dot: '#E59D33', label: t('app.unsaved') },
    error: { dot: '#FF8B8B', label: t('app.saveError') },
  };
  const m = map[s.saveState] || map.saved;
  return (
    <div data-testid="save-indicator" data-state={s.saveState} style={{ fontSize: 12, fontWeight: 700, color: s.saveState === 'error' ? '#FF8B8B' : HDR.dim, display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: 99, background: m.dot, display: 'inline-block' }} />
      {m.label}
      {s.saveState === 'error' && (
        <button type="button" onClick={actions.retrySave}
          style={{ cursor: 'pointer', border: '1px solid #FF8B8B', background: 'transparent', color: '#FF8B8B', fontWeight: 800, fontSize: 11, borderRadius: 999, padding: '3px 10px' }}>
          {t('app.retry')}
        </button>
      )}
    </div>
  );
}

function TopBar() {
  const { s, actions } = useApp();
  const inProject = !!s.project && s.view !== 'home';
  const p = s.project;
  const dir = p?.scriptDirection === 'rtl' ? 'rtl' : 'ltr';
  // Ocean segmented control: the active mode is a WHITE pill on the dark bar.
  const seg = (v) => (v === s.view
    ? { background: '#fff', color: '#014263', boxShadow: '0 1px 3px rgba(1,20,32,.28)' }
    : { background: 'transparent', color: 'rgba(255,255,255,.78)' });
  const segBtn = { border: 0, cursor: 'pointer', fontWeight: 800, fontSize: 13, padding: '7px 16px', borderRadius: 999 };
  return (
    <header style={{ display: 'flex', alignItems: 'center', gap: 14, height: 56, flex: 'none', padding: '0 16px', background: '#014263', zIndex: 30 }}>
      <div onClick={actions.backToProjects} style={{ display: 'flex', alignItems: 'center', gap: 9, cursor: 'pointer' }}>
        <img src={`${import.meta.env.BASE_URL}assets/translationcore-logo.png`} alt="translationCore" style={{ height: 28, width: 'auto', display: 'block' }} />
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{ fontWeight: 800, fontSize: 15.5, color: '#fff', letterSpacing: '-.015em' }}>
            translationCore
            <span style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.7)', verticalAlign: 'super', marginInlineStart: 1 }}>®</span>
          </span>
        </div>
      </div>
      {p && (
        <>
          <div style={{ width: 1, height: 26, background: HDR.rule }} />
          <button onClick={actions.backToProjects} type="button" title={t('app.switchProject')}
            style={{ border: HDR.chipBorder, background: HDR.chipBg, cursor: 'pointer', borderRadius: 10, padding: '5px 10px 5px 8px', display: 'flex', alignItems: 'center', gap: 9 }}>
            <span style={{ width: 26, height: 26, borderRadius: 8, background: '#31ADE3', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 12, flex: 'none' }}>
              {(p.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
            </span>
            <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, textAlign: 'start' }}>
              <span style={{ fontSize: 13, fontWeight: 800, color: '#fff' }}>{p.name}</span>
              <span style={{ fontSize: 11, color: HDR.dim }}>{p.languageTag}</span>
            </span>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.06em', padding: '2px 6px', borderRadius: 999, background: dir === 'rtl' ? '#F6EEDC' : 'rgba(255,255,255,.16)', color: dir === 'rtl' ? '#E59D33' : 'rgba(255,255,255,.85)' }}>{dir.toUpperCase()}</span>
          </button>
        </>
      )}
      {/* book/chapter chip removed from the top bar (owner, 2026-07-31) —
          the Draft header already shows "Book N" */}
      <div style={{ flex: 1 }} />
      {inProject && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, padding: 3, background: HDR.track, borderRadius: 999 }}>
          <button onClick={() => actions.go('draft')} type="button" style={{ ...segBtn, ...seg('draft') }}>{t('nav.draft')}</button>
          <button onClick={() => actions.go('check')} type="button" style={{ ...segBtn, ...seg('check') }}>{t('nav.check')}</button>
          <button onClick={() => actions.go('publish')} type="button" style={{ ...segBtn, ...seg('publish') }}>{t('nav.publish')}</button>
        </div>
      )}
      <div style={{ flex: 1 }} />
      <SaveIndicator />
    </header>
  );
}

// Checking and publishing arrive in their own increments (journey-not-screen
// rule). A real project shows a designed placeholder, not fixture data.
function LaterIncrement({ what, increment }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ textAlign: 'center', maxWidth: 420, padding: 24 }}>
        <p style={{ fontSize: 40, margin: '0 0 8px' }}>🌱</p>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: '#014263', margin: '0 0 8px' }}>{what}</h2>
        <p style={{ fontSize: 14, color: '#8A99A4', lineHeight: 1.6, margin: 0 }}>
          {t('app.laterIncrement', { increment })}
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const { s } = useApp();
  const appDir = s.project && s.view !== 'home'
    ? (s.project.scriptDirection === 'rtl' ? 'rtl' : 'ltr')
    : 'ltr';
  return (
    <div dir={appDir} style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', background: '#F7FAFC', color: '#1E2C36', fontFamily: "'Mulish',sans-serif", overflow: 'hidden' }}>
      <TopBar />
      {s.view === 'home' && <Home />}
      {s.view === 'draft' && <Draft />}
      {s.view === 'check' && <Check />}
      {s.view === 'publish' && <LaterIncrement what={t('app.publishing')} increment={t('app.publishIncrement')} />}
      <NewBible />
      <AddBook />
      <ProjectSettings />
      <SourceTexts />
      <GatewayChange />
    </div>
  );
}
