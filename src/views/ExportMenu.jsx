// The export menu (issue #375, docs/ARCHITECTURE.md §7): the design system's
// Menu, one item for each producer in the table (src/data/export/producers.ts)
// that applies to the open project. A producer registers in the table and
// never edits a view. With no producer yet, the menu states when the exports
// arrive. `pageSetup` is the preview's page setup, passed to every export (#381).
// The desktop app reports each download's result (#382, D80): the menu says
// "Saved" only after a completed download. A browser reports nothing, so there
// the menu says only that the export is ready.
import React from 'react';
import { useApp } from '../state.jsx';
import { t } from '../i18n';
import { Button, Callout, Menu, Text, Toast } from '../ds/index.js';
import { PRODUCERS } from '../data/export/producers';

/** A failed export's text: the diagnosis, then the recovery sentence of its code. */
const failureText = (report) => {
  const recovery = report.code ? t('refusal.' + report.code, undefined, '') : '';
  return recovery ? `${report.facts.error} ${recovery}` : String(report.facts.error);
};

export default function ExportMenu({ pageSetup }) {
  const { s, actions } = useApp();
  const [running, setRunning] = React.useState(false);
  const [failure, setFailure] = React.useState(null);
  const [notice, setNotice] = React.useState(null); // { tone, message }: the download's toast
  const desktop = globalThis.window?.tc4Desktop?.onDownloadDone;

  // The desktop download report (scripts/preload.cjs): a cancelled save shows
  // no message. The returned remover is the effect's cleanup.
  React.useEffect(() => desktop?.(({ filename, state }) => {
    if (state === 'completed') setNotice({ tone: 'success', message: t('cc.exportSaved', { filename }) });
    else if (state === 'interrupted') setNotice({ tone: 'warn', message: t('cc.exportInterrupted', { filename }) });
    else setNotice(null);
  }), [desktop]);
  const producers = s.project ? PRODUCERS.filter((producer) => producer.appliesTo(s.project)) : [];

  if (producers.length === 0) {
    const later = s.project?.flavor === 'textStories' ? t('cc.exportsLaterObs') : t('cc.exportsLater');
    return <Text role="caption" as="p" data-testid="export-menu-empty">{later}</Text>;
  }

  const run = async (producer) => {
    setRunning(true);
    setFailure(null);
    setNotice(null);
    try {
      const report = await actions.exportFile(producer, pageSetup);
      if (report && !report.ok) setFailure(failureText(report));
      else if (report && !desktop) setNotice({ tone: 'info', message: t('cc.exportReady', { filename: report.facts.filename }) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div data-testid="export-menu">
      <Menu
        trigger={<Button size="lg" disabled={running} data-testid="export-menu-trigger">{t('cc.export')}</Button>}
        items={producers.map((producer) => ({ label: t(producer.label, undefined, producer.label), disabled: running, onClick: () => run(producer) }))}
      />
      {/* The side panel is narrower than the toast's 300px minimum width. */}
      {notice && <Toast tone={notice.tone} message={notice.message} onDismiss={() => setNotice(null)} data-testid="export-toast" style={{ marginTop: 10, '--toast-w-min': '0px' }} />}
      {failure && <Callout tone="warn" data-testid="export-failure" style={{ marginTop: 10 }}>{failure}</Callout>}
    </div>
  );
}
