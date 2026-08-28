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
import CommunityChecking from './views/CommunityChecking.jsx';
import Understand from './views/Understand.jsx';
import { AppHeader, SegmentedControl, StatusDot, Button } from './ds/index.js';
import { t } from './i18n';

// FR-32: the indicator binds to the ACTUAL write promise via the SaveScheduler
// state machine — never optimistic.
function SaveIndicator() {
  const { s, actions } = useApp();
  if (!s.project) return null;
  const map = {
    saved: { status: 'valid', label: t('app.saved') },
    saving: { status: 'warn', label: t('app.saving') },
    dirty: { status: 'warn', label: t('app.unsaved') },
    error: { status: 'invalid', label: t('app.saveError') },
  };
  // A failed comprehension write is a save failure like any other (B1): the
  // note scheduler's state folds in here globally — not only on the
  // Understand screen — with its own retry. The effective state is the WORST
  // of the two schedulers (D65): error > saving > dirty > saved, so 'Saved'
  // never shows while either machine holds work.
  const rank = { error: 3, saving: 2, dirty: 1, saved: 0 };
  const noteState = s.noteSaveState ?? 'saved';
  const verseState = s.saveState ?? 'saved';
  const effective = (rank[noteState] ?? 0) >= (rank[verseState] ?? 0) ? noteState : verseState;
  const noteError = noteState === 'error';
  const m = map[effective] || map.saved;
  const isError = effective === 'error';
  return (
    <div data-testid="save-indicator" data-state={effective}
      style={{ fontSize: 'var(--fs-caption)', letterSpacing: 'var(--track-12)', fontWeight: 'var(--fw-heavy)', display: 'flex', alignItems: 'center', gap: 6, color: isError ? 'var(--tc-invalid-inverse)' : 'rgba(255,255,255,.66)' }}>
      <StatusDot status={m.status} size={8} />
      {m.label}
      {isError && (
        <Button size="sm" variant="outline" data-testid={noteError ? 'retry-note-save' : undefined}
          onClick={noteError ? actions.retryNoteSave : actions.retrySave}
          style={{ background: 'transparent', color: 'var(--tc-invalid-inverse)', borderColor: 'var(--tc-invalid-inverse)', padding: '3px 10px', fontSize: 'var(--fs-label)' }}>
          {t('app.retry')}
        </Button>
      )}
    </div>
  );
}

function TopBar() {
  const { s, actions } = useApp();
  const inProject = !!s.project && s.view !== 'home';
  const p = s.project;
  return (
    <AppHeader
      logoSrc={`${import.meta.env.BASE_URL}assets/translationcore-logo.png`}
      projectInitials={p ? (p.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() : undefined}
      projectName={p?.name}
      projectMeta={p ? p.languageTag : undefined}
      switchTitle={t('app.switchProject')}
      onBrandClick={actions.backToProjects}
      onProjectClick={actions.backToProjects}
      center={inProject ? (
        // D63: Publish is retired as a top-level tab — the publish flow lives
        // inside Check as the Community Checking tool (#108).
        <SegmentedControl tone="inverse" value={s.view === 'publish' ? 'check' : s.view} onChange={(v) => actions.go(v)}
          options={[
            { value: 'read', label: t('nav.understand') },
            { value: 'draft', label: t('nav.draft') },
            { value: 'check', label: t('nav.check') },
          ]} />
      ) : null}
      right={<SaveIndicator />}
    />
  );
}

export default function App() {
  const { s } = useApp();
  const appDir = s.project && s.view !== 'home'
    ? (s.project.scriptDirection === 'rtl' ? 'rtl' : 'ltr')
    : 'ltr';
  return (
    <div dir={appDir} style={{ display: 'flex', flexDirection: 'column', height: '100vh', width: '100%', background: 'var(--surface-app)', color: 'var(--text-body)', fontFamily: 'var(--font-ui)', overflow: 'hidden' }}>
      <TopBar />
      {s.view === 'home' && <Home />}
      {s.view === 'read' && <Understand />}
      {s.view === 'draft' && <Draft />}
      {s.view === 'check' && <Check />}
      {s.view === 'publish' && <CommunityChecking />}
      <NewBible />
      <AddBook />
      <ProjectSettings />
      <SourceTexts />
      <GatewayChange />
    </div>
  );
}
