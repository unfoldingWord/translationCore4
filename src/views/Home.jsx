// Home · project picker — owner-approved design, rebuilt on the design system
// (epic #104 / #109; layout per templates/translationcore-app Home). Project
// cards carry per-book tiles with a lazy draft-progress bar
// (actions.loadProgress) and open the creation / add-book / settings dialogs
// over this screen. Export is the publish increment and is omitted.
import React, { useEffect } from 'react';
import { useApp } from '../state.jsx';
import { t } from '../i18n';
import { bookName } from '../data/bookNames';
import { Card, BookTile, Button, Overline, Badge, Callout } from '../ds/index.js';

function ProjectCard({ p }) {
  const { s, actions } = useApp();
  // loadProgress caches by repoPath and no-ops on a warm cache, so the id is
  // the only dependency that matters.
  useEffect(() => {
    actions.loadProgress(p);
  }, [p.id]);
  const prog = s.progressByProject[p.id] || {};
  const dir = p.scriptDirection === 'rtl' ? 'rtl' : 'ltr';

  return (
    <Card data-testid={`project-${p.id}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <span style={{ width: 44, height: 44, borderRadius: 'var(--radius-lg)', background: 'var(--uw-ocean)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'var(--fw-black)', fontSize: 17, flex: 'none' }}>
          {(p.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
        </span>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span dir={dir} style={{ fontSize: 'var(--fs-h3)', letterSpacing: 'var(--track-20)', fontWeight: 'var(--fw-black)', color: 'var(--uw-ocean)' }}>{p.name}</span>
            <Badge tone={dir === 'rtl' ? 'warn' : 'neutral'}>{dir.toUpperCase()}</Badge>
          </div>
          <span style={{ fontSize: 'var(--fs-ui-sm)', letterSpacing: 'var(--track-13)', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-bold)' }}>
            {p.languageTag} · {p.bookCodes.length} {p.bookCodes.length === 1 ? t('home.book') : t('home.books')}
          </span>
        </div>
        <Button variant="ghost" onClick={() => actions.openSettings(p)} style={{ color: 'var(--uw-ocean)' }}>
          {t('home.settings')}
        </Button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(148px,1fr))', gap: 8 }}>
        {p.bookCodes.map((code) => {
          const pct = prog[code];
          const hasPct = typeof pct === 'number';
          // Catch-to-absence sweep (D30): pct null/undefined = UNKNOWN (not
          // yet read, or the read failed) — an em-dash, never a false 0% bar
          // claiming "no drafting has been done".
          return (
            <BookTile key={code} name={bookName(code)} percent={hasPct ? pct : 0}
              meta={hasPct ? undefined : '—'} onClick={() => actions.openProject(p.id, code)} />
          );
        })}
        <button type="button" onClick={() => actions.openAddBook(p)} data-tc="surface"
          style={{ border: 'var(--stroke-selected) dashed var(--border-dashed)', background: 'transparent', cursor: 'pointer', borderRadius: 'var(--radius-md)', padding: '10px 12px', minHeight: 62, fontFamily: 'var(--font-ui)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: 'var(--text-tertiary)' }}>
          <span style={{ fontSize: 16, fontWeight: 'var(--fw-heavy)', color: 'var(--accent)', lineHeight: 1 }}>+</span>
          <span style={{ fontSize: '11.5px', fontWeight: 'var(--fw-heavy)' }}>{t('home.addBookTile')}</span>
        </button>
      </div>
    </Card>
  );
}

export default function Home() {
  const { s, actions } = useApp();
  const projects = s.projects;

  return (
    <main style={{ flex: 1, overflow: 'auto', padding: '44px 40px 64px', background: 'var(--surface-app)' }}>
      <div style={{ maxWidth: 'var(--measure-page)', margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 24px' }}>{t('home.yourBibles')}</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 14px' }}>
          <Overline as="h2" style={{ letterSpacing: '.12em', margin: 0 }}>{t('home.projects')}</Overline>
          <div style={{ flex: 1 }} />
          {/* Source texts are project-independent, so the entry point sits with
              the project list rather than inside one project (owner design:
              the modal is top-level and reachable from anywhere). */}
          <Button variant="ghost" onClick={actions.openSources} data-testid="open-sources">
            {t('nav.sources')} →
          </Button>
          <Button onClick={actions.openNewProject}>+ {t('home.newBible')}</Button>
        </div>

        {/* A refused open (e.g. the #62 seed pipeline's diagnosable STOP) routes
            back here with bookError set; without this banner the click looked
            like it did nothing (found 2026-08-22, rig journey run). */}
        {s.bookError && (
          <Callout tone="warn" role="alert" data-testid="home-open-error"
            style={{ margin: '0 0 16px', overflowWrap: 'anywhere' }}>
            <strong>{t('home.openError')}</strong> {s.bookError}{' '}
            {projects === null && (
              // Catch-to-absence sweep (D30): a failed project LISTING keeps
              // projects unknown — retry in place, never the "No projects
              // yet" invitation to create a duplicate.
              <Button size="sm" variant="outline" data-testid="projects-retry" onClick={() => actions.refreshProjects()}>
                {t('app.retry')}
              </Button>
            )}
          </Callout>
        )}

        {projects === null && !s.bookError && (
          <p style={{ fontSize: 'var(--fs-ui)', color: 'var(--text-tertiary)' }}>{t('home.loading')}</p>
        )}

        {projects && projects.length === 0 && (
          <div style={{ border: 'var(--stroke-selected) dashed var(--border-dashed)', borderRadius: 'var(--radius-xl)', padding: '40px 24px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--fs-ui-md)' }}>
            {t('home.noProjects')}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {projects && projects.map((p) => <ProjectCard key={p.id} p={p} />)}
        </div>
      </div>
    </main>
  );
}
