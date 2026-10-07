// The "Language name" field of New Bible and New Open Bible Stories (#492): it
// suggests languages from Door43's list as the user types. A choice fills the
// name, the Code box and the text direction; all three stay editable, and a
// name or a code that is not in the list is as good as before. The list ships
// with the app (src/data/langnames.json) and loads with the first dialog —
// nothing here uses the network.
import React from 'react';
import { useApp } from '../../state.jsx';
import { t } from '../../i18n';
import { SuggestField } from '../../ds/index.js';
import { indexLanguages, languageName, suggestLanguages } from '../../data/languageSearch';

let indexPromise = null;
const loadIndex = () =>
  (indexPromise ??= import('../../data/langnames.json').then((m) => indexLanguages(m.default)));

export default function LanguageNameField({ id }) {
  const { s, actions } = useApp();
  const [index, setIndex] = React.useState(null);
  React.useEffect(() => {
    let live = true;
    loadIndex().then((loaded) => { if (live) setIndex(loaded); });
    return () => { live = false; };
  }, []);

  const query = s.np.langName;
  const suggestions = React.useMemo(
    () => (index ? suggestLanguages(index, query) : []).map((row) => {
      const name = languageName(row);
      return { value: row.lc, label: name, meta: row.ln !== name ? row.ln : undefined, code: row.lc, dir: row.ld };
    }),
    [index, query],
  );

  return (
    <SuggestField id={id} label={t('newBible.langName')} value={query}
      placeholder={t('newBible.langPlaceholder')} suggestions={suggestions}
      onChange={(e) => actions.patchNp({ langName: e.target.value })}
      onChoose={(o) => actions.patchNp({ langName: o.label, code: o.code, dir: o.dir })} />
  );
}
