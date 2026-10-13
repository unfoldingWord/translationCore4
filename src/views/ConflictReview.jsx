// The conflict review (#679, epic #24; owner mockup 2026-10-13, artboards a and
// b). It shows one verse-text conflict at a time, in Translate: every version
// of the verse with its owner and date, newest first. "Mine" always has one
// background colour and every teammate's version the other, so the colour
// follows the owner, not the position. A click selects a version and the
// others fade (darker text, not opacity: contrast). "Keep this version" writes
// one verse edit that replaces every version (resolveVerse). The translator
// can leave at any time; the open conflicts stay listed. The screen reads the
// fold (s.verseConflicts) and does not start a sync.
import React, { useEffect, useState } from 'react';
import { useApp } from '../state.jsx';
import { t } from '../i18n';
import { bookName } from '../data/bookNames';
import { isSourceAbsent } from '../data/sourceState';
import { Button, Callout, Overline } from '../ds/index.js';
import { actorLabel } from './actorLabel.js';
import { projectDir, targetTypeFor } from './scriptStyle.js';
import { verseText } from './verseText.js';
import { hair } from './draftChrome.jsx';

// Owner shading (owner ruling 2026-10-13): Mine light blue, every teammate cream.
const OWNER_FILL = { mine: 'var(--uw-inspire-200)', teammate: 'var(--uw-cream)' };
const MEASURE = { maxWidth: 860, margin: '0 auto' };

/** The wall-clock part of a §8.2 ts, as the Home card writes a date (machine
 * locale), with the year and the time: two versions can come from one day. */
const versionDate = (ts) => {
  const at = new Date(ts.slice(0, ts.indexOf('|')));
  const day = at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  const time = at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
};

const Icon = ({ d, size = 14, width = 2.2 }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" style={{ flex: 'none', display: 'block' }}>
    {d.map((p) => <path key={p} d={p} />)}
  </svg>
);

/** The ULT verse above the versions, when Translate has it: the conflict's
 * book is the open book, the ULT is loaded, and the source pane uses the
 * project's own numbering (Translate's pane is frame-naive). Else nothing. */
function UltReference({ s, conflict }) {
  const ult = s.sources?.ult;
  if (conflict.book !== s.book || !ult || isSourceAbsent(ult) || s.understand?.sourceRefs != null) return null;
  const v = ult.chapters?.[conflict.chapter]?.[conflict.verse];
  const text = v ? verseText(v) : '';
  if (!text) return null;
  return (
    <div data-testid="conflict-ult" style={{ padding: '12px 16px', borderRadius: 'var(--radius-lg)', background: 'var(--surface-card)', border: 'var(--stroke-hair) solid var(--border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Overline tone="muted">{t('source.ult')} · {t('source.ult.name')}</Overline>
      <span lang="en" style={{ fontFamily: 'var(--font-scripture)', fontSize: 'var(--fs-verse-sm)', lineHeight: 'var(--lh-verse-sm)', color: 'var(--text-scripture)' }}>{text}</span>
    </div>
  );
}

function VersionCard({ version, owner, label, date, selected, faded, type, dir, onSelect }) {
  const mine = owner === 'mine';
  return (
    <button type="button" aria-pressed={selected} aria-label={t('conflicts.versionLabel', { version: label, date })}
      data-testid="conflict-version" data-owner={owner} data-ts={version.ts} onClick={onSelect}
      style={{ boxSizing: 'border-box', width: '100%', textAlign: 'start', cursor: 'pointer', fontFamily: 'var(--font-ui)', background: OWNER_FILL[owner], border: `2px solid ${selected ? 'var(--uw-ocean)' : 'transparent'}`, borderRadius: 'var(--radius-lg)', padding: '15px 19px', boxShadow: selected ? 'var(--shadow-hover)' : 'none', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span style={{ paddingTop: 1 }}>
        {selected ? (
          <span style={{ width: 22, height: 22, borderRadius: 'var(--radius-pill)', background: 'var(--uw-ocean)', color: 'var(--text-inverse)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <Icon d={['M5 12.5l4.5 4.5L19 7.5']} width={2.6} />
          </span>
        ) : (
          <span style={{ display: 'block', width: 22, height: 22, boxSizing: 'border-box', borderRadius: 'var(--radius-pill)', border: `var(--stroke-selected) solid ${faded ? 'var(--uw-slate)' : 'var(--uw-steel)'}`, background: 'var(--surface-card)' }} />
        )}
      </span>
      <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span data-testid="conflict-owner" style={{ display: 'inline-flex', alignItems: 'center', padding: '3px 10px', borderRadius: 'var(--radius-pill)', fontSize: 'var(--fs-label)', fontWeight: 'var(--fw-heavy)', letterSpacing: '.02em', ...(mine ? { background: 'var(--uw-ocean)', color: 'var(--text-inverse)' } : { background: 'var(--surface-card)', color: 'var(--uw-ink)', border: 'var(--stroke-hair) solid var(--border-input)' }) }}>{label}</span>
          <span data-testid="conflict-date" style={{ fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-bold)', color: 'var(--uw-ink)' }}>{date}</span>
        </span>
        <span data-testid="conflict-text" dir={dir}
          style={{ ...type, ...(faded && type.fontSize === 'var(--fs-verse-md)' ? { fontSize: 'var(--fs-verse)', lineHeight: 'var(--lh-verse)' } : null), color: faded ? 'var(--uw-slate)' : 'var(--text-scripture)', whiteSpace: 'pre-wrap' }}>
          {version.text.trim()}
        </span>
      </span>
    </button>
  );
}

/** "Conflict n of m", Previous and Next. A step off either end of the list is
 * off, and so is every step while a keep is in flight. */
function Navigator({ conflicts, index, onShow, busy }) {
  return (
    <>
      <span aria-live="polite" data-testid="conflict-position" data-n={index + 1} data-m={conflicts.length}
        style={{ fontSize: 'var(--fs-ui-sm)', fontWeight: 'var(--fw-heavy)', color: 'var(--uw-slate)' }}>
        {t('conflicts.position', { n: index + 1, m: conflicts.length })}
      </span>
      <Button variant="secondary" size="sm" data-testid="conflict-previous" disabled={busy || index === 0}
        onClick={() => onShow(conflicts[index - 1].key)} style={{ padding: '0 16px 0 12px' }}>
        <Icon d={['M15 18l-6-6 6-6']} />{t('conflicts.previous')}
      </Button>
      <Button variant="secondary" size="sm" data-testid="conflict-next" disabled={busy || index === conflicts.length - 1}
        onClick={() => onShow(conflicts[index + 1].key)} style={{ padding: '0 12px 0 16px' }}>
        {t('conflicts.next')}<Icon d={['M9 18l6-6-6-6']} />
      </Button>
    </>
  );
}

/** The footer: the hint, or what "Keep this version" does with the selected version. */
function KeepBar({ versions, kept, keptName, busy, onCancel, onKeep }) {
  const others = versions.length - 1;
  const [before, after] = t(others === 1 ? 'conflicts.replacesOne' : 'conflicts.replacesMany', { n: others }).split('{version}');
  return (
    <div style={{ flex: 'none', boxSizing: 'border-box', height: 68, display: 'flex', alignItems: 'center', padding: '0 24px', background: 'var(--surface-card)', borderTop: hair }}>
      <div style={{ ...MEASURE, width: '100%', display: 'flex', alignItems: 'center', gap: 12 }}>
        {kept ? (
          <span data-testid="conflict-consequence" style={{ fontSize: 'var(--fs-ui-sm)', lineHeight: 1.45, fontWeight: 'var(--fw-medium)', color: 'var(--uw-ink)' }}>
            {before}<strong style={{ fontWeight: 'var(--fw-heavy)' }}>{keptName}</strong>{after}
          </span>
        ) : (
          <span style={{ fontSize: 'var(--fs-ui-sm)', fontWeight: 'var(--fw-bold)', color: 'var(--uw-slate)' }}>{t('conflicts.hint')}</span>
        )}
        <span style={{ flex: 1 }} />
        {kept && (
          <Button variant="secondary" data-testid="conflict-cancel" onClick={onCancel}>{t('conflicts.cancel')}</Button>
        )}
        <Button variant="ocean" data-testid="conflict-keep" disabled={!kept || busy} onClick={onKeep}>{t('conflicts.keep')}</Button>
      </div>
    </div>
  );
}

const NO_TEAM = { me: null, names: {}, actors: [] };

export default function ConflictReview() {
  const { s, actions } = useApp();
  const conflicts = s.verseConflicts;
  const index = Math.max(0, conflicts.findIndex((c) => c.key === s.conflictReview?.key));
  const conflict = conflicts[index];
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setSelected(null), [conflict?.key]);

  const team = s.team || NO_TEAM;
  const label = (actor) => actorLabel(actor, team.names, team.me, team.actors);
  const back = s.book ? t('conflicts.back', { place: `${bookName(s.book)} ${s.chapter}` }) : t('conflicts.backToTranslate');

  const keep = async () => {
    setBusy(true);
    try {
      await actions.keepVersion(conflict.key, selected);
    } finally {
      setBusy(false);
    }
  };

  // Newest first: the fork lists its heads in ts order.
  const versions = conflict ? [...conflict.versions].reverse() : [];
  const kept = versions.find((v) => v.ts === selected);
  const keptName = kept && (kept.actor === team.me ? t('conflicts.myVersion') : t('conflicts.theirVersion', { owner: label(kept.actor) }));

  return (
    <main data-testid="conflict-review" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'var(--surface-app)' }}>
      <div style={{ height: 53, flex: 'none', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 14, padding: '0 24px', background: 'var(--surface-card)', borderBottom: 'var(--stroke-hair) solid var(--border)' }}>
        <Button variant="ghost" data-testid="conflict-back" disabled={busy} onClick={actions.closeConflictReview}
          style={{ padding: 0, height: 'auto', fontSize: 'var(--fs-ui-sm)' }}>
          <Icon d={['M19 12H5', 'M12 19l-7-7 7-7']} size={16} width={2} />{back}
        </Button>
        <span aria-hidden="true" style={{ width: 1, height: 22, background: 'var(--border)' }} />
        <h1 style={{ margin: 0, fontSize: 'var(--fs-title)', letterSpacing: 'var(--track-17)', fontWeight: 'var(--fw-heavy)', color: 'var(--text-heading)' }}>{t('conflicts.title')}</h1>
        <span style={{ flex: 1 }} />
        {conflict && <Navigator conflicts={conflicts} index={index} onShow={actions.showConflict} busy={busy} />}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '22px 24px' }}>
        {conflict ? (
          <ConflictVersions s={s} conflict={conflict} versions={versions} team={team} label={label} selected={selected} onSelect={setSelected} />
        ) : (
          <p data-testid="conflict-none" style={{ ...MEASURE, fontSize: 'var(--fs-ui)', color: 'var(--text-tertiary)' }}>{t('conflicts.none')}</p>
        )}
      </div>

      {conflict && (
        <KeepBar versions={versions} kept={kept} keptName={keptName} busy={busy} onCancel={() => setSelected(null)} onKeep={keep} />
      )}
    </main>
  );
}

/** One conflict: the verse, its versions newest first, and a refused keep. */
function ConflictVersions({ s, conflict, versions, team, label, selected, onSelect }) {
  const ref = `${bookName(conflict.book)} ${conflict.chapter}:${conflict.verse}`;
  const type = targetTypeFor(s, 'md');
  const dir = projectDir(s);
  return (
    <div role="group" aria-label={t('conflicts.versionsOf', { ref })}
      style={{ ...MEASURE, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <h2 data-testid="conflict-ref" style={{ margin: 0, fontSize: 'var(--fs-h2)', letterSpacing: 'var(--track-22)', fontWeight: 'var(--fw-black)', color: 'var(--text-heading)' }}>
          {ref}
        </h2>
        <span style={{ fontSize: 'var(--fs-ui-sm)', fontWeight: 'var(--fw-medium)', color: 'var(--text-tertiary)' }}>{t('conflicts.versionCount', { n: versions.length })}</span>
        <span style={{ flex: 1 }} />
        <span style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 'var(--fs-caption)', fontWeight: 'var(--fw-bold)', color: 'var(--uw-slate)' }}>
          {['mine', 'teammate'].map((owner) => (
            <span key={owner} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 14, height: 14, borderRadius: 'var(--radius-xs)', background: OWNER_FILL[owner], border: 'var(--stroke-hair) solid var(--border-input)' }} />
              {t(owner === 'mine' ? 'conflicts.mine' : 'conflicts.teammates')}
            </span>
          ))}
        </span>
      </div>
      <UltReference s={s} conflict={conflict} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
        {versions.map((v) => (
          <VersionCard key={v.ts} version={v} owner={v.actor === team.me ? 'mine' : 'teammate'} label={label(v.actor)} date={versionDate(v.ts)}
            selected={selected === v.ts} faded={selected !== null && selected !== v.ts} type={type} dir={dir}
            onSelect={() => onSelect(v.ts)} />
        ))}
      </div>
      {s.conflictReview?.error && (
        <Callout tone="warn" role="alert" data-testid="conflict-error" style={{ overflowWrap: 'anywhere' }}>
          <strong>{t('conflicts.keepError')}</strong> {s.conflictReview.error}
        </Callout>
      )}
    </div>
  );
}
