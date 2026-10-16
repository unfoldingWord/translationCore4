// "+ Add a project" (#431; owner design "tC4 Add a Project Dialog"): one
// chooser for the ways to start. Each card opens its existing dialog in
// place of this one — New Bible, New Open Bible Stories, Import step 1, or
// (#677, owner mockup 2026-10-13, artboard d) Open a project from Door43.
import React from 'react';
import { useApp } from '../../state.jsx';
import { t } from '../../i18n';
import { Modal, OptionCard } from '../../ds/index.js';

// The mockup's icon for the Door43 card: an arrow down to a line (artboard d).
const DOWNLOAD_ICON = (
  <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 4v11" /><path d="M7 10l5 5 5-5" /><path d="M5 20h14" />
  </svg>
);

export default function AddProject() {
  const { s, actions } = useApp();
  if (s.modal !== 'addProject') return null;
  const cards = [
    { id: 'bible', icon: '+', title: t('home.newBible'), desc: t('addProject.bibleDesc'), pick: actions.openNewProject },
    { id: 'obs', icon: t('home.obsMarker'), title: t('home.newObs'), desc: t('addProject.obsDesc'), pick: actions.openNewObs },
    { id: 'import', icon: '↪', title: t('importer.title'), desc: t('addProject.importDesc'), pick: actions.openImport },
    { id: 'door43', icon: DOWNLOAD_ICON, title: t('addProject.door43Title'), desc: t('addProject.door43Desc'), pick: actions.openDoor43Dialog },
  ];
  return (
    <Modal title={t('addProject.title')} subtitle={t('addProject.subtitle')} data-testid="add-project-modal"
      closeLabel={t('common.close')} onClose={actions.closeModal}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, paddingBottom: 18 }}>
        {cards.map((c) => (
          <OptionCard key={c.id} data-testid={`add-project-${c.id}`} icon={c.icon} title={c.title}
            description={c.desc} trailing="→" onClick={c.pick} />
        ))}
      </div>
    </Modal>
  );
}
