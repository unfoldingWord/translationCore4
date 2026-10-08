// The Feedback dialog (#378, D89 point 10): a message to the unfoldingWord
// help desk, as tC3 sends it. "Ask for help" on a refusal banner opens it as a
// Bug Report with the refusal filled in. The attachment shows here exactly as
// it is sent. Opening the dialog and typing in it make no request; Send asks
// "Turn on the internet?" (D95) while the internet is off, and the desktop
// app's main process sends it. The report lives in the state layer's `fb`
// until the app quits; nothing about it is stored.
import React from 'react';
import { useApp } from '../../state.jsx';
import { t } from '../../i18n';
import { CATEGORIES } from '../../data/feedback';
import { Modal, Select, TextArea, TextField, Button, Callout } from '../../ds/index.js';

const CATEGORY_LABEL = {
  'General Feedback': 'feedback.category.general',
  'Content and Resources Feedback': 'feedback.category.content',
  'Bug Report': 'feedback.category.bug',
};
const NOTE = { fontSize: 'var(--fs-caption-lg)', color: 'var(--text-secondary)', lineHeight: 'var(--lh-body)', margin: 0 };

export default function Feedback() {
  const { s, actions } = useApp();
  const fb = s.fb;
  if (s.modal !== 'feedback' || !fb) return null;
  const busy = fb.sending;
  const sent = fb.result === 'sent';

  return (
    <Modal data-testid="feedback" width={600} title={t('feedback.title')} subtitle={t('feedback.subtitle')}
      closeLabel={t('feedback.close')} onClose={actions.closeFeedback}
      footer={sent
        ? <Button onClick={actions.closeFeedback} data-testid="feedback-close">{t('feedback.close')}</Button>
        : <>
          <Button variant="secondary" onClick={actions.closeFeedback} disabled={busy} data-testid="feedback-cancel">{t('feedback.cancel')}</Button>
          <Button onClick={actions.sendFeedback} disabled={busy || !fb.message.trim()} data-testid="feedback-send">
            {busy ? t('feedback.sending') : t('feedback.send')}
          </Button>
        </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {sent ? (
          <Callout tone="success" role="status" data-testid="feedback-result" data-result="sent">{t('feedback.sent')}</Callout>
        ) : (
          <>
            <Select id="fb-category" label={t('feedback.category')} value={fb.category} disabled={busy}
              onChange={(e) => actions.patchFb({ category: e.target.value })}
              options={CATEGORIES.map((c) => ({ value: c, label: t(CATEGORY_LABEL[c]) }))} />
            <TextArea id="fb-message" label={t('feedback.message')} rows={5} value={fb.message} disabled={busy}
              data-testid="feedback-message" onChange={(e) => actions.patchFb({ message: e.target.value })} />
            <TextField id="fb-name" label={t('feedback.name')} value={fb.name} disabled={busy} autoComplete="name"
              onChange={(e) => actions.patchFb({ name: e.target.value })} />
            <TextField id="fb-email" label={t('feedback.email')} hint={t('feedback.emailHint')} type="email" value={fb.email}
              disabled={busy} autoComplete="email" onChange={(e) => actions.patchFb({ email: e.target.value })} />
            <div>
              <p style={NOTE}>{t('feedback.attachment')}</p>
              <pre data-testid="feedback-attachment" style={{ margin: '6px 0 0', maxHeight: 220, overflow: 'auto', whiteSpace: 'pre-wrap',
                overflowWrap: 'anywhere', fontSize: 'var(--fs-caption)', padding: 10, background: 'var(--surface-muted)', borderRadius: 6 }}>
                {fb.attachment}
              </pre>
            </div>
            {fb.result && (
              <Callout tone="warn" role="alert" data-testid="feedback-result" data-result={fb.result}>
                {t('feedback.notSent')} {t(`feedback.reason.${fb.result}`)}
              </Callout>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
