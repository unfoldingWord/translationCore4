// The export menu (issue #375, docs/ARCHITECTURE.md §7): the design system's
// Menu, one item for each producer in the table (src/data/export/producers.ts)
// that applies to the open project. A producer registers in the table and
// never edits a view. With no producer yet, the menu states when the exports
// arrive.
import React from 'react';
import { useApp } from '../state.jsx';
import { t } from '../i18n';
import { Button, Callout, Menu, Text } from '../ds/index.js';
import { PRODUCERS } from '../data/export/producers';

/** A failed export's text: the diagnosis, then the recovery sentence of its code. */
const failureText = (report) => {
  const recovery = report.code ? t('refusal.' + report.code, undefined, '') : '';
  return recovery ? `${report.facts.error} ${recovery}` : String(report.facts.error);
};

export default function ExportMenu() {
  const { s, actions } = useApp();
  const [running, setRunning] = React.useState(false);
  const [failure, setFailure] = React.useState(null);
  const producers = s.project ? PRODUCERS.filter((producer) => producer.appliesTo(s.project)) : [];

  if (producers.length === 0) {
    const later = s.project?.flavor === 'textStories' ? t('cc.exportsLaterObs') : t('cc.exportsLater');
    return <Text role="caption" as="p" data-testid="export-menu-empty">{later}</Text>;
  }

  const run = async (producer) => {
    setRunning(true);
    setFailure(null);
    try {
      const report = await actions.exportFile(producer);
      if (report && !report.ok) setFailure(failureText(report));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div data-testid="export-menu">
      <Menu
        trigger={<Button size="lg" disabled={running} data-testid="export-menu-trigger">{t('cc.export')}</Button>}
        items={producers.map((producer) => ({ label: producer.label, disabled: running, onClick: () => run(producer) }))}
      />
      {failure && <Callout tone="warn" data-testid="export-failure" style={{ marginTop: 10 }}>{failure}</Callout>}
    </div>
  );
}
