// The import screen (issue #361; owner design "tC4 Import Dialog", 2026-09-22):
// choose the kind of file → drop or choose files → review what was found →
// import as a new Bible. Bound to the state layer's `im` form (openImport /
// importPickKind / importAddFiles / importReview / importRun; a tC3 import adds
// importGoOnline / importUseInstalled for its resource versions, #21). A kind
// whose parser is not in the table (src/data/import/parsers.ts) is shown but
// disabled.
import React from 'react';
import { useApp } from '../../state.jsx';
import { bookName } from '../../data/bookNames';
import { PARSERS } from '../../data/import/parsers';
import { t } from '../../i18n';
import { Modal, Button, OptionCard, Overline, DropZone, Surface, Text, IconButton, KeyValueGrid, StatusDot, Field, Input, Spinner, Callout } from '../../ds/index.js';

/** The three kinds of the design, then the dev-only fake when the table holds it. */
export const importKinds = () => [
  ...['tc3', 'usfm', 'burrito'].map((id) => ({ id, parser: PARSERS.find((p) => p.id === id) ?? null })),
  ...PARSERS.filter((p) => !['tc3', 'usfm', 'burrito'].includes(p.id)).map((p) => ({ id: p.id, parser: p })),
];

const kindText = (id, key) => (['tc3', 'usfm', 'burrito'].includes(id) ? t(`importer.kind.${id}.${key}`) : t(`importer.kind.fake.${key}`));

/** A language code of the design's form: `kau`, `es-419`. */
export const LANGUAGE_CODE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const size = (bytes) => (bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`);

/** "3 chapters · 46 verses · 46 drafted": a verse is drafted when it carries text other than the `___` stub. */
const chapterLine = (usfm) => {
  const chapters = (usfm.match(/^\\c \d+/gm) || []).length;
  // each verse's body up to the next verse or chapter, without markers or word attributes
  const verses = usfm.split(/\\v \d+\S*/).slice(1).map((body) => body.split(/\\c \d+/)[0].replace(/\|[^\\]*/g, '').replace(/\\[^\s\\]*/g, '').trim());
  const drafted = verses.filter((text) => text && text !== '___').length;
  return t(chapters === 1 ? 'importer.review.bookLineOne' : 'importer.review.bookLine', { chapters, verses: verses.length, drafted });
};

function KindStep({ actions }) {
  return (
    <div data-testid="import-kind" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {importKinds().map(({ id, parser }) => (
        <OptionCard key={id} data-testid={`import-kind-${id}`} icon={kindText(id, 'icon')} title={kindText(id, 'title')}
          description={parser ? kindText(id, 'desc') : t('importer.kind.later')} trailing="→"
          disabled={!parser} style={parser ? undefined : { opacity: 0.5, cursor: 'default' }}
          onClick={parser ? () => actions.importPickKind(id) : undefined} />
      ))}
      <Text role="caption" tone="muted" style={{ paddingTop: 6 }}>{t('importer.kind.note')}</Text>
    </div>
  );
}

function FilesStep({ im, actions }) {
  const inputRef = React.useRef(null);
  const add = (list) => { if (list?.length) actions.importAddFiles([...list]); };
  return (
    <div data-testid="import-files" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input ref={inputRef} type="file" multiple data-testid="import-file-input" hidden
        onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
      <DropZone title={kindText(im.kind, 'drop')} hint={kindText(im.kind, 'hint')} data-testid="import-drop"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); add(e.dataTransfer?.files); }} />
      {im.files.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Overline as="span">{im.files.length === 1 ? t('importer.files.one') : t('importer.files.many', { n: im.files.length })}</Overline>
          {im.files.map((f, i) => (
            <Surface key={`${f.name}-${i}`} fill="card" border="line" radius="md" pad="10px 10px 10px 14px" data-testid="import-file">
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 10 }}>
                  <Text role="strong" truncate>{f.name}</Text>
                  <Text role="meta" tone="muted">{size(f.bytes.length)}</Text>
                </div>
                <IconButton variant="plain" title={t('importer.files.remove')} onClick={() => actions.importRemoveFile(i)}>✕</IconButton>
              </div>
            </Surface>
          ))}
        </div>
      )}
    </div>
  );
}

/** The Details row: the fixed text, then a details finding's (a foreign burrito: text only). */
const detailsCheck = (details) => ({
  label: t('importer.review.details'),
  status: details?.warn ? 'warn' : 'valid',
  text: [t('importer.review.detailsText'), details?.text].filter(Boolean).join(' '),
});
const carriedTitle = (kind) => t(kind === 'burrito' ? 'importer.review.carriedTc4' : 'importer.review.carried');

/** The verses with alignment work: a record with at least one aligned target word. A tC3
 * project keeps a record for every verse it opened in the aligner, aligned or not. */
const alignedVerses = (bundle) =>
  Object.values(bundle.alignments ?? {}).flat().filter((r) => (r.alignments ?? []).some((a) => a.bottomWords?.length)).length;

const slotName = (slot) => t(`importer.slot.${slot.startsWith('originalLanguage') ? 'originalLanguage' : slot}`);

/** The Resource versions row of a tC3 import (D82): found versions become
 * pins; offline, go online or use the installed versions; a version that
 * cannot be found, use the installed versions. The decisions of a moved tool
 * carry over (D36), and the counts are shown before the import. */
function ResourcesCheck({ im, actions }) {
  const v = im.versions;
  // owner/repo and tag: two owners can publish a repository of the same name
  const found = Object.values(v?.found ?? {}).map((p) => `${p.repoPath.split('/').slice(1).join('/')} ${p.version}`).join(', ');
  const missing = (v?.unresolved ?? []).map(slotName).join(', ');
  const text = !v || v.looking
    ? t('importer.review.resourcesLooking')
    : v.installed
      ? t('importer.review.resourcesInstalled', { carried: v.installed.carried, invalidated: v.installed.invalidated })
      : v.unresolved.length === 0
        ? t('importer.review.resourcesFound', { list: found })
        : v.offline
          ? t('importer.review.resourcesOffline', { list: missing })
          : t('importer.review.resourcesMissing', { list: missing });
  const open = v && !v.looking && !v.installed && v.unresolved.length > 0;
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }} data-testid="import-resources" data-state={!v || v.looking ? 'looking' : v.installed ? 'installed' : open ? (v.offline ? 'offline' : 'missing') : 'found'}>
      <StatusDot status={open ? 'warn' : 'valid'} size={8} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Text role="strong">{t('importer.review.resources')}</Text>
        <Text role="caption">{text}</Text>
        {open && (
          <div style={{ display: 'flex', gap: 8 }}>
            {v.offline && <Button size="sm" variant="secondary" data-testid="import-go-online" disabled={im.busy} onClick={actions.importGoOnline}>{t('importer.review.goOnline')}</Button>}
            <Button size="sm" variant="secondary" data-testid="import-use-installed" disabled={im.busy} onClick={actions.importUseInstalled}>{t('importer.review.useInstalled')}</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function ReviewStep({ im, actions }) {
  const { bundle } = im;
  const damaged = bundle.findings.find((f) => f.kind === 'damaged');
  const license = bundle.findings.find((f) => f.kind === 'license');
  const missing = bundle.findings.find((f) => f.kind === 'missing-verses');
  const primary = im.lang.startsWith('x-') ? im.lang : im.lang.split('-')[0];
  const langError = !damaged && !LANGUAGE_CODE.test(im.lang) ? t('importer.review.langError') : undefined;
  const checks = [
    { label: t('importer.review.license'), status: license?.warn ? 'warn' : 'valid', text: license?.text ?? t('importer.review.licenseFound') },
    detailsCheck(bundle.findings.find((f) => f.kind === 'details')),
    { label: t('importer.review.missing'), status: missing ? 'warn' : 'valid', text: missing?.text ?? t('importer.review.noneMissing') },
  ];
  return (
    <div data-testid="import-review" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {damaged && (
        <Surface tone="invalid" fill="soft" border="tone" radius="lg" pad="md" role="alert" data-testid="import-damaged" data-code={damaged.code ?? ''}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Text role="strong" tone="tone">{t('importer.review.damagedTitle')}</Text>
            <Text role="ui">{damaged.text}</Text>
            <Text role="meta" tone="muted">{t('importer.review.damagedCode', { code: damaged.code ?? 'import.damaged' })}</Text>
          </div>
        </Surface>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))', gap: 24, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Overline as="span">{t('importer.review.found')}</Overline>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {bundle.books.map((b) => (
              <Surface key={b.code} fill="muted" radius="md" pad="10px 14px" data-testid={`import-book-${b.code}`}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <Text role="strong">{bookName(b.code)}</Text>
                  <Text role="caption" tone="muted">{chapterLine(b.usfm)}</Text>
                </div>
              </Surface>
            ))}
          </div>
          <KeyValueGrid columns={2} items={[
            { k: t('importer.review.books'), v: String(bundle.books.length) },
            { k: t('importer.review.format'), v: kindText(im.kind, 'title') },
            { k: t('importer.review.files'), v: String(im.files.length) },
            { k: t('importer.review.creates'), v: t('importer.review.newBible') },
          ]} />
          {(bundle.alignments || bundle.decisions) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="import-carried">
              <Overline as="span">{carriedTitle(im.kind)}</Overline>
              <KeyValueGrid columns={2} items={[
                ...(bundle.verses !== undefined ? [{ k: t('importer.review.verses'), v: String(bundle.verses) }] : []),
                { k: t('importer.review.alignments'), v: t('importer.review.alignedVerses', { n: alignedVerses(bundle) }) },
                { k: t('importer.review.decisions'), v: String(bundle.decisions?.length ?? 0) },
                ...(bundle.facts.contributors ? [{ k: t('importer.review.contributors'), v: String(bundle.facts.contributors.length) }] : []),
              ]} />
            </div>
          )}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Overline as="span">{t('importer.review.checks')}</Overline>
          {bundle.versions && !damaged && <ResourcesCheck im={im} actions={actions} />}
          {checks.map((c) => (
            <div key={c.label} style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <StatusDot status={c.status} size={8} />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                <Text role="strong">{c.label}</Text>
                <Text role="caption">{c.text}</Text>
              </div>
            </div>
          ))}
          <Surface fill="paper" border="line" radius="lg" pad="md">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <Text role="caption" tone="muted">{t('importer.review.readFromFile')}</Text>
              {bundle.licenseChoices && (
                <Field label={t('importer.review.licensePick')}>
                  <Input as="select" value={im.license} data-testid="import-license" disabled={!!damaged} onChange={(e) => actions.patchIm({ license: e.target.value })}>
                    <option value="">{t('importer.review.licensePickNone')}</option>
                    {bundle.licenseChoices.map((l) => <option key={l} value={l}>{l}</option>)}
                  </Input>
                </Field>
              )}
              <Field label={t('importer.review.name')}>
                <Input value={im.name} data-testid="import-name" disabled={!!damaged} onChange={(e) => actions.patchIm({ name: e.target.value })} />
              </Field>
              <Field label={t('importer.review.lang')} error={langError}
                hint={primary && primary !== im.lang ? t('importer.review.langStored', { primary, tag: im.lang }) : t('importer.review.langHint')}>
                <Input value={im.lang} data-testid="import-lang" disabled={!!damaged} onChange={(e) => actions.patchIm({ lang: e.target.value.trim() })} />
              </Field>
            </div>
          </Surface>
        </div>
      </div>
    </div>
  );
}

function FailedStep({ im }) {
  const code = im.report?.code;
  return (
    <Surface tone="invalid" fill="soft" border="tone" radius="lg" pad="md" role="alert" data-testid="import-failed" data-code={im.report?.code ?? ''}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Text role="strong" tone="tone">{t('importer.failed.title')}</Text>
        <Text role="ui">{code ? t('refusal.' + code, undefined, t('importer.failed.body')) : t('importer.failed.body')}</Text>
        <Text role="meta" tone="muted" style={{ overflowWrap: 'anywhere' }}>{im.report?.code ?? ''} {im.report?.facts?.error ?? ''}</Text>
      </div>
    </Surface>
  );
}

const STEP_TITLES = {
  kind: ['importer.step.kind', 'importer.title', 'importer.subtitle.kind'],
  files: ['importer.step.files', null, 'importer.subtitle.files'],
  review: ['importer.step.review', 'importer.review.title', 'importer.subtitle.review'],
  working: ['importer.step.working', 'importer.working.title', 'importer.subtitle.working'],
  failed: ['importer.step.working', 'importer.failed.heading', 'importer.subtitle.failed'],
};

export default function Import() {
  const { s, actions } = useApp();
  const im = s.im;
  if (s.modal !== 'import' || !im) return null;
  const [stepKey, titleKey, subtitleKey] = STEP_TITLES[im.step];
  const damaged = im.bundle?.findings.some((f) => f.kind === 'damaged');
  const v = im.versions;
  const versionsOpen = !!im.bundle?.versions && !(v && !v.looking && (v.unresolved.length === 0 || v.installed));
  const licenseOpen = !!im.bundle?.licenseChoices && !im.bundle.licenseChoices.includes(im.license);
  const cantImport = damaged || !LANGUAGE_CODE.test(im.lang) || !im.name.trim() || versionsOpen || licenseOpen || im.busy;
  const title = (
    <>
      <Overline as="span" style={{ display: 'block', marginBottom: 8 }}>{t(stepKey)}</Overline>
      {titleKey ? t(titleKey) : kindText(im.kind, 'title')}
    </>
  );
  const subtitle = im.step === 'review' && damaged ? t('importer.subtitle.damaged') : t(subtitleKey);
  const back = (label, to) => <Button variant="ghost" onClick={() => actions.patchIm({ step: to, error: null })}>{label}</Button>;
  const footer = {
    files: <>
      {back(t('importer.files.back'), 'kind')}
      <div style={{ flex: 1 }} />
      <Button variant="secondary" onClick={actions.closeModal}>{t('newBible.cancel')}</Button>
      <Button data-testid="import-to-review" disabled={!im.files.length || im.busy} onClick={actions.importReview}>{t('importer.files.review')}</Button>
    </>,
    review: <>
      {back(t('importer.review.back'), 'files')}
      <div style={{ flex: 1 }} />
      <Button variant="secondary" onClick={actions.closeModal}>{t('newBible.cancel')}</Button>
      <Button data-testid="import-run" disabled={cantImport} onClick={actions.importRun}>{t('importer.review.run')}</Button>
    </>,
    failed: <>
      <Button variant="secondary" onClick={actions.closeModal}>{t('common.close')}</Button>
      <Button data-testid="import-retry" onClick={actions.importRun}>{t('importer.failed.retry')}</Button>
    </>,
  }[im.step] ?? null;

  return (
    <Modal width={im.step === 'review' ? 760 : 560} data-testid="import-modal" title={title} subtitle={subtitle}
      closeLabel={t('common.close')} onClose={im.step === 'working' ? undefined : actions.closeModal} footer={footer}>
      {im.step === 'kind' && <KindStep actions={actions} />}
      {im.step === 'files' && <FilesStep im={im} actions={actions} />}
      {im.step === 'review' && <ReviewStep im={im} actions={actions} />}
      {im.step === 'working' && (
        <div style={{ padding: '26px 0 30px', display: 'flex', justifyContent: 'center' }} data-testid="import-working">
          <Spinner label={im.name ? t('importer.working.named', { name: im.name }) : t('importer.working.label')} />
        </div>
      )}
      {im.step === 'failed' && <FailedStep im={im} />}
      {im.error && <Callout tone="warn" role="alert" data-testid="import-error" style={{ overflowWrap: 'anywhere' }}>{im.error}</Callout>}
    </Modal>
  );
}
