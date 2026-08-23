// Home · project picker — owner-approved design (translationCore.dc.html
// lines 61-117). Project cards carry per-book tiles with a lazy draft-progress
// bar (actions.loadProgress) and open the creation / add-book / settings
// dialogs over this screen. Export is the publish increment and is omitted.
import React, { useEffect } from 'react';
import { useApp } from '../state.jsx';
import { t } from '../i18n';
import { bookName } from '../data/bookNames';

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
    <div data-testid={`project-${p.id}`}
      style={{ background: '#fff', border: '1px solid rgba(35,31,32,.1)', borderRadius: 16, padding: '22px 24px', boxShadow: '0 2px 6px rgba(1,66,99,.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <span style={{ width: 44, height: 44, borderRadius: 12, background: '#014263', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 17, flex: 'none' }}>
          {(p.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}
        </span>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span dir={dir} style={{ fontSize: 20, fontWeight: 900, color: '#014263' }}>{p.name}</span>
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '.06em', padding: '3px 8px', borderRadius: 999, background: dir === 'rtl' ? '#F6EEDC' : '#ECF2F5', color: dir === 'rtl' ? '#E59D33' : '#4F5E6A' }}>
              {dir.toUpperCase()}
            </span>
          </div>
          <span style={{ fontSize: 13, color: '#8A99A4', fontWeight: 600 }}>
            {p.languageTag} · {p.bookCodes.length} {p.bookCodes.length === 1 ? t('home.book') : t('home.books')}
          </span>
        </div>
        <button type="button" onClick={() => actions.openSettings(p)} className="hovRow"
          style={{ border: 0, background: 'transparent', cursor: 'pointer', padding: '8px 6px', fontFamily: 'inherit', fontWeight: 800, fontSize: 12.5, color: '#014263', borderRadius: 8 }}>
          {t('home.settings')}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(148px,1fr))', gap: 8 }}>
        {p.bookCodes.map((code) => {
          const pct = prog[code];
          const hasPct = typeof pct === 'number';
          return (
            <button key={code} type="button" onClick={() => actions.openProject(p.id, code)} className="hovInspireBg"
              style={{ border: '1px solid rgba(35,31,32,.1)', background: '#F7FAFC', cursor: 'pointer', borderRadius: 10, padding: '10px 12px', textAlign: 'start', fontFamily: 'inherit', minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 900, color: '#014263', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{bookName(code)}</span>
                {hasPct && (
                  <span style={{ fontSize: 10, fontWeight: 700, color: '#8A99A4', whiteSpace: 'nowrap', flex: 'none' }}>{pct}%</span>
                )}
              </div>
              <div style={{ height: 4, borderRadius: 99, background: '#ECF2F5', overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#31ADE3', borderRadius: 99, width: `${hasPct ? pct : 0}%` }} />
              </div>
            </button>
          );
        })}
        <button type="button" onClick={() => actions.openAddBook(p)} className="hovInspireBg"
          style={{ border: '1.5px dashed rgba(35,31,32,.18)', background: 'transparent', cursor: 'pointer', borderRadius: 10, padding: '10px 12px', minHeight: 62, fontFamily: 'inherit', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, color: '#8A99A4' }}>
          <span style={{ fontSize: 16, fontWeight: 800, color: '#31ADE3', lineHeight: 1 }}>+</span>
          <span style={{ fontSize: 11.5, fontWeight: 800 }}>{t('home.addBookTile')}</span>
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const { s, actions } = useApp();
  const projects = s.projects;

  return (
    <main style={{ flex: 1, overflow: 'auto', padding: '44px 40px 64px' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <h1 style={{ fontSize: 38, fontWeight: 900, color: '#014263', margin: '0 0 24px', letterSpacing: '-.02em' }}>{t('home.yourBibles')}</h1>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '0 0 14px' }}>
          <h2 style={{ fontSize: 13, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: '#8A99A4', margin: 0 }}>{t('home.projects')}</h2>
          <div style={{ flex: 1 }} />
          {/* Source texts are project-independent, so the entry point sits with
              the project list rather than inside one project (owner design:
              the modal is top-level and reachable from anywhere). */}
          <button type="button" onClick={actions.openSources} className="hovRow"
            data-testid="open-sources"
            style={{ border: 0, background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 12.5, color: '#31ADE3', padding: '8px 6px', borderRadius: 8 }}>
            {t('nav.sources')} →
          </button>
          <button type="button" onClick={actions.openNewProject} className="hovNewBible"
            style={{ border: 0, cursor: 'pointer', fontFamily: 'inherit', fontWeight: 800, fontSize: 13, padding: '9px 18px', borderRadius: 999, background: '#31ADE3', color: '#fff', boxShadow: '0 2px 6px rgba(49,173,227,.35)' }}>
            + {t('home.newBible')}
          </button>
        </div>

        {/* A refused open (e.g. the #62 seed pipeline's diagnosable STOP) routes
            back here with bookError set; without this banner the click looked
            like it did nothing (found 2026-08-22, rig journey run). */}
        {s.bookError && (
          <div role="alert" data-testid="home-open-error"
            style={{ border: '1.5px solid rgba(229,157,51,.5)', background: 'rgba(229,157,51,.08)', borderRadius: 12, padding: '12px 16px', margin: '0 0 16px', fontSize: 13.5, color: '#014263', overflowWrap: 'anywhere' }}>
            <strong>{t('home.openError')}</strong> {s.bookError}
          </div>
        )}

        {projects === null && (
          <p style={{ fontSize: 14, color: '#8A99A4' }}>{t('home.loading')}</p>
        )}

        {projects && projects.length === 0 && (
          <div style={{ border: '1.5px dashed rgba(35,31,32,.16)', borderRadius: 16, padding: '40px 24px', textAlign: 'center', color: '#8A99A4', fontSize: 15 }}>
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
