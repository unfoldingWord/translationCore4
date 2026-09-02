// Home · project picker — owner-approved design, rebuilt on the design system
// (epic #104 / #109; layout per templates/translationcore-app Home). Project
// cards carry per-book tiles with a lazy draft-progress bar
// (actions.loadProgress) and open the creation / add-book / settings dialogs
// over this screen. Export is the publish increment and is omitted.
import React, { useEffect, useState } from 'react';
import { useApp } from '../state.jsx';
import { t } from '../i18n';
import { bookName } from '../data/bookNames';
import { Card, BookTile, Button, Overline, Badge, Callout } from '../ds/index.js';

// Above this many books a card shows only its in-progress books until expanded.
const COLLAPSE_ABOVE = 12;

// Plain text action in a card header (Settings, Export): hairline hover, no fill.
const HEADER_ACTION = { border: 0, background: 'transparent', cursor: 'pointer', padding: '8px 6px', fontFamily: 'var(--font-ui)', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-caption-lg)', letterSpacing: 'var(--track-12-5)', color: 'var(--text-heading)', borderRadius: 'var(--radius-sm)' };

function ProjectCard({ p }) {
  const { s, actions } = useApp();
  const [expanded, setExpanded] = useState(false);
  // loadProgress caches by repoPath and no-ops on a warm cache, so the id is
  // the only dependency that matters.
  useEffect(() => {
    actions.loadProgress(p);
  }, [p.id]);
  const prog = s.progressByProject[p.id] || {};
  const dir = p.scriptDirection === 'rtl' ? 'rtl' : 'ltr';

  const known = (code) => typeof prog[code] === 'number';
  const inProgress = p.bookCodes.filter((code) => known(code) && prog[code] > 0);
  const many = p.bookCodes.length > COLLAPSE_ABOVE;
  // Until every book's progress is known the filter would hide books whose
  // state is simply unread, so the full list stays up while loading.
  const allKnown = p.bookCodes.every(known);
  const shown = many && !expanded && allKnown ? inProgress : p.bookCodes;

  return (
    <Card data-testid={`project-${p.id}`} padding="22px 24px">
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <span style={{ width: 44, height: 44, borderRadius: 'var(--radius-lg)', background: 'var(--uw-ocean)', color: 'var(--text-inverse)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'var(--fw-black)', fontSize: 'var(--fs-title)', letterSpacing: 'var(--track-17)', flex: 'none' }}>
          {(p.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
        </span>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span dir={dir} style={{ fontSize: 'var(--fs-h3)', letterSpacing: 'var(--track-20)', fontWeight: 'var(--fw-black)', color: 'var(--text-heading)' }}>{p.name}</span>
            <Badge size="sm" tone={dir === 'rtl' ? 'warn' : 'neutral'} style={dir === 'rtl' ? undefined : { color: 'var(--text-secondary)' }}>{dir.toUpperCase()}</Badge>
          </div>
          <span style={{ fontSize: 'var(--fs-ui-sm)', color: 'var(--text-tertiary)', fontWeight: 'var(--fw-medium)' }}>
            {p.languageTag} · {p.bookCodes.length} {p.bookCodes.length === 1 ? t('home.book') : t('home.books')} · {t('home.inProgress', { n: inProgress.length })}
          </span>
        </div>
        <button type="button" data-tc="quiet" title={t('home.settings')} onClick={() => actions.openSettings(p)} style={HEADER_ACTION}>
          {t('home.settings')}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(148px,1fr))', gap: 8 }}>
        {shown.map((code) => {
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
          style={{ border: 'var(--stroke-selected) dashed var(--border-strong)', background: 'transparent', cursor: 'pointer', borderRadius: 'var(--radius-md)', padding: '10px 12px', minHeight: 62, fontFamily: 'var(--font-ui)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: 'var(--text-tertiary)' }}>
          <span style={{ fontSize: 'var(--fs-title-sm)', letterSpacing: 'var(--track-16)', fontWeight: 'var(--fw-heavy)', color: 'var(--text-accent)', lineHeight: 1 }}>+</span>
          <span style={{ fontSize: 'var(--fs-meta)', letterSpacing: 'var(--track-11-5)', fontWeight: 'var(--fw-heavy)' }}>{t('home.addBookTile')}</span>
        </button>
      </div>
      {many && allKnown && (
        <Button variant="ghost" onClick={() => setExpanded((v) => !v)} data-testid={`toggle-books-${p.id}`}
          style={{ marginTop: 12 }}>
          {expanded ? t('home.showInProgress') : t('home.showAll', { n: p.bookCodes.length })} →
        </Button>
      )}
    </Card>
  );
}

// Ocean banner: the most recent draft edit on this machine, one click back
// into that chapter. Hidden until a draft edit has been recorded.
function ResumeCard({ edit, projects }) {
  const { actions } = useApp();
  const project = projects.find((p) => p.id === edit.repoPath);
  if (!project) return null;
  const resume = async () => {
    await actions.openProject(edit.repoPath, edit.book);
    if (edit.chapter && edit.chapter !== 1) actions.setChapter(edit.chapter);
  };
  const dir = project.scriptDirection === 'rtl' ? 'rtl' : 'ltr';
  return (
    <div role="button" tabIndex={0} data-testid="resume-card" onClick={resume}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); resume(); } }}
      style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '22px 24px', background: 'var(--uw-ocean)', borderRadius: 'var(--radius-xl)', cursor: 'pointer', boxShadow: 'var(--shadow-hero)', marginBottom: 34 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 'var(--fs-h2)', letterSpacing: 'var(--track-22)', fontWeight: 'var(--fw-black)', color: 'var(--text-inverse)', margin: '0 0 2px' }}>
          <span dir={dir}>{project.name}</span> · {bookName(edit.book)} {edit.chapter}
        </p>
        <p dir={edit.snippet ? dir : undefined} style={{ fontSize: 'var(--fs-ui-sm)', color: 'rgba(255,255,255,.72)', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {edit.snippet ? t('home.lastEdited', { v: edit.verse, text: edit.snippet }) : t('home.lastEditedEmpty', { v: edit.verse })}
        </p>
      </div>
      <span data-tc="fill" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '11px 20px', background: 'var(--accent)', color: 'var(--text-inverse)', borderRadius: 'var(--radius-pill)', fontWeight: 'var(--fw-heavy)', fontSize: 'var(--fs-ui-md)', whiteSpace: 'nowrap' }}>
        {t('home.resume')} →
      </span>
    </div>
  );
}

export default function Home() {
  const { s, actions } = useApp();
  const projects = s.projects;

  return (
    <main style={{ flex: 1, overflow: 'auto', padding: '44px 40px 64px', background: 'var(--surface-app)' }}>
      <div style={{ maxWidth: 'var(--measure-page)', margin: '0 auto' }}>
        <h1 style={{ fontSize: 'var(--fs-display)', letterSpacing: 'var(--track-38)', margin: '0 0 24px' }}>{t('home.yourBibles')}</h1>

        {s.lastEdit && projects && <ResumeCard edit={s.lastEdit} projects={projects} />}

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
