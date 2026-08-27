import React from 'react';
import { Modal } from '../surfaces/Modal.jsx';
import { Button } from '../core/Button.jsx';
import { Callout } from '../surfaces/Callout.jsx';

/** Modal that asks before something irreversible. The confirm label names the act. */
export function ConfirmDialog({ open = true, title, description, consequence, confirmLabel = 'Continue', cancelLabel = 'Cancel', destructive, onConfirm, onCancel }) {
  return (
    <Modal open={open} title={title} subtitle={description} width={480} onClose={onCancel}
      footer={<>
        <Button variant="secondary" onClick={onCancel}>{cancelLabel}</Button>
        <Button variant={destructive ? 'danger' : 'primary'}
          style={destructive ? { background: 'var(--tc-invalid)', color: '#fff', borderColor: 'var(--tc-invalid)' } : null}
          onClick={onConfirm}>{confirmLabel}</Button>
      </>}>
      {consequence ? <Callout tone="warn">{consequence}</Callout> : null}
    </Modal>
  );
}
