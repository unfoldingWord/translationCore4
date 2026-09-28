// "+ Add a project" (#431; owner design "tC4 Add a Project Dialog"): one
// chooser for the three ways to start. Each card opens its existing dialog in
// place of this one — New Bible, New Open Bible Stories, or Import step 1.
import React from 'react';
import { useApp } from '../../state.jsx';
import { t } from '../../i18n';
import { Modal, OptionCard } from '../../ds/index.js';

export default function AddProject() {
  const { s, actions } = useApp();
  if (s.modal !== 'addProject') return null;
  const cards = [
    { id: 'bible', icon: '+', title: t('home.newBible'), desc: t('addProject.bibleDesc'), pick: actions.openNewProject },
    { id: 'obs', icon: t('home.obsMarker'), title: t('home.newObs'), desc: t('addProject.obsDesc'), pick: actions.openNewObs },
    { id: 'import', icon: '↪', title: t('importer.title'), desc: t('addProject.importDesc'), pick: actions.openImport },
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
